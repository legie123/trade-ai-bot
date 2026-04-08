// ============================================================
// Unified Conviction Score — Combines all indicators into 0-100
// Weights: VWAP(25%) + RSI(25%) + BB(15%) + Fear&Greed(15%) + MTF(20%)
// Used by executor to decide trade sizing and confidence
// ============================================================

import { createLogger } from '@/lib/core/logger';

const log = createLogger('ConvictionScore');

export interface ConvictionInput {
  // VWAP data
  vwapConfirmed: boolean;
  volumeRatio: number;
  priceAboveVWAP: boolean;

  // RSI data
  rsiValue: number;
  rsiZone: string;
  rsiDivergence: string;

  // Bollinger Bands
  bbPercentB: number;
  bbSqueeze: boolean;
  bbSignal: string;

  // Fear & Greed
  fearGreedValue: number;

  // MTF Confluence
  mtfConfluence: number;  // 0-3 (how many timeframes agree)

  // Signal direction
  direction: 'BUY' | 'SELL';
}

export interface ConvictionResult {
  score: number;          // 0-100 final conviction
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  components: {
    vwap: number;
    rsi: number;
    bb: number;
    fearGreed: number;
    mtf: number;
  };
  reason: string;
}

// ─── VWAP Component (25 points max) ─────────────────
function scoreVWAP(input: ConvictionInput): number {
  let score = 0;

  // Volume surge is most important
  if (input.volumeRatio >= 2.0) score += 15;
  else if (input.volumeRatio >= 1.5) score += 12;
  else if (input.volumeRatio >= 1.2) score += 8;
  else if (input.volumeRatio >= 0.8) score += 3;

  // Price position relative to VWAP
  if (input.direction === 'BUY' && input.priceAboveVWAP) score += 10;
  else if (input.direction === 'SELL' && !input.priceAboveVWAP) score += 10;
  else score += 2; // Misaligned but not zero

  return Math.min(25, score);
}

// ─── RSI Component (25 points max) ──────────────────
function scoreRSI(input: ConvictionInput): number {
  let score = 0;
  const rsi = input.rsiValue;

  if (input.direction === 'BUY') {
    // Ideal BUY zone: RSI 40-60 (momentum building)
    if (rsi >= 40 && rsi <= 60) score += 15;
    else if (rsi >= 30 && rsi < 40) score += 12; // Oversold bounce
    else if (rsi < 30) score += 18; // Deep oversold = high conviction for reversal
    else if (rsi > 60 && rsi < 70) score += 8;
    else score += 2; // Overbought = risky buy

    // Divergence bonus/penalty
    if (input.rsiDivergence === 'BULL_DIV') score += 7;
    if (input.rsiDivergence === 'BEAR_DIV') score -= 10;
  } else {
    // Ideal SELL zone: RSI 60-80
    if (rsi >= 60 && rsi <= 80) score += 15;
    else if (rsi > 80) score += 18; // Deep overbought
    else if (rsi >= 50 && rsi < 60) score += 8;
    else score += 2;

    if (input.rsiDivergence === 'BEAR_DIV') score += 7;
    if (input.rsiDivergence === 'BULL_DIV') score -= 10;
  }

  return Math.max(0, Math.min(25, score));
}

// ─── Bollinger Bands Component (15 points max) ──────
function scoreBB(input: ConvictionInput): number {
  let score = 0;

  // Squeeze = high potential energy
  if (input.bbSqueeze) score += 8;

  // Position within bands
  if (input.direction === 'BUY') {
    if (input.bbPercentB <= 0.1) score += 7; // Near lower band = mean reversion BUY
    else if (input.bbPercentB <= 0.3) score += 5;
    else if (input.bbPercentB >= 0.9) score -= 3; // Near upper = risky BUY
  } else {
    if (input.bbPercentB >= 0.9) score += 7; // Near upper = mean reversion SELL
    else if (input.bbPercentB >= 0.7) score += 5;
    else if (input.bbPercentB <= 0.1) score -= 3;
  }

  // BB signal alignment
  if (input.bbSignal === 'BB_BUY' && input.direction === 'BUY') score += 5;
  if (input.bbSignal === 'BB_SELL' && input.direction === 'SELL') score += 5;

  return Math.max(0, Math.min(15, score));
}

// ─── Fear & Greed Component (15 points max) ─────────
function scoreFearGreed(input: ConvictionInput): number {
  const fg = input.fearGreedValue;

  if (input.direction === 'BUY') {
    // Contrarian: Buy when others are fearful
    if (fg <= 15) return 15; // Extreme fear = maximum BUY conviction
    if (fg <= 25) return 12;
    if (fg <= 40) return 8;
    if (fg <= 60) return 5; // Neutral
    if (fg >= 80) return 1; // Extreme greed = low BUY conviction
    return 3;
  } else {
    // Contrarian: Sell when others are greedy
    if (fg >= 85) return 15;
    if (fg >= 75) return 12;
    if (fg >= 60) return 8;
    if (fg >= 40) return 5;
    if (fg <= 20) return 1;
    return 3;
  }
}

// ─── MTF Confluence Component (20 points max) ───────
function scoreMTF(input: ConvictionInput): number {
  // 3/3 timeframes = full 20 points
  // 2/3 = 12 points
  // 1/3 = 4 points
  // 0/3 = 0
  switch (input.mtfConfluence) {
    case 3: return 20;
    case 2: return 12;
    case 1: return 4;
    default: return 0;
  }
}

// ─── Main Conviction Calculator ─────────────────────
export function calculateConviction(input: ConvictionInput): ConvictionResult {
  const components = {
    vwap: scoreVWAP(input),
    rsi: scoreRSI(input),
    bb: scoreBB(input),
    fearGreed: scoreFearGreed(input),
    mtf: scoreMTF(input),
  };

  const score = components.vwap + components.rsi + components.bb + components.fearGreed + components.mtf;
  const clampedScore = Math.max(0, Math.min(100, score));

  // Grade
  let grade: ConvictionResult['grade'];
  if (clampedScore >= 85) grade = 'A+';
  else if (clampedScore >= 70) grade = 'A';
  else if (clampedScore >= 55) grade = 'B';
  else if (clampedScore >= 40) grade = 'C';
  else if (clampedScore >= 25) grade = 'D';
  else grade = 'F';

  const reason = `Conviction ${clampedScore}/100 (${grade}) — VWAP:${components.vwap}/25, RSI:${components.rsi}/25, BB:${components.bb}/15, F&G:${components.fearGreed}/15, MTF:${components.mtf}/20`;
  
  log.info('Conviction Context Generated', { score: clampedScore, grade, direction: input.direction });

  return {
    score: clampedScore,
    grade,
    components,
    reason,
  };
}
