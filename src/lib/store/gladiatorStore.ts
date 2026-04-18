import { INITIAL_STRATEGIES } from './seedStrategies';
import { Gladiator, ArenaType } from '../types/gladiator';
import { getGladiatorsFromDb, saveGladiatorsToDb } from '@/lib/store/db';
import { WalkForwardEngine } from '@/lib/v2/validation/walkForwardEngine';
import type { WalkForwardResult } from '@/lib/v2/validation/walkForwardEngine';

/**
 * Singleton for managing the Gladiator Ranks and Arenas for Phoenix V2.
 */
class GladiatorStore {
  private static instance: GladiatorStore;
  private gladiators: Gladiator[] = [];
  private lastRecalibrateTime: number = 0;
  /** Walk-forward validation cache: gladiatorId → result. Updated by runWalkForwardGate(). */
  private wfCache = new Map<string, WalkForwardResult>();

  private constructor() {}

  public static getInstance(): GladiatorStore {
    if (!GladiatorStore.instance) {
      GladiatorStore.instance = new GladiatorStore();
    }
    return GladiatorStore.instance;
  }

  private ensureLoaded() {
    if (this.gladiators.length > 0) return;
    const fromDb = getGladiatorsFromDb();
    if (fromDb && fromDb.length > 0) {
      this.gladiators = fromDb;
    } else {
      this.seedGladiators();
    }
  }

  private seedGladiators() {
    // Map initial strategies to the 4 Phoenix Arenas
    // INSTITUTIONAL RULE: All stats start at ZERO. No gladiator gets live access
    // until it earns it through 20+ real phantom trades via the Darwinian loop.
    this.gladiators = INITIAL_STRATEGIES.map((strat, index) => {
      let arena: ArenaType = 'DAY_TRADING';
      if (strat.id.toLowerCase().includes('scalp')) arena = 'SCALPING';
      if (strat.id.toLowerCase().includes('swing') || strat.id.toLowerCase().includes('follow')) arena = 'SWING';
      if (strat.id.toLowerCase().includes('solana') || strat.id.toLowerCase().includes('eco')) arena = 'DEEP_WEB';

      const rank = index + 1;

      return {
        id: strat.id,
        name: strat.name,
        arena,
        rank,
        isLive: false, // NO gladiator gets live capital until proven via phantom trades
        status: 'IN_TRAINING' as const,
        trainingProgress: 0,
        skills: arena === 'DEEP_WEB' ? ['MEME_SNIPER'] : [],
        stats: {
          winRate: 0,
          profitFactor: 1.0,
          maxDrawdown: 0,
          sharpeRatio: 0,
          totalTrades: 0,
        },
        lastUpdated: Date.now(),
      };
    });

    // Seed the ultimate Omega Gladiator
    this.gladiators.push({
      id: 'OMEGA-GLADIATOR',
      name: 'Super-AI (Omega)',
      arena: 'DAY_TRADING', // Can be any arena
      rank: 0, // God rank
      isLive: false,
      isOmega: true,
      status: 'IN_TRAINING',
      trainingProgress: 0,
      stats: {
        winRate: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        totalTrades: 0,
      },
      lastUpdated: Date.now(),
    });
    // NOTE: Do NOT saveGladiatorsToDb here — seed is a local-only fallback.
    // Saving seeded data would overwrite real Supabase state (isLive, stats)
    // on every cold start before initDB has a chance to load real data.
  }

  /**
   * Force-reload gladiators from db.ts cache (call after initDB completes).
   * Fixes race condition: gladiatorStore singleton seeds defaults on import,
   * before initDB loads real data from Supabase json_store.
   */
  public reloadFromDb(): void {
    const fromDb = getGladiatorsFromDb();
    if (fromDb && fromDb.length > 0) {
      this.gladiators = fromDb;
    }
  }

  public getGladiators(): Gladiator[] {
    this.ensureLoaded();
    return this.gladiators;
  }

  // AUDIT FIX BUG-3: Single canonical ranking function using readinessScore
  public getLeaderboard(): Gladiator[] {
    this.ensureLoaded();
    return this.gladiators
      .filter(g => !g.isOmega)
      .sort((a, b) => {
        // Primary: readinessScore (composite metric)
        const scoreA = (a.stats as Record<string, unknown>).readinessScore as number ?? this.computeQuickScore(a);
        const scoreB = (b.stats as Record<string, unknown>).readinessScore as number ?? this.computeQuickScore(b);
        if (scoreB !== scoreA) return scoreB - scoreA;
        // Tiebreaker: profitFactor × winRate
        return (b.stats.profitFactor * b.stats.winRate) - (a.stats.profitFactor * a.stats.winRate);
      });
  }

  // Quick score fallback if readinessScore not yet computed
  private computeQuickScore(g: Gladiator): number {
    const wr = Math.min(100, Math.max(0, g.stats.winRate));
    const pf = Math.min(100, Math.max(0, g.stats.profitFactor * 25));
    const dd = Math.max(0, 100 - g.stats.maxDrawdown * 3);
    return wr * 0.40 + pf * 0.35 + dd * 0.25;
  }

  public updateGladiatorStats(id: string, tick: { pnlPercent: number, isWin: boolean }) {
    this.ensureLoaded();
    const gladiator = this.gladiators.find(g => g.id === id);
    if (!gladiator) return;

    // Initialize tracking fields if missing (migration from old format)
    const ext = gladiator as Gladiator & { _totalWinPnl?: number; _totalLossPnl?: number; _peakEquity?: number; _currentEquity?: number };
    if (ext._totalWinPnl === undefined) ext._totalWinPnl = 0;
    if (ext._totalLossPnl === undefined) ext._totalLossPnl = 0;
    if (ext._peakEquity === undefined) ext._peakEquity = 100;
    if (ext._currentEquity === undefined) ext._currentEquity = 100;

    gladiator.stats.totalTrades += 1;
    const total = gladiator.stats.totalTrades;

    if (tick.isWin) {
      const prevWins = (gladiator.stats.winRate / 100) * (total - 1);
      gladiator.stats.winRate = ((prevWins + 1) / total) * 100;
      ext._totalWinPnl += Math.abs(tick.pnlPercent);
    } else {
      const prevWins = (gladiator.stats.winRate / 100) * (total - 1);
      gladiator.stats.winRate = (prevWins / total) * 100;
      ext._totalLossPnl += Math.abs(tick.pnlPercent);
    }

    // Real ProfitFactor = total win PnL / total loss PnL
    // FIX 2026-04-18 (QW-6): Eliminat fallback artificial PF=99. Cauza: gladiator cu 0 losses
    // primea PF=99 care trivializa gate-ul de promovare (criteriul `PF >= 1.1` era automat satisfăcut
    // după chiar 1 win, înainte ca regimul de pierdere să fi fost observat → promovare prematură).
    // Nou: PF rămâne 1.0 neutru până avem cel puțin un loss înregistrat (denominator real).
    // Asumpție care, dacă se rupe, invalidează logica: _totalLossPnl e acumulat corect la fiecare
    // loss (verificat linia 140). Dacă acumularea eșuează, PF va rămâne 1.0 la infinit → gladiatorul
    // nu se promovează, fail-safe pe partea conservatoare.
    gladiator.stats.profitFactor = ext._totalLossPnl > 0
      ? parseFloat((ext._totalWinPnl / ext._totalLossPnl).toFixed(2))
      : 1.0; // PF nedefinit fără pierderi → neutru, NU 99. Blochează promovare prematură.

    // Real MaxDrawdown = peak-to-trough on equity curve
    ext._currentEquity *= (1 + tick.pnlPercent / 100);
    if (ext._currentEquity > ext._peakEquity) ext._peakEquity = ext._currentEquity;
    const dd = ext._peakEquity > 0 ? ((ext._peakEquity - ext._currentEquity) / ext._peakEquity) * 100 : 0;
    gladiator.stats.maxDrawdown = parseFloat(Math.max(gladiator.stats.maxDrawdown, dd).toFixed(2));
    gladiator.lastUpdated = Date.now();
    
    // Trigger auto-promote/demote max once every 60s to prevent V8 Event Loop Thrashing
    const now = Date.now();
    if (now - this.lastRecalibrateTime > 60000) {
       this.recalibrateRanks();
       this.lastRecalibrateTime = now;
    }
    
    saveGladiatorsToDb(this.gladiators);
  }

  /**
   * AUTO-PROMOTE / DEMOTE ENGINE
   * Re-ranks gladiators per arena by performance score.
   * Only the Top 3 per arena get isLive = true (real capital access).
   * This creates Darwinian selection pressure.
   */
  public recalibrateRanks(): void {
    this.ensureLoaded();
    const nonOmega = this.gladiators.filter(g => !g.isOmega);
    
    // Group by arena
    const arenaGroups = new Map<ArenaType, Gladiator[]>();
    for (const g of nonOmega) {
      const group = arenaGroups.get(g.arena) || [];
      group.push(g);
      arenaGroups.set(g.arena, group);
    }

    for (const [, group] of arenaGroups) {
      // Performance score: normalized components (all 0-100 scale)
      const scored = group.map(g => {
        const wrScore = g.stats.winRate; // 0-100
        const pfScore = Math.min(g.stats.profitFactor / 3.0, 1.0) * 100; // PF 3.0 = max 100
        const recencyBonus = (Date.now() - g.lastUpdated) < 3600_000 ? 10 : 0;
        const tradeBonus = Math.min(g.stats.totalTrades / 50, 1.0) * 15; // 50 trades = full 15pts
        const ddPenalty = g.stats.maxDrawdown > 15 ? -20 : g.stats.maxDrawdown > 10 ? -10 : 0;
        const score = (wrScore * 0.4) + (pfScore * 0.35) + recencyBonus + tradeBonus + ddPenalty;
        return { gladiator: g, score };
      });

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      // Assign ranks and live status
      // INSTITUTIONAL RULE: Only gladiators with 20+ trades AND WR >= 40% AND PF >= 1.0
      // can compete for live capital slots. Raw rank alone is insufficient.
      scored.forEach((entry, index) => {
        entry.gladiator.rank = index + 1;
        const meetsThreshold = entry.gladiator.stats.totalTrades >= 20
          && entry.gladiator.stats.winRate >= 45   // Hardened from 40% — institutional gate
          && entry.gladiator.stats.profitFactor >= 1.1; // Hardened from 1.0 — must prove edge
        // Walk-Forward gate (Step 2.3): OVERFIT gladiators cannot go live
        const wfResult = this.wfCache.get(entry.gladiator.id);
        const wfClean = !wfResult || wfResult.verdict !== 'OVERFIT';
        entry.gladiator.isLive = index < 3 && meetsThreshold && wfClean;
      });
    }
  }

  /**
   * Run Walk-Forward validation for all gladiators (async).
   * Call this periodically (e.g., every hour or after Butcher cycle).
   * Results are cached and used by recalibrateRanks() synchronously.
   *
   * Step 2.3 integration: OVERFIT gladiators blocked from live promotion.
   */
  public async runWalkForwardGate(): Promise<void> {
    const wf = WalkForwardEngine.getInstance();
    const candidates = this.gladiators.filter(g => !g.isOmega && g.stats.totalTrades >= 30);

    for (const g of candidates) {
      try {
        const result = await wf.validate(g.id);
        this.wfCache.set(g.id, result);
      } catch {
        // Fail-open: if WF errors, don't block the gladiator
      }
    }
  }

  /** Get walk-forward result for a specific gladiator (from cache). */
  public getWalkForwardResult(gladiatorId: string): WalkForwardResult | null {
    return this.wfCache.get(gladiatorId) ?? null;
  }

  /**
   * Finds the best candidate gladiator to handle an incoming signal.
   * Priority: Top Rank (isLive = true) for the given symbol's typical arena.
   * Prefers gladiators who were recently active and have higher win rates.
   */
  public findBestGladiator(symbol: string): Gladiator | undefined {
    this.ensureLoaded();
    const preferredArena: ArenaType = symbol.includes('SOL') || symbol.includes('WIF') ? 'DEEP_WEB' : 'DAY_TRADING';
    
    const candidates = this.gladiators
      .filter(g => g.arena === preferredArena && g.isLive && !g.isOmega);

    if (candidates.length === 0) {
      // Fallback: any live gladiator
      return this.gladiators
        .filter(g => g.isLive && !g.isOmega)
        .sort((a, b) => a.rank - b.rank)[0];
    }

    return candidates.sort((a, b) => a.rank - b.rank)[0];
  }

  public updateOmegaProgress(progress: number, stats?: Partial<Gladiator['stats']>): void {
    this.ensureLoaded();
    const omega = this.gladiators.find(g => g.isOmega);
    if (omega) {
      omega.trainingProgress = Math.min(100, Math.max(0, progress));
      if (stats) {
        omega.stats = { ...omega.stats, ...stats };
      }
      if (omega.trainingProgress >= 100 && omega.status === 'IN_TRAINING') {
        omega.status = 'ACTIVE';
        omega.isLive = true;
      }
      omega.lastUpdated = Date.now();
      saveGladiatorsToDb(this.gladiators);
    }
  }
  public hydrate(gladiators: Gladiator[]): void {
    this.gladiators = gladiators;
  }

  /**
   * Evaluates if there is at least one active (Live) gladiator possessing the required skill.
   */
  public hasSkillLive(skill: string): boolean {
    this.ensureLoaded();
    return this.gladiators.some(g => g.isLive && g.skills && g.skills.includes(skill));
  }

  public addGladiator(gladiator: Gladiator): void {
    this.ensureLoaded();
    const exists = this.gladiators.findIndex(g => g.id === gladiator.id);
    if (exists !== -1) {
      this.gladiators[exists] = gladiator;
    } else {
      this.gladiators.push(gladiator);
    }
    this.recalibrateRanks();
    saveGladiatorsToDb(this.gladiators);
  }

  /**
   * RESET ALL STATS — One-shot recovery after TP/SL asymmetry fix (QW-7).
   *
   * Motivație: simulator-ul rulează acum cu TP/SL simetric (±0.5%) și isWin bazat strict
   * pe hitTP, dar stats.winRate din DB conține acumulări pre-QW-7 (TP=0.3%, SL=-1.0%,
   * isWin=pnl>0) → winRate raportat 99.18%, imposibil matematic cu PnL real negativ.
   *
   * Acțiune: resetează toate stats non-omega la inițial + șterge tracking-ul intern
   * (_totalWinPnl etc.) + demotează toți la IN_TRAINING + clear wfCache.
   *
   * Asumpție care invalidează: dacă `saveGladiatorsToDb` eșuează silent, reset-ul e doar
   * in-memory și revine la următorul refresh din cloud. VERIFICĂ return-ul.
   *
   * Side-effects downstream: Butcher, auto-promote, recalibrateRanks vor relua eligibility
   * de la zero. Niciun gladiator nu va fi `isLive` până nu atinge din nou threshold-urile
   * institutionale (totalTrades>=20, WR>=45, PF>=1.1). FAIL-SAFE by design.
   */
  public resetAllStats(reason: string): { affected: number; reason: string; timestamp: number } {
    this.ensureLoaded();
    let affected = 0;
    for (const g of this.gladiators) {
      if (g.isOmega) continue;
      // Reset public stats la starea inițială (match cu seedGladiators)
      g.stats = {
        winRate: 0,
        profitFactor: 1.0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        totalTrades: 0,
      };
      // Șterge tracking-ul intern (force re-init la următorul updateGladiatorStats)
      const ext = g as Gladiator & {
        _totalWinPnl?: number;
        _totalLossPnl?: number;
        _peakEquity?: number;
        _currentEquity?: number;
        readinessScore?: number;
      };
      delete ext._totalWinPnl;
      delete ext._totalLossPnl;
      delete ext._peakEquity;
      delete ext._currentEquity;
      // Demotează: nu poate fi live până nu re-câștigă eligibility via recalibrateRanks
      g.isLive = false;
      g.status = 'IN_TRAINING';
      g.trainingProgress = 0;
      g.lastUpdated = Date.now();
      affected++;
    }
    // Invalidează walk-forward cache — rezultate calculate pe stats vechi
    this.wfCache.clear();
    // Reset timer recalibrate pentru ca recalibrateRanks să se trigger-eze la primul trade
    this.lastRecalibrateTime = 0;
    saveGladiatorsToDb(this.gladiators);
    return { affected, reason, timestamp: Date.now() };
  }
}

export const gladiatorStore = GladiatorStore.getInstance();
