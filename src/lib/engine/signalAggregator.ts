// ============================================================
// Signal Aggregator — Unified stream from all sources
// Combines BTC Engine, Solana Engine, TradingView, DexScreener
// Ranks by ML score + confidence + confluence
// ============================================================
import { getDecisions } from '@/lib/store/db';
import { scoreSignal } from '@/lib/engine/mlFilter';
import { DecisionSnapshot } from '@/lib/types/radar';

export interface AggregatedSignal {
  id: string;
  symbol: string;
  signal: string;
  direction: string;
  confidence: number;
  price: number;
  source: string;
  timestamp: string;
  mlScore: number;
  mlVerdict: string;
  rank: number;        // 0-100 composite rank
  outcome: string;
  age: string;         // human-readable age
}

// ─── Calculate age string ──────────────────────────
function getAge(timestamp: string): string {
  const ms = Date.now() - new Date(timestamp).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h`;
  return `${Math.floor(ms / 86400_000)}d`;
}

// ─── Compute composite rank ───────────────────────
function computeRank(d: DecisionSnapshot, mlScore: number): number {
  const confScore = d.confidence / 100;              // 0-1
  const mlNorm = mlScore / 100;                       // 0-1
  const recency = Math.max(0, 1 - (Date.now() - new Date(d.timestamp).getTime()) / (6 * 3600_000)); // 0-1 (0 at 6h+)
  const isPending = d.outcome === 'PENDING' ? 0.2 : 0;

  return Math.round((confScore * 30 + mlNorm * 40 + recency * 20 + isPending * 10));
}

// ─── Get aggregated signals ───────────────────────
export function getAggregatedSignals(limit = 30): AggregatedSignal[] {
  const decisions = getDecisions()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 100); // process last 100

  const aggregated: AggregatedSignal[] = decisions.map((d) => {
    const ml = scoreSignal(d);
    const rank = computeRank(d, ml.score);
    const direction = (d.signal === 'BUY' || d.signal === 'LONG') ? 'BULLISH' : (d.signal === 'SELL' || d.signal === 'SHORT') ? 'BEARISH' : 'NEUTRAL';

    return {
      id: d.id,
      symbol: d.symbol,
      signal: d.signal,
      direction,
      confidence: d.confidence,
      price: d.price,
      source: d.source || 'engine',
      timestamp: d.timestamp,
      mlScore: ml.score,
      mlVerdict: ml.verdict,
      rank,
      outcome: d.outcome || 'PENDING',
      age: getAge(d.timestamp),
    };
  });

  // Sort by rank (highest first) then by recency
  return aggregated
    .sort((a, b) => b.rank - a.rank || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

// ─── Get summary stats ────────────────────────────
export function getAggregatorStats() {
  const signals = getAggregatedSignals(50);
  const sources = [...new Set(signals.map(s => s.source))];
  const symbols = [...new Set(signals.map(s => s.symbol))];

  return {
    total: signals.length,
    sources,
    symbols,
    avgRank: signals.length > 0 ? Math.round(signals.reduce((s, a) => s + a.rank, 0) / signals.length) : 0,
    topSignal: signals[0] || null,
    strongSignals: signals.filter(s => s.mlVerdict === 'STRONG').length,
    pendingCount: signals.filter(s => s.outcome === 'PENDING').length,
  };
}
