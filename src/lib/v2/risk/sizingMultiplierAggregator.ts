// ============================================================
// Sizing Multiplier Aggregator — FAZA 3.1 Batch 4/9
// ============================================================
// Combines orthogonal sizing multipliers into ONE bounded factor:
//   - Regime gate (ADX trend/mean-rev compatibility)         Batch 2
//   - Sentiment divergence (F&G x funding contrarian flag)   Batch 3
//   - Fractional Kelly (edge-aware position sizing)          Batch 4 (new)
//   - Drawdown scaling (CUT only, never boost)               Batch 4 (new)
//
// PURE FUNCTION. No fetches. All inputs supplied by caller (already
// computed elsewhere). Avoids re-running ADX / F&G / funding queries.
//
// PSEUDO-CODE:
//   1. regimeMult     = regimeMultiplier(regime, signalKind)        ∈ [0.70, 1.20]
//   2. sentimentMult  = sentimentMultiplier(divergence, signalDir)  ∈ [0.85, 1.15]
//   3. kellyMult      = computeKellyMultiplier(stats)               ∈ [0.70, 1.30]
//        - Fractional Kelly (quarter-Kelly) over WR + winLossRatio
//        - Requires sample >= MIN_SAMPLES, else 1.00
//   4. ddMult         = computeDrawdownMultiplier(equity, peak)     ∈ [0.50, 1.00]
//        - Piecewise linear CUT only. Never boosts.
//   5. total          = clamp(prod, GLOBAL_MIN_MULT, GLOBAL_MAX_MULT)
//
// CRITICAL ASSUMPTIONS (if broken → invalidates aggregator):
//   A1: Each input is independent enough that multiplication is sane
//       (Kelly already uses WR; regime/sentiment do NOT use WR — orthogonal)
//   A2: Stats sample (>=MIN_SAMPLES) is large enough to estimate WR/WLR
//       reliably. WR<60% on n<50 is noise (see WR artifact memory).
//   A3: Drawdown is computed on REALIZED equity (not paper marks), peak is
//       all-time high or rolling-N peak — caller supplies whichever.
//   A4: Caller is responsible for invoking only when feature flag is active.
//       Module exposes mode helper but does NOT self-gate.
//
// FEATURE FLAG: env SIZING_AGGREGATOR_ENABLED ('shadow' default | 'active' | 'off')
//   - 'shadow' → caller logs result but does NOT apply to suggestedSize
//   - 'active' → caller multiplies suggestedSize by total
//   - 'off'    → caller bypasses entirely (returns 1.0 from helper if invoked)
//
// KILL-SWITCH: set SIZING_AGGREGATOR_ENABLED=off in Cloud Run env.
//
// CAP RATIONALE:
//   GLOBAL_MAX_MULT=1.50 prevents stacking three boosts (e.g. 1.20*1.15*1.30
//   = 1.79 → capped at 1.50). Each individual gate is intentionally less
//   aggressive than its boost looks because of compound risk.
//   GLOBAL_MIN_MULT=0.30 prevents zeroing out valid edges during DD + mismatch.
// ============================================================

import { createLogger } from '@/lib/core/logger';
import {
  RegimeKind,
  SignalKind,
  regimeMultiplier,
} from '@/lib/v2/scouts/ta/adxRegime';
import {
  DivergenceKind,
  SignalDir,
  sentimentMultiplier,
} from '@/lib/v2/scouts/ta/sentimentDivergence';

const log = createLogger('SizingAggregator');

export type SizingMode = 'shadow' | 'active' | 'off';

export interface KellyStats {
  winRate: number;          // 0..1
  winLossRatio: number;     // avg(win) / avg(|loss|), > 0
  sampleSize: number;       // # closed trades
}

export interface EquitySnapshot {
  current: number;          // current realized equity
  peak: number;             // peak equity (all-time or rolling)
}

export interface AggregatorInput {
  // All optional — missing input → that factor = 1.0
  regime?: RegimeKind;
  signalKind?: SignalKind;
  divergence?: DivergenceKind;
  signalDir?: SignalDir;
  kellyStats?: KellyStats;
  equity?: EquitySnapshot;
}

export interface AggregatorBreakdown {
  regime: number;
  sentiment: number;
  kelly: number;
  drawdown: number;
}

export interface AggregatorResult {
  total: number;
  capped: boolean;          // true if hit min/max global cap
  breakdown: AggregatorBreakdown;
  reasons: string[];        // human-readable trace
  mode: SizingMode;
  computedAt: number;
}

// ─── Constants ───
const KELLY_FRACTION = 0.25;     // Quarter-Kelly (industry standard)
const KELLY_MIN_MULT = 0.70;
const KELLY_MAX_MULT = 1.30;
const KELLY_MIN_SAMPLES = 20;    // Below this, Kelly is noise → return 1.0

const GLOBAL_MIN_MULT = 0.30;
const GLOBAL_MAX_MULT = 1.50;

// DD scaling tiers (piecewise linear). CUT ONLY — never boost.
const DD_TIERS: Array<{ ddPct: number; mult: number }> = [
  { ddPct: 0.05, mult: 1.00 }, // < 5% DD: no impact
  { ddPct: 0.10, mult: 0.90 }, // 5-10% DD: -10%
  { ddPct: 0.20, mult: 0.70 }, // 10-20% DD: -30%
  { ddPct: Infinity, mult: 0.50 }, // ≥20% DD: -50% (halve sizing)
];

export function getSizingMode(): SizingMode {
  const v = (process.env.SIZING_AGGREGATOR_ENABLED || 'shadow').toLowerCase();
  if (v === 'active' || v === 'on' || v === 'true') return 'active';
  if (v === 'off' || v === 'false' || v === 'disabled') return 'off';
  return 'shadow';
}

// ─── Fractional Kelly multiplier ───
// Kelly fraction f* = (p*b - q) / b where p=WR, q=1-WR, b=winLossRatio
// We compute quarter-Kelly, then map it to a [0.70, 1.30] BOUNDED multiplier
// over a "neutral" Kelly band of ~5% (assumed baseline target).
//
// Mapping is intentionally conservative: even with f*=0.40 (extreme positive
// edge), quarter-Kelly = 0.10 → mult = 1.30 (cap). Avoids overconfidence on
// small samples — see WR artifact memory.
export function computeKellyMultiplier(stats?: KellyStats): { mult: number; reason: string } {
  if (!stats) return { mult: 1.0, reason: 'kelly: no stats provided' };
  if (stats.sampleSize < KELLY_MIN_SAMPLES) {
    return { mult: 1.0, reason: `kelly: sample ${stats.sampleSize} < ${KELLY_MIN_SAMPLES} → neutral` };
  }
  if (stats.winLossRatio <= 0 || isNaN(stats.winLossRatio)) {
    return { mult: 1.0, reason: 'kelly: invalid winLossRatio → neutral' };
  }
  if (stats.winRate <= 0 || stats.winRate >= 1 || isNaN(stats.winRate)) {
    return { mult: 1.0, reason: 'kelly: invalid winRate → neutral' };
  }

  const p = stats.winRate;
  const q = 1 - p;
  const b = stats.winLossRatio;
  const fullKelly = (p * b - q) / b;          // can be negative (no edge)
  const fracKelly = fullKelly * KELLY_FRACTION;

  // Map fracKelly to [KELLY_MIN_MULT, KELLY_MAX_MULT]:
  //   fracKelly <= 0     → 0.70 (no edge → cut)
  //   fracKelly = 0.05   → 1.00 (baseline)
  //   fracKelly >= 0.10  → 1.30 (cap)
  let mult: number;
  if (fracKelly <= 0) {
    mult = KELLY_MIN_MULT;
  } else if (fracKelly >= 0.10) {
    mult = KELLY_MAX_MULT;
  } else if (fracKelly >= 0.05) {
    // 0.05 → 1.00, 0.10 → 1.30 (linear)
    mult = 1.0 + ((fracKelly - 0.05) / 0.05) * 0.30;
  } else {
    // 0 → 0.70, 0.05 → 1.00 (linear)
    mult = KELLY_MIN_MULT + (fracKelly / 0.05) * (1.0 - KELLY_MIN_MULT);
  }

  return {
    mult: Number(mult.toFixed(3)),
    reason: `kelly: WR=${(p * 100).toFixed(1)}% WLR=${b.toFixed(2)} fullK=${fullKelly.toFixed(3)} qK=${fracKelly.toFixed(3)} → ${mult.toFixed(3)}`,
  };
}

// ─── Drawdown multiplier (CUT only) ───
export function computeDrawdownMultiplier(equity?: EquitySnapshot): { mult: number; reason: string } {
  if (!equity || equity.peak <= 0 || equity.current < 0) {
    return { mult: 1.0, reason: 'dd: no equity data → neutral' };
  }
  if (equity.current >= equity.peak) {
    return { mult: 1.0, reason: 'dd: at/above peak → neutral' };
  }
  const ddPct = (equity.peak - equity.current) / equity.peak;

  for (const tier of DD_TIERS) {
    if (ddPct < tier.ddPct) {
      return {
        mult: tier.mult,
        reason: `dd: ${(ddPct * 100).toFixed(2)}% drawdown → ${tier.mult.toFixed(2)}`,
      };
    }
  }
  // Should never hit (Infinity guard) but TS exhaustiveness
  const last = DD_TIERS[DD_TIERS.length - 1];
  return { mult: last.mult, reason: `dd: ${(ddPct * 100).toFixed(2)}% deep DD → ${last.mult.toFixed(2)}` };
}

// ─── Public entry: compute aggregated multiplier ───
export function computeSizingMultiplier(input: AggregatorInput): AggregatorResult {
  const reasons: string[] = [];

  // 1. Regime
  let regimeM = 1.0;
  if (input.regime && input.signalKind) {
    regimeM = regimeMultiplier(input.regime, input.signalKind);
    reasons.push(`regime: ${input.regime} × ${input.signalKind} → ${regimeM.toFixed(2)}`);
  } else {
    reasons.push('regime: missing → 1.00');
  }

  // 2. Sentiment
  let sentimentM = 1.0;
  if (input.divergence && input.signalDir) {
    sentimentM = sentimentMultiplier(input.divergence, input.signalDir);
    reasons.push(`sentiment: ${input.divergence} × ${input.signalDir} → ${sentimentM.toFixed(2)}`);
  } else {
    reasons.push('sentiment: missing → 1.00');
  }

  // 3. Kelly
  const kellyRes = computeKellyMultiplier(input.kellyStats);
  reasons.push(kellyRes.reason);

  // 4. DD
  const ddRes = computeDrawdownMultiplier(input.equity);
  reasons.push(ddRes.reason);

  // 5. Aggregate + clip
  const raw = regimeM * sentimentM * kellyRes.mult * ddRes.mult;
  let total = raw;
  let capped = false;
  if (total < GLOBAL_MIN_MULT) {
    total = GLOBAL_MIN_MULT;
    capped = true;
    reasons.push(`global: raw=${raw.toFixed(3)} < min ${GLOBAL_MIN_MULT} → clipped`);
  } else if (total > GLOBAL_MAX_MULT) {
    total = GLOBAL_MAX_MULT;
    capped = true;
    reasons.push(`global: raw=${raw.toFixed(3)} > max ${GLOBAL_MAX_MULT} → clipped`);
  }

  const result: AggregatorResult = {
    total: Number(total.toFixed(3)),
    capped,
    breakdown: {
      regime: regimeM,
      sentiment: sentimentM,
      kelly: kellyRes.mult,
      drawdown: ddRes.mult,
    },
    reasons,
    mode: getSizingMode(),
    computedAt: Date.now(),
  };

  if (Math.abs(total - 1.0) > 0.05) {
    log.info(`[sizing] total=${result.total} regime=${regimeM} sent=${sentimentM} kelly=${kellyRes.mult} dd=${ddRes.mult}`);
  }

  return result;
}

// ─── Telemetry ───
export function getSizingAggregatorConfig(): {
  mode: SizingMode;
  globalMin: number;
  globalMax: number;
  kellyFraction: number;
  kellyMinSamples: number;
  ddTiers: typeof DD_TIERS;
} {
  return {
    mode: getSizingMode(),
    globalMin: GLOBAL_MIN_MULT,
    globalMax: GLOBAL_MAX_MULT,
    kellyFraction: KELLY_FRACTION,
    kellyMinSamples: KELLY_MIN_SAMPLES,
    ddTiers: DD_TIERS,
  };
}
