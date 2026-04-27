/**
 * Experience Memory Store — Step 3.2
 *
 * ADDITIVE. Records trade outcomes with full context (regime, indicators,
 * debate verdict, gladiator) and provides query API for historical performance
 * lookup by symbol, regime, direction, or gladiator.
 *
 * Architecture:
 *   Trade closes → experienceMemory.record(entry) → Supabase + in-memory cache
 *   SwarmOrchestrator/Forge → experienceMemory.query(filters) → historical insight
 *
 * Storage: Supabase `experience_memory` table (async flush)
 * Cache: In-memory ring buffer of last 500 entries for fast queries
 *
 * Kill-switch: DISABLE_EXPERIENCE_MEMORY=true
 */

import { createLogger } from '@/lib/core/logger';
import { supabase, SUPABASE_CONFIGURED } from '@/lib/store/db';

const log = createLogger('ExperienceMemory');

const DISABLED = process.env.DISABLE_EXPERIENCE_MEMORY === 'true';

// ─── Configuration ────────────────────────────────────────────────

const CACHE_SIZE = 500;
const FLUSH_INTERVAL_MS = 30_000;  // Flush to Supabase every 30s
const FLUSH_BATCH_SIZE = 20;       // Max entries per flush

// ─── Types ────────────────────────────────────────────────────

export interface ExperienceEntry {
  id?: string;
  timestamp: number;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  outcome: 'WIN' | 'LOSS';
  pnlPercent: number;
  /** Market regime at time of entry */
  regime: string | null;
  /** Key indicators at entry */
  indicators: {
    rsi?: number;
    vwapDeviation?: number;
    volumeZ?: number;
    fundingRate?: number;
    sentimentScore?: number;
  };
  /** Confidence at execution */
  confidence: number;
  /** Debate verdict if applicable */
  debateVerdict: string | null;
  /** Which gladiator generated this trade */
  gladiatorId: string | null;
  /** Execution quality */
  slippageBps: number | null;
  latencyMs: number | null;
  /** Trade mode */
  mode: 'LIVE' | 'PAPER';
}

export interface ExperienceQuery {
  symbol?: string;
  direction?: 'LONG' | 'SHORT';
  regime?: string;
  gladiatorId?: string;
  mode?: 'LIVE' | 'PAPER';
  /** Only include entries from the last N milliseconds */
  lookbackMs?: number;
  /** Max results to return */
  limit?: number;
}

export interface ExperienceInsight {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnl: number;
  avgWinPnl: number;
  avgLossPnl: number;
  profitFactor: number;
  /** Dominant regime in the matching trades */
  dominantRegime: string | null;
  /** Average confidence of matching trades */
  avgConfidence: number;
  /** Summary string for SwarmOrchestrator.experienceInsight field */
  summary: string;
}

// ─── In-Memory Cache ────────────────────────────────────────────

class ExperienceCache {
  private entries: ExperienceEntry[] = [];

  add(entry: ExperienceEntry): void {
    this.entries.push(entry);
    if (this.entries.length > CACHE_SIZE) {
      this.entries = this.entries.slice(-CACHE_SIZE);
    }
  }

  query(filters: ExperienceQuery): ExperienceEntry[] {
    let results = [...this.entries];

    if (filters.symbol) {
      results = results.filter(e => e.symbol === filters.symbol);
    }
    if (filters.direction) {
      results = results.filter(e => e.direction === filters.direction);
    }
    if (filters.regime) {
      results = results.filter(e => e.regime === filters.regime);
    }
    if (filters.gladiatorId) {
      results = results.filter(e => e.gladiatorId === filters.gladiatorId);
    }
    if (filters.mode) {
      results = results.filter(e => e.mode === filters.mode);
    }
    if (filters.lookbackMs) {
      const cutoff = Date.now() - filters.lookbackMs;
      results = results.filter(e => e.timestamp >= cutoff);
    }

    // Sort newest first
    results.sort((a, b) => b.timestamp - a.timestamp);

    if (filters.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  getAll(): ExperienceEntry[] {
    return [...this.entries];
  }

  size(): number {
    return this.entries.length;
  }
}

// ─── Insight Computation ──────────────────────────────────────────

function computeInsight(entries: ExperienceEntry[]): ExperienceInsight {
  if (entries.length === 0) {
    return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      avgPnl: 0, avgWinPnl: 0, avgLossPnl: 0, profitFactor: 0,
      dominantRegime: null, avgConfidence: 0,
      summary: 'No historical data available',
    };
  }

  const wins = entries.filter(e => e.outcome === 'WIN');
  const losses = entries.filter(e => e.outcome === 'LOSS');
  const winRate = wins.length / entries.length;
  const avgPnl = entries.reduce((s, e) => s + e.pnlPercent, 0) / entries.length;
  const avgWinPnl = wins.length > 0 ? wins.reduce((s, e) => s + e.pnlPercent, 0) / wins.length : 0;
  const avgLossPnl = losses.length > 0 ? losses.reduce((s, e) => s + e.pnlPercent, 0) / losses.length : 0;

  const totalProfit = wins.reduce((s, e) => s + e.pnlPercent, 0);
  const totalLoss = Math.abs(losses.reduce((s, e) => s + e.pnlPercent, 0));
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : (totalProfit > 0 ? 99 : 0);

  // Dominant regime
  const regimeCounts: Record<string, number> = {};
  for (const e of entries) {
    if (e.regime) {
      regimeCounts[e.regime] = (regimeCounts[e.regime] || 0) + 1;
    }
  }
  const dominantRegime = Object.entries(regimeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const avgConfidence = entries.reduce((s, e) => s + e.confidence, 0) / entries.length;

  const summary = `${entries.length} trades | WR=${(winRate * 100).toFixed(0)}% | ` +
    `AvgPnL=${avgPnl.toFixed(2)}% | PF=${profitFactor.toFixed(2)} | ` +
    `Regime=${dominantRegime ?? 'mixed'}`;

  return {
    totalTrades: entries.length,
    wins: wins.length,
    losses: losses.length,
    winRate: parseFloat(winRate.toFixed(4)),
    avgPnl: parseFloat(avgPnl.toFixed(4)),
    avgWinPnl: parseFloat(avgWinPnl.toFixed(4)),
    avgLossPnl: parseFloat(avgLossPnl.toFixed(4)),
    profitFactor: parseFloat(profitFactor.toFixed(3)),
    dominantRegime,
    avgConfidence: parseFloat(avgConfidence.toFixed(3)),
    summary,
  };
}

// ─── Main Store ─────────────────────────────────────────────────

export class ExperienceMemory {
  private static instance: ExperienceMemory;
  private cache = new ExperienceCache();
  private pendingFlush: ExperienceEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    if (!DISABLED) {
      // FIX 2026-04-18 AUDIT: Only flush when there's pending data.
      // Prevents keeping event loop alive on Cloud Run when idle.
      this.flushTimer = setInterval(() => {
        if (this.pendingFlush.length > 0) this.flush();
      }, FLUSH_INTERVAL_MS);
      // Allow Cloud Run to shut down gracefully even with timer running
      if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
        (this.flushTimer as NodeJS.Timeout).unref();
      }
    }
  }

  public static getInstance(): ExperienceMemory {
    if (!ExperienceMemory.instance) {
      ExperienceMemory.instance = new ExperienceMemory();
    }
    return ExperienceMemory.instance;
  }

  /**
   * Record a completed trade outcome.
   * Adds to in-memory cache immediately, queues for Supabase flush.
   */
  record(entry: ExperienceEntry): void {
    if (DISABLED) return;

    this.cache.add(entry);
    // FIX 2026-04-18 AUDIT: Cap pendingFlush to prevent unbounded growth
    // if Supabase is persistently down. Drop oldest on overflow.
    if (this.pendingFlush.length >= 500) {
      this.pendingFlush.splice(0, this.pendingFlush.length - 499);
    }
    this.pendingFlush.push(entry);

    log.info(
      `[XP] Recorded: ${entry.symbol} ${entry.direction} ${entry.outcome} ` +
      `${entry.pnlPercent.toFixed(2)}% (regime=${entry.regime ?? 'unknown'}, glad=${entry.gladiatorId ?? 'unknown'})`
    );

    // Auto-flush if batch is full
    if (this.pendingFlush.length >= FLUSH_BATCH_SIZE) {
      this.flush().catch(() => {/* non-blocking */});
    }
  }

  /**
   * Query historical experience and compute insight.
   * Returns aggregated stats for matching trades.
   */
  queryInsight(filters: ExperienceQuery): ExperienceInsight {
    if (DISABLED) {
      return computeInsight([]);
    }
    const matches = this.cache.query(filters);
    return computeInsight(matches);
  }

  /**
   * Raw query: returns matching entries without aggregation.
   */
  queryRaw(filters: ExperienceQuery): ExperienceEntry[] {
    if (DISABLED) return [];
    return this.cache.query(filters);
  }

  /**
   * Get insight for a specific symbol + direction combo.
   * Convenience method for SwarmOrchestrator.
   */
  getSymbolInsight(symbol: string, direction: 'LONG' | 'SHORT'): ExperienceInsight {
    return this.queryInsight({ symbol, direction });
  }

  /**
   * Get insight for a gladiator across all trades.
   */
  getGladiatorInsight(gladiatorId: string): ExperienceInsight {
    return this.queryInsight({ gladiatorId });
  }

  /**
   * Get insight for a specific regime.
   */
  getRegimeInsight(regime: string): ExperienceInsight {
    return this.queryInsight({ regime });
  }

  /**
   * Flush pending entries to Supabase.
   */
  async flush(): Promise<void> {
    if (this.pendingFlush.length === 0) return;

    const batch = this.pendingFlush.splice(0, FLUSH_BATCH_SIZE);

    try {
      if (!SUPABASE_CONFIGURED) {
        log.warn('[XP] No Supabase client — entries stay in memory only');
        return;
      }

      const rows = batch.map(e => ({
        timestamp: new Date(e.timestamp).toISOString(),
        symbol: e.symbol,
        direction: e.direction,
        outcome: e.outcome,
        pnl_percent: e.pnlPercent,
        regime: e.regime,
        indicators: e.indicators,
        confidence: e.confidence,
        debate_verdict: e.debateVerdict,
        gladiator_id: e.gladiatorId,
        slippage_bps: e.slippageBps,
        latency_ms: e.latencyMs,
        mode: e.mode,
      }));

      const { error } = await supabase
        .from('experience_memory')
        .insert(rows);

      if (error) {
        log.error(`[XP] Supabase flush error: ${error.message}`);
        // Re-queue failed entries
        this.pendingFlush.unshift(...batch);
      } else {
        log.info(`[XP] Flushed ${batch.length} entries to Supabase`);
      }
    } catch (err) {
      log.error(`[XP] Flush exception: ${err}`);
      // Re-queue
      this.pendingFlush.unshift(...batch);
    }
  }

  /**
   * Force flush all pending entries. Call before shutdown.
   */
  async forceFlush(): Promise<void> {
    while (this.pendingFlush.length > 0) {
      await this.flush();
    }
  }

  /**
   * Load historical entries from Supabase into cache.
   * Call on startup to warm the cache.
   */
  async warmCache(limit: number = CACHE_SIZE): Promise<void> {
    if (DISABLED) return;

    try {
      if (!SUPABASE_CONFIGURED) return;

      const { data, error } = await supabase
        .from('experience_memory')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        log.warn(`[XP] Cache warm error: ${error.message}`);
        return;
      }

      if (data && data.length > 0) {
        // Add in chronological order (oldest first) so newest ends up at end of cache
        const sorted = data.reverse();
        for (const row of sorted) {
          this.cache.add({
            timestamp: new Date(row.timestamp).getTime(),
            symbol: row.symbol,
            direction: row.direction,
            outcome: row.outcome,
            pnlPercent: row.pnl_percent,
            regime: row.regime,
            indicators: row.indicators || {},
            confidence: row.confidence,
            debateVerdict: row.debate_verdict,
            gladiatorId: row.gladiator_id,
            slippageBps: row.slippage_bps,
            latencyMs: row.latency_ms,
            mode: row.mode,
          });
        }
        log.info(`[XP] Cache warmed with ${data.length} entries`);
      }
    } catch (err) {
      log.warn(`[XP] Cache warm exception: ${err}`);
    }
  }

  /** Current cache size */
  cacheSize(): number {
    return this.cache.size();
  }

  /** Cleanup timer on shutdown */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

export const experienceMemory = ExperienceMemory.getInstance();
