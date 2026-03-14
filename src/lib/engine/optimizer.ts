// ============================================================
// Alpha Optimizer — auto-tunes scoring weights
// Runs nightly or on-demand to analyze what works
// ============================================================
import {
  getDecisions,
  getOptimizerState,
  saveOptimizerState,
  recalculatePerformance,
} from '@/lib/store/db';
import { DecisionSnapshot, OptimizationState } from '@/lib/types/radar';

const MIN_DECISIONS = 10; // Need at least this many evaluated decisions
const MAX_WEIGHT_CHANGE = 0.05; // Max 5% adjustment per cycle
const WEIGHT_KEYS = [
  'volumeWeight',
  'liquidityWeight',
  'momentumWeight',
  'holderWeight',
  'socialWeight',
  'emaWeight',
];

// ─── Analyze which signals are winning ─────────────
function analyzeWinningPatterns(decisions: DecisionSnapshot[]) {
  const evaluated = decisions.filter((d) => d.outcome !== 'PENDING');
  if (evaluated.length < MIN_DECISIONS) return null;

  // Group by context features and find correlations
  const patterns = {
    highEma: { wins: 0, total: 0 },     // price > all EMAs
    lowEma: { wins: 0, total: 0 },      // price < all EMAs
    nearPsych: { wins: 0, total: 0 },   // near psychological level
    highConfidence: { wins: 0, total: 0 }, // confidence >= 80
    lowConfidence: { wins: 0, total: 0 },  // confidence < 80
  };

  for (const d of evaluated) {
    const isWin = d.outcome === 'WIN';

    // EMA analysis
    if (d.price > d.ema50 && d.price > d.ema200) {
      patterns.highEma.total++;
      if (isWin) patterns.highEma.wins++;
    } else {
      patterns.lowEma.total++;
      if (isWin) patterns.lowEma.wins++;
    }

    // Psychological level proximity
    const distToPsych = Math.min(
      Math.abs(d.price - d.psychHigh),
      Math.abs(d.price - d.psychLow)
    );
    if (distToPsych / d.price < 0.01) {
      patterns.nearPsych.total++;
      if (isWin) patterns.nearPsych.wins++;
    }

    // Confidence analysis
    if (d.confidence >= 80) {
      patterns.highConfidence.total++;
      if (isWin) patterns.highConfidence.wins++;
    } else {
      patterns.lowConfidence.total++;
      if (isWin) patterns.lowConfidence.wins++;
    }
  }

  return patterns;
}

// ─── Calculate recommended weight adjustments ──────
function calculateAdjustments(
  currentWeights: Record<string, number>,
  decisions: DecisionSnapshot[]
): Record<string, number> {
  const patterns = analyzeWinningPatterns(decisions);
  if (!patterns) return currentWeights;

  const newWeights = { ...currentWeights };

  // If EMA-based signals have high win rate, boost EMA weight
  const emaWinRate = patterns.highEma.total > 0
    ? patterns.highEma.wins / patterns.highEma.total
    : 0.5;
  if (emaWinRate > 0.6) {
    newWeights.emaWeight = Math.min(
      (currentWeights.emaWeight || 0.10) + MAX_WEIGHT_CHANGE,
      0.40
    );
  } else if (emaWinRate < 0.4) {
    newWeights.emaWeight = Math.max(
      (currentWeights.emaWeight || 0.10) - MAX_WEIGHT_CHANGE,
      0.05
    );
  }

  // If high-confidence signals win more, boost momentum
  const confWinRate = patterns.highConfidence.total > 0
    ? patterns.highConfidence.wins / patterns.highConfidence.total
    : 0.5;
  if (confWinRate > 0.6) {
    newWeights.momentumWeight = Math.min(
      (currentWeights.momentumWeight || 0.20) + MAX_WEIGHT_CHANGE,
      0.40
    );
  }

  // Normalize weights to sum to 1.0
  const sum = WEIGHT_KEYS.reduce((s, k) => s + (newWeights[k] || 0), 0);
  if (sum > 0) {
    for (const k of WEIGHT_KEYS) {
      newWeights[k] = Math.round(((newWeights[k] || 0) / sum) * 100) / 100;
    }
  }

  return newWeights;
}

// ─── Main optimizer entry point ────────────────────
export function runOptimizer(): {
  optimized: boolean;
  version: number;
  changes: Record<string, { from: number; to: number }>;
  winRateBefore: number;
  winRateAfter: number;
} {
  const decisions = getDecisions();
  const evaluated = decisions.filter((d) => d.outcome !== 'PENDING');

  if (evaluated.length < MIN_DECISIONS) {
    return {
      optimized: false,
      version: getOptimizerState().version,
      changes: {},
      winRateBefore: 0,
      winRateAfter: 0,
    };
  }

  const state = getOptimizerState();
  const currentWeights = state.weights;
  const wins = evaluated.filter((d) => d.outcome === 'WIN').length;
  const winRateBefore = Math.round((wins / evaluated.length) * 100);

  // Calculate new weights
  const newWeights = calculateAdjustments(currentWeights, decisions);

  // Track changes
  const changes: Record<string, { from: number; to: number }> = {};
  for (const k of WEIGHT_KEYS) {
    if (currentWeights[k] !== newWeights[k]) {
      changes[k] = { from: currentWeights[k] || 0, to: newWeights[k] || 0 };
    }
  }

  const hasChanges = Object.keys(changes).length > 0;

  if (hasChanges) {
    const newState: OptimizationState = {
      version: state.version + 1,
      weights: newWeights,
      lastOptimizedAt: new Date().toISOString(),
      improvementPercent: 0, // updated retroactively
      history: [
        ...state.history.slice(-20), // keep last 20
        {
          date: new Date().toISOString(),
          weightChanges: changes,
          winRateBefore,
          winRateAfter: winRateBefore, // same for now, updated later
        },
      ],
    };
    saveOptimizerState(newState);
    console.log(`[Optimizer] v${newState.version}: Updated ${Object.keys(changes).length} weights`);
  }

  // Refresh performance stats
  recalculatePerformance();

  return {
    optimized: hasChanges,
    version: hasChanges ? state.version + 1 : state.version,
    changes,
    winRateBefore,
    winRateAfter: winRateBefore,
  };
}
