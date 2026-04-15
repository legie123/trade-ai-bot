// ============================================================
// Volume Intelligence — volume regime detection (spike vs drought)
// ============================================================

export interface VolumeSample {
  t: number;
  v: number;
}

export interface VolumeIntel {
  symbol: string;
  current: number;
  mean: number;
  stdev: number;
  zScore: number;             // (current - mean) / stdev
  regime: 'spike' | 'elevated' | 'normal' | 'quiet' | 'drought' | 'unknown';
  acceleration: number;       // last/mean ratio of recent vs prior window
  at: number;
}

/**
 * Classify volume vs a trailing window. Expects chronological samples.
 */
export function classifyVolume(symbol: string, samples: VolumeSample[]): VolumeIntel {
  const at = Date.now();
  if (!samples || samples.length < 5) {
    return {
      symbol,
      current: samples?.[samples.length - 1]?.v || 0,
      mean: 0,
      stdev: 0,
      zScore: 0,
      regime: 'unknown',
      acceleration: 0,
      at,
    };
  }
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const vals = sorted.map((s) => s.v).filter((v) => v >= 0);
  const n = vals.length;
  const mean = vals.reduce((s, v) => s + v, 0) / n;
  const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  const current = vals[n - 1];
  const zScore = stdev > 0 ? (current - mean) / stdev : 0;

  // Acceleration: compare last 25% to prior 75%
  const splitIdx = Math.floor(n * 0.75);
  const recent = vals.slice(splitIdx);
  const prior = vals.slice(0, splitIdx);
  const recentMean = recent.reduce((s, v) => s + v, 0) / (recent.length || 1);
  const priorMean = prior.reduce((s, v) => s + v, 0) / (prior.length || 1);
  const acceleration = priorMean > 0 ? recentMean / priorMean : 0;

  let regime: VolumeIntel['regime'];
  if (zScore >= 3) regime = 'spike';
  else if (zScore >= 1.5) regime = 'elevated';
  else if (zScore <= -2) regime = 'drought';
  else if (zScore <= -1) regime = 'quiet';
  else regime = 'normal';

  return {
    symbol,
    current: Number(current.toFixed(4)),
    mean: Number(mean.toFixed(4)),
    stdev: Number(stdev.toFixed(4)),
    zScore: Number(zScore.toFixed(3)),
    regime,
    acceleration: Number(acceleration.toFixed(3)),
    at,
  };
}
