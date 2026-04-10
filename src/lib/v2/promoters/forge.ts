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

// ─── LLM call helper (DeepSeek preferred, Gemini fallback) ────
async function callLLMForDNA(prompt: string): Promise<string | null> {
  const timeout = 15_000;

  // Chain: DeepSeek (cheapest) → OpenAI (most capable) → Gemini (fallback)

  // 1. DeepSeek
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          max_tokens: 400,
          temperature: 0.7,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text && text.length > 20) return text;
      }
    } catch {
      log.warn('[The Forge] DeepSeek unavailable, trying OpenAI...');
    }
  }

  // 2. OpenAI (gpt-4o)
  if (process.env.OPENAI_API_KEY) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          max_tokens: 400,
          temperature: 0.7,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text && text.length > 20) return text;
      }
    } catch {
      log.warn('[The Forge] OpenAI unavailable, trying Gemini...');
    }
  }

  // 3. Gemini (final fallback)
  if (process.env.GEMINI_API_KEY) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 400,
              temperature: 0.7,
              responseMimeType: 'application/json',
            },
          }),
          signal: ctrl.signal,
        }
      );
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.length > 20) return text;
      }
    } catch {
      log.warn('[The Forge] Gemini also unavailable. Using deterministic fallback.');
    }
  }

  return null;
}

// ─── Parse LLM DNA response ────────────────────────────────────
function parseDNAFromLLM(text: string): Partial<GladiatorDNA> | null {
  try {
    const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean);
    return parsed as Partial<GladiatorDNA>;
  } catch {
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

export class TheForge {
  private static instance: TheForge;

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

        // ── Step 2: Ask LLM to mutate the crossover ──
        const prompt = `You are a quantitative trading strategy genetic algorithm.

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
}`;

        const llmResponse = await callLLMForDNA(prompt);
        const llmDNA = llmResponse ? parseDNAFromLLM(llmResponse) : null;

        if (llmDNA && llmDNA.rsiOversold !== undefined) {
          // Merge LLM output with crossover base (LLM fills any missing fields)
          const crossoverBase = deterministicCrossover(dnaA, dnaB);
          dna = { ...crossoverBase, ...llmDNA } as GladiatorDNA;
          log.info(`[The Forge] LLM genetic mutation applied for new gladiator in ${arena}`);
        } else {
          // LLM failed → use deterministic crossover
          dna = deterministicCrossover(dnaA, dnaB);
          log.info(`[The Forge] LLM unavailable — using deterministic crossover for ${arena}`);
        }
      } else {
        // No parents → fresh random DNA
        dna = randomDNA();
        log.info(`[The Forge] No parent DNA found — spawning random gladiator in ${arena}`);
      }

      // ── Step 3: Build name from DNA traits ──
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
   */
  public async evaluateAndRecruit(weakLinkIds: string[]): Promise<void> {
    if (weakLinkIds.length === 0) return;

    log.info(`[The Forge] ${weakLinkIds.length} slots open. Forging replacements via genetic mutation...`);

    const newGladiators: Gladiator[] = [];

    for (let i = 0; i < weakLinkIds.length; i++) {
      const gen = await this.spawnNewGladiator();
      if (gen) newGladiators.push(gen);
    }

    if (newGladiators.length > 0) {
      newGladiators.forEach(g => gladiatorStore.addGladiator(g));
      saveGladiatorsToDb(gladiatorStore.getGladiators());
      log.info(`[The Forge] Recruited ${newGladiators.length} new strategies to the Arena.`);
    }
  }
}
