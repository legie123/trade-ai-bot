/**
 * Micro-ML per Gladiator — Step 4.1
 *
 * ADDITIVE. Per-gladiator ML inference using ONNX Runtime.
 * Models are trained externally (Python XGBoost/LightGBM) and exported as .onnx.
 * This module handles loading models and running inference in TypeScript.
 *
 * Architecture:
 *   SwarmOrchestrator → MicroML.predict(gladiatorId, features) → { probability, shouldTrade }
 *   The Forge → MicroML.getModelStatus(gladiatorId) → model health info
 *
 * Feature vector (11 dimensions):
 *   [rsi, vwapDeviation, volumeZ, fundingRate, sentimentScore, momentumScore,
 *    regimeEncoded, rollingWinRate, currentLossStreak, hourOfDay, dayOfWeek]
 *
 * Training pipeline (external Python):
 *   1. Fetch trades from experience_memory via Supabase
 *   2. Build feature matrix + labels (WIN=1, LOSS=0)
 *   3. Train XGBoost classifier with walk-forward splits
 *   4. Export to ONNX: model.save_model('model.json') → onnxmltools convert
 *   5. Upload .onnx to models/{gladiatorId}.onnx
 *
 * ASSUMPTION: ONNX model input shape is [1, 11] float32.
 *   If model architecture changes, FEATURE_COUNT must be updated.
 *   Mismatched input shape will throw at inference time.
 *
 * ASSUMPTION: ONNX Runtime (onnxruntime-node) is installed.
 *   If not available, falls back to heuristic scoring.
 *
 * Kill-switch: DISABLE_MICRO_ML=true
 */

import { createLogger } from '@/lib/core/logger';

const log = createLogger('MicroML');

const DISABLED = process.env.DISABLE_MICRO_ML === 'true';

// ─── Configuration ──────────────────────────────────────────

const FEATURE_COUNT = 11;
const MODEL_DIR = process.env.ML_MODEL_DIR || './models';
const PREDICTION_THRESHOLD = 0.55;  // P(profit) > 55% → shouldTrade=true
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // Reload model every 5 min

// ─── Types ──────────────────────────────────────────────────

export interface MLFeatures {
  rsi?: number;
  vwapDeviation?: number;
  volumeZ?: number;
  fundingRate?: number;
  sentimentScore?: number;
  momentumScore?: number;
  regime?: string;
  rollingWinRate?: number;
  currentLossStreak?: number;
  /** Optional: auto-derived from current time if not provided */
  hourOfDay?: number;
  dayOfWeek?: number;
}

export interface MLPrediction {
  probability: number;        // P(profit) 0-1
  shouldTrade: boolean;       // probability > threshold
  confidence: number;         // |probability - 0.5| × 2 (distance from uncertain)
  method: 'ONNX' | 'HEURISTIC' | 'DISABLED' | 'NO_MODEL';
  modelVersion: string | null;
  latencyMs: number;
}

export interface ModelStatus {
  gladiatorId: string;
  loaded: boolean;
  modelPath: string | null;
  lastLoaded: number | null;
  featureCount: number;
  predictionThreshold: number;
}

// ─── Regime Encoding ────────────────────────────────────────

const REGIME_MAP: Record<string, number> = {
  'BULL': 1.0,
  'trend_up': 1.0,
  'BEAR': -1.0,
  'trend_down': -1.0,
  'RANGE': 0.0,
  'ranging': 0.0,
  'HIGH_VOL': -0.5,
  'volatile': -0.5,
  'TRANSITION': 0.3,
  'unknown': 0.0,
};

function encodeRegime(regime?: string | null): number {
  if (!regime) return 0;
  return REGIME_MAP[regime] ?? 0;
}

// ─── Feature Normalization ──────────────────────────────────

function buildFeatureVector(features: MLFeatures): Float32Array {
  const now = new Date();
  const vec = new Float32Array(FEATURE_COUNT);

  // Normalize features to roughly [-1, 1] or [0, 1] range
  vec[0] = ((features.rsi ?? 50) - 50) / 50;                    // RSI: centered at 50
  vec[1] = Math.max(-1, Math.min(1, (features.vwapDeviation ?? 0) * 50)); // VWAP dev: small values
  vec[2] = Math.max(-3, Math.min(3, features.volumeZ ?? 0)) / 3;         // Volume Z: typically -3 to 3
  vec[3] = Math.max(-1, Math.min(1, (features.fundingRate ?? 0) * 1000)); // Funding: tiny values
  vec[4] = Math.max(-1, Math.min(1, features.sentimentScore ?? 0));       // Sentiment: already -1 to 1
  vec[5] = Math.max(-1, Math.min(1, features.momentumScore ?? 0));        // Momentum: -1 to 1
  vec[6] = encodeRegime(features.regime);                                  // Regime: encoded
  vec[7] = (features.rollingWinRate ?? 50) / 100;                         // WR: 0-1
  vec[8] = Math.min(1, (features.currentLossStreak ?? 0) / 5);           // Streak: 0-1 (cap at 5)
  vec[9] = (features.hourOfDay ?? now.getUTCHours()) / 23;               // Hour: 0-1
  vec[10] = (features.dayOfWeek ?? now.getUTCDay()) / 6;                 // Day: 0-1

  return vec;
}

// ─── Heuristic Fallback (no model available) ────────────────

function heuristicPredict(features: MLFeatures): MLPrediction {
  const t0 = Date.now();
  let score = 0.5; // Start neutral

  // RSI: extreme values slightly predictive of reversal
  const rsi = features.rsi ?? 50;
  if (rsi < 30) score += 0.05;  // Oversold → slight long edge
  if (rsi > 70) score -= 0.05;  // Overbought → slight short edge

  // Regime alignment
  const regimeVal = encodeRegime(features.regime);
  score += regimeVal * 0.08;

  // Win rate momentum
  const wr = features.rollingWinRate ?? 50;
  if (wr > 55) score += 0.05;
  if (wr < 40) score -= 0.08;

  // Loss streak penalty
  const streak = features.currentLossStreak ?? 0;
  if (streak >= 3) score -= 0.1;

  // Sentiment alignment
  const sent = features.sentimentScore ?? 0;
  score += sent * 0.06;

  score = Math.max(0.1, Math.min(0.9, score));

  return {
    probability: parseFloat(score.toFixed(4)),
    shouldTrade: score > PREDICTION_THRESHOLD,
    confidence: parseFloat((Math.abs(score - 0.5) * 2).toFixed(4)),
    method: 'HEURISTIC',
    modelVersion: null,
    latencyMs: Date.now() - t0,
  };
}

// ─── ONNX Model Cache ──────────────────────────────────────

interface CachedModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;  // onnxruntime.InferenceSession — typed as any to avoid hard dep
  loadedAt: number;
  modelPath: string;
  version: string;
}

const modelCache = new Map<string, CachedModel>();

// ─── Main Engine ────────────────────────────────────────────

export class MicroML {
  private static instance: MicroML;
  private onnxAvailable: boolean | null = null;

  public static getInstance(): MicroML {
    if (!MicroML.instance) {
      MicroML.instance = new MicroML();
    }
    return MicroML.instance;
  }

  /**
   * Predict P(profit) for a gladiator given current market features.
   *
   * Tries ONNX model first, falls back to heuristic if model unavailable.
   */
  async predict(gladiatorId: string, features: MLFeatures): Promise<MLPrediction> {
    const t0 = Date.now();

    if (DISABLED) {
      return {
        probability: 0.5,
        shouldTrade: false,
        confidence: 0,
        method: 'DISABLED',
        modelVersion: null,
        latencyMs: 0,
      };
    }

    // Try ONNX inference
    try {
      const session = await this.loadModel(gladiatorId);
      if (session) {
        return await this.onnxInference(session, features, t0);
      }
    } catch (err) {
      log.warn(`[ML] ONNX inference failed for ${gladiatorId}: ${err}`);
    }

    // Fallback to heuristic
    return heuristicPredict(features);
  }

  /**
   * Get model status for a gladiator.
   */
  getModelStatus(gladiatorId: string): ModelStatus {
    const cached = modelCache.get(gladiatorId);
    return {
      gladiatorId,
      loaded: !!cached,
      modelPath: cached?.modelPath ?? null,
      lastLoaded: cached?.loadedAt ?? null,
      featureCount: FEATURE_COUNT,
      predictionThreshold: PREDICTION_THRESHOLD,
    };
  }

  /**
   * Clear cached model (force reload on next predict).
   */
  clearModel(gladiatorId: string): void {
    modelCache.delete(gladiatorId);
    log.info(`[ML] Cleared model cache for ${gladiatorId}`);
  }

  /**
   * Clear all cached models.
   */
  clearAllModels(): void {
    modelCache.clear();
    log.info(`[ML] Cleared all model caches`);
  }

  // ─── Private helpers ─────────────────────────────────────

  private async checkOnnxAvailable(): Promise<boolean> {
    if (this.onnxAvailable !== null) return this.onnxAvailable;
    try {
      // @ts-expect-error — onnxruntime-node is an optional dependency
      await import('onnxruntime-node');
      this.onnxAvailable = true;
      log.info('[ML] ONNX Runtime available');
    } catch {
      this.onnxAvailable = false;
      log.warn('[ML] ONNX Runtime not installed — using heuristic fallback');
    }
    return this.onnxAvailable;
  }

  private async loadModel(gladiatorId: string): Promise<CachedModel | null> {
    // Check cache
    const cached = modelCache.get(gladiatorId);
    if (cached && (Date.now() - cached.loadedAt) < MODEL_CACHE_TTL_MS) {
      return cached;
    }

    // Check ONNX availability
    if (!await this.checkOnnxAvailable()) return null;

    // Try to load model file
    const modelPath = `${MODEL_DIR}/${gladiatorId}.onnx`;

    try {
      const fs = await import('fs');
      if (!fs.existsSync(modelPath)) {
        // No model file for this gladiator — not an error, just not trained yet
        return null;
      }

      // @ts-expect-error — onnxruntime-node is an optional dependency
      const ort = await import('onnxruntime-node');
      const session = await ort.InferenceSession.create(modelPath);

      const model: CachedModel = {
        session,
        loadedAt: Date.now(),
        modelPath,
        version: `${gladiatorId}-${Date.now()}`,
      };

      modelCache.set(gladiatorId, model);
      log.info(`[ML] Loaded ONNX model: ${modelPath}`);
      return model;
    } catch (err) {
      log.warn(`[ML] Failed to load model ${modelPath}: ${err}`);
      return null;
    }
  }

  private async onnxInference(
    model: CachedModel, features: MLFeatures, t0: number,
  ): Promise<MLPrediction> {
    // @ts-expect-error — onnxruntime-node is an optional dependency
    const ort = await import('onnxruntime-node');
    const featureVec = buildFeatureVector(features);

    // Create input tensor [1, FEATURE_COUNT]
    const inputTensor = new ort.Tensor('float32', featureVec, [1, FEATURE_COUNT]);

    // Run inference — input name is typically 'input' or 'features'
    // Try common input names
    const inputNames = model.session.inputNames || ['input'];
    const feeds: Record<string, unknown> = {};
    feeds[inputNames[0]] = inputTensor;

    const results = await model.session.run(feeds);

    // Extract probability — output is typically 'output' or 'probabilities'
    const outputNames = model.session.outputNames || ['output'];
    const outputData = results[outputNames[0]];

    // For binary classifier: output is [P(loss), P(profit)] or just [P(profit)]
    let probability: number;
    if (outputData.data.length >= 2) {
      probability = Number(outputData.data[1]); // P(profit) = second class
    } else {
      probability = Number(outputData.data[0]);
    }

    probability = Math.max(0, Math.min(1, probability));

    return {
      probability: parseFloat(probability.toFixed(4)),
      shouldTrade: probability > PREDICTION_THRESHOLD,
      confidence: parseFloat((Math.abs(probability - 0.5) * 2).toFixed(4)),
      method: 'ONNX',
      modelVersion: model.version,
      latencyMs: Date.now() - t0,
    };
  }
}

export const microML = MicroML.getInstance();
