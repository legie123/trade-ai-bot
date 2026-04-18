// ============================================================
// FAZA B.2 — FEES NET MODEL (2026-04-18)
// RUFLO FAZA 3 Batch A (2026-04-19) — SLIPPAGE ADDER
//
// Single source of truth for round-trip cost (fee + slippage) across all
// writers to gladiator_battles (simulator, cron shadow DNA, positionManager LIVE).
//
// Fee schedule (MEXC public, verified 2026-04):
//   SPOT    taker = 0.1%  → round-trip 0.2%
//   FUTURES taker = 0.04% → round-trip 0.08%
//
// Slippage estimate (RUFLO FAZA 1 audit finding P5):
//   FUTURES at $50-100 size on MEXC perps → ~0.06% round-trip (LOWER BOUND).
//   SPOT (thinner liquidity) → ~0.08% round-trip.
//   Kill-switch: FEE_INCLUDE_SLIPPAGE=0 → slippage disabled (legacy behavior).
//   When real fills are telemetered, replace static table with rolling-avg.
//
// Default = FUTURES. LIVE plan targets perps. Flip via env MARKET_TYPE=SPOT
// if PAPER/LIVE execution pivots to spot.
//
// ASUMPȚII CRITICE care invalidează modelul:
//   1) Slippage table e STATIC. Real slippage depinde de order book depth,
//      size, volatilitate. 0.06% e LOWER BOUND. Dacă size-ul crește peste $100
//      sau volatility spike, underestimate. Validare: compară pnl simulat
//      vs realized pnl live după primele 20 trades LIVE.
//   2) 100% taker assumption. Maker rebate -0.01% → model invalid dacă trecem
//      pe limit orders. Adaugă marketType='FUTURES_MAKER' când e cazul.
//   3) Funding rates NU sunt incluse. Negligible pentru hold <8h, notable peste.
//   4) Slippage aplicat simetric (round-trip). Asimetric (buy vs sell) posibil
//      pe piețe trending → model subestimează long-side în bull, short-side în bear.
// ============================================================

export type MarketType = 'FUTURES' | 'SPOT';

const FEES_ROUND_TRIP: Record<MarketType, number> = {
  FUTURES: 0.08, // 0.04% × 2 — MEXC futures taker
  SPOT: 0.2,     // 0.1%  × 2 — MEXC spot taker
};

// RUFLO FAZA 3 Batch A — slippage estimate round-trip.
// Sursă: RUFLO FAZA 1 audit, P5 finding. Conservative lower-bound.
const SLIPPAGE_ROUND_TRIP: Record<MarketType, number> = {
  FUTURES: 0.06, // ~0.03% × 2 — MEXC futures $50-100 size
  SPOT: 0.08,    // ~0.04% × 2 — MEXC spot thinner liquidity
};

/**
 * Returns round-trip fee + slippage + total, and resolved market type.
 * Reads env at call time (not at module load) so runtime flips work.
 *
 * Backward compat: `fee` key preserved (just taker, without slippage).
 * New keys (additive, non-breaking): `slippage`, `total`.
 */
export function getFeeRoundTrip(): { fee: number; slippage: number; total: number; marketType: MarketType } {
  const mt = (process.env.MARKET_TYPE || 'FUTURES').toUpperCase();
  const resolved: MarketType = mt === 'SPOT' ? 'SPOT' : 'FUTURES';
  const fee = FEES_ROUND_TRIP[resolved];
  // Kill-switch: FEE_INCLUDE_SLIPPAGE=0 → legacy behavior (fee only).
  // Default ON (includes slippage) to make gladiator stats reflect realistic net cost.
  const includeSlippage = (process.env.FEE_INCLUDE_SLIPPAGE || '1') !== '0';
  const slippage = includeSlippage ? SLIPPAGE_ROUND_TRIP[resolved] : 0;
  const total = parseFloat((fee + slippage).toFixed(4));
  return { fee, slippage, total, marketType: resolved };
}

/**
 * Compute net PnL from gross, applying current round-trip TOTAL cost (fee + slippage).
 * Pure function — no side effects, safe to call from anywhere.
 *
 * Backward compat: existing keys `pnlPercentNet`, `feeRoundTrip`, `marketType`,
 * `isWinNet` preserved. `feeRoundTrip` keep returning just taker fee (not total)
 * to avoid breaking downstream consumers that log it separately.
 * New keys (additive): `slippage`, `totalCost`.
 *
 * IMPORTANT: `pnlPercentNet` now uses `total` (fee+slippage), so callers
 * automatically get slippage-adjusted net. Flip via FEE_INCLUDE_SLIPPAGE=0.
 */
export function netPnlFromGross(pnlPercentGross: number): {
  pnlPercentNet: number;
  feeRoundTrip: number;
  slippage: number;
  totalCost: number;
  marketType: MarketType;
  isWinNet: boolean;
} {
  const { fee, slippage, total, marketType } = getFeeRoundTrip();
  const pnlPercentNet = parseFloat((pnlPercentGross - total).toFixed(4));
  return {
    pnlPercentNet,
    feeRoundTrip: fee,
    slippage,
    totalCost: total,
    marketType,
    isWinNet: pnlPercentNet > 0,
  };
}
