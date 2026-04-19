/**
 * POST /api/polymarket/ingest — Goldsky Mirror webhook receiver (Polymarket data)
 *
 * FAZA 3.1 PROMOTION 2026-04-20: LOG-ONLY → WRITE-THROUGH to polymarket_events.
 * Previous LOG-ONLY contract stays intact as a fallback: if the write path is
 * disabled or fails, endpoint STILL returns 2xx so Goldsky doesn't retry forever.
 *
 * DATA FLOW
 *   Goldsky pipeline → POST → auth/rate/size checks → insertGoldskyEvent()
 *   → polymarket_events (append-only) → queryable via /api/v2/polymarket/events/query
 *   → FAZA 3.3 correlation layer consumes unprocessed rows.
 *
 * AUTH MODEL: Goldsky webhook sinks use a single custom header (configured via
 *   `goldsky secret create` type=httpauth). They do NOT sign payloads with HMAC.
 *   We require header `x-trade-auth` == POLYMARKET_WEBHOOK_SECRET. Missing/wrong → 401.
 *
 * KILL-SWITCHES (in env):
 *   POLYMARKET_INGEST_ENABLED=0          → 503, endpoint dark (blocks Goldsky entirely)
 *   POLYMARKET_INGEST_WRITE_ENABLED=0    → write-through off, LOG-ONLY fallback (safe degrade)
 *   POLYMARKET_WEBHOOK_SECRET unset      → 503 (refuses to accept anything)
 *
 * RATE LIMIT: per-instance token bucket, 100 req/min. Cloud Run multi-instance means
 *   effective = 100 × N instances. Goldsky retries with exponential backoff on 429,
 *   so transient rate-limit is safe. Tight bound prevents log flooding.
 *
 * PAYLOAD BOUND: 1 MiB hard cap. Over → 413.
 *
 * ASSUMPTIONS (invalidate = disable endpoint):
 *   (1) Goldsky at-least-once delivery + retry forever on non-2xx → endpoint must NEVER 500
 *       on happy path; 2xx always when body is syntactically valid.
 *   (2) Write-through is best-effort: DB errors soft-fail (inserted=0 skipped=N).
 *   (3) Goldsky region aws us-west-2 ↔ Cloud Run europe-west1 → p95 ~140ms > 100ms
 *       recommended. Acceptable for Discovery; NOT acceptable for any live-trading path.
 *   (4) Insert is WRITE-ONLY, never UPDATE. Deduplication (if needed) happens at query
 *       layer, not at ingest — keeps ingest path single-purpose.
 *
 * KILL PROCEDURE IF GOES WRONG:
 *   1a. Write-flood: gcloud run services update trade-ai --update-env-vars POLYMARKET_INGEST_WRITE_ENABLED=0
 *   1b. Full shutoff: POLYMARKET_INGEST_ENABLED=0
 *   2. In Goldsky UI → disable/delete pipeline (stops retries)
 *   3. (optional) rotate POLYMARKET_WEBHOOK_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createLogger } from '@/lib/core/logger';
import { insertGoldskyEvent } from '@/lib/polymarket/eventsStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('PolymarketIngest');

// Per-instance sliding window. Not cross-instance; acceptable for MVP.
const rateWindow: number[] = [];
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 100;
const MAX_BODY_BYTES = 1_048_576; // 1 MiB

function rateCheck(): boolean {
  const now = Date.now();
  while (rateWindow.length > 0 && rateWindow[0]! < now - RATE_WINDOW_MS) {
    rateWindow.shift();
  }
  if (rateWindow.length >= RATE_MAX) return false;
  rateWindow.push(now);
  return true;
}

export async function POST(req: NextRequest) {
  // 1. Kill-switch
  if (process.env.POLYMARKET_INGEST_ENABLED === '0') {
    return NextResponse.json({ ok: false, reason: 'ingest_disabled' }, { status: 503 });
  }

  // 2. Server sanity
  const expected = process.env.POLYMARKET_WEBHOOK_SECRET;
  if (!expected) {
    log.error('POLYMARKET_WEBHOOK_SECRET not configured — refusing all traffic');
    return NextResponse.json({ ok: false, reason: 'server_misconfigured' }, { status: 503 });
  }

  // 3. Auth (constant-time compare via Buffer)
  const provided = req.headers.get('x-trade-auth') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const authOk = a.length === b.length && timingSafeEqual(a, b);
  if (!authOk) {
    log.warn('auth failed', { providedLen: provided.length });
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  // 4. Rate limit (after auth so spammers don't flood)
  if (!rateCheck()) {
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 429 });
  }

  // 5. Parse body (bounded)
  let payload: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, reason: 'payload_too_large' }, { status: 413 });
    }
    payload = JSON.parse(text);
  } catch (e) {
    log.warn('bad json', { err: (e as Error).message });
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 });
  }

  // 6. Log + write-through. Best-effort: DB failure → soft-fail, NOT 500.
  const isArray = Array.isArray(payload);
  const count = isArray ? (payload as unknown[]).length : 1;
  const sampleStr = JSON.stringify(isArray ? (payload as unknown[])[0] : payload).slice(0, 600);

  // Pipeline name: Goldsky can forward it via header; fall back to a generic.
  // Asumptie: un singur endpoint serveste N pipelines, dar fiecare pipeline
  // trimite un header identificator. Invalidare → pipeline_name = "unknown"
  // si health-ul per-pipeline e degradat (nu fatal).
  const pipelineName = req.headers.get('x-goldsky-pipeline') || req.headers.get('x-pipeline-name') || 'polymarket-default';

  let writeResult: { inserted: number; skipped: number; reason?: string } = { inserted: 0, skipped: 0 };
  try {
    writeResult = await insertGoldskyEvent(pipelineName, payload);
  } catch (e) {
    // insertGoldskyEvent catches internally; this is belt-and-suspenders
    log.warn('ingest write threw', { err: (e as Error).message });
  }

  log.info('ingest', {
    count,
    inserted: writeResult.inserted,
    skipped: writeResult.skipped,
    reason: writeResult.reason,
    pipeline: pipelineName,
    sample: sampleStr,
  });

  // 7. Always 2xx on valid input → Goldsky won't retry
  return NextResponse.json({
    ok: true,
    received: count,
    inserted: writeResult.inserted,
    skipped: writeResult.skipped,
  }, { status: 200 });
}

// Health / status probe (no auth required)
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'polymarket-ingest',
    enabled: process.env.POLYMARKET_INGEST_ENABLED !== '0',
    auth_configured: !!process.env.POLYMARKET_WEBHOOK_SECRET,
    mode: 'log-only',
    ts: new Date().toISOString(),
  });
}
