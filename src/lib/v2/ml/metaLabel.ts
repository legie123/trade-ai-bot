// ============================================================
// RUFLO FAZA 3 Batch 7/9 — Meta-Labeling (shadow scaffolding)
// ============================================================
// CONCEPT (de Prado 2018, Advances in Financial ML, ch. 3):
//   Primary model: "IS this an opportunity?" (direction + size).
//   Meta model:    "GIVEN primary says YES, SHOULD I actually trade?"
//
//   In TRADE AI:
//     Primary = OMNI-X picks a Gladiator + microML predicts win prob.
//     Meta    = secondary classifier conditioning on *decision context*
//               (confidence, regime, sentiment, sizing, gladiator history).
//     Output  = P(win | primary=YES, context). If < threshold → veto.
//
// WHY separate from microML.ts:
//   microML is per-gladiator binary classifier on PRE-decision market
//   features (RSI, VWAP dev, funding, etc). Meta features are
//   ORTHOGONAL: they describe the DECISION state, not the market.
//   Stacking microML under meta = proper de Prado architecture.
//
// SAFETY (this batch):
//   - SCAFFOLDING ONLY. No training data used. No Supabase writes.
//   - `predict()` returns a heuristic sigmoid of weighted features.
//     Weights are hand-picked from domain intuition, NOT learned.
//     This is intentional: we need CPCV-validated training data
//     (Batch 6 prereq: ≥100 trades/gladiator, not yet satisfied).
//   - Marked `modelVersion: 'stub-heuristic-v0'` so downstream can
//     detect when to ignore vs trust.
//
// KILL-SWITCH:
//   META_LABEL_SHADOW_ENABLED ∈ {off, shadow (default), active}
//   - off    → predict() returns pass-through {prob: null, shouldTrade: true}
//   - shadow → predict() returns stub heuristic; consumers may log but NOT act
//   - active → consumers MAY act on prob (not wired in Batch 7)
//
// ASSUMPTIONS (if violated → stub output is meaningless):
//   - `features.primaryConfidence` is already calibrated 0..1 by the
//     gladiator's own scout. Garbage-in = garbage-out, stub can't fix.
//   - `features.wilsonLowerWr` is from butcher.ts-style Wilson lower
//     bound, i.e. a conservative estimate. Using raw WR here would
//     bias stub toward lucky-streak gladiators.
//   - `features.regimeMatch` is 1 when signal kind matches current
//     regime kind (both 'trend' or both 'mr'), 0 otherwise. See
//     adxRegime.RegimeKind / SignalKind.
// ============================================================

import { createLogger } from '@/lib/core/logger';

const log = createLogger('MetaLabel');

// ─── Mode / config ──────────────────────────────────────────

export type MetaLabelMode = 'off' | 'shadow' | 'active';

export function getMetaLabelMode(): MetaLabelMode {
  const raw = (process.env.META_LABEL_SHADOW_ENABLED || 'shadow').toLowerCase();
  if (raw === 'off' || raw === 'active') return raw as MetaLabelMode;
  return 'shadow';
}

/** Default threshold for shouldTrade. Intentionally conservative:
 *  we want the gate to veto only when the stub is meaningfully negative,
 *  not random coin-flip 0.5. 0.55 = ~1 stddev pessimism off a neutral
 *  prior. Overridable via META_LABEL_THRESHOLD. */
const DEFAULT_THRESHOLD = parseFloat(
  process.env.META_LABEL_THRESHOLD || '0.55',
);

// ─── Feature schema ─────────────────────────────────────────

/**
 * Post-decision context features. All numeric, all normalized 0..1
 * EXCEPT the categorical `regimeMatch` and `sentimentVeto` flags (0/1).
 *
 * Caller is responsible for normalization before predict(). Most of
 * these are already in 0..1 from upstream modules (confidence, WR) or
 * trivially mappable (boolean → 0/1).
 *
 * Missing fields are treated as neutral (0.5 for continuous, 1 for
 * flags) — i.e. "no information" is not punishment.
 */
export interface MetaLabelFeatures {
  /** Gladiator's own reported confidence for this decision (0..1). */
  primaryConfidence?: number;
  /** microML probability of win if available (0..1). */
  microMlProb?: number;
  /** Gladiator's population-corrected Wilson lower WR (0..1).
   *  See butcher.ts wilsonLower + graveyard.ts population stats. */
  wilsonLowerWr?: number;
  /** 1 if signal kind matches regime kind (trend with trend, mr with
   *  mr), 0 otherwise. See Batch 2 adxRegime. */
  regimeMatch?: 0 | 1;
  /** 1 if sentiment divergence does NOT veto this direction,
   *  0 if PANIC_OFFSET would flag it. See Batch 3 sentimentDivergence. */
  sentimentOk?: 0 | 1;
  /** Sizing multiplier from Batch 4 aggregator. 1.0 = neutral, <1 =
   *  dampened conviction, >1 = amplified. We map into [0..1] via a
   *  squash so extreme values don't dominate the stub's sigmoid. */
  sizingMult?: number;
  /** Gladiator sample size indicator: min(totalTrades/100, 1).
   *  Low n → lower meta confidence regardless of other features. */
  sampleMaturity?: number;
}

export interface MetaLabelPrediction {
  /** P(win | decision context). 0..1. */
  prob: number;
  /** prob > threshold. */
  shouldTrade: boolean;
  /** Threshold used (from env or input override). */
  threshold: number;
  /** |prob - 0.5| × 2 — distance from maximally-uncertain (0..1). */
  confidence: number;
  /** Per-feature contribution to the logit (pre-sigmoid). Helpful
   *  for debugging: see which feature pushed the prediction. */
  breakdown: Record<string, number>;
  /** Model identifier. v0 is hand-tuned heuristic; future versions
   *  will swap in trained weights without changing this API shape. */
  modelVersion: 'stub-heuristic-v0';
  /** Mode active when the prediction was made. */
  mode: MetaLabelMode;
  /** Pass-through flag when mode=off. Consumers MUST NOT veto when
   *  bypass=true; prob/shouldTrade are non-informative. */
  bypass: boolean;
}

// ─── Weights (stub v0) ──────────────────────────────────────
//
// Hand-picked from domain intuition. Sum of positive weights = 3.2,
// sum of neg = -1.0, bias = -0.4 → sigmoid neutral around
// mid-strength signals. Tune once real data arrives (Batch 7b).
//
// Rationale per weight:
//   primaryConfidence (1.0): the gladiator itself said so; strongest
//     single input, but alone insufficient (fits "overfit gladiator"
//     failure mode).
//   wilsonLowerWr    (1.2): conservative historical edge. Weighted
//     higher than primaryConf because lucky-streak gladiators have
//     high conf but low Wilson.
//   microMlProb      (0.8): independent classifier on different
//     features. Ensemble lift.
//   regimeMatch      (0.7): strategy matching regime is a big
//     pre-filter per adxRegime audit (Batch 2).
//   sentimentOk      (0.5): panic-offset signal. Binary kill signal
//     when 0 (sentimentVeto).
//   sizingMult       (0.3): aggregator already conservative; small
//     influence here to avoid double-counting.
//   sampleMaturity   (0.4): lower for new gladiators, higher for
//     seasoned.
//   BIAS           (-0.4): slight negative prior. We'd rather miss a
//     trade than take a bad one.
const W = {
  primaryConfidence: 1.0,
  microMlProb: 0.8,
  wilsonLowerWr: 1.2,
  regimeMatch: 0.7,
  sentimentOk: 0.5,
  sizingMult: 0.3,
  sampleMaturity: 0.4,
  BIAS: -0.4,
};

// ─── Helpers ────────────────────────────────────────────────

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function sigmoid(z: number): number {
  if (z > 30) return 1;
  if (z < -30) return 0;
  return 1 / (1 + Math.exp(-z));
}

/**
 * Map sizingMult from [0.30, 1.50] (the aggregator's clamp range)
 * to [0..1]. 1.0 → 0.5 (neutral), 1.5 → 1.0 (max amplification),
 * 0.3 → 0.0 (max dampening).
 */
function normalizeSizing(mult: number | undefined): number {
  if (mult === undefined || !Number.isFinite(mult)) return 0.5;
  const MIN = 0.30;
  const MAX = 1.50;
  const clamped = Math.min(Math.max(mult, MIN), MAX);
  return (clamped - MIN) / (MAX - MIN);
}

// ─── Public API ─────────────────────────────────────────────

export function predict(
  features: MetaLabelFeatures,
  thresholdOverride?: number,
): MetaLabelPrediction {
  const mode = getMetaLabelMode();
  const threshold = thresholdOverride ?? DEFAULT_THRESHOLD;

  if (mode === 'off') {
    // Pass-through: meta-label takes no position. Downstream must not
    // veto based on this result.
    return {
      prob: 0.5,
      shouldTrade: true,
      threshold,
      confidence: 0,
      breakdown: {},
      modelVersion: 'stub-heuristic-v0',
      mode,
      bypass: true,
    };
  }

  // Neutral defaults — missing input = no information = 0.5 (or 1 for
  // binary flags that, when absent, should not penalize).
  const primaryConf = clamp01(features.primaryConfidence ?? 0.5);
  const microMl = clamp01(features.microMlProb ?? 0.5);
  const wilsonWr = clamp01(features.wilsonLowerWr ?? 0.5);
  const regimeMatch = features.regimeMatch === 0 ? 0 : features.regimeMatch === 1 ? 1 : 0.5;
  const sentimentOk = features.sentimentOk === 0 ? 0 : features.sentimentOk === 1 ? 1 : 1;
  const sizing = normalizeSizing(features.sizingMult);
  const sampleMaturity = clamp01(features.sampleMaturity ?? 0.5);

  // Logit = Σ wᵢ × (xᵢ − 0.5) + bias
  // Centering around 0.5 means a feature at its neutral value
  // contributes nothing. Above-neutral pushes positive, below-neutral
  // pushes negative. Keeps the stub interpretable.
  const contribPrimary = W.primaryConfidence * (primaryConf - 0.5);
  const contribMicro = W.microMlProb * (microMl - 0.5);
  const contribWilson = W.wilsonLowerWr * (wilsonWr - 0.5);
  const contribRegime = W.regimeMatch * (regimeMatch - 0.5);
  const contribSent = W.sentimentOk * (sentimentOk - 0.5);
  const contribSizing = W.sizingMult * (sizing - 0.5);
  const contribMat = W.sampleMaturity * (sampleMaturity - 0.5);

  const logit =
    contribPrimary +
    contribMicro +
    contribWilson +
    contribRegime +
    contribSent +
    contribSizing +
    contribMat +
    W.BIAS;

  const prob = sigmoid(logit);
  const shouldTrade = prob > threshold;
  const confidence = Math.abs(prob - 0.5) * 2;

  return {
    prob: parseFloat(prob.toFixed(4)),
    shouldTrade,
    threshold,
    confidence: parseFloat(confidence.toFixed(4)),
    breakdown: {
      primaryConfidence: parseFloat(contribPrimary.toFixed(4)),
      microMlProb: parseFloat(contribMicro.toFixed(4)),
      wilsonLowerWr: parseFloat(contribWilson.toFixed(4)),
      regimeMatch: parseFloat(contribRegime.toFixed(4)),
      sentimentOk: parseFloat(contribSent.toFixed(4)),
      sizingMult: parseFloat(contribSizing.toFixed(4)),
      sampleMaturity: parseFloat(contribMat.toFixed(4)),
      bias: W.BIAS,
      logit: parseFloat(logit.toFixed(4)),
    },
    modelVersion: 'stub-heuristic-v0',
    mode,
    bypass: false,
  };
}

export function getMetaLabelConfig() {
  return {
    mode: getMetaLabelMode(),
    modelVersion: 'stub-heuristic-v0' as const,
    threshold: DEFAULT_THRESHOLD,
    weights: W,
    featureSchema: [
      'primaryConfidence',
      'microMlProb',
      'wilsonLowerWr',
      'regimeMatch',
      'sentimentOk',
      'sizingMult',
      'sampleMaturity',
    ],
    note:
      'Stub heuristic, not trained. Weights hand-picked. Replace with trained logistic regression after CPCV-validated data accumulates (Batch 6 prereq).',
  };
}

/**
 * Canonical test scenarios the diag endpoint displays so operators
 * can sanity-check the stub without wiring a live signal. Keeping
 * this in the module (not the route) so unit tests can assert on
 * them too.
 */
export const CANONICAL_SCENARIOS: { name: string; features: MetaLabelFeatures }[] = [
  {
    name: 'HIGH conviction (trend-match, sentiment OK, experienced gladiator)',
    features: {
      primaryConfidence: 0.75,
      microMlProb: 0.70,
      wilsonLowerWr: 0.55,
      regimeMatch: 1,
      sentimentOk: 1,
      sizingMult: 1.2,
      sampleMaturity: 0.8,
    },
  },
  {
    name: 'NEUTRAL (mid confidence, no regime info, mid sample)',
    features: {
      primaryConfidence: 0.55,
      microMlProb: 0.52,
      wilsonLowerWr: 0.50,
      sampleMaturity: 0.5,
    },
  },
  {
    name: 'LOW conviction (chop regime, panic sentiment, new gladiator)',
    features: {
      primaryConfidence: 0.48,
      microMlProb: 0.45,
      wilsonLowerWr: 0.42,
      regimeMatch: 0,
      sentimentOk: 0,
      sizingMult: 0.5,
      sampleMaturity: 0.1,
    },
  },
];
