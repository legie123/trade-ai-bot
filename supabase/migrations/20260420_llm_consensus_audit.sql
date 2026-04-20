-- ============================================================
-- Pas 5 — LLM Consensus Audit (FAZA 3 Batch 9/9 telemetry persist)
-- Purpose: persist every ProviderVote[] + aggregate from runConsensus()
-- for post-hoc analysis (divergenceFromPrimary vs loss clusters, per-
-- provider health, parse-fail correlations, cost trending).
--
-- Append-only. Fire-and-forget from multiLlmConsensusAudit.ts. INSERT
-- failure MUST NOT block the decision path — writes are best-effort.
--
-- Design notes:
--  - id: deterministic-ish composite (symbol + ts + random4) — cheap
--    collision guard without requiring UUID extension. Primary uniqueness
--    comes from insert ordering + random suffix; ts provides chrono order.
--  - votes JSONB: full ProviderVote[] preserved so we can re-aggregate
--    with a different algorithm later without losing provenance.
--  - bypass rows (mode_off, sample, rate, budget) are NOT persisted —
--    only rows where providers actually ran. Those are filtered at the
--    application layer (validVotes >= 1 OR bypass=false).
--  - No FK. If gladiator/decision_audit rows get pruned, audit rows here
--    retain independent forensic value.
--
-- Kill-switch (app layer): LLM_CONSENSUS_PERSIST_ENABLED={off,on}
--   - default 'off' at first deploy so a broken RLS/schema doesn't
--     flood logs. Operator flips 'on' after validating first INSERT.
--
-- Generated: 2026-04-20
-- ============================================================

CREATE TABLE IF NOT EXISTS llm_consensus_audit (
  id                    TEXT        PRIMARY KEY,
  ts                    BIGINT      NOT NULL,  -- epoch ms (consistent w/ decision_audit)
  symbol                TEXT        NOT NULL,
  proposed_direction    TEXT        NOT NULL,  -- 'LONG' | 'SHORT'
  primary_confidence    REAL        NOT NULL,  -- 0..1
  regime                TEXT,
  indicators            JSONB,

  -- Mode at time of run (off/shadow/active). 'off' never reaches here.
  mode                  TEXT        NOT NULL,

  -- Aggregated result
  vote                  TEXT        NOT NULL,  -- 'LONG' | 'SHORT' | 'SKIP'
  score                 REAL        NOT NULL,  -- -1..1
  agreement_ratio       REAL        NOT NULL,  -- 0..1
  valid_votes           INTEGER     NOT NULL,  -- 0..3
  diverges_from_primary BOOLEAN     NOT NULL,

  -- Per-provider breakdown (array of ProviderVote)
  votes                 JSONB       NOT NULL,

  total_latency_ms      INTEGER     NOT NULL,
  total_cost_usd        REAL        NOT NULL,
  prompt_version        TEXT        NOT NULL,

  -- Soft-correlation link to decision_audit.id (if caller provides).
  -- Nullable — operator diag POST has no decision context.
  decision_audit_id     TEXT,

  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Chronological scan (dashboard, rolling aggregates)
CREATE INDEX IF NOT EXISTS idx_llm_consensus_audit_ts       ON llm_consensus_audit(ts DESC);
-- Per-symbol drill-down
CREATE INDEX IF NOT EXISTS idx_llm_consensus_audit_symbol   ON llm_consensus_audit(symbol);
-- Shadow vs active separation
CREATE INDEX IF NOT EXISTS idx_llm_consensus_audit_mode     ON llm_consensus_audit(mode);
-- Primary research query: divergence clusters
CREATE INDEX IF NOT EXISTS idx_llm_consensus_audit_diverges ON llm_consensus_audit(diverges_from_primary);
-- Linkage to decision_audit (when populated)
CREATE INDEX IF NOT EXISTS idx_llm_consensus_audit_dec_id   ON llm_consensus_audit(decision_audit_id)
  WHERE decision_audit_id IS NOT NULL;
