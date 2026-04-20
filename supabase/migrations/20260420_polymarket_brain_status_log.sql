-- ============================================================
-- Batch 3.18 — Polymarket Brain Status snapshot log
-- Purpose: persist every getBrainStatus() rollup for post-hoc
-- regression detection (when did we flip amber→red? which signal
-- held the brain green/amber? did feed flap before settlement
-- went yellow?).
--
-- Append-only. Fire-and-forget from brainStatusLog.ts. INSERT
-- failure MUST NOT block /api/v2/polymarket/brain-status. Writer
-- is gated by BRAIN_STATUS_LOG_ENABLED (default 'off' at first
-- deploy — operator flips to 'on' after migration applied).
--
-- Design notes:
--  - No dedicated id column. composite PK (ts, random4) is enough
--    for an append-only telemetry log with 1-min-ish granularity.
--  - verdict + per-source verdict columns are denormalized for
--    fast filtering ("rows where edge=red") without jsonb->>.
--  - signals JSONB preserves the full per-signal payload (summary
--    + detail) so we can reconstruct the rollup input later.
--  - No FK, no retention trigger. Operator adds pg_cron delete
--    policy if storage pressure matters (target: 30-90d window).
--
-- Generated: 2026-04-20
-- ============================================================

CREATE TABLE IF NOT EXISTS polymarket_brain_status_log (
  id                TEXT        PRIMARY KEY,       -- ts_ms + '-' + random4
  ts                BIGINT      NOT NULL,          -- epoch ms at compute time
  verdict           TEXT        NOT NULL,          -- GREEN | AMBER | RED | UNKNOWN
  edge_verdict      TEXT        NOT NULL,          -- green | amber | red | unknown
  settlement_verdict TEXT       NOT NULL,
  feed_verdict      TEXT        NOT NULL,
  ops_verdict       TEXT        NOT NULL,
  top_reasons       TEXT[]      NOT NULL DEFAULT '{}',
  signals           JSONB       NOT NULL,          -- full BrainSignal[] payload
  cache_hit         BOOLEAN     NOT NULL DEFAULT FALSE, -- should always be FALSE in log rows
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Chronological scan (dashboard / rolling lookback)
CREATE INDEX IF NOT EXISTS idx_polymarket_brain_status_log_ts
  ON polymarket_brain_status_log(ts DESC);

-- Filter for red/amber-only queries
CREATE INDEX IF NOT EXISTS idx_polymarket_brain_status_log_verdict
  ON polymarket_brain_status_log(verdict);

-- Optional: fast "when did edge flip" query
CREATE INDEX IF NOT EXISTS idx_polymarket_brain_status_log_edge
  ON polymarket_brain_status_log(edge_verdict)
  WHERE edge_verdict IN ('amber', 'red');
