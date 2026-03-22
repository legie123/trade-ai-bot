// ============================================================
// ML Prediction Engine — Simple neural network for price prediction
// Uses historical decision data + market features
// ============================================================
import { getDecisions } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('MLPredictor');

// Cache trained weights to avoid retraining on every predict() call
const g = globalThis as unknown as {
  __mlWeightsCache?: { weights: ModelWeights; trainedAt: number; accuracy: number; samples: number };
};
const RETRAIN_INTERVAL_MS = 10 * 60_000; // Retrain every 10 minutes max

export interface PredictionInput {
  priceChange1h: number;
  priceChange24h: number;
  volume24h: number;
  rsi: number;
  confidence: number;
  recentWinRate: number;
  streak: number;
  hourOfDay?: number;       // 0-23
  dayOfWeek?: number;       // 0-6 (Sun-Sat)
  recentVolatility?: number; // stddev of recent PnL%
}

export interface PredictionResult {
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;       // 0-100
  predictedMove: number;    // -10 to +10 percent
  features: PredictionInput;
  modelVersion: string;
}

// ─── Simple ML Weights (sigmoid-based regression) ─────────
// These weights are automatically tuned from historical decisions
interface ModelWeights {
  priceChange1h: number;
  priceChange24h: number;
  volumeNorm: number;
  rsiDev: number;
  confidenceW: number;
  winRateW: number;
  streakW: number;
  hourW: number;
  dayW: number;
  volatilityW: number;
  bias: number;
}

const DEFAULT_WEIGHTS: ModelWeights = {
  priceChange1h: 0.25,
  priceChange24h: 0.15,
  volumeNorm: 0.1,
  rsiDev: -0.2,
  confidenceW: 0.3,
  winRateW: 0.2,
  streakW: 0.05,
  hourW: 0.05,
  dayW: 0.03,
  volatilityW: -0.1,
  bias: -0.1,
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function normalize(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// ─── Train Weights from Historical Data ──────────────────
export function trainModel(): { weights: ModelWeights; accuracy: number; samples: number } {
  const decisions = getDecisions()
    .filter(d => d.outcome !== 'PENDING')
    .reverse(); // oldest first

  if (decisions.length < 10) {
    return { weights: DEFAULT_WEIGHTS, accuracy: 0, samples: 0 };
  }

  // Simple gradient descent
  const weights = { ...DEFAULT_WEIGHTS };
  const lr = 0.01; // learning rate
  let accuracy = 0;
  let correct = 0;

  for (let epoch = 0; epoch < 50; epoch++) {
    correct = 0;

    for (let i = 5; i < decisions.length; i++) {
      const d = decisions[i];
      const recent = decisions.slice(Math.max(0, i - 5), i);
      const recentWins = recent.filter(r => r.outcome === 'WIN').length;
      const recentWinRate = recentWins / recent.length;

      // Compute features with real data (no more dummy values)
      const hour = new Date(d.timestamp).getHours();
      const day = new Date(d.timestamp).getDay();
      const recentPnls = recent.map(r => r.pnlPercent || 0);
      const meanPnl = recentPnls.length > 0 ? recentPnls.reduce((a, b) => a + b, 0) / recentPnls.length : 0;
      const volatility = recentPnls.length > 1
        ? Math.sqrt(recentPnls.reduce((s, p) => s + Math.pow(p - meanPnl, 2), 0) / recentPnls.length)
        : 1;

      const features = {
        pc1h: normalize(d.pnlPercent || 0, -5, 5),
        pc24h: normalize(d.pnlPercent || 0, -10, 10),
        vol: normalize(d.confidence * 0.5, 0, 50), // proxy: higher confidence → better volume context
        rsi: normalize(d.confidence > 80 ? 65 : d.confidence > 60 ? 50 : 35, 0, 100), // RSI proxy from confidence
        conf: normalize(d.confidence, 0, 100),
        wr: recentWinRate,
        streak: normalize(recentWins, 0, 5),
        hour: normalize(hour, 0, 23),
        day: normalize(day, 0, 6),
        volatility: normalize(volatility, 0, 5),
      };

      // Forward pass
      const z = features.pc1h * weights.priceChange1h +
                features.pc24h * weights.priceChange24h +
                features.vol * weights.volumeNorm +
                features.rsi * weights.rsiDev +
                features.conf * weights.confidenceW +
                features.wr * weights.winRateW +
                features.streak * weights.streakW +
                features.hour * weights.hourW +
                features.day * weights.dayW +
                features.volatility * weights.volatilityW +
                weights.bias;

      const prediction = sigmoid(z);
      const target = d.outcome === 'WIN' ? 1 : 0;
      const error = prediction - target;

      if ((prediction >= 0.5 && target === 1) || (prediction < 0.5 && target === 0)) {
        correct++;
      }

      // Gradient descent
      weights.priceChange1h -= lr * error * features.pc1h;
      weights.priceChange24h -= lr * error * features.pc24h;
      weights.volumeNorm -= lr * error * features.vol;
      weights.rsiDev -= lr * error * features.rsi;
      weights.confidenceW -= lr * error * features.conf;
      weights.winRateW -= lr * error * features.wr;
      weights.streakW -= lr * error * features.streak;
      weights.hourW -= lr * error * features.hour;
      weights.dayW -= lr * error * features.day;
      weights.volatilityW -= lr * error * features.volatility;
      weights.bias -= lr * error;
    }

    accuracy = correct / (decisions.length - 5);
  }

  return { weights, accuracy: Math.round(accuracy * 100), samples: decisions.length };
}

// ─── Predict (uses cached weights) ──────────────────────────
export function predict(input: PredictionInput): PredictionResult {
  // Use cached weights if fresh, otherwise retrain
  const now = Date.now();
  if (!g.__mlWeightsCache || (now - g.__mlWeightsCache.trainedAt) > RETRAIN_INTERVAL_MS) {
    const result = trainModel();
    g.__mlWeightsCache = { weights: result.weights, trainedAt: now, accuracy: result.accuracy, samples: result.samples };
    log.info('ML model retrained', { accuracy: result.accuracy, samples: result.samples });
  }
  const { weights } = g.__mlWeightsCache;

  const features = {
    pc1h: normalize(input.priceChange1h, -5, 5),
    pc24h: normalize(input.priceChange24h, -10, 10),
    vol: normalize(Math.log10(input.volume24h + 1), 0, 10),
    rsi: normalize(input.rsi, 0, 100),
    conf: normalize(input.confidence, 0, 100),
    wr: input.recentWinRate,
    streak: normalize(input.streak, -5, 5),
    hour: normalize(input.hourOfDay ?? 12, 0, 23),
    day: normalize(input.dayOfWeek ?? 3, 0, 6),
    volatility: normalize(input.recentVolatility ?? 1, 0, 5),
  };

  const z = features.pc1h * weights.priceChange1h +
            features.pc24h * weights.priceChange24h +
            features.vol * weights.volumeNorm +
            features.rsi * weights.rsiDev +
            features.conf * weights.confidenceW +
            features.wr * weights.winRateW +
            features.streak * weights.streakW +
            features.hour * weights.hourW +
            features.day * weights.dayW +
            features.volatility * weights.volatilityW +
            weights.bias;

  const probability = sigmoid(z);
  const confidence = Math.round(Math.abs(probability - 0.5) * 200);
  const predictedMove = Math.round((probability - 0.5) * 20 * 100) / 100;

  let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (probability > 0.6) direction = 'BULLISH';
  else if (probability < 0.4) direction = 'BEARISH';

  return {
    direction,
    confidence,
    predictedMove,
    features: input,
    modelVersion: 'ml-v1-sigmoid',
  };
}
