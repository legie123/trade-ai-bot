// ============================================================
// Pas 5 — Multi-LLM Consensus Audit Persist (FAZA 3 Batch 9/9)
// ============================================================
// PROBLEM:
//   runConsensus() writes telemetry only to in-memory counters (reset
//   at cold start) and Prometheus (no row-level replay). To correlate
//   divergenceFromPrimary against post-hoc loss clusters we need
//   durable, queryable per-vote history.
//
// FIX (append-only, fire-and-forget):
//   Persist each EXECUTED consensus run (bypass=false OR validVotes<2)
//   to supabase table `llm_consensus_audit`. Migration 20260420.
//
// SAFETY:
//   - Kill-switch LLM_CONSENSUS_PERSIST_ENABLED (default 'off' at first
//     deploy; operator flips 'on' after validating one successful
//     INSERT). Prevents RLS denial from flooding logs on cold start.
//   - Fail-soft: caller uses `void persistConsensusAudit(...).catch(() => {})`
//     — any exception is swallowed. Decision path NEVER blocked.
//   - bypass rows (mode_off/sample/rate/budget) are skipped at source
//     (shouldPersist checks bypassReason). Only rows where providers
//     actually executed are stored. Saves DB rows + cost.
//
// ASSUMPTIONS (if violated → persistence degrades; core path unchanged):
//   A. Table llm_consensus_audit exists per migration 20260420.
//      If missing → INSERT returns 42P01 "relation does not exist";
//      we log a single warn per cold-start and continue.
//   B. SUPABASE_SERVICE_ROLE_KEY (or anon w/ RLS allowing insert) is
//      set in Cloud Run env. If missing → CONFIGURED=false; no-op.
//   C. ProviderVote JSON shape is stable. Downstream analytics query
//      JSONB paths like votes->0->>'provider'. Schema change here
//      = update analytics SQL.
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/core/logger';
import type { ConsensusInput, ConsensusResult } from './multiLlmConsensus';

const log = createLogger('ConsensusAudit');

// ------------------------------------------------------------
// Config
// ------------------------------------------------------------

export type PersistMode = 'off' | 'on';

export function getPersistMode(): PersistMode {
  // Default 'off' — operator must explicitly flip ON after validating schema.
  const raw = (process.env.LLM_CONSENSUS_PERSIST_ENABLED || 'off').toLowerCase();
  return raw === 'on' ? 'on' : 'off';
}

// Reuse db env convention (same as graveyard.ts). Intentionally NOT
// importing from db.ts to avoid circular + side-effect init penalty.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const CONFIGURED = !!(supabaseUrl && supabaseKey && !supabaseUrl.includes('placeholder'));

let _client: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (!CONFIGURED) return null;
  if (!_client) _client = createClient(supabaseUrl, supabaseKey);
  return _client;
}

// Log the "missing table" warning AT MOST ONCE per cold start so
// migration lag doesn't spam. Reset naturally on new container boot.
let _missingTableWarned = false;

// ------------------------------------------------------------
// Decision whether to persist this particular run
// ------------------------------------------------------------

/**
 * Filter: only persist runs where providers were actually invoked.
 *
 * - bypass=true with reason in {mode_off,sample_out_of_range,rate_limit,budget_hit}
 *   → skip (no providers ran, nothing interesting to audit).
 * - bypass=true with reason='all_providers_down'
 *   → PERSIST. validVotes<2 is diagnostically important (reveals key
 *     rotation / billing / network issues). votes[] contains error detail.
 * - bypass=false
 *   → PERSIST. This is the primary research dataset.
 */
function shouldPersist(result: ConsensusResult): boolean {
  if (!result.bypass) return true;
  return result.bypassReason === 'all_providers_down';
}

// ------------------------------------------------------------
// Insert row
// ------------------------------------------------------------

interface PersistOpts {
  decisionAuditId?: string | null;
}

export async function persistConsensusAudit(
  input: ConsensusInput,
  result: ConsensusResult,
  opts: PersistOpts = {},
): Promise<void> {
  // Kill-switch hard gate.
  if (getPersistMode() === 'off') return;

  // Filter: skip bypass rows where providers didn't run.
  if (!shouldPersist(result)) return;

  const client = db();
  if (!client) return;

  const ts = Date.now();
  // Deterministic-ish id. Collision probability with 4-hex random + per-ms
  // bucket is negligible at our volume (~1 call/min peak).
  const id = `consensus_${ts}_${input.symbol}_${Math.random().toString(16).slice(2, 6)}`;

  const row = {
    id,
    ts,
    symbol: input.symbol,
    proposed_direction: input.proposedDirection,
    primary_confidence: input.primaryConfidence,
    regime: input.regime ?? null,
    indicators: input.indicators ?? {},
    mode: result.mode,
    vote: result.vote,
    score: result.score,
    agreement_ratio: result.agreementRatio,
    valid_votes: result.validVotes,
    diverges_from_primary: result.divergesFromPrimary,
    votes: result.votes,
    total_latency_ms: result.totalLatencyMs,
    total_cost_usd: result.totalCostUsd,
    prompt_version: result.promptVersion,
    decision_audit_id: opts.decisionAuditId ?? null,
  };

  try {
    const { error } = await client.from('llm_consensus_audit').insert(row);
    if (error) {
      // 42P01 = undefined_table (Postgres). Log once and swallow after.
      const code = (error as { code?: string }).code;
      if (code === '42P01' || /relation .* does not exist/i.test(error.message)) {
        if (!_missingTableWarned) {
          _missingTableWarned = true;
          log.warn(
            '[ConsensusAudit] Table llm_consensus_audit not found. ' +
            'Apply migration supabase/migrations/20260420_llm_consensus_audit.sql. ' +
            'Suppressing further warnings this process.',
          );
        }
        return;
      }
      // Other errors: log occurrence (at warn, not error, because this
      // is best-effort telemetry — never should page the operator).
      log.warn(`[ConsensusAudit] INSERT failed: ${error.message}`);
    }
  } catch (e) {
    // Network / JSON serialization / anything unexpected.
    log.warn(`[ConsensusAudit] Unexpected persist error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
