// ============================================================
// /api/v2/diag/sizing-mult — FAZA 3 Batch 4/9
// ============================================================
// Diagnostic endpoint for the Sizing Multiplier Aggregator.
// Accepts inputs via query string OR body JSON and returns the
// aggregated multiplier + full breakdown + reasons.
// PURE SHADOW: no writes, no decision impact.
//
// Usage (GET, params as query):
//   /api/v2/diag/sizing-mult
//     ?regime=TREND&signalKind=trend
//     &divergence=PANIC_OFFSET&signalDir=long
//     &winRate=0.55&winLossRatio=1.3&sampleSize=50
//     &equityCurrent=9500&equityPeak=10000
//
// Missing fields → that factor defaults to 1.0. Helpful for operator
// sanity checks like "what would the gate do with WR=60, 1.5 WLR?".
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  computeSizingMultiplier,
  getSizingAggregatorConfig,
  AggregatorInput,
  KellyStats,
  EquitySnapshot,
} from '@/lib/v2/risk/sizingMultiplierAggregator';
import {
  RegimeKind,
  SignalKind,
} from '@/lib/v2/scouts/ta/adxRegime';
import {
  DivergenceKind,
  SignalDir,
} from '@/lib/v2/scouts/ta/sentimentDivergence';
import { createLogger } from '@/lib/core/logger';

export const dynamic = 'force-dynamic';

const log = createLogger('DiagSizingMult');

const REGIME_VALS = new Set(['TREND', 'MEAN_REV', 'TRANSITION', 'UNKNOWN']);
const SIGNAL_KIND_VALS = new Set(['trend', 'mean_rev', 'unknown']);
const DIVERGENCE_VALS = new Set(['PANIC_OFFSET', 'EUPHORIA_TRAP', 'NEUTRAL', 'UNKNOWN']);
const SIGNAL_DIR_VALS = new Set(['long', 'short', 'unknown']);

function parseNum(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

export async function GET(req: NextRequest) {
  try {
    const q = new URL(req.url).searchParams;

    const regimeRaw = q.get('regime');
    const signalKindRaw = q.get('signalKind');
    const divergenceRaw = q.get('divergence');
    const signalDirRaw = q.get('signalDir');

    const regime = regimeRaw && REGIME_VALS.has(regimeRaw) ? (regimeRaw as RegimeKind) : undefined;
    const signalKind = signalKindRaw && SIGNAL_KIND_VALS.has(signalKindRaw) ? (signalKindRaw as SignalKind) : undefined;
    const divergence = divergenceRaw && DIVERGENCE_VALS.has(divergenceRaw) ? (divergenceRaw as DivergenceKind) : undefined;
    const signalDir = signalDirRaw && SIGNAL_DIR_VALS.has(signalDirRaw) ? (signalDirRaw as SignalDir) : undefined;

    // Kelly stats
    const wr = parseNum(q.get('winRate'));
    const wlr = parseNum(q.get('winLossRatio'));
    const ss = parseNum(q.get('sampleSize'));
    let kellyStats: KellyStats | undefined;
    if (wr !== undefined && wlr !== undefined && ss !== undefined) {
      kellyStats = { winRate: wr, winLossRatio: wlr, sampleSize: ss };
    }

    // Equity
    const eCur = parseNum(q.get('equityCurrent'));
    const ePeak = parseNum(q.get('equityPeak'));
    let equity: EquitySnapshot | undefined;
    if (eCur !== undefined && ePeak !== undefined) {
      equity = { current: eCur, peak: ePeak };
    }

    const input: AggregatorInput = {
      regime,
      signalKind,
      divergence,
      signalDir,
      kellyStats,
      equity,
    };

    const t0 = Date.now();
    const result = computeSizingMultiplier(input);
    const computeMs = Date.now() - t0;

    return NextResponse.json({
      success: true,
      computeMs,
      input,
      result,
      config: getSizingAggregatorConfig(),
    });
  } catch (err) {
    log.error('diag/sizing-mult failed', { err: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
