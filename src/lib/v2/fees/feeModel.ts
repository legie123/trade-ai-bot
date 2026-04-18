// ============================================================
// FAZA B.2 — FEES NET MODEL (2026-04-18)
// Single source of truth for round-trip taker fees across all writers to
// gladiator_battles (simulator, cron shadow DNA, positionManager LIVE).
//
// Fee schedule (MEXC public, verified 2026-04):
//   SPOT    taker = 0.1%  → round-trip 0.2%
//   FUTURES taker = 0.04% → round-trip 0.08%
//
// Default = FUTURES. LIVE plan targets perps. Flip via env MARKET_TYPE=SPOT
// if PAPER/LIVE execution pivots to spot.
//
// ASUMPȚII CRITICE care invalidează modelul:
//   1) Slippage NU este modelat. 0.08% este LOWER BOUND. Real size $50-100 pe
//      MEXC futures = +0.04-0.1% slippage round-trip. B.2b future.
//   2) 100% taker assumption. Maker rebate -0.01% → model invalid dacă trecem
//      pe limit orders. Adaugă marketType='FUTURES_MAKER' când e cazul.
//   3) Funding rates NU sunt incluse. Negligible pentru hold <8h, notable peste.
// ============================================================

export type MarketType = 'FUTURES' | 'SPOT';

const FEES_ROUND_TRIP: Record<MarketType, number> = {
  FUTURES: 0.08, // 0.04% × 2 — MEXC futures taker
  SPOT: 0.2,     // 0.1%  × 2 — MEXC spot taker
};

/**
 * Returns round-trip fee in % and resolved market type.
 * Reads env MARKET_TYPE at call time (not at module load) so runtime flips work.
 */
export function getFeeRoundTrip(): { fee: number; marketType: MarketType } {
  const mt = (process.env.MARKET_TYPE || 'FUTURES').toUpperCase();
  const resolved: MarketType = mt === 'SPOT' ? 'SPOT' : 'FUTURES';
  return { fee: FEES_ROUND_TRIP[resolved], marketType: resolved };
}

/**
 * Compute net PnL from gross, applying current round-trip fee.
 * Pure function — no side effects, safe to call from anywhere.
 */
export function netPnlFromGross(pnlPercentGross: number): {
  pnlPercentNet: number;
  feeRoundTrip: number;
  marketType: MarketType;
  isWinNet: boolean;
} {
  const { fee, marketType } = getFeeRoundTrip();
  const pnlPercentNet = parseFloat((pnlPercentGross - fee).toFixed(4));
  return {
    pnlPercentNet,
    feeRoundTrip: fee,
    marketType,
    isWinNet: pnlPercentNet > 0,
  };
}
