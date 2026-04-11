import { createLogger } from '@/lib/core/logger';
import { addGladiatorDna, getGladiatorDna, getGladiatorBattles } from '@/lib/store/db';

const log = createLogger('DNAExtractor');

export interface BattleRecord {
  id: string;
  gladiatorId: string;
  symbol: string;
  decision: 'LONG' | 'SHORT' | 'FLAT';
  outcomePrice: number;
  entryPrice: number;
  pnlPercent: number;
  timestamp: number;
  isWin: boolean;
  marketContext: Record<string, unknown>;
}

export interface SymbolEdge {
  symbol: string;
  totalTrades: number;
  winRate: number;
  avgWinPnl: number;
  avgLossPnl: number;
  expectancy: number; // (winRate * avgWin) - ((1 - winRate) * avgLoss)
  longBias: number;   // % of wins that were LONG
}

export interface IntelligenceDigest {
  gladiatorId: string;
  totalBattles: number;
  overallWinRate: number;
  recentWinRate: number;        // Last 20 trades
  currentStreak: number;        // Positive = wins, negative = losses
  bestSymbol: string | null;
  worstSymbol: string | null;
  symbolEdges: SymbolEdge[];
  avgHoldTimeSec: number;
  longWinRate: number;
  shortWinRate: number;
  recentPnL: number;            // Sum of last 20 PnL %
  confidenceModifier: number;   // Reinforcement learning multiplier
  digest: string;               // Human-readable summary for LLM consumption
}

export class DNAExtractor {
  private static instance: DNAExtractor;

  private constructor() {}

  public static getInstance(): DNAExtractor {
    if (!DNAExtractor.instance) {
      DNAExtractor.instance = new DNAExtractor();
    }
    return DNAExtractor.instance;
  }

  public async logBattle(record: BattleRecord): Promise<void> {
    try {
      await addGladiatorDna(record as unknown as Record<string, unknown>);
      log.info(`[DNA Bank] Logged battle for ${record.gladiatorId} on ${record.symbol} (Win: ${record.isWin}, PnL: ${record.pnlPercent.toFixed(2)}%)`);
    } catch (err) {
      log.error('Failed to log battle DNA', { error: (err as Error).message });
    }
  }

  /**
   * Extracts a full intelligence digest for a gladiator.
   * This is the BRAIN of the reinforcement learning loop.
   *
   * INSTITUTIONAL UPGRADE: Uses Postgres-backed getGladiatorBattles when available
   * (paginated to 500 most recent per gladiator). Falls back to in-memory cache.
   * Synchronous wrapper maintained for backward compatibility — uses cached data
   * from last async fetch. Call extractIntelligenceAsync for fresh Postgres reads.
   */
  public extractIntelligence(gladiatorId: string): IntelligenceDigest {
    // Synchronous path: use in-memory cache (populated by addGladiatorDna or initDB)
    const allBattles = (getGladiatorDna() as unknown as BattleRecord[]) || [];
    const battles = allBattles.filter(b => b.gladiatorId === gladiatorId);
    const total = battles.length;

    if (total === 0) {
      return this.emptyDigest(gladiatorId);
    }

    // Sort chronologically
    const sorted = [...battles].sort((a, b) => a.timestamp - b.timestamp);
    const recent = sorted.slice(-20);

    // ─── Overall Stats ───
    const wins = sorted.filter(b => b.isWin).length;
    const overallWinRate = wins / total;
    const recentWins = recent.filter(b => b.isWin).length;
    const recentWinRate = recent.length > 0 ? recentWins / recent.length : 0;
    const recentPnL = recent.reduce((s, b) => s + b.pnlPercent, 0);

    // ─── Streak Detection ───
    let currentStreak = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (i === sorted.length - 1) {
        currentStreak = sorted[i].isWin ? 1 : -1;
      } else {
        if (sorted[i].isWin && currentStreak > 0) currentStreak++;
        else if (!sorted[i].isWin && currentStreak < 0) currentStreak--;
        else break;
      }
    }

    // ─── Direction Bias ───
    const longs = sorted.filter(b => b.decision === 'LONG');
    const shorts = sorted.filter(b => b.decision === 'SHORT');
    const longWinRate = longs.length > 0 ? longs.filter(b => b.isWin).length / longs.length : 0;
    const shortWinRate = shorts.length > 0 ? shorts.filter(b => b.isWin).length / shorts.length : 0;

    // ─── Hold Time Analysis ───
    const holdTimes = sorted
      .map(b => (b.marketContext?.holdTimeSec as number) || 0)
      .filter(h => h > 0);
    const avgHoldTimeSec = holdTimes.length > 0
      ? holdTimes.reduce((s, h) => s + h, 0) / holdTimes.length
      : 0;

    // ─── Per-Symbol Edge Analysis ───
    const symbolMap = new Map<string, BattleRecord[]>();
    for (const b of sorted) {
      const arr = symbolMap.get(b.symbol) || [];
      arr.push(b);
      symbolMap.set(b.symbol, arr);
    }

    const symbolEdges: SymbolEdge[] = [];
    let bestSymbol: string | null = null;
    let worstSymbol: string | null = null;
    let bestExpectancy = -Infinity;
    let worstExpectancy = Infinity;

    for (const [symbol, records] of symbolMap) {
      const symWins = records.filter(r => r.isWin);
      const symLosses = records.filter(r => !r.isWin);
      const symWinRate = records.length > 0 ? symWins.length / records.length : 0;
      const avgWinPnl = symWins.length > 0
        ? symWins.reduce((s, r) => s + r.pnlPercent, 0) / symWins.length
        : 0;
      const avgLossPnl = symLosses.length > 0
        ? Math.abs(symLosses.reduce((s, r) => s + r.pnlPercent, 0) / symLosses.length)
        : 0;
      const expectancy = (symWinRate * avgWinPnl) - ((1 - symWinRate) * avgLossPnl);
      const longBias = symWins.length > 0
        ? symWins.filter(r => r.decision === 'LONG').length / symWins.length
        : 0.5;

      symbolEdges.push({ symbol, totalTrades: records.length, winRate: symWinRate, avgWinPnl, avgLossPnl, expectancy, longBias });

      if (expectancy > bestExpectancy) { bestExpectancy = expectancy; bestSymbol = symbol; }
      if (expectancy < worstExpectancy) { worstExpectancy = expectancy; worstSymbol = symbol; }
    }

    // ─── Reinforcement Learning Confidence Modifier ───
    // Based on recent performance: hot streaks boost, cold streaks dampen
    let confidenceModifier = 1.0;
    if (recentWinRate > 0.65) confidenceModifier = 1.15;     // Hot hand → boost
    else if (recentWinRate > 0.55) confidenceModifier = 1.05;
    else if (recentWinRate < 0.35) confidenceModifier = 0.7;  // Cold streak → dampen heavily
    else if (recentWinRate < 0.45) confidenceModifier = 0.85;

    if (currentStreak >= 5) confidenceModifier *= 1.1;       // 5+ win streak → extra boost
    else if (currentStreak <= -4) confidenceModifier *= 0.75; // 4+ loss streak → extra dampening

    confidenceModifier = parseFloat(Math.min(Math.max(confidenceModifier, 0.5), 1.5).toFixed(2));

    // ─── Human-readable Digest for LLM Context ───
    const topEdges = symbolEdges.sort((a, b) => b.expectancy - a.expectancy).slice(0, 3);
    const digest = [
      `GLADIATOR ${gladiatorId} INTELLIGENCE:`,
      `Overall: ${total} trades, ${(overallWinRate * 100).toFixed(1)}% win rate`,
      `Recent (last 20): ${(recentWinRate * 100).toFixed(1)}% win rate, PnL: ${recentPnL.toFixed(2)}%`,
      `Streak: ${currentStreak > 0 ? `+${currentStreak} wins` : `${currentStreak} losses`}`,
      `Direction bias: LONG ${(longWinRate * 100).toFixed(0)}% vs SHORT ${(shortWinRate * 100).toFixed(0)}%`,
      `Best asset: ${bestSymbol} (expectancy: ${bestExpectancy.toFixed(3)}%)`,
      `Confidence modifier: ${confidenceModifier}x`,
      topEdges.length > 0 ? `Top edges: ${topEdges.map(e => `${e.symbol}(${(e.winRate * 100).toFixed(0)}%/${e.expectancy.toFixed(2)})`).join(', ')}` : '',
    ].filter(Boolean).join('. ');

    return {
      gladiatorId,
      totalBattles: total,
      overallWinRate,
      recentWinRate,
      currentStreak,
      bestSymbol,
      worstSymbol,
      symbolEdges,
      avgHoldTimeSec,
      longWinRate,
      shortWinRate,
      recentPnL,
      confidenceModifier,
      digest,
    };
  }

  /**
   * INSTITUTIONAL UPGRADE: Async version that reads directly from Postgres
   * via getGladiatorBattles (paginated to 500 records per gladiator).
   * Preferred path for ManagerVizionar signal processing.
   */
  public async extractIntelligenceAsync(gladiatorId: string): Promise<IntelligenceDigest> {
    try {
      const rawBattles = await getGladiatorBattles(gladiatorId, 500);
      if (!rawBattles || rawBattles.length === 0) {
        return this.emptyDigest(gladiatorId);
      }
      // Re-use the synchronous computation logic by temporarily injecting fetched data
      const battles = rawBattles as unknown as BattleRecord[];
      return this.computeDigest(gladiatorId, battles);
    } catch {
      // Fallback to synchronous in-memory
      return this.extractIntelligence(gladiatorId);
    }
  }

  /**
   * Core computation extracted for reuse by both sync and async paths.
   */
  private computeDigest(gladiatorId: string, battles: BattleRecord[]): IntelligenceDigest {
    const total = battles.length;
    if (total === 0) return this.emptyDigest(gladiatorId);

    const sorted = [...battles].sort((a, b) => a.timestamp - b.timestamp);
    const recent = sorted.slice(-20);
    const wins = sorted.filter(b => b.isWin).length;
    const overallWinRate = wins / total;
    const recentWins = recent.filter(b => b.isWin).length;
    const recentWinRate = recent.length > 0 ? recentWins / recent.length : 0;
    const recentPnL = recent.reduce((s, b) => s + b.pnlPercent, 0);

    let currentStreak = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (i === sorted.length - 1) {
        currentStreak = sorted[i].isWin ? 1 : -1;
      } else {
        if (sorted[i].isWin && currentStreak > 0) currentStreak++;
        else if (!sorted[i].isWin && currentStreak < 0) currentStreak--;
        else break;
      }
    }

    const longs = sorted.filter(b => b.decision === 'LONG');
    const shorts = sorted.filter(b => b.decision === 'SHORT');
    const longWinRate = longs.length > 0 ? longs.filter(b => b.isWin).length / longs.length : 0;
    const shortWinRate = shorts.length > 0 ? shorts.filter(b => b.isWin).length / shorts.length : 0;

    const holdTimes = sorted.map(b => (b.marketContext?.holdTimeSec as number) || 0).filter(h => h > 0);
    const avgHoldTimeSec = holdTimes.length > 0 ? holdTimes.reduce((s, h) => s + h, 0) / holdTimes.length : 0;

    const symbolMap = new Map<string, BattleRecord[]>();
    for (const b of sorted) {
      const arr = symbolMap.get(b.symbol) || [];
      arr.push(b);
      symbolMap.set(b.symbol, arr);
    }

    const symbolEdges: SymbolEdge[] = [];
    let bestSymbol: string | null = null;
    let worstSymbol: string | null = null;
    let bestExpectancy = -Infinity;
    let worstExpectancy = Infinity;

    for (const [symbol, records] of symbolMap) {
      const symWins = records.filter(r => r.isWin);
      const symLosses = records.filter(r => !r.isWin);
      const symWinRate = records.length > 0 ? symWins.length / records.length : 0;
      const avgWinPnl = symWins.length > 0 ? symWins.reduce((s, r) => s + r.pnlPercent, 0) / symWins.length : 0;
      const avgLossPnl = symLosses.length > 0 ? Math.abs(symLosses.reduce((s, r) => s + r.pnlPercent, 0) / symLosses.length) : 0;
      const expectancy = (symWinRate * avgWinPnl) - ((1 - symWinRate) * avgLossPnl);
      const longBias = symWins.length > 0 ? symWins.filter(r => r.decision === 'LONG').length / symWins.length : 0.5;

      symbolEdges.push({ symbol, totalTrades: records.length, winRate: symWinRate, avgWinPnl, avgLossPnl, expectancy, longBias });
      if (expectancy > bestExpectancy) { bestExpectancy = expectancy; bestSymbol = symbol; }
      if (expectancy < worstExpectancy) { worstExpectancy = expectancy; worstSymbol = symbol; }
    }

    let confidenceModifier = 1.0;
    if (recentWinRate > 0.65) confidenceModifier = 1.15;
    else if (recentWinRate > 0.55) confidenceModifier = 1.05;
    else if (recentWinRate < 0.35) confidenceModifier = 0.7;
    else if (recentWinRate < 0.45) confidenceModifier = 0.85;

    if (currentStreak >= 5) confidenceModifier *= 1.1;
    else if (currentStreak <= -4) confidenceModifier *= 0.75;
    confidenceModifier = parseFloat(Math.min(Math.max(confidenceModifier, 0.5), 1.5).toFixed(2));

    const topEdges = symbolEdges.sort((a, b) => b.expectancy - a.expectancy).slice(0, 3);
    const digest = [
      `GLADIATOR ${gladiatorId} INTELLIGENCE:`,
      `Overall: ${total} trades, ${(overallWinRate * 100).toFixed(1)}% win rate`,
      `Recent (last 20): ${(recentWinRate * 100).toFixed(1)}% win rate, PnL: ${recentPnL.toFixed(2)}%`,
      `Streak: ${currentStreak > 0 ? `+${currentStreak} wins` : `${currentStreak} losses`}`,
      `Direction bias: LONG ${(longWinRate * 100).toFixed(0)}% vs SHORT ${(shortWinRate * 100).toFixed(0)}%`,
      `Best asset: ${bestSymbol} (expectancy: ${bestExpectancy.toFixed(3)}%)`,
      `Confidence modifier: ${confidenceModifier}x`,
      topEdges.length > 0 ? `Top edges: ${topEdges.map(e => `${e.symbol}(${(e.winRate * 100).toFixed(0)}%/${e.expectancy.toFixed(2)})`).join(', ')}` : '',
    ].filter(Boolean).join('. ');

    return {
      gladiatorId, totalBattles: total, overallWinRate, recentWinRate, currentStreak,
      bestSymbol, worstSymbol, symbolEdges, avgHoldTimeSec, longWinRate, shortWinRate,
      recentPnL, confidenceModifier, digest,
    };
  }

  /** Backward-compatible accessor */
  public async getGladiatorAggregatedDna(gladiatorId: string): Promise<Record<string, unknown>> {
    return this.extractIntelligenceAsync(gladiatorId) as unknown as Record<string, unknown>;
  }

  private emptyDigest(gladiatorId: string): IntelligenceDigest {
    return {
      gladiatorId,
      totalBattles: 0,
      overallWinRate: 0,
      recentWinRate: 0,
      currentStreak: 0,
      bestSymbol: null,
      worstSymbol: null,
      symbolEdges: [],
      avgHoldTimeSec: 0,
      longWinRate: 0,
      shortWinRate: 0,
      recentPnL: 0,
      confidenceModifier: 1.0,
      digest: `GLADIATOR ${gladiatorId}: No battle history. First trade — use standard confidence.`,
    };
  }
}

