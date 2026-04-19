-- ============================================================
-- FAZA 3.1 — Polymarket Goldsky Event Store (append-only)
-- Purpose: promote /api/polymarket/ingest from LOG-ONLY to a
-- durable, queryable event ledger fed by Goldsky mirror pipelines.
-- Design: append-only (no UPDATE path), defensive columns
-- (everything nullable except id + raw), best-effort insert.
-- Generated: 2026-04-20
-- ============================================================

CREATE TABLE IF NOT EXISTS polymarket_events (
  id             BIGSERIAL   PRIMARY KEY,
  event_id       TEXT,                 -- Goldsky-provided uniq id (if any); NOT unique (retries ok)
  pipeline_name  TEXT,                 -- e.g. "trade-ai-polymarket-global-oi"
  entity_type    TEXT,                 -- heuristic: market | position | trade | resolution | other
  condition_id   TEXT,                 -- Polymarket market conditionId if present
  actor          TEXT,                 -- wallet/entity if extractable
  block_number   BIGINT,               -- on-chain block, if present
  tx_hash        TEXT,                 -- on-chain tx, if present
  raw_payload    JSONB       NOT NULL, -- full event (truncated to 1 MiB at ingest)
  received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at   TIMESTAMPTZ,          -- set when correlation layer consumes it (FAZA 3.3)
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Chronological scan for lag/freshness probes
CREATE INDEX IF NOT EXISTS idx_poly_events_received_at ON polymarket_events(received_at DESC);
-- Per-pipeline health panel
CREATE INDEX IF NOT EXISTS idx_poly_events_pipeline ON polymarket_events(pipeline_name);
-- Per-market drill-down (FAZA 3.4)
CREATE INDEX IF NOT EXISTS idx_poly_events_condition ON polymarket_events(condition_id);
-- Entity filtering
CREATE INDEX IF NOT EXISTS idx_poly_events_entity ON polymarket_events(entity_type);
-- Unprocessed queue (correlation layer cursor)
CREATE INDEX IF NOT EXISTS idx_poly_events_unprocessed ON polymarket_events(id) WHERE processed_at IS NULL;
