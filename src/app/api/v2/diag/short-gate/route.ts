// ============================================================
// /api/v2/diag/short-gate — FAZA 7c (2026-04-20)
// ============================================================
// Diagnostic endpoint for the SHORT LIVE conditional gate.
// Returns current config, computed session, and decision preview
// for a given symbol+timestamp. Pure read-only; no side effects.
//
// Usage:
//   GET /api/v2/diag/short-gate                       → config + now()
//   GET /api/v2/diag/short-gate?symbol=SOLUSDT        → preview for symbol
//   GET /api/v2/diag/short-gate?symbol=PYTH&ts=NNN    → preview at custom ts
//
// Purpose: verify env wiring + session bucketing without waiting for a
// live SHORT decision to prove the gate is active. Pair with
// /api/metrics (tradeai_short_live_gate_*) for ledger.
//
// Kill-switches visible in payload so operator can confirm state:
//   SHORT_LIVE_GATE_ENABLED, SHORT_LIVE_GATE_SHADOW,
//   SHORT_LIVE_ALLOWED_SESSIONS, SHORT_LIVE_ALLOWED_SYMBOLS.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionUTC,
  readShortGateConfig,
  shouldAdmitShortLive,
} from '@/lib/v2/arena/directionGate';
import { createLogger } from '@/lib/core/logger';

export const dynamic = 'force-dynamic';

const log = createLogger('DiagShortGate');

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get('symbol') || '').toUpperCase() || undefined;
    const tsRaw = searchParams.get('ts');
    const ts = tsRaw ? Number(tsRaw) : Date.now();
    if (!Number.isFinite(ts)) {
      return NextResponse.json({ success: false, error: 'ts must be a number (ms epoch)' }, { status: 400 });
    }

    const cfg = readShortGateConfig();
    const session = getSessionUTC(ts);
    // Preview decision (no metric side-effect because no inc() triggers when gate_off
    // and counters only grow when gate is enabled — probing while disabled is safe).
    const preview = shouldAdmitShortLive(symbol, ts, cfg);

    return NextResponse.json({
      success: true,
      now: new Date(ts).toISOString(),
      session,
      config: {
        enabled: cfg.enabled,
        shadow: cfg.shadow,
        allowedSessions: cfg.allowedSessions,
        allowedSymbols: cfg.allowedSymbols,
      },
      preview: {
        symbol: preview.symbol,
        admit: preview.admit,
        reason: preview.reason,
      },
      env: {
        SHORT_LIVE_GATE_ENABLED: process.env.SHORT_LIVE_GATE_ENABLED ?? null,
        SHORT_LIVE_GATE_SHADOW: process.env.SHORT_LIVE_GATE_SHADOW ?? null,
        SHORT_LIVE_ALLOWED_SESSIONS: process.env.SHORT_LIVE_ALLOWED_SESSIONS ?? null,
        SHORT_LIVE_ALLOWED_SYMBOLS: process.env.SHORT_LIVE_ALLOWED_SYMBOLS ?? null,
      },
    });
  } catch (err) {
    log.error('diag/short-gate failed', { err: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
