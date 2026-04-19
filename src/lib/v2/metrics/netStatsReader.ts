// ============================================================
// FAZA B.3 — NET-OF-FEE STATS READER (2026-04-18)
// Pure reader that extracts pnlPercentNet + isWinNet from BattleRecord.marketContext
// (FAZA B.2 schema) with safe fallback for historical rows.
//
// DESIGN INTENT:
// - Zero DB migration: reads existing JSONB marketContext path.
// - Zero side effects: pure functions, no global state, no logging.
// - Expose coverage metric so downstream gates (B.4 Butcher) can refuse
//   decisions made on fallback-dominated datasets.
// - Gross fields mirror existing BattleRecord.pnlPercent / isWin (unchanged),
//   so call sites can still use the old stats path.
//
// ASUMPȚII CRITICE care invalidează modelul:
//   1) Fallback `pnlGross - 0.14` presupune istorice sunt FUTURES taker cu
//      slippage activ (FEE_INCLUDE_SLIPPAGE=1), sync cu feeModel.ts total
//      (fee 0.08 + slippage 0.06). Prior 0.08 subestima cost pe pre-FAZA-B.2 rows
//      cu 0.06% → PF/WR net inflated. RUFLO NEXT FEE fix 2026-04-20.
//      Dacă vreodată pivotezi pe SPOT istoric → fee+slip 0.28%, underestimate.
//      Marker corect: folosește ONLY rows with hasNetData=true in LIVE decisions.
//   2) Nu face dedup cross-gladiator. Fiecare gladiator își deține battles,
//      deci stats per-gladiator sunt corecte direct. Pentru aggregate edge
//      (toate gladiatorii pe același signalId) cheamă dedupBySignalId separat.
//   3) Nu cunoaște regim. Stratificarea pe regime.regime e responsabilitate
//      consumer (filter views before computeSummary).
// ============================================================

export interface NetBattleView {
  pnlPercentGross: number;
  pnlPercentNet: number;
  isWinGross: boolean;
  isWinNet: boolean;
  hasNetData: boolean;        // true if marketContext.pnlPercentNet was present (not fallback)
  symbol: string;
  direction: string;          // 'LONG' | 'SHORT' | 'FLAT' (uppercased)
  timestamp: number;
  battleId: string;
  regime?: string;            // from marketContext.regime if present
}

export interface NetStatsSummary {
  totalTrades: number;
  coverageNet: number;        // 0-1, fraction with actual net data (NOT fallback)
  winRateGross: number;       // %
  winRateNet: number;         // %
  profitFactorGross: number;  // sum(win)/abs(sum(loss)); +Infinity if no losses & wins>0; 0 if empty
  profitFactorNet: number;
  avgPnlGross: number;        // % per trade
  avgPnlNet: number;
  totalPnlGross: number;      // cumulative %
  totalPnlNet: number;
  sampleWindow: { firstTs: number; lastTs: number } | null;
}

// RUFLO NEXT FEE (2026-04-20) — audit fix: bumped 0.08 → 0.14 to match
// feeModel.ts FUTURES total (fee 0.08 + slippage 0.06). Prior value subestima
// fallback cost cu 0.06% pe pre-FAZA-B.2 battles → PF/WR net inflated în stats.
const FUTURES_FALLBACK_FEE = 0.14; // fee(0.08) + slippage(0.06) — matches feeModel.ts getFeeRoundTrip().total

/**
 * Convert one raw battle row (shape returned by getGladiatorBattles) to NetBattleView.
 * Safe against partial/missing marketContext; falls back to gross-minus-fee if net absent.
 */
export function toNetView(row: Record<string, unknown>): NetBattleView {
  const mc = (row.marketContext as Record<string, unknown> | undefined) || {};
  const pnlGross = typeof row.pnlPercent === 'number' ? row.pnlPercent : 0;
  const isWinGross = row.isWin === true;

  const netRaw = mc['pnlPercentNet'];
  const hasNetData = typeof netRaw === 'number';

  const pnlNet = hasNetData ? (netRaw as number) : parseFloat((pnlGross - FUTURES_FALLBACK_FEE).toFixed(4));
  const isWinNetMc = mc['isWinNet'];
  const isWinNet = typeof isWinNetMc === 'boolean' ? isWinNetMc : pnlNet > 0;

  return {
    pnlPercentGross: pnlGross,
    pnlPercentNet: pnlNet,
    isWinGross,
    isWinNet,
    hasNetData,
    symbol: typeof row.symbol === 'string' ? row.symbol : 'UNK',
    direction: typeof row.decision === 'string' ? row.decision.toUpperCase() : 'UNK',
    timestamp: typeof row.timestamp === 'number' ? row.timestamp : 0,
    battleId: typeof row.id === 'string' ? row.id : '',
    regime: typeof mc['regime'] === 'string' ? (mc['regime'] as string) : undefined,
  };
}

/**
 * Compute summary stats from a set of battle rows. Pure, O(n).
 * Returns safe defaults on empty input (totalTrades=0, PF=0, window=null).
 */
export function computeNetStats(battles: Record<string, unknown>[]): NetStatsSummary {
  const empty: NetStatsSummary = {
    totalTrades: 0,
    coverageNet: 0,
    winRateGross: 0,
    winRateNet: 0,
    profitFactorGross: 0,
    profitFactorNet: 0,
    avgPnlGross: 0,
    avgPnlNet: 0,
    totalPnlGross: 0,
    totalPnlNet: 0,
    sampleWindow: null,
  };
  if (!battles || battles.length === 0) return empty;

  let winsG = 0, winsN = 0;
  let sumWinG = 0, sumLossG = 0;
  let sumWinN = 0, sumLossN = 0;
  let sumG = 0, sumN = 0;
  let covered = 0;
  let firstTs = Number.POSITIVE_INFINITY;
  let lastTs = 0;

  for (const row of battles) {
    const v = toNetView(row);
    sumG += v.pnlPercentGross;
    sumN += v.pnlPercentNet;

    if (v.isWinGross) { winsG++; sumWinG += v.pnlPercentGross; }
    else              { sumLossG += v.pnlPercentGross; } // losses are negative → sumLossG ends up <=0

    if (v.isWinNet)   { winsN++; sumWinN += v.pnlPercentNet; }
    else              { sumLossN += v.pnlPercentNet; }

    if (v.hasNetData) covered++;
    if (v.timestamp > 0) {
      if (v.timestamp < firstTs) firstTs = v.timestamp;
      if (v.timestamp > lastTs) lastTs = v.timestamp;
    }
  }

  const n = battles.length;
  // PF convention: +Infinity when no losses and >0 wins; 0 when no wins.
  const pfGross = sumLossG < 0 ? sumWinG / Math.abs(sumLossG) : (sumWinG > 0 ? Number.POSITIVE_INFINITY : 0);
  const pfNet   = sumLossN < 0 ? sumWinN / Math.abs(sumLossN) : (sumWinN > 0 ? Number.POSITIVE_INFINITY : 0);

  return {
    totalTrades: n,
    coverageNet: parseFloat((covered / n).toFixed(4)),
    winRateGross: parseFloat(((winsG / n) * 100).toFixed(2)),
    winRateNet:   parseFloat(((winsN / n) * 100).toFixed(2)),
    profitFactorGross: Number.isFinite(pfGross) ? parseFloat(pfGross.toFixed(3)) : pfGross,
    profitFactorNet:   Number.isFinite(pfNet)   ? parseFloat(pfNet.toFixed(3))   : pfNet,
    avgPnlGross: parseFloat((sumG / n).toFixed(4)),
    avgPnlNet:   parseFloat((sumN / n).toFixed(4)),
    totalPnlGross: parseFloat(sumG.toFixed(4)),
    totalPnlNet:   parseFloat(sumN.toFixed(4)),
    sampleWindow: lastTs > 0 ? { firstTs: firstTs === Number.POSITIVE_INFINITY ? lastTs : firstTs, lastTs } : null,
  };
}

/**
 * Dedup cross-gladiator aggregate by (symbol|direction|timestamp-bucket).
 * Use ONLY for aggregate edge-strength queries (e.g., "how profitable is the SOL LONG 15m
 * signal regardless of who took it"). Default bucket = 30s — two battles on same
 * (symbol|direction) within 30s are almost certainly the same underlying signal
 * replicated across gladiators.
 *
 * NOT needed for per-gladiator stats (each gladiator already owns distinct rows).
 */
export function dedupViews(views: NetBattleView[], bucketMs = 30_000): NetBattleView[] {
  const seen = new Map<string, NetBattleView>();
  for (const v of views) {
    const bucket = Math.floor(v.timestamp / bucketMs);
    const key = `${v.symbol}|${v.direction}|${bucket}`;
    const prior = seen.get(key);
    if (!prior || v.timestamp < prior.timestamp) seen.set(key, v);
  }
  return Array.from(seen.values()).sort((a, b) => a.timestamp - b.timestamp);
}
