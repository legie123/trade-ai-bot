/**
 * GET /api/health
 * Top-level health endpoint — redirects to /api/v2/health.
 * Exists because Cloud Scheduler and external monitors may ping this URL.
 */

import { NextResponse } from 'next/server';

const V2_HEALTH = '/api/v2/health';

export async function GET(request: Request) {
  // Forward to v2 health internally to avoid extra HTTP hop
  try {
    const url = new URL(request.url);
    const v2Url = `${url.origin}${V2_HEALTH}`;

    const resp = await fetch(v2Url, {
      headers: { ...Object.fromEntries(new Headers(request.headers).entries()) },
      signal: AbortSignal.timeout(8000),
    });

    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch {
    // If internal fetch fails, return minimal health
    return NextResponse.json({
      success: true,
      status: 'DEGRADED',
      message: 'Health proxy failed — v2/health unreachable internally',
      timestamp: new Date().toISOString(),
    }, { status: 206 });
  }
}
