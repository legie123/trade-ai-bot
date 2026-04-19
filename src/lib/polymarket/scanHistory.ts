/**
 * scanHistory.ts — audit trail writer for Polymarket cron scan runs.
 *
 * FAZA 3.4. Best-effort: scan DOES NOT BLOCK on logging — a DB outage
 * must not take down the scanner. All writers soft-fail to log.warn.
 *
 * Life-cycle:
 *   const { runId } = await startScanRun();
 *   // ... run the scan, log decisions linked by runId ...
 *   await finishScanRun(runId, { divisionsScanned, opportunitiesFound, betsPlaced, decisionsLogged, errors, envSnapshot });
 *
 * Both halves are soft. If startScanRun fails, decisions for that run
 * simply have run_id=null — still visible via market/decision query.
 */
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyScanHistory');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supa = (SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('placeholder'))
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

function uuid(): string {
  const r = () => Math.floor(Math.random() * 16).toString(16);
  let s = '';
  for (let i = 0; i < 32; i++) s += r();
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

export interface StartScanRunResult {
  runId: string;
  startedAt: string;
  persisted: boolean;
}

export async function startScanRun(envSnapshot?: Record<string, unknown>): Promise<StartScanRunResult> {
  const runId = uuid();
  const startedAt = new Date().toISOString();
  if (!supa) return { runId, startedAt, persisted: false };
  try {
    const { error } = await supa.from('polymarket_scan_history').insert({
      run_id: runId,
      started_at: startedAt,
      env_snapshot: envSnapshot ?? null,
      correlation_disabled: process.env.POLYMARKET_CORRELATION_ENABLED === '0',
    });
    if (error) {
      log.warn('startScanRun insert failed', { error: error.message });
      return { runId, startedAt, persisted: false };
    }
    return { runId, startedAt, persisted: true };
  } catch (err) {
    log.warn('startScanRun threw', { error: String(err) });
    return { runId, startedAt, persisted: false };
  }
}

export interface FinishScanRunInput {
  divisionsScanned: string[];
  opportunitiesFound: number;
  betsPlaced: number;
  decisionsLogged: number;
  errors?: Array<{ division: string; error: string }>;
  envSnapshot?: Record<string, unknown>;
}

export async function finishScanRun(runId: string, startedAtIso: string, input: FinishScanRunInput): Promise<{ persisted: boolean }> {
  if (!supa) return { persisted: false };
  const finishedAtIso = new Date().toISOString();
  const duration = new Date(finishedAtIso).getTime() - new Date(startedAtIso).getTime();
  try {
    const { error } = await supa.from('polymarket_scan_history').update({
      finished_at: finishedAtIso,
      duration_ms: duration,
      divisions_scanned: input.divisionsScanned,
      opportunities_found: input.opportunitiesFound,
      bets_placed: input.betsPlaced,
      decisions_logged: input.decisionsLogged,
      errors: input.errors && input.errors.length ? input.errors : null,
      env_snapshot: input.envSnapshot ?? null,
    }).eq('run_id', runId);
    if (error) {
      log.warn('finishScanRun update failed', { error: error.message });
      return { persisted: false };
    }
    return { persisted: true };
  } catch (err) {
    log.warn('finishScanRun threw', { error: String(err) });
    return { persisted: false };
  }
}

export async function getScanRun(runId: string): Promise<{ run: unknown; decisions: unknown[] } | null> {
  if (!supa) return null;
  try {
    const [runRes, decRes] = await Promise.all([
      supa.from('polymarket_scan_history').select('*').eq('run_id', runId).maybeSingle(),
      supa.from('polymarket_decisions').select('*').eq('run_id', runId).order('decided_at', { ascending: true }),
    ]);
    if (runRes.error || !runRes.data) return null;
    return { run: runRes.data, decisions: decRes.data ?? [] };
  } catch (err) {
    log.warn('getScanRun threw', { error: String(err) });
    return null;
  }
}

export async function listRecentScans(limit = 50): Promise<unknown[]> {
  if (!supa) return [];
  try {
    const { data, error } = await supa
      .from('polymarket_scan_history')
      .select('run_id, started_at, finished_at, duration_ms, divisions_scanned, opportunities_found, bets_placed, decisions_logged, correlation_disabled')
      .order('started_at', { ascending: false })
      .limit(Math.min(limit, 200));
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}
