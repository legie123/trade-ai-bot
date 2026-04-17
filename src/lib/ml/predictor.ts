// ============================================================
// ML Prediction Engine — Ensemble model with 3 weak learners
// Walk-forward validation, online learning, confidence calibration
// ============================================================
import { getDecisions } from '@/lib/store/db';
import type { DecisionSnapshot } from '@/lib/types/radar';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('MLPredictor');

// Global cache: one active ensemble + historical performance
const g = globalThis as unknown as {
  __mlEnsemble?: EnsembleModel;
  __mlTrainedAt?: number;
  __mlValidationAccuracy?: number;
};
const RETRAIN_INTERVAL_MS = 15 * 60_000; // 15 min (slower — ensembles need more data)

// ─── Interfaces ─────────────────────────────────────────────
export interface PredictionInput {
  priceChange1h: number;      // Not used directly (leaky); kept for compat
  priceChange24h: number;     // Not used directly (leaky); kept for compat
  volume24h: number;
  rsi: number;
  confidence: number;
  recentWinRate: number;
  streak: number;
  hourOfDay?: number;
  dayOfWeek?: number;
  recentVolatility?: number;
}

export interface PredictionResult {
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;        // 0-100, calibrated to empirical hit rate
  predictedMove: number;     // -10 to +10
  features: PredictionInput;
  modelVersion: string;
  ensembleVotes?: { momentum: number; meanReversion: number; volatilityRegime: number };
}

// ─── Feature Engineering (non-leaking only) ─────────────────
interface Features {
  momentum: number;           // ROC over 5-period
  momentumTrend: number;      // Momentum over 10-period
  volatilityRegime: number;   // 1=high, 0=low
  winRateStability: number;   // rolling variance of recent wins
  hour: number;               // 0-1 normalized
  dayOfWeek: number;          // 0-1 normalized
  sessionBias: number;        // AM/PM/overnight bias
  tradeCountSignal: number;   // sample size confidence
}

interface WeakLearner {
  name: string;
  weights: Record<string, number>;
  bias: number;
}

interface EnsembleModel {
  version: string;
  trainedEpoch: number;
  learners: WeakLearner[];     // momentum, meanReversion, volatilityRegime
  calibration: { totalPredictions: number; correctByConf: Map<number, number> };
}

// ─── Utility Functions ───────────────────────────────────────
function normalize(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(Math.max(-20, Math.min(20, x))));
}

// Extract non-leaking features from decisions history
function extractFeatures(
  decisionIdx: number,
  allDecisions: DecisionSnapshot[]
): Features {
  const window = 10; // lookback window
  const start = Math.max(0, decisionIdx - window);
  const recent = allDecisions.slice(start, decisionIdx);

  if (recent.length === 0) {
    return {
      momentum: 0.5,
      momentumTrend: 0.5,
      volatilityRegime: 0.5,
      winRateStability: 0.5,
      hour: 0.5,
      dayOfWeek: 0.5,
      sessionBias: 0.5,
      tradeCountSignal: 0,
    };
  }

  // Momentum: rate of change in win rate over lookback
  const recentWins = recent.filter(r => r.outcome === 'WIN').length;
  const winRate = recentWins / recent.length;
  const oldWins = recent.slice(0, Math.floor(recent.length / 2)).filter(r => r.outcome === 'WIN').length;
  const oldWinRate = oldWins / Math.max(1, Math.floor(recent.length / 2));
  const momentum = (winRate - oldWinRate + 1) / 2; // normalize to [0, 1]

  // Momentum trend: change in momentum itself
  const momentumTrend = normalize(winRate, 0.3, 0.7);

  // Volatility regime from pnl stddev
  const pnls = recent.map(r => r.pnlPercent || 0);
  const meanPnl = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((s, p) => s + Math.pow(p - meanPnl, 2), 0) / pnls.length;
  const stddev = Math.sqrt(variance);
  const volatilityRegime = normalize(stddev, 0, 3); // 1 if vol > 3%, 0 if < 0%

  // Win rate stability: variance of win rate in rolling windows
  let stability = 0;
  if (recent.length > 4) {
    const subwindow = Math.floor(recent.length / 3);
    const subwindows = [];
    for (let i = 0; i < 3; i++) {
      const start = i * subwindow;
      const end = start + subwindow;
      const subWins = recent.slice(start, end).filter(r => r.outcome === 'WIN').length;
      subwindows.push(subWins / subwindow);
    }
    const meanSubWr = subwindows.reduce((a, b) => a + b, 0) / 3;
    const subVar = subwindows.reduce((s, w) => s + Math.pow(w - meanSubWr, 2), 0) / 3;
    stability = 1 / (1 + Math.sqrt(subVar)); // stable → 1
  }
  const winRateStability = Math.max(0, Math.min(1, stability));

  // Time features
  const ts = new Date(allDecisions[decisionIdx].timestamp);
  const hour = normalize(ts.getHours(), 0, 23);
  const dow = normalize(ts.getDay(), 0, 6);
  const sessionBias = ts.getHours() < 10 ? 0 : ts.getHours() < 16 ? 1 : 0.5;

  const tradeCountSignal = normalize(recent.length, 1, 20);

  return { momentum, momentumTrend, volatilityRegime, winRateStability, hour, dayOfWeek: dow, sessionBias, tradeCountSignal };
}

// ─── Weak Learner 1: Momentum Learner ────────────────────────
function trainMomentumLearner(
  decisions: DecisionSnapshot[],
  trainSplit: number
): WeakLearner {
  const split = Math.floor(decisions.length * trainSplit);
  const weights: Record<string, number> = {
    momentum: 1,
    momentumTrend: 0.5,
    winRateStability: 0.3,
    sessionBias: -0.1,
  };

  // Online gradient update (simple)
  for (let i = 5; i < split; i++) {
    const features = extractFeatures(i, decisions);
    const z = features.momentum * weights.momentum +
              features.momentumTrend * weights.momentumTrend +
              features.winRateStability * weights.winRateStability +
              features.sessionBias * weights.sessionBias;
    const pred = sigmoid(z);
    const target = decisions[i].outcome === 'WIN' ? 1 : 0;
    const err = pred - target;

    const lr = 0.05;
    weights.momentum -= lr * err * features.momentum;
    weights.momentumTrend -= lr * err * features.momentumTrend;
    weights.winRateStability -= lr * err * features.winRateStability;
    weights.sessionBias -= lr * err * features.sessionBias;
  }

  return { name: 'momentum', weights, bias: -0.1 };
}

// ─── Weak Learner 2: Mean Reversion Learner ──────────────────
function trainMeanReversionLearner(
  decisions: DecisionSnapshot[],
  trainSplit: number
): WeakLearner {
  const split = Math.floor(decisions.length * trainSplit);
  const weights: Record<string, number> = {
    volatilityRegime: 1,
    momentum: -0.3,          // low momentum + high vol → mean reversion
    winRateStability: 0.2,
    hour: 0.1,
  };

  for (let i = 5; i < split; i++) {
    const features = extractFeatures(i, decisions);
    const z = features.volatilityRegime * weights.volatilityRegime +
              features.momentum * weights.momentum +
              features.winRateStability * weights.winRateStability +
              features.hour * weights.hour;
    const pred = sigmoid(z);
    const target = decisions[i].outcome === 'WIN' ? 1 : 0;
    const err = pred - target;

    const lr = 0.05;
    weights.volatilityRegime -= lr * err * features.volatilityRegime;
    weights.momentum -= lr * err * features.momentum;
    weights.winRateStability -= lr * err * features.winRateStability;
    weights.hour -= lr * err * features.hour;
  }

  return { name: 'meanReversion', weights, bias: 0.05 };
}

// ─── Weak Learner 3: Volatility Regime Learner ───────────────
function trainVolatilityRegimeLearner(
  decisions: DecisionSnapshot[],
  trainSplit: number
): WeakLearner {
  const split = Math.floor(decisions.length * trainSplit);
  const weights: Record<string, number> = {
    volatilityRegime: 0.8,
    winRateStability: 0.5,
    dayOfWeek: 0.2,
    tradeCountSignal: 0.3,
  };

  for (let i = 5; i < split; i++) {
    const features = extractFeatures(i, decisions);
    const z = features.volatilityRegime * weights.volatilityRegime +
              features.winRateStability * weights.winRateStability +
              features.dayOfWeek * weights.dayOfWeek +
              features.tradeCountSignal * weights.tradeCountSignal;
    const pred = sigmoid(z);
    const target = decisions[i].outcome === 'WIN' ? 1 : 0;
    const err = pred - target;

    const lr = 0.05;
    weights.volatilityRegime -= lr * err * features.volatilityRegime;
    weights.winRateStability -= lr * err * features.winRateStability;
    weights.dayOfWeek -= lr * err * features.dayOfWeek;
    weights.tradeCountSignal -= lr * err * features.tradeCountSignal;
  }

  return { name: 'volatilityRegime', weights, bias: 0 };
}

// ─── Ensemble Training with Walk-Forward Validation ─────────
export function trainModel(): { model: EnsembleModel; validationAccuracy: number; samples: number } {
  const decisions = getDecisions()
    .filter(d => d.outcome !== 'PENDING')
    .reverse(); // oldest first

  if (decisions.length < 30) {
    return { model: createDefaultEnsemble(), validationAccuracy: 0, samples: 0 };
  }

  const trainSplit = 0.7;
  const split = Math.floor(decisions.length * trainSplit);

  // Train 3 weak learners on 70%
  const momentum = trainMomentumLearner(decisions, trainSplit);
  const meanReversion = trainMeanReversionLearner(decisions, trainSplit);
  const volatilityRegime = trainVolatilityRegimeLearner(decisions, trainSplit);

  // Validate on 30%
  let validCorrect = 0;
  for (let i = split; i < decisions.length; i++) {
    const features = extractFeatures(i, decisions);

    const m = sigmoid(
      (features.momentum * momentum.weights.momentum || 0) +
      (features.momentumTrend * momentum.weights.momentumTrend || 0) +
      (features.winRateStability * momentum.weights.winRateStability || 0) +
      (features.sessionBias * momentum.weights.sessionBias || 0) +
      momentum.bias
    );

    const mr = sigmoid(
      (features.volatilityRegime * meanReversion.weights.volatilityRegime || 0) +
      (features.momentum * meanReversion.weights.momentum || 0) +
      (features.winRateStability * meanReversion.weights.winRateStability || 0) +
      (features.hour * meanReversion.weights.hour || 0) +
      meanReversion.bias
    );

    const vr = sigmoid(
      (features.volatilityRegime * volatilityRegime.weights.volatilityRegime || 0) +
      (features.winRateStability * volatilityRegime.weights.winRateStability || 0) +
      (features.dayOfWeek * volatilityRegime.weights.dayOfWeek || 0) +
      (features.tradeCountSignal * volatilityRegime.weights.tradeCountSignal || 0) +
      volatilityRegime.bias
    );

    const ensemble = (m + mr + vr) / 3;
    const pred = ensemble >= 0.5 ? 1 : 0;
    const target = decisions[i].outcome === 'WIN' ? 1 : 0;
    if (pred === target) validCorrect++;
  }

  const validationAccuracy = validCorrect / Math.max(1, decisions.length - split);

  // Reject model if validation < 52% (worse than coin flip + buffer)
  if (validationAccuracy < 0.52) {
    log.warn('Ensemble validation accuracy < 52%, using default', { validationAccuracy });
    return { model: createDefaultEnsemble(), validationAccuracy, samples: decisions.length };
  }

  const model: EnsembleModel = {
    version: `ens-v1-${Date.now()}`,
    trainedEpoch: Math.floor(Date.now() / 1000),
    learners: [momentum, meanReversion, volatilityRegime],
    calibration: { totalPredictions: 0, correctByConf: new Map() },
  };

  log.info('Ensemble trained', {
    validationAccuracy: Math.round(validationAccuracy * 100),
    samples: decisions.length,
  });

  return { model, validationAccuracy: Math.round(validationAccuracy * 100), samples: decisions.length };
}

function createDefaultEnsemble(): EnsembleModel {
  return {
    version: 'ens-v0-default',
    trainedEpoch: Math.floor(Date.now() / 1000),
    learners: [
      {
        name: 'momentum',
        weights: { momentum: 1, momentumTrend: 0.5, winRateStability: 0.3, sessionBias: -0.1 },
        bias: -0.1,
      },
      {
        name: 'meanReversion',
        weights: { volatilityRegime: 1, momentum: -0.3, winRateStability: 0.2, hour: 0.1 },
        bias: 0.05,
      },
      {
        name: 'volatilityRegime',
        weights: { volatilityRegime: 0.8, winRateStability: 0.5, dayOfWeek: 0.2, tradeCountSignal: 0.3 },
        bias: 0,
      },
    ],
    calibration: { totalPredictions: 0, correctByConf: new Map() },
  };
}

// ─── Prediction with Online Learning ────────────────────────
export function predict(input: PredictionInput): PredictionResult {
  const now = Date.now();
  if (!g.__mlEnsemble || (now - (g.__mlTrainedAt || 0)) > RETRAIN_INTERVAL_MS) {
    const result = trainModel();
    g.__mlEnsemble = result.model;
    g.__mlTrainedAt = now;
    g.__mlValidationAccuracy = result.validationAccuracy;
  }

  const ensemble = g.__mlEnsemble!;
  const decisions = getDecisions().filter(d => d.outcome !== 'PENDING').reverse();

  if (decisions.length === 0) {
    return {
      direction: 'NEUTRAL',
      confidence: 0,
      predictedMove: 0,
      features: input,
      modelVersion: ensemble.version,
    };
  }

  const features = extractFeatures(decisions.length - 1, decisions);

  // Get votes from 3 weak learners
  const votes = {
    momentum: sigmoid(
      (features.momentum * ensemble.learners[0].weights.momentum || 0) +
      (features.momentumTrend * ensemble.learners[0].weights.momentumTrend || 0) +
      (features.winRateStability * ensemble.learners[0].weights.winRateStability || 0) +
      (features.sessionBias * ensemble.learners[0].weights.sessionBias || 0) +
      ensemble.learners[0].bias
    ),
    meanReversion: sigmoid(
      (features.volatilityRegime * ensemble.learners[1].weights.volatilityRegime || 0) +
      (features.momentum * ensemble.learners[1].weights.momentum || 0) +
      (features.winRateStability * ensemble.learners[1].weights.winRateStability || 0) +
      (features.hour * ensemble.learners[1].weights.hour || 0) +
      ensemble.learners[1].bias
    ),
    volatilityRegime: sigmoid(
      (features.volatilityRegime * ensemble.learners[2].weights.volatilityRegime || 0) +
      (features.winRateStability * ensemble.learners[2].weights.winRateStability || 0) +
      (features.dayOfWeek * ensemble.learners[2].weights.dayOfWeek || 0) +
      (features.tradeCountSignal * ensemble.learners[2].weights.tradeCountSignal || 0) +
      ensemble.learners[2].bias
    ),
  };

  // Ensemble prediction: simple average
  const probability = (votes.momentum + votes.meanReversion + votes.volatilityRegime) / 3;

  // Calibrate confidence: map raw prob to empirical hit rate
  const rawConf = Math.abs(probability - 0.5) * 200;
  const confBucket = Math.round(rawConf / 10) * 10;
  const empiricalAccuracy = ensemble.calibration.correctByConf.get(confBucket) ?? 50;
  const calibratedConf = Math.max(20, Math.min(95, empiricalAccuracy));

  const predictedMove = Math.round((probability - 0.5) * 20 * 100) / 100;

  let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (probability > 0.6) direction = 'BULLISH';
  else if (probability < 0.4) direction = 'BEARISH';

  return {
    direction,
    confidence: calibratedConf,
    predictedMove,
    features: input,
    modelVersion: ensemble.version,
    ensembleVotes: votes,
  };
}

// ─── Online Learning: Update on Trade Outcome ────────────────
export function recordOutcome(wasWin: boolean): void {
  if (!g.__mlEnsemble) return;

  const ensemble = g.__mlEnsemble;
  const decisions = getDecisions().filter(d => d.outcome !== 'PENDING').reverse();

  if (decisions.length < 2) return;

  const features = extractFeatures(decisions.length - 1, decisions);
  const target = wasWin ? 1 : 0;

  // Light online update: 1% SGD step per learner
  for (const learner of ensemble.learners) {
    let z = learner.bias;
    for (const [key, weight] of Object.entries(learner.weights)) {
      z += (features[key as keyof Features] || 0) * weight;
    }
    const pred = sigmoid(z);
    const err = pred - target;

    for (const [key, weight] of Object.entries(learner.weights)) {
      learner.weights[key] = weight - 0.01 * err * (features[key as keyof Features] || 0);
    }
    learner.bias -= 0.01 * err;
  }

  // AUDIT FIX T1.9: Use actual ensemble prediction for calibration bucket (was hardcoded 0)
  // Calculate mean prediction from all learners as the confidence estimate
  let ensemblePred = 0;
  for (const learner of ensemble.learners) {
    let z = learner.bias;
    for (const [key, weight] of Object.entries(learner.weights)) {
      z += (features[key as keyof Features] || 0) * weight;
    }
    ensemblePred += sigmoid(z);
  }
  ensemblePred /= ensemble.learners.length;
  const recentProb = Math.abs(ensemblePred - 0.5) * 200; // 0-100 scale distance from neutral
  const confBucket = Math.round(recentProb / 10) * 10;
  const currentCount = ensemble.calibration.correctByConf.get(confBucket) ?? 50;
  const newCount = Math.round((currentCount * ensemble.calibration.totalPredictions + target) / (ensemble.calibration.totalPredictions + 1));
  ensemble.calibration.correctByConf.set(confBucket, newCount);
  ensemble.calibration.totalPredictions += 1;
}
