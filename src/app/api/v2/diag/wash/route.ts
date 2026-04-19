// ============================================================
// /api/v2/diag/wash — FAZA 3/5 Batch 3/4 (2026-04-20)
// Cross-Gladiator Wash Guard — calibration & telemetry endpoint.
//
// PURPOSE: expose distribution of (overlap, |corr|) across recent
// promotion candidates so thresholds can be tightened with data
// rather than guessed. Also exposes the shadow ring buffer of
// would-have-blocked entries for forensic review.
//
// PURE READ. No writes. No effect on promotion gate.
//
// Usage:
//   GET /api/v2/diag/wash                     → ring + summary
//   GET /api/v2/diag/wash?simulate=1
//        &overlap=0.6&corr=0.8                → re-score ring under new thresholds
//   GET /api/v2/diag/wash?live=1              → recompute against current pool (heavier)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { getCrossGladiatorWashScore } from '@/lib/store/db';
import { washShadowRingBuffer, washRingSnapshot, WASH_RING_SIZE } from '@/lib/v2/wash/washState';

export const dynamic = 'force-dynamic';

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}

function summarize(values: number[]): {
  n: number; min: number; p50: number; p90: number; p95: number; p99: number; max: number;
} {
  const s = values.slice().sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0] ?? 0,
    p50: percentile(s, 0.5),
    p90: percentile(s, 0.9),
    p95: percentile(s, 0.95),
    p99: percentile(s, 0.99),
    max: s[s.length - 1] ?? 0,
  };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const live = url.searchParams.get('live') === '1';
  const simulate = url.searchParams.get('simulate') === '1';
  const overlapThr = parseFloat(url.searchParams.get('overlap') || '0.70');
  const corrThr = parseFloat(url.searchParams.get('corr') || '0.85');

  const ring = washRingSnapshot();
  const overlapVals = ring.map((r) => r.overlap);
  const absCorrVals = ring.map((r) => Math.abs(r.corr));
  const failClosedCount = ring.filter((r) => r.washPeerId === '__fetch_error__').length;

  const summary = {
    ringSize: ring.length,
    ringCapacity: WASH_RING_SIZE,
    failClosedCount,
    overlap: summarize(overlapVals),
    absCorr: summarize(absCorrVals),
    blockedInShadow: ring.filter((r) => r.blocked).length,
  };

  const config = {
    mode: process.env.WASH_CROSS_GLADIATOR_ENABLED || 'shadow',
    maxOverlap: parseFloat(process.env.WASH_MAX_OVERLAP || '0.70'),
    pnlCorrThreshold: parseFloat(process.env.WASH_CORR_THRESHOLD || '0.85'),
    bucketMs: parseFloat(process.env.WASH_BUCKET_MS || '1800000'),
    lookbackTrades: parseFloat(process.env.WASH_LOOKBACK_TRADES || '200'),
    maxPeers: parseFloat(process.env.WASH_MAX_PEERS || '15'),
    minSharedTrades: parseFloat(process.env.WASH_MIN_SHARED_TRADES || '30'),
  };

  let simulation: { wouldBlockCount: number; thresholds: { overlap: number; corr: number } } | null = null;
  if (simulate && Number.isFinite(overlapThr) && Number.isFinite(corrThr)) {
    const wouldBlock = ring.filter(
      (r) => r.washPeerId === '__fetch_error__' || (r.overlap > overlapThr && Math.abs(r.corr) > corrThr)
    ).length;
    simulation = { wouldBlockCount: wouldBlock, thresholds: { overlap: overlapThr, corr: corrThr } };
  }

  type LiveScanRow = {
    id: string; name: string; isLive: boolean;
    overlap: number; corr: number; absCorr: number; peer: string | null; totalKeys: number;
  };
  let liveScan: LiveScanRow[] | null = null;
  if (live) {
    try {
      const all = gladiatorStore.getGladiators();
      const ids = all.map((g) => g.id);
      const out: LiveScanRow[] = [];
      for (const g of all) {
        const peers = ids.filter((p) => p !== g.id).slice(0, config.maxPeers);
        const w = await getCrossGladiatorWashScore(g.id, peers, {
          bucketMs: config.bucketMs,
          lookbackTrades: config.lookbackTrades,
          minSharedTrades: config.minSharedTrades,
        });
        out.push({
          id: g.id,
          name: g.name,
          isLive: !!g.isLive,
          overlap: w.maxOverlapRatio,
          corr: w.washPeerPnlCorr,
          absCorr: Math.abs(w.washPeerPnlCorr),
          peer: w.washPeerId,
          totalKeys: w.totalCandidateKeys,
        });
      }
      liveScan = out.sort((a, b) => (b.absCorr + b.overlap) - (a.absCorr + a.overlap));
    } catch (err) {
      liveScan = null;
      console.warn(`[diag/wash] live scan failed: ${(err as Error).message}`);
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    config,
    summary,
    simulation,
    liveScan,
    ring: ring.slice().reverse(), // newest first
  });
}
