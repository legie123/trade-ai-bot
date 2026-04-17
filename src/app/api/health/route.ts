/**
 * GET /api/health
 * Top-level health endpoint — proxy to /api/v2/health.
 * Exists because Cloud Scheduler and external monitors may ping this URL.
 *
 * FIX 2026-04-18: Eliminat forward-ul de headere din request (cauza "Health proxy failed").
 * Cloud Run self-fetch pica dacă propagăm headerele externe (host corupt, cookie auth etc).
 * v2/health e public (in PUBLIC_PREFIXES din middleware), deci nu are nevoie de auth forward.
 */

import { NextResponse } from 'next/server';

const V2_HEALTH = '/api/v2/health';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const v2Url = `${url.origin}${V2_HEALTH}`;

    // FIX 2026-04-18: Self-fetch minimal — fara headere propagate.
    const resp = await fetch(v2Url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000), // 10s pentru warm-up Cloud Run
    });

    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    // Fallback daca self-fetch esueaza — trimitem 206 cu motivul real
    return NextResponse.json({
      success: true,
      status: 'DEGRADED',
      message: `Health proxy failed: ${(err as Error).message || 'unknown'}`,
      timestamp: new Date().toISOString(),
    }, { status: 206 });
  }
}
