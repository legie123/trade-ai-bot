// ============================================================
// Correlation Guard — Step 1.2
//
// ADDITIVE. Prevents opening new positions that are highly
// correlated with existing open positions. Reduces portfolio
// concentration risk from correlated crypto assets.
//
// Kill-switch: DISABLE_CORRELATION_GUARD=true
// ============================================================

import { createLogger } from '@/lib/core/logger';
import { getOrFetchPrice } from '@/lib/cache/priceCache';

const log = createLogger('CorrelationGuard');

// ─── Configuration ──────────────────────────────────────────

const DISABLED = process.env.DISABLE_CORRELATION_GUARD === 'true';

/** Max correlation allowed between new position and any existing position */
const CORRELATION_THRESHOLD = parseFloat(process.env.CORRELATION_THRESHOLD || '0.80');

/** Lookback window for correlation calculation */
const LOOKBACK_CLOSES = 100;

/** Minimum data points required for meaningful correlation */
const MIN_DATA_POINTS = 20;

// ─── Types ──────────────────────────────────────────────────

export interface CorrelationCheck {
  allowed: boolean;
  reason?: string;
  correlations: Array<{ existingSymbol: string; correlation: number }>;
  maxCorrelation: number;
  checkedAt: number;
}

interface PositionInfo {
  symbol: string;
  side: 'LONG' | 'SHORT';
}

// ─── In-Memory Price History Cache ──────────────────────────
// Stores recent close prices per symbol for correlation calc.
// Fed by WS streams or periodic polling.

const priceHistory: Map<string, number[]> = new Map();
const MAX_HISTORY = 200;

/**
 * Record a price tick for a symbol (called by WS stream or polling)
 */
export function recordPrice(symbol: string, price: number): void {
  if (price <= 0) return;
  const normalized = symbol.toUpperCase();

  let history = priceHistory.get(normalized);
  if (!history) {
    history = [];
    priceHistory.set(normalized, history);
  }

  history.push(price);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

/**
 * Get recorded price history for a symbol
 */
export function getPriceHistory(symbol: string): number[] {
  return priceHistory.get(symbol.toUpperCase()) || [];
}

// ─── Math: Pearson Correlation ──────────────────────────────

/**
 * Calculate Pearson correlation coefficient between two price series.
 * Uses log returns instead of raw prices for stationarity.
 * Returns value in [-1, 1]. Returns 0 if insufficient data.
 */
function pearsonCorrelation(pricesA: number[], pricesB: number[]): number {
  // Align to same length (use shorter)
  const len = Math.min(pricesA.length, pricesB.length, LOOKBACK_CLOSES);
  if (len < MIN_DATA_POINTS) return 0;

  const a = pricesA.slice(-len);
  const b = pricesB.slice(-len);

  // Convert to log returns
  const returnsA: number[] = [];
  const returnsB: number[] = [];
  for (let i = 1; i < len; i++) {
    if (a[i - 1] > 0 && b[i - 1] > 0) {
      returnsA.push(Math.log(a[i] / a[i - 1]));
      returnsB.push(Math.log(b[i] / b[i - 1]));
    }
  }

  if (returnsA.length < MIN_DATA_POINTS - 1) return 0;

  const n = returnsA.length;
  const meanA = returnsA.reduce((s, v) => s + v, 0) / n;
  const meanB = returnsB.reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;

  for (let i = 0; i < n; i++) {
    const dA = returnsA[i] - meanA;
    const dB = returnsB[i] - meanB;
    cov += dA * dB;
    varA += dA * dA;
    varB += dB * dB;
  }

  const denom = Math.sqrt(varA * varB);
  if (denom === 0) return 0;

  return cov / denom;
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Check if a new position is allowed based on correlation with existing positions.
 *
 * @param newSymbol - Symbol to open a new position on
 * @param openPositions - Currently open positions
 * @returns CorrelationCheck with allowed/denied status and details
 */
export function checkCorrelation(
  newSymbol: string,
  openPositions: PositionInfo[],
): CorrelationCheck {
  const now = Date.now();

  if (DISABLED) {
    return { allowed: true, correlations: [], maxCorrelation: 0, checkedAt: now };
  }

  if (openPositions.length === 0) {
    return { allowed: true, correlations: [], maxCorrelation: 0, checkedAt: now };
  }

  const newNorm = newSymbol.toUpperCase();
  const newHistory = priceHistory.get(newNorm);

  // If no price history for new symbol, allow (can't check)
  if (!newHistory || newHistory.length < MIN_DATA_POINTS) {
    log.info(`[CorrelationGuard] No history for ${newSymbol} (${newHistory?.length ?? 0} points) — allowing`);
    return { allowed: true, correlations: [], maxCorrelation: 0, checkedAt: now };
  }

  const correlations: Array<{ existingSymbol: string; correlation: number }> = [];
  let maxCorrelation = 0;
  let maxCorrSymbol = '';

  for (const pos of openPositions) {
    const existNorm = pos.symbol.toUpperCase();

    // Same symbol check — always correlated
    if (existNorm === newNorm || existNorm.replace('USDT', '') === newNorm.replace('USDT', '')) {
      correlations.push({ existingSymbol: pos.symbol, correlation: 1.0 });
      maxCorrelation = 1.0;
      maxCorrSymbol = pos.symbol;
      continue;
    }

    const existHistory = priceHistory.get(existNorm);
    if (!existHistory || existHistory.length < MIN_DATA_POINTS) continue;

    const corr = pearsonCorrelation(newHistory, existHistory);
    const absCorr = Math.abs(corr);
    correlations.push({ existingSymbol: pos.symbol, correlation: corr });

    if (absCorr > maxCorrelation) {
      maxCorrelation = absCorr;
      maxCorrSymbol = pos.symbol;
    }
  }

  if (maxCorrelation > CORRELATION_THRESHOLD) {
    const reason = `BLOCKED: ${newSymbol} correlation with ${maxCorrSymbol} = ${maxCorrelation.toFixed(3)} > threshold ${CORRELATION_THRESHOLD}`;
    log.warn(`[CorrelationGuard] ${reason}`);
    return { allowed: false, reason, correlations, maxCorrelation, checkedAt: now };
  }

  log.info(`[CorrelationGuard] ${newSymbol} ALLOWED — max correlation: ${maxCorrelation.toFixed(3)} with ${maxCorrSymbol || 'none'}`);
  return { allowed: true, correlations, maxCorrelation, checkedAt: now };
}

/**
 * Get known correlation pairs (for dashboard display)
 */
export function getCorrelationMatrix(symbols: string[]): Record<string, Record<string, number>> {
  const matrix: Record<string, Record<string, number>> = {};

  for (const a of symbols) {
    matrix[a] = {};
    const histA = priceHistory.get(a.toUpperCase());
    if (!histA) continue;

    for (const b of symbols) {
      if (a === b) {
        matrix[a][b] = 1.0;
        continue;
      }
      const histB = priceHistory.get(b.toUpperCase());
      if (!histB) {
        matrix[a][b] = 0;
        continue;
      }
      matrix[a][b] = pearsonCorrelation(histA, histB);
    }
  }

  return matrix;
}
