// ============================================================
// Wick Analysis — Rejection candle detection for crypto
// Long wicks at key levels = institutional rejection
// ============================================================
import { createLogger } from '@/lib/core/logger';

const log = createLogger('WickAnalysis');

interface Candle {
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
}

export interface WickSignal {
  type: 'HAMMER' | 'SHOOTING_STAR' | 'DOJI' | 'ENGULFING_BULL' | 'ENGULFING_BEAR' | 'NONE';
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  strength: number;  // 0-1
  reason: string;
}

/**
 * Analyze the last few candles for rejection wicks and reversal patterns
 */
export function analyzeWicks(candles: Candle[]): WickSignal {
  if (candles.length < 3) {
    return { type: 'NONE', signal: 'NEUTRAL', strength: 0, reason: 'Insufficient candles' };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const range = last.h - last.l;
  if (range <= 0) return { type: 'NONE', signal: 'NEUTRAL', strength: 0, reason: 'No range' };

  const body = Math.abs(last.c - last.o);
  const bodyRatio = body / range;
  const isGreen = last.c > last.o;

  // Lower wick (tail below body)
  const lowerWick = Math.min(last.o, last.c) - last.l;
  const upperWick = last.h - Math.max(last.o, last.c);
  const lowerWickRatio = lowerWick / range;
  const upperWickRatio = upperWick / range;

  // ─── HAMMER: Long lower wick, small body, at/near support ────
  // Classic bullish reversal — institutional buying at lows
  if (lowerWickRatio >= 0.60 && bodyRatio <= 0.30) {
    const strength = Math.min(1, lowerWickRatio * 1.2);
    log.info(`Hammer detected: lower wick ${(lowerWickRatio * 100).toFixed(0)}% of range`);
    return {
      type: 'HAMMER',
      signal: 'BUY',
      strength,
      reason: `🔨 Hammer: ${(lowerWickRatio * 100).toFixed(0)}% lower wick rejection — institutional buying`,
    };
  }

  // ─── SHOOTING STAR: Long upper wick, small body, at/near resistance ────
  // Classic bearish reversal — institutional selling at highs
  if (upperWickRatio >= 0.60 && bodyRatio <= 0.30) {
    const strength = Math.min(1, upperWickRatio * 1.2);
    log.info(`Shooting star detected: upper wick ${(upperWickRatio * 100).toFixed(0)}% of range`);
    return {
      type: 'SHOOTING_STAR',
      signal: 'SELL',
      strength,
      reason: `⭐ Shooting Star: ${(upperWickRatio * 100).toFixed(0)}% upper wick rejection — institutional selling`,
    };
  }

  // ─── BULLISH ENGULFING: Current green body fully engulfs prev red body ────
  const prevIsRed = prev.c < prev.o;
  if (isGreen && prevIsRed && last.c > prev.o && last.o < prev.c) {
    const engulfRatio = body / Math.abs(prev.c - prev.o);
    if (engulfRatio >= 1.5) {
      log.info('Bullish engulfing detected');
      return {
        type: 'ENGULFING_BULL',
        signal: 'BUY',
        strength: Math.min(1, engulfRatio * 0.4),
        reason: `🟢 Bullish Engulfing: ${engulfRatio.toFixed(1)}x body engulf — reversal signal`,
      };
    }
  }

  // ─── BEARISH ENGULFING: Current red body fully engulfs prev green body ────
  const prevIsGreen = prev.c > prev.o;
  if (!isGreen && prevIsGreen && last.o > prev.c && last.c < prev.o) {
    const engulfRatio = body / Math.abs(prev.c - prev.o);
    if (engulfRatio >= 1.5) {
      log.info('Bearish engulfing detected');
      return {
        type: 'ENGULFING_BEAR',
        signal: 'SELL',
        strength: Math.min(1, engulfRatio * 0.4),
        reason: `🔴 Bearish Engulfing: ${engulfRatio.toFixed(1)}x body engulf — reversal signal`,
      };
    }
  }

  // ─── DOJI: Very small body relative to range ────
  if (bodyRatio <= 0.10 && range > 0) {
    return {
      type: 'DOJI',
      signal: 'NEUTRAL',
      strength: 0.3,
      reason: `⬜ Doji: Indecision (body ${(bodyRatio * 100).toFixed(0)}% of range)`,
    };
  }

  return { type: 'NONE', signal: 'NEUTRAL', strength: 0, reason: 'No pattern detected' };
}

/**
 * Market Structure Break detection from swing highs/lows
 * Looks for Higher Highs + Higher Lows (bullish) or Lower Highs + Lower Lows (bearish)
 */
export function detectMarketStructure(candles: Candle[]): {
  structure: 'BULLISH' | 'BEARISH' | 'RANGING';
  breakOfStructure: boolean;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  reason: string;
} {
  if (candles.length < 20) {
    return { structure: 'RANGING', breakOfStructure: false, signal: 'NEUTRAL', reason: 'Insufficient data' };
  }

  // Find swing highs and lows (simplified 5-bar pivots)
  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i];
    if (c.h > candles[i-1].h && c.h > candles[i-2].h && c.h > candles[i+1].h && c.h > candles[i+2].h) {
      swingHighs.push(c.h);
    }
    if (c.l < candles[i-1].l && c.l < candles[i-2].l && c.l < candles[i+1].l && c.l < candles[i+2].l) {
      swingLows.push(c.l);
    }
  }

  if (swingHighs.length < 2 || swingLows.length < 2) {
    return { structure: 'RANGING', breakOfStructure: false, signal: 'NEUTRAL', reason: 'Not enough swing points' };
  }

  const lastHigh = swingHighs[swingHighs.length - 1];
  const prevHigh = swingHighs[swingHighs.length - 2];
  const lastLow = swingLows[swingLows.length - 1];
  const prevLow = swingLows[swingLows.length - 2];

  const higherHigh = lastHigh > prevHigh;
  const higherLow = lastLow > prevLow;
  const lowerHigh = lastHigh < prevHigh;
  const lowerLow = lastLow < prevLow;

  const currentPrice = candles[candles.length - 1].c;

  // Bullish market structure: HH + HL
  if (higherHigh && higherLow) {
    const bos = currentPrice > lastHigh; // Price breaking above last swing high
    return {
      structure: 'BULLISH',
      breakOfStructure: bos,
      signal: bos ? 'BUY' : 'NEUTRAL',
      reason: bos
        ? `📈 BOS: Price broke above swing high $${lastHigh.toFixed(2)} — bullish continuation`
        : `Bullish structure (HH+HL) — waiting for break above $${lastHigh.toFixed(2)}`,
    };
  }

  // Bearish market structure: LH + LL
  if (lowerHigh && lowerLow) {
    const bos = currentPrice < lastLow; // Price breaking below last swing low
    return {
      structure: 'BEARISH',
      breakOfStructure: bos,
      signal: bos ? 'SELL' : 'NEUTRAL',
      reason: bos
        ? `📉 BOS: Price broke below swing low $${lastLow.toFixed(2)} — bearish continuation`
        : `Bearish structure (LH+LL) — waiting for break below $${lastLow.toFixed(2)}`,
    };
  }

  return { structure: 'RANGING', breakOfStructure: false, signal: 'NEUTRAL', reason: 'Mixed structure — ranging market' };
}
