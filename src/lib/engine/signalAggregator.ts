// ============================================================
// Signal Aggregator — Unified stream from all sources
// Combines BTC Engine, Solana Engine, TradingView, DexScreener
// Ranks by ML score + aggregated confidence + confluence
// ============================================================
import { getDecisions } from '@/lib/store/db';
import { scoreSignal } from '@/lib/engine/mlFilter';
import { aggregateConfidence, ConfidenceResult } from '@/lib/core/confidenceAggregator';

export interface AggregatedSignal {
  id: string;
  symbol: string;
  signal: string;
  direction: string;
  confidence: number;          // Overridden by aggregated confidence
  confidenceDetail: ConfidenceResult; 
  price: number;
  source: string;              // Primary source
  sources: string[];           // All contributing sources
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
function computeRank(confidenceScore: number, mlScore: number, timestamp: string, outcome: string): number {
  const confNorm = confidenceScore / 100;             // 0-1
  const mlNorm = mlScore / 100;                       // 0-1
  const recency = Math.max(0, 1 - (Date.now() - new Date(timestamp).getTime()) / (6 * 3600_000)); // 0-1 (0 at 6h+)
  const isPending = outcome === 'PENDING' ? 0.2 : 0;

  return Math.round((confNorm * 30 + mlNorm * 40 + recency * 20 + isPending * 10));
}

// ─── Get aggregated signals ───────────────────────
export function getAggregatedSignals(limit = 30): AggregatedSignal[] {
  const decisions = getDecisions()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 200); // process last 200 to allow good aggregation

  // We only want to output one AggregatedSignal per pending symbol, or the latest 100 if we want history
  const output: AggregatedSignal[] = [];
  const processedSymbols = new Set<string>();

  for (const d of decisions) {
    // Only one output per symbol if it's pending to avoid spam, or just show all if we want. 
    // Usually, dashboard wants latest primary decisions. 
    // We'll output all recent unique primary decisions.
    
    // Quick dedup for display purposes: only show the most recent decision per symbol
    if (processedSymbols.has(d.symbol)) continue;
    processedSymbols.add(d.symbol);

    const ml = scoreSignal(d);
    
    // Here we use the new Confidence Aggregator
    const confDetail = aggregateConfidence(decisions, d.symbol);

    const rank = computeRank(confDetail.finalConfidence, ml.score, d.timestamp, d.outcome);
    const direction = (d.signal === 'BUY' || d.signal === 'LONG') ? 'BULLISH' : (d.signal === 'SELL' || d.signal === 'SHORT') ? 'BEARISH' : 'NEUTRAL';

    output.push({
      id: d.id,
      symbol: d.symbol,
      signal: d.signal,
      direction,
      confidence: confDetail.finalConfidence, // Use aggregated confidence
      confidenceDetail: confDetail,
      price: d.price,
      source: d.source || 'engine',
      sources: confDetail.sourceBreakdown.map(s => s.source),
      timestamp: d.timestamp,
      mlScore: ml.score,
      mlVerdict: ml.verdict,
      rank,
      outcome: d.outcome || 'PENDING',
      age: getAge(d.timestamp),
    });
  }

  // Sort by rank (highest first) then by recency
  return output
    .sort((a, b) => b.rank - a.rank || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

// ─── Get summary stats ────────────────────────────
export function getAggregatorStats() {
  const signals = getAggregatedSignals(50);
  const sources = [...new Set(signals.flatMap(s => s.sources))];
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
