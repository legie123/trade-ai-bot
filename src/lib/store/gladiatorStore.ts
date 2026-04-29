import { INITIAL_STRATEGIES } from './seedStrategies';
import { isSeedBlacklisted, isBlacklistReady } from './seedBlacklist';
import { Gladiator, ArenaType } from '../types/gladiator';
import { getGladiatorsFromDb, saveGladiatorsToDb, getIndependentSampleSize, getGladiatorBattles } from '@/lib/store/db';
import { WalkForwardEngine } from '@/lib/v2/validation/walkForwardEngine';
import type { WalkForwardResult } from '@/lib/v2/validation/walkForwardEngine';
import { DNAExtractor } from '@/lib/v2/superai/dnaExtractor';
import { createLogger } from '@/lib/core/logger';
import { wilsonLowerBound } from '@/lib/core/stats';

const storeLog = createLogger('GladiatorStore');

/**
 * Filter out gladiators currently tripping the Circuit Breaker condition in applyRLModifier.
 * CB condition (applyRLModifier): currentStreak <= -4 AND recentWinRate < 0.50 → force FLAT.
 *
 * AND (not OR): streak -5 with WR=65% = bad luck, still include. streak -5 with WR=30% = broken, exclude.
 * Fail-open: if intel lookup throws, include gladiator (prefer routing over silence).
 *
 * Assumption that invalidates this filter if broken:
 *   - DNAExtractor.extractIntelligenceAsync returns accurate+timely streak/recentWR.
 *   - If Postgres reads spike >500ms per gladiator and we have 12+, latency compounds (sequential await).
 *   - Mitigation path: switch to Promise.all if perf degrades.
 */
// PERF FIX 2026-04-18 AUDIT: CB status cache per tick (60s TTL).
// Was: sequential extractIntelligenceAsync per gladiator per tier → 48 DB queries.
// Now: parallel Promise.all + cached results → max 12 DB queries, once per tick.
const _cbCache: Map<string, { inCB: boolean; ts: number }> = new Map();
const CB_CACHE_TTL = 60_000; // 60s — one cron cycle

async function filterNonCB(candidates: Gladiator[]): Promise<Gladiator[]> {
  if (candidates.length === 0) return [];
  const dna = DNAExtractor.getInstance();
  const now = Date.now();

  // Parallel CB check with per-gladiator cache
  const checks = await Promise.all(
    candidates.map(async (g): Promise<{ gladiator: Gladiator; inCB: boolean }> => {
      const cached = _cbCache.get(g.id);
      if (cached && now - cached.ts < CB_CACHE_TTL) {
        return { gladiator: g, inCB: cached.inCB };
      }
      try {
        const intel = await dna.extractIntelligenceAsync(g.id);
        const inCB = intel.currentStreak <= -4 && intel.recentWinRate < 0.50;
        _cbCache.set(g.id, { inCB, ts: now });
        if (inCB) {
          storeLog.warn(`[ROUTING] Skipping ${g.id} — in CB (streak=${intel.currentStreak}, recentWR=${(intel.recentWinRate * 100).toFixed(0)}%)`);
        }
        return { gladiator: g, inCB };
      } catch (err) {
        storeLog.warn(`[ROUTING] Intel fetch failed for ${g.id}, including anyway`, { error: String(err) });
        return { gladiator: g, inCB: false };
      }
    })
  );

  return checks.filter(c => !c.inCB).map(c => c.gladiator);
}

/**
 * Singleton for managing the Gladiator Ranks and Arenas for Phoenix V2.
 */
class GladiatorStore {
  private static instance: GladiatorStore;
  private gladiators: Gladiator[] = [];
  private lastRecalibrateTime: number = 0;
  /** Walk-forward validation cache: gladiatorId → result. Updated by runWalkForwardGate(). */
  private wfCache = new Map<string, WalkForwardResult>();
  /**
   * FAZA 3/5 BATCH 2/4 — Independent sample size cache: gladiatorId → count of unique
   * (minute_bucket, symbol, direction) decisions. Populated by refreshIndependentSampleSizes().
   * Used in QW-8 promotion gate instead of raw stats.totalTrades (which is wash-contaminated).
   */
  private indepSampleCache = new Map<string, number>();

  // C5 Batch 1 — Write debounce: accumulate stat ticks, flush once every DEBOUNCE_MS.
  // Replaces per-tick saveGladiatorsToDb (line 325 old) which caused 93% stat loss
  // on multi-instance Cloud Run (last-write-wins race). reconcileStatsFromBattles()
  // remains the authoritative hourly fix; this reduces write pressure ~60×.
  private _dirty = false;
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly DEBOUNCE_MS = 5_000;

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
      this.mergeSeedMissing();
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
      const lid = strat.id.toLowerCase();
      if (lid.includes('scalp')) arena = 'SCALPING';
      if (lid.includes('swing') || lid.includes('follow')) arena = 'SWING';
      // DEEP_WEB = Solana ecosystem + memecoins + alt-pump specialists.
      // Fix 2026-04-18: memecoin-degen, alt-pump-hunter, meme-momentum-surf now correctly land in DEEP_WEB
      // so findBestGladiator P1 (preferredArena=DEEP_WEB) can find them for JUP/RNDR/WIF/etc.
      if (lid.includes('solana') || lid.includes('eco') || lid.includes('meme') || lid.includes('pump')) {
        arena = 'DEEP_WEB';
      }

      const rank = index + 1;

      return {
        id: strat.id,
        name: strat.name,
        arena,
        rank,
        isLive: false, // NO gladiator gets live capital until proven via phantom trades
        dna: strat.dna, // Signal acceptance criteria — creates real strategy differentiation
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
      // Migrate: inject DNA into existing gladiators that don't have it yet.
      // DNA comes from seed definitions. Gladiators not in seed keep dna=undefined (accept all).
      this.migrateDna();
      // Merge-seed: add any new INITIAL_STRATEGIES missing from DB.
      this.mergeSeedMissing();
    }
  }

  /**
   * Merge-seed: insert new INITIAL_STRATEGIES entries that don't exist in DB.
   * Preserves existing gladiator stats/isLive; only ADDS missing ones.
   * Called from both ensureLoaded (cold start with DB) and reloadFromDb (post-initDB).
   */
  private mergeSeedMissing(): void {
    const existingIds = new Set(this.gladiators.map(g => g.id));
    let missing = INITIAL_STRATEGIES.filter(s => !existingIds.has(s.id));
    // FAZA 4/4 2026-04-20 — seed-revive blacklist. Skip re-introducing seeds
    // that were killed within SEED_REVIVE_BLACKLIST_DAYS (default 30). Breaks
    // the kill→revive→kill loop documented in memory
    // [project_zombie_purge_fix_2026_04_20].
    //
    // 2026-04-29 ZOMBIE-RACE FIX: defer ENTIRE merge if blacklist hasn't
    // completed its first refresh. Without this guard, an HTTP request that
    // hits getGladiators() during the boot window between initDB step 1
    // (cache.gladiators populated) and step 2 (refreshSeedBlacklist awaited)
    // would run mergeSeedMissing with an empty blacklist Set → recently-
    // killed seeds revive AND get persisted via saveGladiatorsToDb at the
    // tail of this function → every subsequent cold-start instance loads
    // those zombies from cache.gladiators. Symptom: zombieCount=55-69 on
    // /api/v2/diag/graveyard with aliveTrades=0 (all 14 seeds resurrected
    // with stats=0). The merge is idempotent: deferring once is safe;
    // initDB's explicit reloadFromDb (after blacklist refresh) catches up
    // on the next cycle. Kill-switch: SEED_BLACKLIST_ENABLED=off makes
    // isBlacklistReady() return true unconditionally → behavior pre-fix.
    if (missing.length > 0 && !isBlacklistReady()) {
      storeLog.warn(`[MERGE-SEED] Blacklist not yet ready — deferring merge of ${missing.length} seed(s) to avoid zombie revive race.`);
      return;
    }
    const beforeFilter = missing.length;
    missing = missing.filter(s => !isSeedBlacklisted(s.id));
    const filtered = beforeFilter - missing.length;
    if (filtered > 0) {
      storeLog.info(`[MERGE-SEED] Blacklist blocked ${filtered} recently-killed seed(s) from revive.`);
    }
    if (missing.length === 0) return;
    storeLog.info(`[MERGE-SEED] Adding ${missing.length} new gladiator(s): ${missing.map(m => m.id).join(', ')}`);
    let nextRank = Math.max(...this.gladiators.map(g => g.rank), 0) + 1;
    for (const strat of missing) {
      let arena: ArenaType = 'DAY_TRADING';
      const lid = strat.id.toLowerCase();
      if (lid.includes('scalp')) arena = 'SCALPING';
      if (lid.includes('swing') || lid.includes('follow')) arena = 'SWING';
      if (lid.includes('solana') || lid.includes('eco') || lid.includes('meme') || lid.includes('pump')) {
        arena = 'DEEP_WEB';
      }
      this.gladiators.push({
        id: strat.id,
        name: strat.name,
        arena,
        rank: nextRank++,
        isLive: false,
        dna: strat.dna,
        status: 'IN_TRAINING',
        trainingProgress: 0,
        skills: arena === 'DEEP_WEB' ? ['MEME_SNIPER'] : [],
        stats: { winRate: 0, profitFactor: 1.0, maxDrawdown: 0, sharpeRatio: 0, totalTrades: 0 },
        lastUpdated: Date.now(),
      });
    }
    saveGladiatorsToDb(this.gladiators);
  }

  /**
   * One-time migration: injects DNA from INITIAL_STRATEGIES into existing gladiators.
   * Existing gladiators loaded from Supabase may predate the DNA system.
   * Gladiators already with DNA are left untouched.
   */
  private migrateDna(): void {
    let migrated = 0;
    for (const g of this.gladiators) {
      if (g.dna) continue; // Already has DNA
      const seed = INITIAL_STRATEGIES.find(s => s.id === g.id);
      if (seed?.dna) {
        g.dna = seed.dna;
        migrated++;
      }
    }
    if (migrated > 0) {
      saveGladiatorsToDb(this.gladiators);
    }
  }

  public getGladiators(): Gladiator[] {
    this.ensureLoaded();
    return this.gladiators;
  }

  // AUDIT FIX BUG-3: Single canonical ranking function.
  // C21 (2026-04-20): ALWAYS use computeQuickScore (has profitability tier).
  // Prior: used stale readinessScore from DB/gladiatorMetrics → tier logic bypassed.
  public getLeaderboard(): Gladiator[] {
    this.ensureLoaded();
    return this.gladiators
      .filter(g => !g.isOmega)
      .sort((a, b) => {
        const scoreA = this.computeQuickScore(a);
        const scoreB = this.computeQuickScore(b);
        if (scoreB !== scoreA) return scoreB - scoreA;
        // Tiebreaker: profitFactor × winRate
        return (b.stats.profitFactor * b.stats.winRate) - (a.stats.profitFactor * a.stats.winRate);
      });
  }

  // Quick score fallback if readinessScore not yet computed.
  // WILSON FIX (2026-04-18): uses Wilson 95% CI lower bound on win rate, not raw WR.
  // Why: raw WR on small samples is biased optimism. n=10/WR=80% was beating
  // n=200/WR=60% under the old formula — the opposite of what we want. Wilson LB
  // penalizes small samples automatically. Kill-switch via WILSON_SORT_OFF=1 env.
  private computeQuickScore(g: Gladiator): number {
    const n = g.stats.totalTrades;
    const wins = Math.round((g.stats.winRate / 100) * n);
    const wrLB = wilsonLowerBound(wins, n) * 100;
    const wrRaw = Math.min(100, Math.max(0, g.stats.winRate));
    const wr = process.env.WILSON_SORT_OFF === '1' ? wrRaw : wrLB;
    const pf = Math.min(100, Math.max(0, g.stats.profitFactor * 25));
    // C23 (2026-04-28): DD penalty aligned with recalibrateRanks — sqrt-normalized.
    // PRIOR: flat `100 - DD * 3` diverged from recalibrateRanks' ddNorm formula,
    // causing getLeaderboard() and recalibrateRanks() to produce different orderings.
    // NOW: same ddNorm + threshold approach as recalibrateRanks.
    // Kill-switch: DD_PENALTY_MODE=legacy → flat thresholds (same as recalibrateRanks legacy).
    const ddNorm = n > 0 ? g.stats.maxDrawdown / Math.sqrt(n / 50) : g.stats.maxDrawdown;
    const dd = process.env.DD_PENALTY_MODE === 'legacy'
      ? (g.stats.maxDrawdown > 15 ? 80 : g.stats.maxDrawdown > 10 ? 90 : 100)
      : (ddNorm > 8 ? 80 : ddNorm > 5 ? 90 : 100);
    const rawScore = wr * 0.40 + pf * 0.35 + dd * 0.25;
    // C21: same profitability tier as recalibrateRanks — prevents inversion in getLeaderboard().
    const pfRaw = g.stats.profitFactor;
    const tierBonus = process.env.RANKING_TIER_OFF === '1' ? 0
      : (pfRaw >= 1.3 ? 200 : pfRaw >= 1.0 ? 100 : 0);
    return rawScore + tierBonus;
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
    // FIX 2026-04-18 (QW-10): PF inflation fix — three guards:
    //   1. Minimum loss floor: _totalLossPnl < MIN_LOSS_FLOOR → PF=1.0 (insufficient data)
    //   2. PF cap at 10.0 — any PF > 10 in crypto is artifact, not edge
    //   3. Keep QW-6 rule: no losses at all → PF=1.0 neutral
    // Root cause of PF=439: expired phantoms with +0.02% pnl counted as loss →
    // _totalLossPnl denominator near-zero. Also fixed upstream (QW-10 NEUTRAL zone
    // in simulator.ts), but this guard protects against future denominator pollution.
    // ASSUMPTION: MIN_LOSS_FLOOR=0.5 ≈ one real SL hit (SL=0.5%).
    const MIN_LOSS_FLOOR = 0.5;
    const PF_CAP = 10.0;
    if (ext._totalLossPnl >= MIN_LOSS_FLOOR) {
      const rawPF = ext._totalWinPnl / ext._totalLossPnl;
      gladiator.stats.profitFactor = parseFloat(Math.min(rawPF, PF_CAP).toFixed(2));
    } else {
      gladiator.stats.profitFactor = 1.0; // insufficient loss data → neutral
    }

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
    
    // C5 Batch 1: mark dirty + schedule debounced flush instead of per-tick save.
    // Old: saveGladiatorsToDb(this.gladiators) — fired every tick → race on multi-instance.
    this._markDirtyAndScheduleFlush();
  }

  /**
   * C5 Batch 1 — Debounced write scheduler.
   * Marks store dirty and ensures a single flush fires after DEBOUNCE_MS of quiet.
   * If another tick arrives before flush, timer resets (trailing-edge debounce).
   * ASSUMPTION: Node.js setTimeout is single-threaded — no concurrent flush possible
   * within same instance. Cross-instance race mitigated by reconcileStatsFromBattles().
   */
  private _markDirtyAndScheduleFlush(): void {
    this._dirty = true;
    if (this._flushTimer) clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      if (this._dirty) {
        this._dirty = false;
        saveGladiatorsToDb(this.gladiators);
        storeLog.info('[debounce] flushed gladiator stats to Supabase');
      }
    }, GladiatorStore.DEBOUNCE_MS);
  }

  /**
   * C5 Batch 1 — Force-flush for graceful shutdown / explicit sync.
   * Called by flushPendingSyncs (db.ts drain) and anywhere that needs
   * guaranteed persistence before process exit.
   */
  public flushIfDirty(): void {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._dirty) {
      this._dirty = false;
      saveGladiatorsToDb(this.gladiators);
      storeLog.info('[debounce] force-flushed gladiator stats (shutdown/sync)');
    }
  }

  /**
   * SUB-FAZA D' (2026-04-19) — Stats reconciliation from gladiator_battles ground truth.
   *
   * CONTEXT: stats-drift diagnostic confirmed 13/15 gladiators CRITICAL drift
   * (store.total_tt=336 vs battles.total_tt=8846 — 97% loss). Root cause:
   * updateGladiatorStats persists via saveGladiatorsToDb(this.gladiators) — full
   * array rewrite on EVERY increment. Cloud Run multi-instance race: last-write-wins
   * drops concurrent increments. Rate loss observed ~93% ≈ N instances competing.
   *
   * FIX STRATEGY: not patching the increment path (invasive, touches every write
   * site). Instead, treat gladiator_battles as ledger-of-record. This function
   * RECOMPUTES stats from battles, persists ONCE at end. Idempotent & convergent.
   *
   * WHY idempotent: aggregate(battles) is deterministic. If a concurrent
   * updateGladiatorStats tick happens mid-reconciliation, the tick's +1 is
   * captured by the NEXT reconciliation (and the phantom write to battles still
   * lands). No ticks are permanently lost because battles are the source of truth.
   *
   * WHY safe for Butcher: after reconciliation, stats reflect real WR/PF/DD.
   * Butcher judging becomes sound, not stats-starved.
   *
   * ASSUMPȚII CRITICE:
   *  - gladiator_battles is append-only (never mutated) → replaying is deterministic
   *  - `pnlPercent` on battle rows reflects the execution-convention clamped value
   *    (simulator.ts writes `finalPnl` clamped TP/SL; shadow writes `execPnlPercent`
   *    clamped). If those conventions diverge, equity curve replay is contaminated.
   *  - limit=10000 per gladiator sufficient for current volume (~1k battles each
   *    over ~20 days). Needs revisit if battles growth accelerates.
   *
   * CONSEQUENCE: isOmega skipped — Omega stats tracked separately in OmegaEngine,
   * reconciling here would corrupt that.
   */
  public async reconcileStatsFromBattles(): Promise<{
    reconciled: number;
    skipped: number;
    details: Array<{
      id: string;
      before: { totalTrades: number; winRate: number; profitFactor: number };
      after: { totalTrades: number; winRate: number; profitFactor: number };
    }>;
  }> {
    this.ensureLoaded();
    const details: Array<{
      id: string;
      before: { totalTrades: number; winRate: number; profitFactor: number };
      after: { totalTrades: number; winRate: number; profitFactor: number };
    }> = [];
    let skipped = 0;

    // C24 (2026-04-28): Two-phase reconciliation — parallel fetch, sync apply.
    // PRIOR: sequential await getGladiatorBattles per gladiator → 50 × ~200ms = ~10s.
    // NOW: Phase 1 fetches all battles in batches of 8 → ~1.2s.
    //      Phase 2 replays equity curves synchronously (CPU-bound, ~50ms total).
    // Safe: DB reads are independent; mutations happen in Phase 2 single-threaded.
    const nonOmega = this.gladiators.filter(g => !g.isOmega);
    skipped += this.gladiators.length - nonOmega.length; // Omega count

    // Phase 1: Parallel battle fetch
    const BATCH = 8;
    const battleMap = new Map<string, Record<string, unknown>[]>();
    for (let i = 0; i < nonOmega.length; i += BATCH) {
      const batch = nonOmega.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async (g) => {
          const battles = await getGladiatorBattles(g.id, 10000);
          return { id: g.id, battles: battles || [] };
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.battles.length > 0) {
          battleMap.set(r.value.id, r.value.battles as Record<string, unknown>[]);
        }
      }
    }

    // Phase 2: Sync replay + stat apply (CPU-bound, no I/O)
    // C6 FIX: Clamp raw pnl_percent to TP/SL bandwidth before accumulating.
    const RECONCILE_TP_CLAMP = 1.0;
    const RECONCILE_SL_CLAMP = -0.5;
    const MIN_LOSS_FLOOR = 0.5;
    const PF_CAP = 10.0;

    for (const g of nonOmega) {
      const rawBattles = battleMap.get(g.id);
      if (!rawBattles || rawBattles.length === 0) { skipped++; continue; }

      // Replay chronologically ascending — equity curve requires temporal order.
      const rows = [...rawBattles].sort((a, b) => {
        const ta = Number(a.timestamp || 0);
        const tb = Number(b.timestamp || 0);
        return ta - tb;
      });

      let wins = 0;
      let totalWinPnl = 0;
      let totalLossPnl = 0;
      let peakEq = 100;
      let curEq = 100;
      let maxDd = 0;

      for (const r of rows) {
        const isWin = r.isWin === true;
        const rawPnl = Number(r.pnlPercent ?? 0);
        const pnl = Math.max(RECONCILE_SL_CLAMP, Math.min(RECONCILE_TP_CLAMP, rawPnl));
        if (isWin) {
          wins += 1;
          totalWinPnl += Math.abs(pnl);
        } else {
          totalLossPnl += Math.abs(pnl);
        }
        curEq *= (1 + pnl / 100);
        if (curEq > peakEq) peakEq = curEq;
        const dd = peakEq > 0 ? ((peakEq - curEq) / peakEq) * 100 : 0;
        if (dd > maxDd) maxDd = dd;
      }

      const n = rows.length;
      const before = {
        totalTrades: g.stats.totalTrades,
        winRate: parseFloat((g.stats.winRate || 0).toFixed(2)),
        profitFactor: parseFloat((g.stats.profitFactor || 0).toFixed(2)),
      };

      g.stats.totalTrades = n;
      g.stats.winRate = n > 0 ? (wins / n) * 100 : 0;

      if (totalLossPnl >= MIN_LOSS_FLOOR) {
        const rawPF = totalWinPnl / totalLossPnl;
        g.stats.profitFactor = parseFloat(Math.min(rawPF, PF_CAP).toFixed(2));
      } else {
        g.stats.profitFactor = 1.0;
      }
      g.stats.maxDrawdown = parseFloat(maxDd.toFixed(2));

      // Sync extension fields so subsequent incremental updateGladiatorStats calls
      // continue from the reconciled equity curve, not from zero.
      const ext = g as Gladiator & {
        _totalWinPnl?: number;
        _totalLossPnl?: number;
        _peakEquity?: number;
        _currentEquity?: number;
      };
      ext._totalWinPnl = totalWinPnl;
      ext._totalLossPnl = totalLossPnl;
      ext._peakEquity = peakEq;
      ext._currentEquity = curEq;

      g.lastUpdated = Date.now();
      details.push({
        id: g.id,
        before,
        after: {
          totalTrades: n,
          winRate: parseFloat(g.stats.winRate.toFixed(2)),
          profitFactor: g.stats.profitFactor,
        },
      });
    }

    // Single persist at end (NOT per-gladiator) — reduces race window.
    // Note: still subject to last-write-wins across instances, but convergent:
    // next reconciliation call re-derives from battles ground truth.
    saveGladiatorsToDb(this.gladiators);
    this.recalibrateRanks();
    storeLog.info(`[reconcileStatsFromBattles] ${details.length} gladiators reconciled, ${skipped} skipped (Omega or empty)`);
    return { reconciled: details.length, skipped, details };
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
      // WILSON FIX (2026-04-18): wrScore now uses Wilson 95% CI lower bound, not raw WR.
      // Why: prior formula let n=10/WR=80% outrank n=200/WR=60% — statistically inverted.
      // Wilson LB auto-penalizes small samples. tradeBonus kept as secondary recency/maturity
      // signal. Kill-switch: WILSON_SORT_OFF=1 reverts to raw WR for rollback.
      // Assumption: trades are independent Bernoulli. Violated under regime flips +
      // pyramiding correlated entries — re-examine if CB fires frequently post-deploy.
      const scored = group.map(g => {
        const n = g.stats.totalTrades;
        const wins = Math.round((g.stats.winRate / 100) * n);
        const wrLB = wilsonLowerBound(wins, n) * 100;
        const wrScore = process.env.WILSON_SORT_OFF === '1' ? g.stats.winRate : wrLB;
        const pfScore = Math.min(g.stats.profitFactor / 3.0, 1.0) * 100; // PF 3.0 = max 100
        const recencyBonus = (Date.now() - g.lastUpdated) < 3600_000 ? 10 : 0;
        const tradeBonus = Math.min(g.stats.totalTrades / 50, 1.0) * 15; // 50 trades = full 15pts
        // C18 (2026-04-20): DD penalty normalized by sqrt(n) to prevent survivorship bias.
        // PRIOR BUG: flat -20 at DD>15% penalized veterans (n=400, DD=16.6% is p75 at WR=35%)
        // equally to a rookie who hit DD=16% in 50 trades (catastrophic). Monte Carlo shows
        // expected max DD grows ~sqrt(n): at WR=35%/TP=1.0%/SL=-0.5%, median DD at n=400
        // is 12.5% vs 4.5% at n=50. Normalizing by sqrt(n/50) gives DD-per-unit-experience.
        // Kill-switch: DD_PENALTY_MODE=legacy reverts to flat thresholds.
        const ddNorm = n > 0 ? g.stats.maxDrawdown / Math.sqrt(n / 50) : g.stats.maxDrawdown;
        const ddPenalty = process.env.DD_PENALTY_MODE === 'legacy'
          ? (g.stats.maxDrawdown > 15 ? -20 : g.stats.maxDrawdown > 10 ? -10 : 0)
          : (ddNorm > 8 ? -20 : ddNorm > 5 ? -10 : 0);
        const rawScore = (wrScore * 0.4) + (pfScore * 0.35) + recencyBonus + tradeBonus + ddPenalty;

        // C21 (2026-04-20): Profitability tier prevents scoring inversion.
        // PRIOR BUG: gladiators with PF<1.0 and tt=20 (low DD by lack of exposure)
        // outranked PF=1.36/tt=546 veterans. A strategy that LOSES money should never
        // rank above one that MAKES money, regardless of DD or sample size.
        //
        // Tier system (additive offset ensures strict ordering):
        //   PF >= 1.3 (institutional): +200 (always top tier)
        //   PF >= 1.0 (break-even+):   +100 (middle tier)
        //   PF <  1.0 (losing):           +0 (bottom tier)
        //
        // Within each tier, rawScore determines ordering normally.
        // Kill-switch: RANKING_TIER_OFF=1 reverts to raw score only.
        const pf = g.stats.profitFactor;
        const tierBonus = process.env.RANKING_TIER_OFF === '1' ? 0
          : (pf >= 1.3 ? 200 : pf >= 1.0 ? 100 : 0);
        const score = rawScore + tierBonus;
        return { gladiator: g, score };
      });

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      // Assign ranks and live status
      // INSTITUTIONAL RULE (QW-8):
      //   tt>=50, WR>=40%, PF>=1.3, WF fail-closed.
      // C14 (2026-04-20): WR gate 58% → 40%. With asymmetric TP=1.0%/SL=-0.5% (2:1 R:R),
      // break-even WR = ~33%, PF≥1.3 requires WR≥39.4%. Old 58% was calibrated for
      // symmetric ±0.5% and made LIVE promotion mathematically impossible with current TP/SL.
      // Top gladiator (PF=1.69, WR=41.4%, tt=382) was blocked despite being clearly profitable.
      // PF≥1.3 remains the primary profitability gate; WR≥40% is a sanity floor.
      // FAZA 3/5 BATCH 2/4 (2026-04-19): `tt` = INDEPENDENT SAMPLE SIZE (wash-deduped).
      //   indepSampleCache populated by refreshIndependentSampleSizes(). Fail-closed if cache
      //   empty → treat as 0 samples → no LIVE promotion until refresh runs.
      // WF fail-closed (require explicit pass) blocks OVERFIT gladiators.
      // C15 (2026-04-20): If EITHER indepSampleCache or wfCache has NEVER been
      // populated (cold start / no auto-promote run yet), preserve DB-persisted
      // isLive state instead of fail-closing all to false.
      // Both caches must be populated for the full QW-8 gate to apply:
      //   - indepSampleCache: populated by refreshIndependentSampleSizes()
      //   - wfCache: populated by runWalkForwardGate()
      // auto-promote cron populates indepSampleCache but NOT wfCache,
      // so recalibrateRanks was resetting isLive via wfClean=false.
      const cacheHydrated = this.indepSampleCache.size > 0 && this.wfCache.size > 0;

      scored.forEach((entry, index) => {
        entry.gladiator.rank = index + 1;

        if (!cacheHydrated) {
          // Cold start: preserve existing isLive from DB state.
          // Only enforce rank <= 3 (hard structural limit).
          if (index >= 3) entry.gladiator.isLive = false;
          // Else: keep entry.gladiator.isLive as loaded from DB.
          return;
        }

        // Normal path: full QW-8 gate with independent sample cache.
        const indepTT = this.indepSampleCache.get(entry.gladiator.id) ?? 0;
        // C19 (2026-04-20): WR 40→35%. At 2:1 R:R (TP=1.0%/SL=-0.5%), break-even=33%.
        // PF≥1.3 is the primary profitability gate. WR≥35% is sanity floor above BE.
        // BTC Swing Macro (PF=1.46,WR=37.4%,tt=479) was blocked at 40%. Kill: QW8_WR_GATE=40.
        const wrGate = Number(process.env.QW8_WR_GATE) || 35;
        const meetsThreshold = indepTT >= 50
          && entry.gladiator.stats.winRate >= wrGate
          && entry.gladiator.stats.profitFactor >= 1.3;
        // Walk-Forward gate: fail-closed — require explicit WF pass, not absence.
        const wfResult = this.wfCache.get(entry.gladiator.id);
        const wfClean = wfResult !== undefined && wfResult.verdict !== 'OVERFIT';
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

    // C24 (2026-04-28): Parallel with bounded concurrency.
    // PRIOR: sequential await per gladiator → 50 × ~100ms = ~5s.
    // NOW: Promise.all batches of 8 → ~625ms. Safe: each validate() is
    // an independent DB read; results cached in wfCache (Map.set is sync).
    const BATCH = 8;
    for (let i = 0; i < candidates.length; i += BATCH) {
      await Promise.allSettled(
        candidates.slice(i, i + BATCH).map(async (g) => {
          try {
            const result = await wf.validate(g.id);
            this.wfCache.set(g.id, result);
          } catch {
            // Fail-open: if WF errors, don't block the gladiator
          }
        })
      );
    }
  }

  /**
   * FAZA 3/5 BATCH 2/4 — Refresh independent sample size cache for all non-Omega gladiators.
   * Call from cron/auto-promote tick (hourly, not every 5min — DB read cost).
   *
   * ASSUMPȚIE: indepSampleCache e single-writer (only this function). Dacă e accesat concurent
   * din mai multe requests, ultimul scris câștigă — acceptabil (counts nu descresc brusc).
   *
   * Fail-closed: dacă funcția aruncă pre-populare, cache rămâne gol → gate QW-8 vede 0 samples
   * → nu promovează. SIGURANȚĂ by default.
   */
  public async refreshIndependentSampleSizes(): Promise<void> {
    this.ensureLoaded();
    const candidates = this.gladiators.filter(g => !g.isOmega);
    // C24 (2026-04-28): Parallel with bounded concurrency.
    // PRIOR: sequential await per gladiator → 50 × ~100ms = ~5s.
    // NOW: batches of 8 → ~625ms. Safe: independent reads, Map.set is sync.
    // Fail-closed preserved: errors leave cache unpopulated → QW-8 sees 0.
    const BATCH = 8;
    for (let i = 0; i < candidates.length; i += BATCH) {
      await Promise.allSettled(
        candidates.slice(i, i + BATCH).map(async (g) => {
          try {
            const count = await getIndependentSampleSize(g.id);
            this.indepSampleCache.set(g.id, count);
          } catch {
            // Fail-closed: do NOT populate cache on error → gate sees 0 → no promotion
          }
        })
      );
    }
  }

  /** Diagnostic accessor: current indep sample size for a gladiator (0 if cache miss). */
  public getIndependentSampleCount(gladiatorId: string): number {
    return this.indepSampleCache.get(gladiatorId) ?? 0;
  }

  /** Get walk-forward result for a specific gladiator (from cache). */
  public getWalkForwardResult(gladiatorId: string): WalkForwardResult | null {
    return this.wfCache.get(gladiatorId) ?? null;
  }

  /**
   * Finds the best candidate gladiator to handle an incoming signal.
   * Priority: Top Rank (isLive = true) for the given symbol's typical arena.
   * Prefers gladiators who were recently active and have higher win rates.
   *
   * ASYNC (2026-04-18): filters out gladiators in CB state BEFORE routing, to prevent
   * applyRLModifier CIRCUIT BREAKER from firing on routed signals and collapsing to FLAT.
   * Hard fallback: if ALL tiers filter to empty, returns top-rank anyway (prefer maybe-VETO over silence).
   */
  public async findBestGladiator(symbol: string): Promise<Gladiator | undefined> {
    this.ensureLoaded();
    // Routing: map symbol → preferred arena. DEEP_WEB covers Solana ecosystem + memes + alts without BTC/ETH majors.
    // Fix 2026-04-18: JUP/RNDR/BONK/PEPE/DOGE/SHIB/FLOKI/RAY/JTO/PYTH now route to DEEP_WEB so meme/alt specialists get signals.
    // Assumption that invalidates: if an alt listed here shows up as "BTC-correlated momentum" it might be better served by BTC gladiators.
    //   Monitor per-gladiator symbol P&L; if JUP/RNDR systematically lose in DEEP_WEB, revisit classification.
    const DEEP_WEB_SYMBOLS = ['SOL', 'WIF', 'JUP', 'RNDR', 'BONK', 'PEPE', 'DOGE', 'SHIB', 'FLOKI', 'RAY', 'JTO', 'PYTH'];
    const sym = symbol.toUpperCase();
    const preferredArena: ArenaType = DEEP_WEB_SYMBOLS.some(s => sym.includes(s)) ? 'DEEP_WEB' : 'DAY_TRADING';
    const isPaper = (process.env.TRADING_MODE || 'PAPER').toUpperCase() === 'PAPER';

    // Priority 1: live non-Omega in preferred arena
    const p1 = this.gladiators
      .filter(g => g.arena === preferredArena && g.isLive && !g.isOmega)
      .sort((a, b) => a.rank - b.rank);
    const p1Filtered = await filterNonCB(p1);
    if (p1Filtered.length > 0) return p1Filtered[0];

    // Priority 2: any live non-Omega
    const p2 = this.gladiators
      .filter(g => g.isLive && !g.isOmega)
      .sort((a, b) => a.rank - b.rank);
    const p2Filtered = await filterNonCB(p2);
    if (p2Filtered.length > 0) return p2Filtered[0];

    // Priority 3 (PAPER mode only): top-ranked non-Omega even if not live.
    // Breaks the live-deadlock; in PAPER mode risk is zero (shadow-only).
    if (isPaper) {
      const p3 = this.gladiators
        .filter(g => g.arena === preferredArena && !g.isOmega)
        .sort((a, b) => a.rank - b.rank);
      const p3Filtered = await filterNonCB(p3);
      if (p3Filtered.length > 0) return p3Filtered[0];

      // Priority 4: any non-Omega (last resort in PAPER)
      const p4 = this.gladiators
        .filter(g => !g.isOmega)
        .sort((a, b) => a.rank - b.rank);
      const p4Filtered = await filterNonCB(p4);
      if (p4Filtered.length > 0) return p4Filtered[0];

      // HARD FALLBACK: all filtered empty → return top-rank anyway, log error.
      // Rationale: Sentinel VETO is a safer failure mode than total silence.
      if (p4.length > 0) {
        storeLog.error(`[ROUTING] All tiers filtered empty for ${symbol} — returning top-rank ${p4[0].id} as hard fallback (expect downstream VETO)`);
        return p4[0];
      }
    }

    // LIVE mode: if p2 had candidates but all filtered CB, hard-fallback to top-rank live
    if (p2.length > 0) {
      storeLog.error(`[ROUTING] All live tiers filtered empty for ${symbol} — returning top-live ${p2[0].id} as hard fallback`);
      return p2[0];
    }

    return undefined;
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
      // C24 (2026-04-28): use debounce instead of direct save.
      // PRIOR: every omega progress tick did full array save → unnecessary writes.
      this._markDirtyAndScheduleFlush();
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
   * instituționale (totalTrades>=20, WR>=45, PF>=1.1). FAIL-SAFE by design.
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
