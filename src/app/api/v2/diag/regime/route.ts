// ============================================================
// /api/v2/diag/regime — FAZA 3 Batch 2/9
// ============================================================
// Diagnostic endpoint for ADX regime classifier.
// Returns current regime + ADX + +DI/-DI for a symbol.
// PURE SHADOW: no side effects, no decision impact, no writes.
//
// Usage:
//   GET /api/v2/diag/regime?symbol=BTCUSDT&interval=1h
//   GET /api/v2/diag/regime (defaults: BTCUSDT, 1h)
//
// Purpose: validate regime classifier empirically for 24-48h BEFORE wiring
// into signal decision path (Batch 3). If regime stays in sensible bands
// across majors + alts, we graduate from shadow → active.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { computeRegime, getRegimeCacheStats, getRegimeMode, OHLC } from '@/lib/v2/scouts/ta/adxRegime';
import { createLogger } from '@/lib/core/logger';

export const dynamic = 'force-dynamic';

const log = createLogger('DiagRegime');

// Fetch klines from MEXC public API (no auth needed).
// Match pattern used in btcEngine.ts.
async function fetchMexcKlines(symbol: string, interval: string, limit = 250): Promise<OHLC[]> {
  const mexcInterval = interval === '1h' ? '60m' : interval;
  const url = `https://api.mexc.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${mexcInterval}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`MEXC klines HTTP ${res.status}`);
  const klines = await res.json();
  if (!Array.isArray(klines)) throw new Error('MEXC klines invalid response');
  return klines.map((k: [number, string, string, string, string]) => ({
    t: k[0],
    h: parseFloat(k[2]),
    l: parseFloat(k[3]),
    c: parseFloat(k[4]),
  }));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbolRaw = searchParams.get('symbol') || 'BTCUSDT';
    const interval = searchParams.get('interval') || '1h';
    const symbol = symbolRaw.toUpperCase();

    // Whitelist intervals we actually use in the pipeline
    const ALLOWED_INTERVALS = ['15m', '1h', '4h', '1d'];
    if (!ALLOWED_INTERVALS.includes(interval)) {
      return NextResponse.json({ success: false, error: `interval must be one of ${ALLOWED_INTERVALS.join(',')}` }, { status: 400 });
    }

    const t0 = Date.now();
    let candles: OHLC[] = [];
    try {
      candles = await fetchMexcKlines(symbol, interval);
    } catch (err) {
      log.warn('kline fetch failed', { symbol, interval, err: err instanceof Error ? err.message : String(err) });
      return NextResponse.json({
        success: false,
        symbol,
        interval,
        error: 'kline_fetch_failed',
        detail: err instanceof Error ? err.message : String(err),
      }, { status: 502 });
    }

    const regime = await computeRegime(symbol, candles);
    const fetchMs = Date.now() - t0;

    return NextResponse.json({
      success: true,
      mode: getRegimeMode(),
      symbol,
      interval,
      candles: candles.length,
      fetchMs,
      regime,
      cache: getRegimeCacheStats(),
    });
  } catch (err) {
    log.error('diag/regime failed', { err: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
