// ============================================================
// RUFLO FAZA 3 Batch 6/9 — CPCV (Purged + Embargo) Validator
// ============================================================
// PROBLEM: The existing WalkForwardEngine splits trades into expanding
// train/test folds with embargo=0 and no purging. Labels for trades
// near train_end are computed using horizon outcomes (15m, 60m, 240m
// after entry) that extend INTO the test region → train stats already
// "know" the start of test prices. Result: IS/OOS comparison
// systematically understates overfit.
//
// FIX (de Prado 2018, ch.7): two orthogonal corrections applied before
// computing per-fold stats:
//
//   PURGE: remove from training set any trade whose
//          (entry_ts + labelSpanMs) > train_end_ts. These are the
//          trades whose label was still being written at the time we
//          handed the model off to test.
//
//   EMBARGO: shift the test-window start forward by embargoMs so
//            serial correlation (market microstructure persistence)
//            from the last train trades doesn't directly drive the
//            first test trades.
//
// SHAPE: pure read-side module. Does not mutate gladiator state,
// does not write to DB. Returns a WalkForwardResult-compatible object
// plus {purgedFromTrain, embargoedTrades} telemetry.
//
// SAFETY:
//   - Feature-flagged via CPCV_SHADOW_ENABLED (default 'shadow').
//   - Consumed only by /api/v2/diag/cpcv for now. NOT yet wired into
//     promotion gate / butcher. That's Batch 6b if divergence is big.
//   - Reuses getGladiatorBattles (same DB path as WF). Zero new
//     dependencies.
//
// ASSUMPTIONS (memory stale if violated):
//   - Trades from getGladiatorBattles are time-ordered (oldest first).
//     Same assumption as WF. Broken order → garbage result.
//   - timestamp is parseable to ms epoch (Number(ts) or Date(ts).getTime()).
//   - pnl_percent is final-state (label already settled). If a trade's
//     label hasn't settled at query time, it shouldn't be in the set —
//     caller's responsibility. We filter on finite pnl_percent to be safe.
// ============================================================

import { createLogger } from '@/lib/core/logger';
import { getGladiatorBattles } from '@/lib/store/db';

const log = createLogger('CPCV');

// ─── Config / mode ─────────────────────────────────────────

export type CpcvMode = 'off' | 'shadow' | 'active';

export function getCpcvMode(): CpcvMode {
  const raw = (process.env.CPCV_SHADOW_ENABLED || 'shadow').toLowerCase();
  if (raw === 'off' || raw === 'active') return raw as CpcvMode;
  return 'shadow';
}

/** Default label span = max horizon we fill in multihorizon eval = 240m.
 *  Rationale: if we don't know which horizon the downstream consumer
 *  reads, we must purge conservatively — assume worst case 4h. */
const DEFAULT_LABEL_SPAN_MS = 4 * 60 * 60 * 1000;

/** Default embargo = 0.5% of the time span. Follows de Prado recommendation
 *  of 0.5%–2% depending on serial correlation. Start low; tune upward
 *  if divergence shows CPCV is still too optimistic. */
const DEFAULT_EMBARGO_FRAC = 0.005;

/** Minimum trades required to run validation (same as WF). */
const MIN_TRADES = 100;

const DEFAULT_FOLDS = 5;
const TRAIN_RATIO = 0.7;

// ─── Types ─────────────────────────────────────────────────

interface TradeRecord {
  pnlPercent: number;
  tsMs: number;
}

export interface CpcvFoldStats {
  winRate: number;
  profitFactor: number;
  sharpe: number;
  avgPnl: number;
  tradeCount: number;
}

export interface CpcvFoldResult {
  foldIndex: number;
  trainStats: CpcvFoldStats;
  testStats: CpcvFoldStats;
  /** Relative degradation: (IS - OOS) / |IS|. Positive = OOS worse. */
  degradation: {
    winRate: number;
    profitFactor: number;
    sharpe: number;
    avgPnl: number;
  };
  overfitFlag: boolean;
  /** How many trades were removed from train due to purge */
  purgedFromTrain: number;
  /** How many trades were removed from test-region start due to embargo */
  embargoedTrades: number;
}

export interface CpcvResult {
  gladiatorId: string;
  mode: CpcvMode;
  folds: number;
  totalTrades: number;
  labelSpanMs: number;
  embargoMs: number;
  foldResults: CpcvFoldResult[];
  overfitScore: number;
  aggregateOOS: CpcvFoldStats;
  aggregateIS: CpcvFoldStats;
  verdict: 'CLEAN' | 'SUSPECT' | 'OVERFIT';
  totalPurgedFromTrain: number;
  totalEmbargoedTrades: number;
  computeTimeMs: number;
  /** If validation couldn't run (too few trades etc) this is the reason. */
  skippedReason?: string;
}

export interface CpcvOptions {
  folds?: number;
  labelSpanMs?: number;
  embargoMs?: number;
}

// ─── Pure stat helpers (intentionally duplicated from WF to avoid
//     touching walkForwardEngine.ts). ~35 lines of harmless dup. ──

function computeStats(trades: TradeRecord[]): CpcvFoldStats {
  if (trades.length === 0) {
    return { winRate: 0, profitFactor: 0, sharpe: 0, avgPnl: 0, tradeCount: 0 };
  }
  const wins = trades.filter((t) => t.pnlPercent > 0);
  const losses = trades.filter((t) => t.pnlPercent <= 0);
  const winRate = wins.length / trades.length;
  const totalProfit = wins.reduce((s, t) => s + t.pnlPercent, 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPercent, 0));
  const profitFactor =
    totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Number.POSITIVE_INFINITY : 0;
  const avgPnl = trades.reduce((s, t) => s + t.pnlPercent, 0) / trades.length;
  const returns = trades.map((t) => t.pnlPercent / 100);
  const meanRet = returns.reduce((s, r) => s + r, 0) / returns.length;
  const retStd = Math.sqrt(
    returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / returns.length,
  );
  const sharpe = retStd > 0 ? meanRet / retStd : 0;
  return {
    winRate: parseFloat(winRate.toFixed(4)),
    profitFactor: parseFloat(profitFactor.toFixed(3)),
    sharpe: parseFloat(sharpe.toFixed(3)),
    avgPnl: parseFloat(avgPnl.toFixed(4)),
    tradeCount: trades.length,
  };
}

function computeDegradation(is: CpcvFoldStats, oos: CpcvFoldStats) {
  const safeDivide = (isVal: number, oosVal: number) => {
    if (!Number.isFinite(isVal) || !Number.isFinite(oosVal)) return 0;
    if (Math.abs(isVal) < 0.0001) return 0;
    const r = (isVal - oosVal) / Math.abs(isVal);
    return Number.isFinite(r) ? r : 0;
  };
  return {
    winRate: parseFloat(safeDivide(is.winRate, oos.winRate).toFixed(4)),
    profitFactor: parseFloat(safeDivide(is.profitFactor, oos.profitFactor).toFixed(4)),
    sharpe: parseFloat(safeDivide(is.sharpe, oos.sharpe).toFixed(4)),
    avgPnl: parseFloat(safeDivide(is.avgPnl, oos.avgPnl).toFixed(4)),
  };
}

const DEGRADATION_THRESHOLDS = {
  winRate: 0.2,
  profitFactor: 0.3,
  sharpe: 0.4,
  avgPnl: 0.25,
} as const;

function isFoldOverfit(d: CpcvFoldResult['degradation']): boolean {
  return (
    d.winRate > DEGRADATION_THRESHOLDS.winRate ||
    d.profitFactor > DEGRADATION_THRESHOLDS.profitFactor ||
    d.sharpe > DEGRADATION_THRESHOLDS.sharpe ||
    d.avgPnl > DEGRADATION_THRESHOLDS.avgPnl
  );
}

// ─── Timestamp parse helper (defensive) ─────────────────────

function parseTsMs(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Heuristic: seconds vs ms. Anything < 10^12 treat as seconds.
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
    const d = Date.parse(v);
    return Number.isFinite(d) ? d : 0;
  }
  return 0;
}

// ─── Fetch + shape trades ───────────────────────────────────

async function loadTrades(gladiatorId: string): Promise<TradeRecord[]> {
  const raw = await getGladiatorBattles(gladiatorId, 5000);
  const out: TradeRecord[] = [];
  for (const b of raw || []) {
    const rec = b as Record<string, unknown>;
    const pnl = rec.pnl_percent;
    if (typeof pnl !== 'number' || !Number.isFinite(pnl)) continue;
    const ts = parseTsMs(rec.timestamp);
    out.push({ pnlPercent: pnl, tsMs: ts });
  }
  // Ensure monotonic — WF assumes this silently, we enforce defensively.
  out.sort((a, b) => a.tsMs - b.tsMs);
  return out;
}

// ─── Main: runCpcvValidate ──────────────────────────────────

export async function runCpcvValidate(
  gladiatorId: string,
  opts: CpcvOptions = {},
): Promise<CpcvResult> {
  const t0 = Date.now();
  const mode = getCpcvMode();
  const folds = opts.folds ?? DEFAULT_FOLDS;
  const labelSpanMs = opts.labelSpanMs ?? DEFAULT_LABEL_SPAN_MS;

  const empty: CpcvResult = {
    gladiatorId,
    mode,
    folds,
    totalTrades: 0,
    labelSpanMs,
    embargoMs: opts.embargoMs ?? 0,
    foldResults: [],
    overfitScore: 0,
    aggregateOOS: { winRate: 0, profitFactor: 0, sharpe: 0, avgPnl: 0, tradeCount: 0 },
    aggregateIS: { winRate: 0, profitFactor: 0, sharpe: 0, avgPnl: 0, tradeCount: 0 },
    verdict: 'CLEAN',
    totalPurgedFromTrain: 0,
    totalEmbargoedTrades: 0,
    computeTimeMs: 0,
  };

  if (mode === 'off') {
    return { ...empty, skippedReason: 'mode=off', computeTimeMs: Date.now() - t0 };
  }

  const trades = await loadTrades(gladiatorId);
  if (trades.length < MIN_TRADES) {
    return {
      ...empty,
      totalTrades: trades.length,
      skippedReason: `n<${MIN_TRADES}`,
      computeTimeMs: Date.now() - t0,
    };
  }

  // Derive embargo in ms. If opts.embargoMs is missing, use fraction of
  // the FULL timestamp range (first..last trade) × DEFAULT_EMBARGO_FRAC.
  const firstTs = trades[0].tsMs;
  const lastTs = trades[trades.length - 1].tsMs;
  const spanMs = Math.max(lastTs - firstTs, 1);
  const embargoMs = opts.embargoMs ?? Math.floor(spanMs * DEFAULT_EMBARGO_FRAC);

  // Same expanding-window boundary logic as WF, but on indices we can
  // filter (not slice).
  const minInitialTrain = Math.max(Math.floor(MIN_TRADES * TRAIN_RATIO), 20);
  if (trades.length <= minInitialTrain + 10) {
    return {
      ...empty,
      totalTrades: trades.length,
      embargoMs,
      skippedReason: 'too-small-for-folds',
      computeTimeMs: Date.now() - t0,
    };
  }

  const testRegionStart = minInitialTrain;
  const testRegionSize = trades.length - testRegionStart;
  const testFoldSize = Math.max(Math.floor(testRegionSize / folds), 3);

  const foldResults: CpcvFoldResult[] = [];
  const allTrainTrades: TradeRecord[] = [];
  const allTestTrades: TradeRecord[] = [];
  let totalPurged = 0;
  let totalEmbargoed = 0;

  for (let i = 0; i < folds; i++) {
    const testStart = testRegionStart + i * testFoldSize;
    const testEnd = i === folds - 1 ? trades.length : testStart + testFoldSize;
    if (testStart >= trades.length) break;

    const trainSlice = trades.slice(0, testStart);
    const testSliceRaw = trades.slice(testStart, testEnd);
    if (trainSlice.length < minInitialTrain || testSliceRaw.length < 3) continue;

    // --- Purge ---
    // Boundary = timestamp of the first test trade.
    const boundaryTs = testSliceRaw[0].tsMs;
    const purgeCutoffTs = boundaryTs - labelSpanMs; // train trades with
    // entry > purgeCutoffTs have labels that leak into/past boundary.
    const trainPurged = trainSlice.filter((t) => t.tsMs <= purgeCutoffTs);
    const purgedN = trainSlice.length - trainPurged.length;

    // --- Embargo ---
    // Drop test trades within [boundaryTs, boundaryTs + embargoMs).
    const embargoEnd = boundaryTs + embargoMs;
    const testAfterEmbargo = testSliceRaw.filter((t) => t.tsMs >= embargoEnd);
    const embargoedN = testSliceRaw.length - testAfterEmbargo.length;

    // If purge or embargo destroyed the fold, skip. This is the real
    // risk with aggressive CPCV — we'd rather have fewer folds than
    // folds stuffed with artifact-driven stats.
    if (trainPurged.length < minInitialTrain || testAfterEmbargo.length < 3) {
      log.info(
        `[CPCV] fold ${i} skipped after purge/embargo: train=${trainPurged.length}, test=${testAfterEmbargo.length}`,
      );
      totalPurged += purgedN;
      totalEmbargoed += embargoedN;
      continue;
    }

    const trainStats = computeStats(trainPurged);
    const testStats = computeStats(testAfterEmbargo);
    const degradation = computeDegradation(trainStats, testStats);

    totalPurged += purgedN;
    totalEmbargoed += embargoedN;
    allTrainTrades.push(...trainPurged);
    allTestTrades.push(...testAfterEmbargo);

    foldResults.push({
      foldIndex: i,
      trainStats,
      testStats,
      degradation,
      overfitFlag: isFoldOverfit(degradation),
      purgedFromTrain: purgedN,
      embargoedTrades: embargoedN,
    });
  }

  if (foldResults.length === 0) {
    return {
      ...empty,
      totalTrades: trades.length,
      embargoMs,
      totalPurgedFromTrain: totalPurged,
      totalEmbargoedTrades: totalEmbargoed,
      skippedReason: 'all-folds-destroyed-by-purge-embargo',
      computeTimeMs: Date.now() - t0,
    };
  }

  const overfitCount = foldResults.filter((f) => f.overfitFlag).length;
  const overfitScore = parseFloat((overfitCount / foldResults.length).toFixed(3));
  const verdict: CpcvResult['verdict'] =
    overfitScore > 0.5 ? 'OVERFIT' : overfitScore > 0.2 ? 'SUSPECT' : 'CLEAN';

  const result: CpcvResult = {
    gladiatorId,
    mode,
    folds: foldResults.length,
    totalTrades: trades.length,
    labelSpanMs,
    embargoMs,
    foldResults,
    overfitScore,
    aggregateOOS: computeStats(allTestTrades),
    aggregateIS: computeStats(allTrainTrades),
    verdict,
    totalPurgedFromTrain: totalPurged,
    totalEmbargoedTrades: totalEmbargoed,
    computeTimeMs: Date.now() - t0,
  };

  log.info(
    `[CPCV] ${gladiatorId}: ${verdict} overfit=${(overfitScore * 100).toFixed(0)}% ` +
      `folds=${foldResults.length}/${folds} purged=${totalPurged} emb=${totalEmbargoed} ${result.computeTimeMs}ms`,
  );

  return result;
}

export function getCpcvConfig() {
  return {
    mode: getCpcvMode(),
    defaultLabelSpanMs: DEFAULT_LABEL_SPAN_MS,
    defaultEmbargoFrac: DEFAULT_EMBARGO_FRAC,
    minTrades: MIN_TRADES,
    trainRatio: TRAIN_RATIO,
  };
}
