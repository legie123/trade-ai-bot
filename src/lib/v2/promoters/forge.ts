import { Gladiator, ArenaType } from '../../types/gladiator';
import { createLogger } from '@/lib/core/logger';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { saveGladiatorsToDb } from '@/lib/store/db';

const log = createLogger('TheForge');

// ─── DNA Parameter Schema ─────────────────────────────────────
export interface GladiatorDNA {
  timeframeBias: '1m' | '5m' | '15m' | '1h' | '4h';
  rsiOversold: number;        // 20–40 (entry threshold oversold)
  rsiOverbought: number;      // 60–80 (entry threshold overbought)
  vwapDeviation: number;      // 0.1–0.8 (% distance from VWAP to enter)
  stopLossRisk: number;       // 0.005–0.06 (max loss per trade)
  takeProfitTarget: number;   // 0.01–0.15 (TP target)
  momentumWeight: number;     // 0–1 (how much to weight momentum signals)
  contraryBias: number;       // 0–1 (0 = trend following, 1 = contrarian)
  sessionFilter: 'LONDON' | 'NEWYORK' | 'ASIA' | 'ALL';
  bollingerSqueeze: boolean;  // Use BB squeeze as entry filter
  sfpEnabled: boolean;        // Stop Flip Protection enabled
}

// ─── LLM call helper — shared (extracted 2026-04-19) ────
// Was ~100-line inline duplicate of debateEngine.ts. Now delegates to shared callLLM.
import { callLLM } from '@/lib/v2/llm/callLLM';

async function callLLMForDNA(prompt: string): Promise<string | null> {
  return callLLM(prompt, {
    maxTokens: 400,
    temperature: 0.7,       // creative DNA generation
    timeoutMs: 15_000,
    minResponseLength: 20,
    openaiModel: 'gpt-4o',
    geminiModel: 'gemini-2.5-flash',
    caller: 'TheForge',
  });
}

// ─── Parse LLM DNA response ────────────────────────────────────
function parseDNAFromLLM(text: string): Partial<GladiatorDNA> | null {
  try {
    // Robust extraction: find the first '{' and the last '}'
    const startIndex = text.indexOf('{');
    const endIndex = text.lastIndexOf('}');
    if (startIndex === -1 || endIndex === -1) return null;
    
    const clean = text.substring(startIndex, endIndex + 1);
    const parsed = JSON.parse(clean);
    return parsed as Partial<GladiatorDNA>;
  } catch (err) {
    log.error(`[The Forge] Failed to parse LLM JSON: ${err}`);
    return null;
  }
}

// ─── Deterministic genetic crossover fallback ─────────────────
function deterministicCrossover(parentA: GladiatorDNA, parentB: GladiatorDNA): GladiatorDNA {
  const mutate = (v: number, min: number, max: number, variance = 0.15): number => {
    const delta = (Math.random() * 2 - 1) * variance * (max - min);
    return Math.min(max, Math.max(min, v + delta));
  };

  const pick = <T>(a: T, b: T): T => (Math.random() > 0.5 ? a : b);

  return {
    timeframeBias: pick(parentA.timeframeBias, parentB.timeframeBias),
    rsiOversold: Math.round(mutate((parentA.rsiOversold + parentB.rsiOversold) / 2, 20, 40)),
    rsiOverbought: Math.round(mutate((parentA.rsiOverbought + parentB.rsiOverbought) / 2, 60, 80)),
    vwapDeviation: parseFloat(mutate((parentA.vwapDeviation + parentB.vwapDeviation) / 2, 0.1, 0.8).toFixed(2)),
    stopLossRisk: parseFloat(mutate((parentA.stopLossRisk + parentB.stopLossRisk) / 2, 0.005, 0.06).toFixed(4)),
    takeProfitTarget: parseFloat(mutate((parentA.takeProfitTarget + parentB.takeProfitTarget) / 2, 0.01, 0.15).toFixed(4)),
    momentumWeight: parseFloat(mutate((parentA.momentumWeight + parentB.momentumWeight) / 2, 0, 1).toFixed(2)),
    contraryBias: parseFloat(mutate((parentA.contraryBias + parentB.contraryBias) / 2, 0, 1).toFixed(2)),
    sessionFilter: pick(parentA.sessionFilter, parentB.sessionFilter),
    bollingerSqueeze: pick(parentA.bollingerSqueeze, parentB.bollingerSqueeze),
    sfpEnabled: pick(parentA.sfpEnabled, parentB.sfpEnabled),
  };
}

// ─── Random fresh DNA (when no parents available) ─────────────
function randomDNA(): GladiatorDNA {
  const timeframes: GladiatorDNA['timeframeBias'][] = ['1m', '5m', '15m', '1h', '4h'];
  const sessions: GladiatorDNA['sessionFilter'][] = ['LONDON', 'NEWYORK', 'ASIA', 'ALL'];
  return {
    timeframeBias: timeframes[Math.floor(Math.random() * timeframes.length)],
    rsiOversold: Math.floor(Math.random() * 20) + 20,
    rsiOverbought: Math.floor(Math.random() * 20) + 60,
    vwapDeviation: parseFloat((Math.random() * 0.7 + 0.1).toFixed(2)),
    stopLossRisk: parseFloat((Math.random() * 0.055 + 0.005).toFixed(4)),
    takeProfitTarget: parseFloat((Math.random() * 0.14 + 0.01).toFixed(4)),
    momentumWeight: parseFloat(Math.random().toFixed(2)),
    contraryBias: parseFloat(Math.random().toFixed(2)),
    sessionFilter: sessions[Math.floor(Math.random() * sessions.length)],
    bollingerSqueeze: Math.random() > 0.5,
    sfpEnabled: Math.random() > 0.4,
  };
}

// ─── Get DNA from existing gladiator (or generate random) ─────
function extractDNA(g: Gladiator): GladiatorDNA {
  const stored = (g as Gladiator & { dnaConfig?: Partial<GladiatorDNA> }).dnaConfig;
  if (stored && stored.rsiOversold !== undefined) {
    return { ...randomDNA(), ...stored } as GladiatorDNA;
  }
  // Legacy DNA format upgrade
  if (stored && (stored as Record<string, unknown>).rsiThreshold !== undefined) {
    const legacy = stored as Record<string, unknown>;
    const base = randomDNA();
    base.rsiOversold = Number(legacy.rsiThreshold) || 30;
    base.stopLossRisk = Number(legacy.stopLossRisk) || 0.02;
    base.takeProfitTarget = Number(legacy.takeProfitTarget) || 0.05;
    return base;
  }
  return randomDNA();
}

// ─── DNA Sanity Filter — reject obviously broken strategies ──────
function isDNASane(dna: GladiatorDNA): { pass: boolean; reason?: string } {
  // Risk/Reward ratio must be > 1.0 (TP target must exceed SL risk)
  const rrRatio = dna.takeProfitTarget / dna.stopLossRisk;
  if (rrRatio < 1.0) {
    return { pass: false, reason: `R:R ratio ${rrRatio.toFixed(2)} < 1.0 (TP ${(dna.takeProfitTarget*100).toFixed(2)}% < SL ${(dna.stopLossRisk*100).toFixed(2)}%)` };
  }

  // RSI thresholds must not overlap (oversold must be < overbought)
  if (dna.rsiOversold >= dna.rsiOverbought) {
    return { pass: false, reason: `RSI overlap: oversold ${dna.rsiOversold} >= overbought ${dna.rsiOverbought}` };
  }

  // RSI gap must be meaningful (at least 20 points)
  if ((dna.rsiOverbought - dna.rsiOversold) < 20) {
    return { pass: false, reason: `RSI gap too narrow: ${dna.rsiOverbought - dna.rsiOversold} < 20` };
  }

  // Stop loss can't be wider than take profit by 2x (guaranteed losing system)
  if (dna.stopLossRisk > dna.takeProfitTarget * 2) {
    return { pass: false, reason: `SL ${(dna.stopLossRisk*100).toFixed(2)}% > 2x TP ${(dna.takeProfitTarget*100).toFixed(2)}%` };
  }

  return { pass: true };
}

// ─── Mini-Backtester: Quick simulation of DNA against recent price moves ─
// Uses last N phantom trade results from existing gladiators as a proxy market.
// If DNA's parameters would have produced > 60% losses in this sample, REJECT.
async function miniBacktest(dna: GladiatorDNA): Promise<{ pass: boolean; estimatedWR: number; sampleSize: number }> {
  try {
    const { getGladiatorBattles } = await import('@/lib/store/db');
    // Collect recent battles from top gladiators as proxy market data
    const { gladiatorStore: store } = await import('@/lib/store/gladiatorStore');
    const topGladiators = store.getLeaderboard().filter(g => g.stats.totalTrades >= 10).slice(0, 3);

    if (topGladiators.length === 0) {
      // No historical data to backtest against — pass by default (system is bootstrapping)
      return { pass: true, estimatedWR: 50, sampleSize: 0 };
    }

    // R4a (2026-04-18): enforce rolling time window on mini-backtest sample.
    // Previous behavior fetched last-50 regardless of timestamp → pre-QW-11
    // trades (polluted PnL signs + old regime) leaked into DNA screening,
    // propagating memorization into newly-forged gladiators. Limiting to
    // FORGE_BACKTEST_WINDOW_DAYS (default 7) forces Forge to validate DNA
    // against *current* market behavior only.
    // Assumption: >=10 battles exist in the last 7d at top-gladiator level.
    // If not → allBattles.length < 10 falls through to bootstrap-pass at L257,
    // which is the intended safe behavior.
    // Kill-switch: env FORGE_BACKTEST_WINDOW_DAYS=365 reverts to pre-R4a.
    const WINDOW_DAYS = parseInt(process.env.FORGE_BACKTEST_WINDOW_DAYS || '7', 10);
    const SINCE_MS = Date.now() - WINDOW_DAYS * 86_400_000;

    // Gather recent battles as market proxy
    const allBattles: Array<{ pnlPercent: number; entryPrice: number; outcomePrice: number; decision: string }> = [];
    for (const g of topGladiators) {
      const battles = await getGladiatorBattles(g.id, 50);
      const fresh = battles.filter(b => {
        const ts = Date.parse(String(b.timestamp || ''));
        return Number.isFinite(ts) && ts >= SINCE_MS;
      });
      allBattles.push(...fresh.map(b => ({
        pnlPercent: Number(b.pnlPercent) || 0,
        entryPrice: Number(b.entryPrice) || 0,
        outcomePrice: Number(b.outcomePrice) || 0,
        decision: String(b.decision || 'LONG'),
      })));
    }

    if (allBattles.length < 10) {
      return { pass: true, estimatedWR: 50, sampleSize: allBattles.length };
    }

    // Simulate: Would this DNA's parameters have filtered differently?
    // Apply DNA's SL/TP thresholds to each historical price movement
    let wins = 0;
    let losses = 0;

    for (const battle of allBattles) {
      const priceMove = Math.abs((battle.outcomePrice - battle.entryPrice) / battle.entryPrice);

      // DNA would have hit TP first
      if (priceMove >= dna.takeProfitTarget && battle.pnlPercent > 0) {
        wins++;
      }
      // DNA would have hit SL first
      else if (priceMove >= dna.stopLossRisk && battle.pnlPercent <= 0) {
        losses++;
      }
      // Small move — DNA's momentum/contrary bias decides
      else {
        const trendBias = dna.momentumWeight > 0.5 ? 1 : -1;
        const signalCorrect = (battle.pnlPercent > 0 && trendBias > 0) || (battle.pnlPercent <= 0 && trendBias < 0);
        if (signalCorrect) wins++;
        else losses++;
      }
    }

    const total = wins + losses;
    const estimatedWR = total > 0 ? (wins / total) * 100 : 50;

    // DNA must show > 35% estimated WR to pass pre-screening
    // (lower than live threshold of 45% because this is a rough estimate)
    return {
      pass: estimatedWR >= 35,
      estimatedWR: parseFloat(estimatedWR.toFixed(1)),
      sampleSize: total,
    };
  } catch {
    // If backtest fails for any reason, don't block spawning
    return { pass: true, estimatedWR: 50, sampleSize: 0 };
  }
}

export class TheForge {
  private static instance: TheForge;
  private static readonly MAX_SPAWN_RETRIES = 3; // Max retries if DNA fails pre-screening

  private constructor() {}

  public static getInstance(): TheForge {
    if (!TheForge.instance) {
      TheForge.instance = new TheForge();
    }
    return TheForge.instance;
  }

  /**
   * Generates a new gladiator via LLM-driven genetic mutation.
   * If top performers exist, their DNA is crossed over and mutated by the LLM.
   * Falls back to deterministic crossover → random DNA if LLM is unavailable.
   */
  public async spawnNewGladiator(): Promise<Gladiator | null> {
    try {
      const arenas: ArenaType[] = ['SCALPING', 'DAY_TRADING', 'SWING', 'DEEP_WEB'];
      const arena = arenas[Math.floor(Math.random() * arenas.length)];

      // ── Step 1: Get top 3 parents from leaderboard ──
      const leaderboard = gladiatorStore.getLeaderboard().filter(
        g => g.stats.totalTrades >= 5 && g.stats.winRate > 0
      );
      const parentA = leaderboard[0];
      const parentB = leaderboard[1] || leaderboard[0];

      let dna: GladiatorDNA;

      if (parentA && parentB) {
        const dnaA = extractDNA(parentA);
        const dnaB = extractDNA(parentB);

        // ── Step 2: Ask LLM to mutate the crossover (The Anvil Repair Loop) ──
        const basePrompt = `You are a quantitative trading strategy genetic algorithm.

Two parent trading strategies (gladiators) performed well. Create a MUTATED OFFSPRING strategy by combining and slightly varying their parameters. The offspring must be DIFFERENT from both parents — do not just copy.

Parent A (WR: ${parentA.stats.winRate.toFixed(1)}%, PF: ${parentA.stats.profitFactor.toFixed(2)}):
${JSON.stringify(dnaA)}

Parent B (WR: ${parentB.stats.winRate.toFixed(1)}%, PF: ${parentB.stats.profitFactor.toFixed(2)}):
${JSON.stringify(dnaB)}

Return ONLY a valid JSON object (no markdown) with these exact fields:
{
  "timeframeBias": "1m"|"5m"|"15m"|"1h"|"4h",
  "rsiOversold": <integer 20-40>,
  "rsiOverbought": <integer 60-80>,
  "vwapDeviation": <float 0.1-0.8>,
  "stopLossRisk": <float 0.005-0.06>,
  "takeProfitTarget": <float 0.01-0.15>,
  "momentumWeight": <float 0-1>,
  "contraryBias": <float 0-1>,
  "sessionFilter": "LONDON"|"NEWYORK"|"ASIA"|"ALL",
  "bollingerSqueeze": true|false,
  "sfpEnabled": true|false
}
CRITICAL RULE: "takeProfitTarget" MUST BE AT LEAST 1.5x GREATER THAN "stopLossRisk" (R:R > 1.5).`;

        let llmDNA: Partial<GladiatorDNA> | null = null;
        let attempt = 0;
        let lastError = '';

        while (attempt < 3 && !llmDNA) {
          const promptWithFeedback = lastError
            ? basePrompt + `\n\nERROR IN YOUR PREVIOUS GENERATION:\n${lastError}\n\nFIX YOUR MISTAKES AND RETURN A VALID DNA JSON.`
            : basePrompt;

          const llmResponse = await callLLMForDNA(promptWithFeedback);
          if (llmResponse) {
            const parsed = parseDNAFromLLM(llmResponse);
            if (parsed && parsed.rsiOversold !== undefined && parsed.stopLossRisk !== undefined && parsed.takeProfitTarget !== undefined) {
              const base = deterministicCrossover(dnaA, dnaB);
              const testDna = { ...base, ...parsed } as GladiatorDNA;
              const sanity = isDNASane(testDna);
              
              if (!sanity.pass) {
                lastError = `Sanity Check Failed: ${sanity.reason}. You must obey trading logic constraints.`;
                log.warn(`[The Forge] LLM DNA Failed Sanity (Attempt ${attempt + 1}): ${sanity.reason}`);
              } else {
                llmDNA = parsed;
              }
            } else {
              lastError = "Invalid JSON structure or missing critical fields.";
              log.warn(`[The Forge] LLM DNA Structure Invalid (Attempt ${attempt + 1})`);
            }
          } else {
             break; // Network or provider failure, exit loop
          }
          attempt++;
        }

        if (llmDNA) {
          // Merge LLM output with crossover base (LLM fills any missing fields)
          const crossoverBase = deterministicCrossover(dnaA, dnaB);
          dna = { ...crossoverBase, ...llmDNA } as GladiatorDNA;
          log.info(`[The Forge] LLM genetic mutation success on attempt ${attempt} for ${arena}`);
        } else {
          // LLM failed → use deterministic crossover
          dna = deterministicCrossover(dnaA, dnaB);
          log.info(`[The Forge] LLM completely failed — using deterministic crossover for ${arena}`);
        }
      } else {
        // No parents → fresh random DNA
        dna = randomDNA();
        log.info(`[The Forge] No parent DNA found — spawning random gladiator in ${arena}`);
      }

      // ── Step 3: PRE-SCREENING — Sanity Check + Mini-Backtest ──
      const sanity = isDNASane(dna);
      if (!sanity.pass) {
        log.warn(`[The Forge] DNA REJECTED (sanity): ${sanity.reason}`);
        return null;
      }

      const backtest = await miniBacktest(dna);
      if (!backtest.pass) {
        log.warn(`[The Forge] DNA REJECTED (backtest): Estimated WR ${backtest.estimatedWR}% on ${backtest.sampleSize} samples — below 35% threshold`);
        return null;
      }
      log.info(`[The Forge] DNA PASSED pre-screening: Sanity OK, Backtest WR ~${backtest.estimatedWR}% (${backtest.sampleSize} samples)`);

      // ── Step 4: Build name from DNA traits ──
      const styleTag = dna.contraryBias > 0.6 ? 'Contrarian' : dna.momentumWeight > 0.6 ? 'Momentum' : 'Balanced';
      const tfTag = dna.timeframeBias.toUpperCase();
      const sessionTag = dna.sessionFilter === 'ALL' ? 'Omni' : dna.sessionFilter;
      const uniqueName = `G-${styleTag}-${tfTag}-${sessionTag}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;

      const newGladiator: Gladiator & { dnaConfig: GladiatorDNA } = {
        id: `g_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        name: uniqueName,
        arena,
        rank: 99,
        isLive: false,
        stats: {
          winRate: 0,
          profitFactor: 1.0,
          maxDrawdown: 0,
          sharpeRatio: 0,
          totalTrades: 0,
        },
        status: 'IN_TRAINING',
        trainingProgress: 0,
        lastUpdated: Date.now(),
        dnaConfig: dna,
      };

      log.info(`[The Forge] Spawned: ${newGladiator.name} | Arena: ${arena} | DNA: RSI ${dna.rsiOversold}/${dna.rsiOverbought}, TF ${dna.timeframeBias}, SL ${(dna.stopLossRisk * 100).toFixed(2)}%, TP ${(dna.takeProfitTarget * 100).toFixed(2)}%`);
      return newGladiator;

    } catch (err) {
      log.error('[The Forge] Failed to spawn:', { error: (err as Error).message });
      return null;
    }
  }

  /**
   * Replaces eliminated weak gladiators with freshly forged offspring.
   * INSTITUTIONAL FIX: Spawns all gladiators in parallel via Promise.allSettled
   * instead of sequential for-loop (eliminates N*15s latency).
   */
  /**
   * Spawns a gladiator with retry — if DNA fails pre-screening, re-rolls up to MAX_SPAWN_RETRIES times.
   */
  private async spawnWithRetry(): Promise<Gladiator | null> {
    for (let attempt = 1; attempt <= TheForge.MAX_SPAWN_RETRIES; attempt++) {
      const g = await this.spawnNewGladiator();
      if (g) return g;
      log.info(`[The Forge] Spawn attempt ${attempt}/${TheForge.MAX_SPAWN_RETRIES} failed pre-screening, retrying...`);
    }
    log.warn(`[The Forge] All ${TheForge.MAX_SPAWN_RETRIES} spawn attempts failed pre-screening.`);
    return null;
  }

  /**
   * Replaces eliminated weak gladiators with freshly forged offspring.
   * INSTITUTIONAL: Spawns in parallel with retry for DNA pre-screening rejects.
   */
  public async evaluateAndRecruit(weakLinkIds: string[]): Promise<void> {
    if (weakLinkIds.length === 0) return;

    log.info(`[The Forge] ${weakLinkIds.length} slots open. Forging replacements via parallel genetic mutation + pre-screening...`);

    const results = await Promise.allSettled(
      weakLinkIds.map(() => this.spawnWithRetry())
    );

    const newGladiators: Gladiator[] = results
      .filter((r): r is PromiseFulfilledResult<Gladiator | null> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter((g): g is Gladiator => g !== null);

    const failures = results.filter(r => r.status === 'rejected').length;
    const prescreenRejects = weakLinkIds.length - newGladiators.length - failures;
    if (failures > 0 || prescreenRejects > 0) {
      log.warn(`[The Forge] ${newGladiators.length}/${weakLinkIds.length} recruited. ${prescreenRejects} rejected by pre-screening, ${failures} errored.`);
    }

    if (newGladiators.length > 0) {
      newGladiators.forEach(g => gladiatorStore.addGladiator(g));
      saveGladiatorsToDb(gladiatorStore.getGladiators());
      log.info(`[The Forge] Recruited ${newGladiators.length} new strategies to the Arena.`);
    }
  }
}
