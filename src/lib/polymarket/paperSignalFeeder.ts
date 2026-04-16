// ============================================================
// Paper Signal Feeder — Phase 2 Batch 6
//
// ADDITIVE. Pure side-effect. Converts ranker `PolyOpportunity` items
// into PAPER signals (no order placement, no money movement) for
// observability + later backtest.
//
// Gates (ALL must be true to emit):
//   1. process.env.TRADING_MODE !== 'LIVE'         (default safe)
//   2. process.env.POLY_PAPER_FEEDER === 'true'    (opt-in)
//
// Storage:
//   - In-memory ring buffer (last N=200) — always.
//   - Best-effort Supabase insert into table `poly_paper_signals`
//     (silently no-ops if table missing / write fails).
//
// Consumers:
//   - GET /api/v2/polymarket/paper-signals (added as separate route).
//
// Safety:
//   - try/catch around everything; never throws to caller.
//   - No external HTTP / no exchange call.
// ============================================================
import { PolyOpportunity, PolyDivision } from './polyTypes';
import { supabase } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PaperSignalFeeder');

export interface PaperSignal {
  id: string;                  // marketId + timestamp
  marketId: string;
  marketTitle: string;
  division: PolyDivision;
  recommendation: 'BUY_YES' | 'BUY_NO' | 'SKIP';
  edgeScore: number;
  mispricingScore: number;
  liquidityScore: number;
  momentumScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  yesPrice: number | null;
  noPrice: number | null;
  liquidityUSD: number | null;
  volume24h: number | null;
  reasoning: string;
  emittedAt: number;            // unix ms
  mode: 'PAPER';
}

const RING_MAX = 200;
const ring: PaperSignal[] = [];

function isEnabled(): boolean {
  if ((process.env.TRADING_MODE || '').toUpperCase() === 'LIVE') return false;
  return (process.env.POLY_PAPER_FEEDER || '').toLowerCase() === 'true';
}

function toSignal(opp: PolyOpportunity): PaperSignal {
  const yes = opp.market.outcomes?.[0]?.price ?? null;
  const no = opp.market.outcomes?.[1]?.price ?? null;
  return {
    id: `${opp.marketId}:${Date.now()}`,
    marketId: opp.marketId,
    marketTitle: opp.market.title || opp.marketId,
    division: opp.division,
    recommendation: opp.recommendation,
    edgeScore: opp.edgeScore,
    mispricingScore: opp.mispricingScore,
    liquidityScore: opp.liquidityScore,
    momentumScore: opp.momentumScore,
    riskLevel: opp.riskLevel,
    yesPrice: yes,
    noPrice: no,
    liquidityUSD: opp.market.liquidityUSD ?? null,
    volume24h: opp.market.volume24h ?? null,
    reasoning: opp.reasoning,
    emittedAt: Date.now(),
    mode: 'PAPER',
  };
}

/**
 * Feed a batch of opportunities. Filters out SKIP recommendations.
 * Always safe — never throws, never blocks scanner.
 */
export function feedOpportunities(opps: PolyOpportunity[]): { emitted: number; reason?: string } {
  try {
    if (!isEnabled()) {
      return { emitted: 0, reason: 'disabled' };
    }
    const tradable = opps.filter(o => o.recommendation !== 'SKIP' && o.edgeScore >= 50);
    if (!tradable.length) return { emitted: 0, reason: 'no-tradable' };

    const signals = tradable.map(toSignal);
    for (const s of signals) {
      ring.push(s);
    }
    while (ring.length > RING_MAX) ring.shift();

    // Best-effort persist (non-blocking)
    void persistAsync(signals);

    log.info('Paper signals emitted', { count: signals.length });
    return { emitted: signals.length };
  } catch (e) {
    log.warn('Paper feeder skipped', { error: String(e) });
    return { emitted: 0, reason: 'error' };
  }
}

async function persistAsync(signals: PaperSignal[]): Promise<void> {
  try {
    await supabase.from('poly_paper_signals').insert(
      signals.map(s => ({
        signal_id: s.id,
        market_id: s.marketId,
        market_title: s.marketTitle,
        division: s.division,
        recommendation: s.recommendation,
        edge_score: s.edgeScore,
        risk_level: s.riskLevel,
        yes_price: s.yesPrice,
        no_price: s.noPrice,
        liquidity_usd: s.liquidityUSD,
        volume_24h: s.volume24h,
        reasoning: s.reasoning,
        emitted_at: new Date(s.emittedAt).toISOString(),
        mode: s.mode,
      })),
    );
  } catch {
    // table may not exist — ring buffer still serves the data
  }
}

export function recentPaperSignals(limit = 50): PaperSignal[] {
  const slice = ring.slice(-Math.max(1, Math.min(limit, RING_MAX)));
  return slice.slice().reverse();
}

export function paperFeederStatus(): {
  enabled: boolean;
  tradingMode: string;
  bufferSize: number;
  lastEmittedAt: number | null;
} {
  return {
    enabled: isEnabled(),
    tradingMode: (process.env.TRADING_MODE || 'PAPER').toUpperCase(),
    bufferSize: ring.length,
    lastEmittedAt: ring.length ? ring[ring.length - 1].emittedAt : null,
  };
}
