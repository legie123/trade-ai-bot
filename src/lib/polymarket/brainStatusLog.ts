/**
 * Batch 3.18 — Brain Status snapshot log (fire-and-forget persister).
 *
 * Writes every fresh getBrainStatus() rollup to
 * `polymarket_brain_status_log` for post-hoc regression + audit.
 * Cache-hit returns are NOT persisted — only cache-miss computes
 * (once per BRAIN_STATUS_CACHE_MS; ≈30s by default).
 *
 * Hard constraints:
 *  - SILENT on failure. INSERT errors MUST NOT surface to caller
 *    or crash the brain-status probe. Telemetry only.
 *  - Gated by env BRAIN_STATUS_LOG_ENABLED. Default 'off' at first
 *    deploy so a missing migration doesn't spam error logs. Operator
 *    flips to 'on' after applying migration 20260420_polymarket_brain_status_log.sql.
 *  - No retention logic here. Let pg_cron (or ops) handle pruning.
 *
 * Kill-switch:
 *   BRAIN_STATUS_LOG_ENABLED=1  → persist (after migration applied)
 *   BRAIN_STATUS_LOG_ENABLED=0  → skip (default)
 */
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/core/logger';
import type { BrainStatus, BrainSignal } from './brainStatus';

const log = createLogger('BrainStatusLog');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

const supa =
  SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('placeholder')
    ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
    : null;

function pickVerdict(signals: BrainSignal[], source: BrainSignal['source']): string {
  const s = signals.find((x) => x.source === source);
  return s ? s.verdict : 'unknown';
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

/**
 * Fire-and-forget. Never throws. Caller gets no confirmation; any
 * error surfaces as a single WARN log line (rate-limited by log infra).
 */
export function logBrainStatusSnapshot(status: BrainStatus): void {
  // Kill-switch: default OFF until operator flips after migration apply.
  if ((process.env.BRAIN_STATUS_LOG_ENABLED ?? '0') === '0') return;
  if (!supa) return;
  if (!status.enabled) return;         // don't log disabled brain
  if (status.cacheHit) return;         // only fresh computes

  const ts = Date.now();
  const row = {
    id: `${ts}-${randomSuffix()}`,
    ts,
    verdict: status.verdict,
    edge_verdict: pickVerdict(status.signals, 'edge'),
    settlement_verdict: pickVerdict(status.signals, 'settlement'),
    feed_verdict: pickVerdict(status.signals, 'feed'),
    ops_verdict: pickVerdict(status.signals, 'ops'),
    top_reasons: status.topReasons ?? [],
    signals: status.signals,
    cache_hit: status.cacheHit,
  };

  // Fire and forget. Swallow errors to keep the probe non-blocking.
  void supa
    .from('polymarket_brain_status_log')
    .insert(row)
    .then((res: { error: { message: string; code?: string } | null }) => {
      if (res.error) {
        log.warn(
          `snapshot insert failed: ${res.error.message}${res.error.code ? ` (code ${res.error.code})` : ''}`,
        );
      }
    })
    .catch?.((e: unknown) => {
      log.warn(`snapshot insert exception: ${(e as Error).message}`);
    });
}
