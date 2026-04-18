// ============================================================
// /api/v2/diag/sentiment-flag — FAZA 3 Batch 3/9
// ============================================================
// Diagnostic endpoint for F&G × funding divergence classifier.
// Returns current F&G, funding rate, divergence kind, and multiplier
// previews for long/short signals.
// PURE SHADOW: no side effects, no decision impact, no writes.
//
// Usage:
//   GET /api/v2/diag/sentiment-flag?symbol=BTCUSDT
//   GET /api/v2/diag/sentiment-flag (defaults: BTCUSDT)
//
// Purpose: validate divergence classifier empirically for 24-48h BEFORE
// wiring into signal decision path (Batch 4). If divergence flags fire
// on sensible setups (e.g. PANIC_OFFSET on dumps where funding is flat),
// we graduate from shadow → active.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  computeSentimentDivergence,
  sentimentMultiplier,
  getSentimentFlagStats,
} from '@/lib/v2/scouts/ta/sentimentDivergence';
import { createLogger } from '@/lib/core/logger';

export const dynamic = 'force-dynamic';

const log = createLogger('DiagSentimentFlag');

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbolRaw = searchParams.get('symbol') || 'BTCUSDT';
    const symbol = symbolRaw.toUpperCase();

    const t0 = Date.now();
    const flag = await computeSentimentDivergence(symbol);
    const computeMs = Date.now() - t0;

    // Preview multiplier for both signal directions so operator can see
    // what the gate WOULD do in shadow vs active mode.
    const multPreview = {
      long: sentimentMultiplier(flag.divergence, 'long'),
      short: sentimentMultiplier(flag.divergence, 'short'),
    };

    return NextResponse.json({
      success: true,
      symbol,
      computeMs,
      flag,
      multiplierPreview: multPreview,
      stats: getSentimentFlagStats(),
    });
  } catch (err) {
    log.error('diag/sentiment-flag failed', { err: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
