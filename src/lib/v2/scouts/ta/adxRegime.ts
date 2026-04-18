// ============================================================
// ADX Regime Gate — FAZA 3.1 Batch 2
// ============================================================
// Wilder's ADX(14) → classify market regime → return sizing multiplier.
//
// PSEUDO-CODE:
//   1. Compute +DI, -DI from daily HLC differences (smoothed Wilder)
//   2. DX = |+DI - -DI| / (+DI + -DI) * 100
//   3. ADX = Wilder smoothing of DX over period
//   4. Regime classification:
//        ADX > 25  → TREND     (trend-followers favored)
//        ADX < 20  → MEAN_REV  (range-traders / mean-reversion favored)
//        20-25     → TRANSITION (neutral, no boost/penalty)
//   5. multiplier(regime, signalKind) returns 1.0 baseline,
//        boost 1.20 for compatible (trend signal in TREND regime),
//        cut 0.70 for incompatible (trend signal in MEAN_REV regime).
//
// CRITICAL ASSUMPTIONS (if broken → invalidates regime gate):
//   A1: Candles are time-ordered ascending (oldest first)
//   A2: Period >= 14 candles available (otherwise ADX is unreliable)
//   A3: signalKind is reliably classifiable as 'trend' | 'mean_rev' | 'unknown'
//   A4: Regime is stable enough across the trade horizon (not flipping every candle)
//
// FEATURE FLAG: env REGIME_GATE_ENABLED ('shadow' default | 'active' | 'off')
//   - 'shadow' → telemetry only, no decision impact (SAFE rollout)
//   - 'active' → multiplier applied to confidence/sizing
//   - 'off'    → bypass entirely
//
// KILL-SWITCH: set REGIME_GATE_ENABLED=off in Cloud Run env without redeploy.
// ============================================================

import { createLogger } from '@/lib/core/logger';

const log = createLogger('ADXRegime');

export type RegimeKind = 'TREND' | 'MEAN_REV' | 'TRANSITION' | 'UNKNOWN';
export type SignalKind = 'trend' | 'mean_rev' | 'unknown';
export type RegimeMode = 'shadow' | 'active' | 'off';

export interface RegimeResult {
  adx: number;            // 0-100
  plusDI: number;         // current +DI
  minusDI: number;        // current -DI
  regime: RegimeKind;
  multiplier: number;     // 1.0 baseline; >1 = compatible boost; <1 = incompatible cut
  reason: string;
  candlesUsed: number;
  computedAt: number;
}

export interface OHLC {
  t: number;
  h: number;
  l: number;
  c: number;
}

const DEFAULT_PERIOD = 14;
const TREND_THRESHOLD = 25;
const MEAN_REV_THRESHOLD = 20;

// ─── Cache (symbol, lastCandleTs) → RegimeResult ───
// Avoids recomputing ADX on every signal — only when a new candle closes.
const _regimeCache = new Map<string, RegimeResult>();
const CACHE_MAX = 100; // hard cap; LRU eviction below

function cacheKey(symbol: string, lastCandleTs: number, period: number): string {
  return `${symbol.toUpperCase()}|${lastCandleTs}|${period}`;
}

function evictIfFull(): void {
  if (_regimeCache.size <= CACHE_MAX) return;
  // Drop oldest by insertion order until back to cap
  while (_regimeCache.size > CACHE_MAX) {
    const oldest = _regimeCache.keys().next().value;
    if (oldest === undefined) break;
    _regimeCache.delete(oldest);
  }
}

export function getRegimeMode(): RegimeMode {
  const v = (process.env.REGIME_GATE_ENABLED || 'shadow').toLowerCase();
  if (v === 'active' || v === 'on' || v === 'true') return 'active';
  if (v === 'off' || v === 'false' || v === 'disabled') return 'off';
  return 'shadow';
}

// ─── Wilder smoothing helper ───
// Equivalent to: smoothed[i] = (smoothed[i-1] * (period-1) + value[i]) / period
function wilderSmooth(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const out: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + values[i]) / period;
  }
  return out;
}

// ─── Core ADX calculation ───
// Returns the most recent ADX, +DI, -DI (or NaN if insufficient data).
export function calcADX(
  candles: OHLC[],
  period: number = DEFAULT_PERIOD
): { adx: number; plusDI: number; minusDI: number } {
  // Need at least 2*period for stable ADX (initial smoothing + smoothing of DX)
  if (candles.length < period * 2 + 1) {
    return { adx: NaN, plusDI: NaN, minusDI: NaN };
  }

  const trList: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    // True Range
    const tr = Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prev.c),
      Math.abs(cur.l - prev.c)
    );
    trList.push(tr);
    // Directional Movement
    const upMove = cur.h - prev.h;
    const downMove = prev.l - cur.l;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const atr = wilderSmooth(trList, period);
  const plusDMSm = wilderSmooth(plusDM, period);
  const minusDMSm = wilderSmooth(minusDM, period);

  const dx: number[] = [];
  for (let i = 0; i < trList.length; i++) {
    if (isNaN(atr[i]) || atr[i] === 0) {
      dx.push(NaN);
      continue;
    }
    const pDI = (plusDMSm[i] / atr[i]) * 100;
    const mDI = (minusDMSm[i] / atr[i]) * 100;
    const sum = pDI + mDI;
    if (sum === 0) {
      dx.push(0);
      continue;
    }
    dx.push((Math.abs(pDI - mDI) / sum) * 100);
  }

  // Wilder smooth DX → ADX. Skip leading NaNs.
  const dxClean = dx.filter((v) => !isNaN(v));
  if (dxClean.length < period) return { adx: NaN, plusDI: NaN, minusDI: NaN };
  const adxSeries = wilderSmooth(dxClean, period);
  const lastAdx = adxSeries[adxSeries.length - 1];
  const lastAtr = atr[atr.length - 1];
  const lastPlus = plusDMSm[plusDMSm.length - 1];
  const lastMinus = minusDMSm[minusDMSm.length - 1];
  const plusDI = lastAtr > 0 ? (lastPlus / lastAtr) * 100 : NaN;
  const minusDI = lastAtr > 0 ? (lastMinus / lastAtr) * 100 : NaN;
  return { adx: lastAdx, plusDI, minusDI };
}

// ─── Classify regime from ADX value ───
export function classifyRegime(adx: number): RegimeKind {
  if (isNaN(adx)) return 'UNKNOWN';
  if (adx >= TREND_THRESHOLD) return 'TREND';
  if (adx < MEAN_REV_THRESHOLD) return 'MEAN_REV';
  return 'TRANSITION';
}

// ─── Sizing multiplier (gate logic) ───
// HARD MODE: multiplier is intentionally conservative.
//   - Compatible match (TREND signal in TREND regime): 1.20 boost
//   - Incompatible match (TREND signal in MEAN_REV regime): 0.70 cut
//   - Neutral / unknown: 1.00 (no impact)
// Rationale: amplifying losers is worse than missing winners. Cut > Boost in magnitude
// is a deliberate asymmetric design — prevents overconfidence on regime classifier itself.
export function regimeMultiplier(regime: RegimeKind, signalKind: SignalKind): number {
  if (regime === 'UNKNOWN' || signalKind === 'unknown') return 1.0;
  if (regime === 'TRANSITION') return 1.0;
  if (regime === 'TREND' && signalKind === 'trend') return 1.20;
  if (regime === 'MEAN_REV' && signalKind === 'mean_rev') return 1.20;
  // Mismatch: trend signal in mean-rev regime, or vice versa
  return 0.70;
}

// ─── Public entry: compute regime with cache ───
export async function computeRegime(
  symbol: string,
  candles: OHLC[],
  period: number = DEFAULT_PERIOD
): Promise<RegimeResult> {
  if (!candles || candles.length === 0) {
    return {
      adx: NaN,
      plusDI: NaN,
      minusDI: NaN,
      regime: 'UNKNOWN',
      multiplier: 1.0,
      reason: 'no_candles',
      candlesUsed: 0,
      computedAt: Date.now(),
    };
  }

  const lastTs = candles[candles.length - 1].t;
  const key = cacheKey(symbol, lastTs, period);
  const cached = _regimeCache.get(key);
  if (cached) return cached;

  const { adx, plusDI, minusDI } = calcADX(candles, period);
  const regime = classifyRegime(adx);
  const result: RegimeResult = {
    adx: isNaN(adx) ? 0 : Number(adx.toFixed(2)),
    plusDI: isNaN(plusDI) ? 0 : Number(plusDI.toFixed(2)),
    minusDI: isNaN(minusDI) ? 0 : Number(minusDI.toFixed(2)),
    regime,
    multiplier: 1.0, // multiplier resolved at apply-time with signalKind
    reason: isNaN(adx)
      ? `insufficient_candles (need ${period * 2 + 1}, got ${candles.length})`
      : `adx=${adx.toFixed(2)} → ${regime}`,
    candlesUsed: candles.length,
    computedAt: Date.now(),
  };

  _regimeCache.set(key, result);
  evictIfFull();

  if (regime !== 'UNKNOWN') {
    log.info(`[regime] ${symbol} ADX=${result.adx} +DI=${result.plusDI} -DI=${result.minusDI} → ${regime}`);
  }

  return result;
}

// ─── Telemetry: cache stats for /api/v2/health observability ───
export function getRegimeCacheStats(): { size: number; maxSize: number; mode: RegimeMode } {
  return {
    size: _regimeCache.size,
    maxSize: CACHE_MAX,
    mode: getRegimeMode(),
  };
}
