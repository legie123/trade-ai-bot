/**
 * OmegaExtractor — Faza 7: Omega Gladiator Meta-Learning
 *
 * Omega nu tranzacționează direct. El sintetizează intelligence-ul colectiv
 * din top-3 gladiatori și produce un `omegaModifier` (0.7–1.3) care scalează
 * confidence-ul în DualMasterConsciousness.
 *
 * Flux:
 *   cron_dailyRotation → OmegaExtractor.synthesize() → updateOmegaProgress()
 *   → getOmegaModifier(symbol) → injectat în gladiatorDnaContext.confidenceModifier
 *
 * Nu blochează trading-ul. Dacă Omega nu are date, returnează 1.0 (neutru).
 */

import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { getGladiatorDna } from '@/lib/store/db';
import { saveGladiatorsToDb } from '@/lib/store/db';

interface OmegaSynthesis {
  /** Weighted win rate across top-3 gladiators */
  aggregatedWR: number;
  /** Weighted profit factor across top-3 gladiators */
  aggregatedPF: number;
  /** Dominant direction bias: net % of LONG vs SHORT battles */
  directionBias: 'LONG' | 'SHORT' | 'NEUTRAL';
  /** Symbols where top-3 collectively have WR > 55% */
  strongSymbols: string[];
  /** Symbols where top-3 collectively have WR < 40% — avoid */
  weakSymbols: string[];
  /** Global modifier to apply to confidence (0.7–1.3) */
  globalModifier: number;
  /** Per-symbol modifiers for fine-grained control */
  symbolModifiers: Record<string, number>;
  /** Timestamp of last synthesis */
  synthesizedAt: number;
  /** How many gladiators were used */
  gladiatorsUsed: number;
}

// Singleton cache — persists in-memory between cron calls
let cachedSynthesis: OmegaSynthesis | null = null;
const CACHE_TTL_MS = 23 * 60 * 60 * 1000; // 23h — refreshed by daily cron

export class OmegaExtractor {
  private static instance: OmegaExtractor;

  public static getInstance(): OmegaExtractor {
    if (!OmegaExtractor.instance) {
      OmegaExtractor.instance = new OmegaExtractor();
    }
    return OmegaExtractor.instance;
  }

  /**
   * Main synthesis routine. Call this from cron_dailyRotation AFTER TheForge.
   * Aggregates DNA from top-3 gladiators (by score = WR × PF × tradeBonus).
   * Updates Omega gladiator's stats and trainingProgress in the store.
   * Returns the new synthesis or null if insufficient data.
   */
  public async synthesize(): Promise<OmegaSynthesis | null> {
    const allGladiators = gladiatorStore.getGladiators().filter(g => !g.isOmega);

    // Score each gladiator: WR × PF × min(trades/50, 1.0)
    const scored = allGladiators
      .filter(g => g.stats.totalTrades >= 10) // Minimum data threshold
      .map(g => ({
        gladiator: g,
        score: (g.stats.winRate / 100) * g.stats.profitFactor * Math.min(g.stats.totalTrades / 50, 1.0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3); // Top 3 only

    if (scored.length === 0) {
      console.log('[OmegaExtractor] No gladiators with sufficient data for synthesis. Omega stays dormant.');
      return null;
    }

    const totalScore = scored.reduce((s, e) => s + e.score, 0);
    if (totalScore === 0) return null;

    // ── Aggregate DNA battles from Supabase ──
    const symbolWins: Record<string, number> = {};
    const symbolTotal: Record<string, number> = {};
    let totalLongBattles = 0;
    let totalShortBattles = 0;
    let weightedWR = 0;
    let weightedPF = 0;

    for (const { gladiator, score } of scored) {
      const weight = score / totalScore;
      weightedWR += (gladiator.stats.winRate / 100) * weight;
      weightedPF += gladiator.stats.profitFactor * weight;

      // Extract per-symbol stats from DNA
      const rawDna = await this.loadGladiatorBattles(gladiator.id);
      for (const battle of rawDna) {
        const sym = String(battle.symbol ?? '');
        const isWin = battle.is_win === true || battle.is_win === 1;
        const dir = String(battle.decision ?? '');

        if (!sym) continue;
        symbolTotal[sym] = (symbolTotal[sym] ?? 0) + 1;
        if (isWin) symbolWins[sym] = (symbolWins[sym] ?? 0) + 1;
        if (dir === 'LONG') totalLongBattles++;
        if (dir === 'SHORT') totalShortBattles++;
      }
    }

    // ── Direction bias ──
    const totalDirectional = totalLongBattles + totalShortBattles;
    const longRatio = totalDirectional > 0 ? totalLongBattles / totalDirectional : 0.5;
    const directionBias: 'LONG' | 'SHORT' | 'NEUTRAL' =
      longRatio > 0.6 ? 'LONG' : longRatio < 0.4 ? 'SHORT' : 'NEUTRAL';

    // ── Symbol strengths ──
    const strongSymbols: string[] = [];
    const weakSymbols: string[] = [];
    const symbolModifiers: Record<string, number> = {};

    for (const [sym, total] of Object.entries(symbolTotal)) {
      if (total < 5) continue; // Not enough data for this symbol
      const wr = (symbolWins[sym] ?? 0) / total;
      const symMod = this.wrToModifier(wr);
      symbolModifiers[sym] = symMod;
      if (wr >= 0.55) strongSymbols.push(sym);
      if (wr <= 0.38) weakSymbols.push(sym);
    }

    // ── Global modifier ──
    // Based on aggregated WR + PF + direction clarity
    const globalModifier = this.computeGlobalModifier(weightedWR, weightedPF, directionBias);

    const synthesis: OmegaSynthesis = {
      aggregatedWR: parseFloat((weightedWR * 100).toFixed(2)),
      aggregatedPF: parseFloat(weightedPF.toFixed(3)),
      directionBias,
      strongSymbols,
      weakSymbols,
      globalModifier,
      symbolModifiers,
      synthesizedAt: Date.now(),
      gladiatorsUsed: scored.length,
    };

    // ── Persist to Omega gladiator in store ──
    const trainingProgress = Math.min(100, Math.round(weightedWR * 100 + (weightedPF - 1) * 20));
    gladiatorStore.updateOmegaProgress(trainingProgress, {
      winRate: synthesis.aggregatedWR,
      profitFactor: synthesis.aggregatedPF,
      totalTrades: scored.reduce((s, e) => s + e.gladiator.stats.totalTrades, 0),
      sharpeRatio: globalModifier,
    });

    // Save to DB
    const allGlads = gladiatorStore.getGladiators();
    saveGladiatorsToDb(allGlads);

    // Update cache
    cachedSynthesis = synthesis;

    console.log(
      `[OmegaExtractor] Synthesis complete: WR=${synthesis.aggregatedWR}% PF=${synthesis.aggregatedPF} ` +
      `modifier=${globalModifier}x bias=${directionBias} ` +
      `strong=[${strongSymbols.join(',')}] weak=[${weakSymbols.join(',')}] ` +
      `from ${scored.length} gladiators`
    );

    return synthesis;
  }

  /**
   * Returns the confidence modifier for a given symbol.
   * Used by DualMasterConsciousness to scale final confidence.
   *
   * Priority: symbol-specific > global > 1.0 (if no synthesis yet)
   */
  public getModifierForSymbol(symbol: string): number {
    if (!cachedSynthesis) return 1.0;

    // Cache expired — return 1.0 (neutral) until next cron
    if (Date.now() - cachedSynthesis.synthesizedAt > CACHE_TTL_MS) {
      return 1.0;
    }

    // Symbol-specific modifier takes precedence
    if (cachedSynthesis.symbolModifiers[symbol] != null) {
      return cachedSynthesis.symbolModifiers[symbol];
    }

    return cachedSynthesis.globalModifier;
  }

  /**
   * Returns the current synthesis (null if not synthesized yet or cache expired).
   */
  public getCurrentSynthesis(): OmegaSynthesis | null {
    if (!cachedSynthesis) return null;
    if (Date.now() - cachedSynthesis.synthesizedAt > CACHE_TTL_MS) return null;
    return cachedSynthesis;
  }

  /**
   * Returns a human-readable summary for the dashboard / Moltbook broadcast.
   */
  public getSummary(): string {
    const s = this.getCurrentSynthesis();
    if (!s) return 'Omega: dormant — insufficient gladiator data';
    return (
      `Omega Synthesis [${s.gladiatorsUsed}g]: ` +
      `WR=${s.aggregatedWR}% PF=${s.aggregatedPF} ` +
      `Modifier=${s.globalModifier}x Bias=${s.directionBias} ` +
      `Strong=[${s.strongSymbols.slice(0, 3).join(',')}]`
    );
  }

  // ── Private helpers ────────────────────────────────────────

  private async loadGladiatorBattles(gladiatorId: string): Promise<Record<string, unknown>[]> {
    try {
      // getGladiatorDna returns all DNA records from gladiator_battles
      const all = await getGladiatorDna();
      return all.filter((r: Record<string, unknown>) => r.gladiator_id === gladiatorId);
    } catch {
      return [];
    }
  }

  private wrToModifier(wr: number): number {
    // Maps WR 0-1 to modifier 0.7-1.3 (linear, clamped)
    // WR=0.70 → 1.30 | WR=0.50 → 1.00 | WR=0.30 → 0.70
    const raw = 0.7 + (wr / 0.7) * 0.6;
    return parseFloat(Math.min(1.3, Math.max(0.7, raw)).toFixed(2));
  }

  private computeGlobalModifier(wr: number, pf: number, bias: string): number {
    // Base from WR
    let mod = this.wrToModifier(wr);

    // Bonus from PF (PF 1.5 = +0.05, PF < 1.0 = -0.05)
    if (pf >= 1.5) mod += 0.05;
    else if (pf >= 1.2) mod += 0.02;
    else if (pf < 1.0) mod -= 0.05;
    else if (pf < 0.9) mod -= 0.08;

    // Direction clarity bonus (clear bias = higher modifier)
    if (bias !== 'NEUTRAL') mod += 0.03;

    return parseFloat(Math.min(1.3, Math.max(0.7, mod)).toFixed(2));
  }
}

export const omegaExtractor = OmegaExtractor.getInstance();
