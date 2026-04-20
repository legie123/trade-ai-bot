/**
 * FAZA 3.16 — Decision Budget Gate (shadow).
 *
 * Reads rolling 24h LLM spend from llmCostTracker and classifies the next
 * market-scan decision as one of:
 *
 *   allow     — spent < throttleRatio × cap  (full fidelity: architect+oracle)
 *   throttle  — throttleRatio ≤ spent < 1.0  (operator intent: degrade to
 *               cheaper model OR skip optional fallback — enforcement wire
 *               is a follow-up, this batch is read-only telemetry)
 *   block     — spent ≥ cap                  (operator intent: skip LLM call
 *               entirely, fall back to non-LLM routing or no-bet)
 *   unknown   — tracker disabled or error
 *
 * Shadow-first: this module only REPORTS the verdict. Call-site integration
 * (polySyndicate → checkDecisionBudget → skip/downgrade) ships in 3.16b,
 * once a few days of data confirm the cap + throttleRatio are calibrated.
 *
 * Cardinality discipline:
 *   llmCostTracker is process-local. On a scaled Cloud Run fleet each
 *   instance has its own 24h window. For a fleet-wide cap, aggregate via
 *   Prometheus (`increase(tradeai_llm_cost_dollars_total[24h])`) and plug
 *   that into a second classifier. Today we operate on the local view
 *   because our fleet is 1 instance almost always.
 *
 * Env:
 *   DECISION_BUDGET_ENABLED       = '0' kills gate (verdict=allow forever)
 *   DECISION_BUDGET_USD_DAY       = hard cap in USD (default 1.00)
 *   DECISION_BUDGET_THROTTLE_PCT  = ratio (0..1) where throttle begins (default 0.70)
 *   DECISION_BUDGET_CACHE_MS      = verdict cache TTL ms (default 15000)
 */

import { getLlmCostSnapshot } from './llmCostTracker';

export type BudgetVerdict = 'allow' | 'throttle' | 'block' | 'unknown';

export interface DecisionBudgetState {
  enabled: boolean;
  verdict: BudgetVerdict;
  usedUsd: number;            // rolling 24h, process-local
  capUsd: number;             // DECISION_BUDGET_USD_DAY
  throttleAtUsd: number;      // capUsd × throttleRatio
  usedRatio: number;          // usedUsd / capUsd, clamped [0, ∞)
  throttleRatio: number;      // 0..1
  totalCalls: number;
  totalMarkets: number;
  checkedAt: string;
  cacheHit: boolean;
  errorMsg: string | null;
}

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clampRatio(x: number): number {
  if (!Number.isFinite(x) || x < 0) return 0;
  if (x > 10) return 10;                // sanity ceiling, not a hard gate
  return x;
}

function classify(
  usedUsd: number,
  capUsd: number,
  throttleRatio: number
): BudgetVerdict {
  if (!Number.isFinite(capUsd) || capUsd <= 0) return 'unknown';
  if (usedUsd >= capUsd) return 'block';
  if (usedUsd >= capUsd * throttleRatio) return 'throttle';
  return 'allow';
}

let cache: { state: DecisionBudgetState; expiresAt: number } | null = null;

export async function getDecisionBudgetState(): Promise<DecisionBudgetState> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return { ...cache.state, cacheHit: true };
  }

  const enabled = (process.env.DECISION_BUDGET_ENABLED ?? '1') !== '0';
  const capUsd = envNum('DECISION_BUDGET_USD_DAY', 1.0);
  const throttleRatio = Math.min(1, Math.max(0, envNum('DECISION_BUDGET_THROTTLE_PCT', 0.70)));
  const throttleAtUsd = capUsd * throttleRatio;
  const cacheMs = envNum('DECISION_BUDGET_CACHE_MS', 15_000);

  if (!enabled) {
    const st: DecisionBudgetState = {
      enabled: false,
      verdict: 'allow',
      usedUsd: 0,
      capUsd,
      throttleAtUsd,
      usedRatio: 0,
      throttleRatio,
      totalCalls: 0,
      totalMarkets: 0,
      checkedAt: new Date().toISOString(),
      cacheHit: false,
      errorMsg: null,
    };
    cache = { state: st, expiresAt: now + cacheMs };
    return st;
  }

  try {
    const snap = getLlmCostSnapshot(1); // we only need totals
    const usedUsd = Math.max(0, Number(snap.totalCostUsd) || 0);
    const verdict = classify(usedUsd, capUsd, throttleRatio);

    const state: DecisionBudgetState = {
      enabled: true,
      verdict,
      usedUsd,
      capUsd,
      throttleAtUsd,
      usedRatio: clampRatio(capUsd > 0 ? usedUsd / capUsd : 0),
      throttleRatio,
      totalCalls: snap.totalCalls,
      totalMarkets: snap.totalMarkets,
      checkedAt: new Date().toISOString(),
      cacheHit: false,
      errorMsg: null,
    };
    cache = { state, expiresAt: now + cacheMs };
    return state;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    const state: DecisionBudgetState = {
      enabled: true,
      verdict: 'unknown',
      usedUsd: 0,
      capUsd,
      throttleAtUsd,
      usedRatio: 0,
      throttleRatio,
      totalCalls: 0,
      totalMarkets: 0,
      checkedAt: new Date().toISOString(),
      cacheHit: false,
      errorMsg: msg,
    };
    cache = { state, expiresAt: now + cacheMs };
    return state;
  }
}

/**
 * Call-site helper — today this is advisory only; polySyndicate will wire
 * it in 3.16b. Returns the verdict directly to keep integration trivial.
 */
export async function canMakeDecision(): Promise<{
  allowed: boolean;
  verdict: BudgetVerdict;
  reason: string;
}> {
  const st = await getDecisionBudgetState();
  if (!st.enabled) return { allowed: true, verdict: 'allow', reason: 'gate_disabled' };
  if (st.verdict === 'block') {
    return {
      allowed: false,
      verdict: 'block',
      reason: `budget_exhausted: $${st.usedUsd.toFixed(4)} / $${st.capUsd.toFixed(4)}`,
    };
  }
  if (st.verdict === 'throttle') {
    return {
      allowed: true,
      verdict: 'throttle',
      reason: `budget_throttle: $${st.usedUsd.toFixed(4)} / $${st.capUsd.toFixed(4)} (>= ${(st.throttleRatio * 100).toFixed(0)}%)`,
    };
  }
  return { allowed: true, verdict: st.verdict, reason: 'within_budget' };
}

/** Test hook. */
export function __resetDecisionBudgetForTests(): void {
  cache = null;
}
