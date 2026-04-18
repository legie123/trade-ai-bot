/**
 * Position Context Sidecar — C5 wiring (2026-04-18)
 *
 * ADDITIVE. Stores per-position context (regime, indicators, confidence,
 * debate verdict, slippage) at trade OPEN time, so that at trade CLOSE time
 * the experienceMemory.record() call can include them instead of hardcoded
 * zeros. Without this sidecar, experienceMemory was DECORATIVE — stored WIN/LOSS
 * outcomes but NO learnable features → RL layer could not adapt.
 *
 * Storage: in-memory Map keyed by positionId. Lost on process restart.
 *
 * ASUMPȚIE: Cloud Run restarts are rare enough that transient context loss
 * is acceptable. If critical, migrate to Supabase json_store with the
 * position id as key. For now, the RL layer tolerates null context entries.
 *
 * Kill-switch: none — sidecar is passive storage.
 */

interface PositionContext {
  regime: string | null;
  indicators: {
    rsi?: number;
    vwapDeviation?: number;
    volumeZ?: number;
    fundingRate?: number;
    sentimentScore?: number;
  };
  confidence: number;
  debateVerdict: string | null;
  /** Signal price (what strategy wanted) vs fill price (what MEXC executed at) */
  signalPrice: number;
  /** Execution latency in ms — time from signal emission to fill confirmation */
  latencyMs: number | null;
}

const contextMap = new Map<string, PositionContext>();

/** Keep a soft cap to avoid unbounded growth on zombie positions */
const MAX_ENTRIES = 500;

export function storePositionContext(positionId: string, ctx: PositionContext): void {
  if (contextMap.size >= MAX_ENTRIES) {
    // Evict oldest (FIFO — Maps preserve insertion order)
    const firstKey = contextMap.keys().next().value;
    if (firstKey) contextMap.delete(firstKey);
  }
  contextMap.set(positionId, ctx);
}

export function getPositionContext(positionId: string): PositionContext | undefined {
  return contextMap.get(positionId);
}

export function clearPositionContext(positionId: string): void {
  contextMap.delete(positionId);
}

/**
 * Compute slippage in basis points (bps).
 * Positive = filled WORSE than signal (bad), negative = filled BETTER (lucky).
 * LONG: (fill - signal) / signal. SHORT: (signal - fill) / signal.
 */
export function computeSlippageBps(
  signalPrice: number,
  fillPrice: number,
  side: 'LONG' | 'SHORT',
): number | null {
  if (!signalPrice || signalPrice <= 0) return null;
  const rawDelta = (fillPrice - signalPrice) / signalPrice;
  const directional = side === 'LONG' ? rawDelta : -rawDelta;
  return Math.round(directional * 10000); // to bps
}
