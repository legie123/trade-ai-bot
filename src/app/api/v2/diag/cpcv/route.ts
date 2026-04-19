// ============================================================
// /api/v2/diag/cpcv — FAZA 3 Batch 6/9 (CPCV + embargo)
// ============================================================
// Diagnostic endpoint to compare baseline expanding-window WF
// (walkForwardEngine.ts) vs the same engine WITH purge + embargo
// applied (cpcv.ts). Same gladiator, same trades, same fold count.
//
// PURPOSE: expose the divergence between unguarded WF (current
// production validator) and CPCV. If divergence is large
// (overfitScoreDelta > +0.2 or verdict flips), the unguarded WF is
// hiding label leakage / serial correlation — that means the
// promotion gate that uses WF is letting overfitted gladiators
// through.
//
// PURE READ. No writes. No effect on Butcher / promotion gate yet.
// Promotion of CPCV from shadow → active is a separate decision
// (Batch 6 ships ONLY observability).
//
// Usage:
//   GET /api/v2/diag/cpcv?gladiatorId=g_abc                    → single
//   GET /api/v2/diag/cpcv?all=1                                → all alive
//   GET /api/v2/diag/cpcv?gladiatorId=g_abc&folds=5
//        &labelSpanMs=900000&embargoMs=60000                   → tuned
//
// Defaults: folds=5, labelSpanMs=14400000 (4h, worst-case horizon),
// embargoMs = 0.5% of trade-history span.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { WalkForwardEngine } from '@/lib/v2/validation/walkForwardEngine';
import {
  runCpcvValidate,
  getCpcvConfig,
  type CpcvResult,
} from '@/lib/v2/validation/cpcv';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { createLogger } from '@/lib/core/logger';

export const dynamic = 'force-dynamic';

const log = createLogger('DiagCpcv');

// ─── Divergence helpers ─────────────────────────────────────

interface DivergenceRow {
  gladiatorId: string;
  baselineFolds: number;
  cpcvFolds: number;
  baselineVerdict: string;
  cpcvVerdict: CpcvResult['verdict'];
  overfitScoreBaseline: number;
  overfitScoreCpcv: number;
  overfitScoreDelta: number; // cpcv - baseline (positive = CPCV exposes more overfit)
  oosWinRateDelta: number;   // cpcv - baseline
  oosAvgPnlDelta: number;    // cpcv - baseline
  oosSharpeDelta: number;
  purgedFromTrain: number;
  embargoedTrades: number;
  cpcvSkipped?: string;
  baselineSkipped?: string;
  totalTrades: number;
  computeMs: number;
}

async function evaluateOne(
  gladiatorId: string,
  opts: { folds?: number; labelSpanMs?: number; embargoMs?: number },
): Promise<DivergenceRow> {
  const t0 = Date.now();
  // Run sequentially — both hit getGladiatorBattles, parallelizing
  // doubles DB load for no latency gain on warm cache.
  const baseline = await WalkForwardEngine.getInstance().validate(
    gladiatorId,
    opts.folds ?? 5,
  );
  const cpcv = await runCpcvValidate(gladiatorId, opts);

  // Baseline emits empty result with folds=0 when MIN_TRADES not met.
  // We translate that into a skip reason for symmetry with cpcv.
  const baselineSkipped =
    baseline.foldResults.length === 0
      ? `n=${baseline.totalTrades}<MIN`
      : undefined;

  return {
    gladiatorId,
    baselineFolds: baseline.foldResults.length,
    cpcvFolds: cpcv.foldResults.length,
    baselineVerdict: baseline.verdict,
    cpcvVerdict: cpcv.verdict,
    overfitScoreBaseline: baseline.overfitScore,
    overfitScoreCpcv: cpcv.overfitScore,
    overfitScoreDelta: parseFloat(
      (cpcv.overfitScore - baseline.overfitScore).toFixed(3),
    ),
    oosWinRateDelta: parseFloat(
      (cpcv.aggregateOOS.winRate - baseline.aggregateOOS.winRate).toFixed(4),
    ),
    oosAvgPnlDelta: parseFloat(
      (cpcv.aggregateOOS.avgPnl - baseline.aggregateOOS.avgPnl).toFixed(4),
    ),
    oosSharpeDelta: parseFloat(
      (cpcv.aggregateOOS.sharpe - baseline.aggregateOOS.sharpe).toFixed(3),
    ),
    purgedFromTrain: cpcv.totalPurgedFromTrain,
    embargoedTrades: cpcv.totalEmbargoedTrades,
    cpcvSkipped: cpcv.skippedReason,
    baselineSkipped,
    totalTrades: cpcv.totalTrades,
    computeMs: Date.now() - t0,
  };
}

// Aggregate divergence across multiple gladiators. We focus on:
//   - how often CPCV flips verdict CLEAN→SUSPECT/OVERFIT (= label leakage hit)
//   - average overfitScoreDelta (positive = CPCV exposes hidden overfit)
//   - count of "destroyed" CPCV runs (= signal that WF was running on
//     too-correlated trades — its IS/OOS split was meaningless)
function aggregate(rows: DivergenceRow[]) {
  const considered = rows.filter((r) => !r.cpcvSkipped && !r.baselineSkipped);
  const flipsToWorse = considered.filter(
    (r) =>
      (r.baselineVerdict === 'CLEAN' && r.cpcvVerdict !== 'CLEAN') ||
      (r.baselineVerdict === 'SUSPECT' && r.cpcvVerdict === 'OVERFIT'),
  );
  const avgDelta =
    considered.length > 0
      ? considered.reduce((s, r) => s + r.overfitScoreDelta, 0) /
        considered.length
      : 0;
  const totalPurged = rows.reduce((s, r) => s + r.purgedFromTrain, 0);
  const totalEmbargoed = rows.reduce((s, r) => s + r.embargoedTrades, 0);
  return {
    evaluated: rows.length,
    considered: considered.length,
    cpcvSkipped: rows.length - considered.length,
    flipsToWorseCount: flipsToWorse.length,
    flipsToWorseIds: flipsToWorse.map((r) => r.gladiatorId),
    avgOverfitScoreDelta: parseFloat(avgDelta.toFixed(3)),
    totalPurgedFromTrain: totalPurged,
    totalEmbargoedTrades: totalEmbargoed,
  };
}

// ─── HTTP handler ───────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const q = new URL(req.url).searchParams;
    const all = q.get('all') === '1';
    const gladiatorIdParam = q.get('gladiatorId');

    const folds = q.get('folds') ? parseInt(q.get('folds')!, 10) : undefined;
    const labelSpanMs = q.get('labelSpanMs')
      ? parseInt(q.get('labelSpanMs')!, 10)
      : undefined;
    const embargoMs = q.get('embargoMs')
      ? parseInt(q.get('embargoMs')!, 10)
      : undefined;
    const opts = { folds, labelSpanMs, embargoMs };

    const config = getCpcvConfig();

    if (!all && !gladiatorIdParam) {
      return NextResponse.json(
        {
          success: false,
          error: 'specify ?gladiatorId=X or ?all=1',
          config,
        },
        { status: 400 },
      );
    }

    const t0 = Date.now();

    if (all) {
      // Iterate alive non-omega gladiators. Omega is immune to butcher
      // and its stats are special — exclude from validator audit too.
      const alive = gladiatorStore
        .getGladiators()
        .filter((g) => !g.isOmega);
      // Cap to avoid runaway compute on a large pool. Each gladiator does
      // 2 sequential passes over up to 5000 battles + bootstrap. 25 is a
      // safe upper bound for current pool sizes; tune if pool grows.
      const SAFETY_CAP = 25;
      const subset = alive.slice(0, SAFETY_CAP);
      const rows: DivergenceRow[] = [];
      for (const g of subset) {
        try {
          rows.push(await evaluateOne(g.id, opts));
        } catch (err) {
          log.warn(`[diag/cpcv] evaluate ${g.id} failed`, {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const agg = aggregate(rows);
      return NextResponse.json({
        success: true,
        mode: 'all',
        config,
        truncated: alive.length > subset.length,
        truncatedFrom: alive.length,
        evaluatedCount: subset.length,
        aggregate: agg,
        rows,
        // Interpretation: avgOverfitScoreDelta > 0.2 OR flipsToWorseCount/considered > 0.3
        // means baseline WF was systematically under-detecting overfit.
        interpretation: {
          significant:
            Math.abs(agg.avgOverfitScoreDelta) > 0.2 ||
            (agg.considered > 0 &&
              agg.flipsToWorseCount / agg.considered > 0.3),
          note:
            agg.considered === 0
              ? 'No gladiator had enough trades for both validators.'
              : 'Positive avgOverfitScoreDelta = CPCV detected more overfit than WF. flipsToWorseIds = gladiators that promotion gate would have falsely cleared.',
        },
        computeMs: Date.now() - t0,
      });
    }

    // Single gladiator path
    const row = await evaluateOne(gladiatorIdParam!, opts);
    return NextResponse.json({
      success: true,
      mode: 'single',
      config,
      gladiatorId: gladiatorIdParam,
      row,
      computeMs: Date.now() - t0,
    });
  } catch (err) {
    log.error('diag/cpcv failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
