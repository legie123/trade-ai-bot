// ============================================================
// Market Regime Agent — classifies recent price action into regimes
//
// ADDITIVE. Works on a generic series of {price, volume?} ticks. The
// Polymarket + MEXC WS clients feed this via polyWsClient.getLastEvent
// and AlphaScout's tape.
// ============================================================
export type MarketRegime =
  | 'trend_up'
  | 'trend_down'
  | 'range'
  | 'volatile'
  | 'illiquid'
  | 'unknown';

export interface RegimeContext {
  symbol: string;
  regime: MarketRegime;
  volatility: number;    // stdev of returns
  trendStrength: number; // slope sign × |slope| normalized
  sampleSize: number;
  at: number;
}

export interface PricePoint {
  t: number;   // ms
  p: number;   // price
  v?: number;  // optional volume
}

/**
 * Classify a short price series. Inputs are expected to cover
 * ~minutes to ~hour; caller controls window.
 */
export function classifyRegime(symbol: string, series: PricePoint[]): RegimeContext {
  const now = Date.now();
  if (!series || series.length < 5) {
    return {
      symbol,
      regime: 'unknown',
      volatility: 0,
      trendStrength: 0,
      sampleSize: series?.length || 0,
      at: now,
    };
  }
  const sorted = [...series].sort((a, b) => a.t - b.t);
  const prices = sorted.map((s) => s.p).filter((p) => p > 0);
  if (prices.length < 5) {
    return { symbol, regime: 'unknown', volatility: 0, trendStrength: 0, sampleSize: prices.length, at: now };
  }

  // Log returns
  const rets: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) rets.push(Math.log(prices[i] / prices[i - 1]));
  }
  const meanR = rets.reduce((s, v) => s + v, 0) / rets.length;
  const variance = rets.reduce((s, v) => s + (v - meanR) ** 2, 0) / rets.length;
  const volatility = Math.sqrt(variance);

  // Simple linear slope (least squares) over prices indexed 0..n
  const n = prices.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const xMean = (n - 1) / 2;
  const pMean = prices.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (prices[i] - pMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  const priceRange = Math.max(...prices) - Math.min(...prices);
  const normSlope = priceRange > 0 ? slope / priceRange : 0;

  // Regime classification
  let regime: MarketRegime = 'unknown';
  const absSlope = Math.abs(normSlope);
  const highVol = volatility > 0.02;       // heuristic: 2% stdev per tick
  const lowVol = volatility < 0.005;
  if (absSlope > 0.05 && !highVol) regime = normSlope > 0 ? 'trend_up' : 'trend_down';
  else if (highVol && absSlope < 0.05) regime = 'volatile';
  else if (lowVol && absSlope < 0.02) regime = 'range';
  else if (absSlope > 0.05 && highVol) regime = normSlope > 0 ? 'trend_up' : 'trend_down';
  else regime = 'range';

  // Volume-based illiquidity hint
  const volumes = sorted.map((s) => s.v || 0).filter((v) => v > 0);
  if (volumes.length > 0) {
    const meanVol = volumes.reduce((s, v) => s + v, 0) / volumes.length;
    if (meanVol < 1 && volumes.length < n * 0.5) regime = 'illiquid';
  }

  return {
    symbol,
    regime,
    volatility: Number(volatility.toFixed(6)),
    trendStrength: Number(normSlope.toFixed(6)),
    sampleSize: n,
    at: now,
  };
}
