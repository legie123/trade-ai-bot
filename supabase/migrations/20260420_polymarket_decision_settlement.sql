-- ============================================================
-- FAZA 3.7 — Polymarket Decision Settlement Hook
-- Purpose: writeback realized P&L on each acted decision so the
-- learning loop (FAZA 3.6) can compute REAL win-rate / profit-factor
-- per division/gladiator/factor-bucket — not just selection lift.
--
-- run_id (FAZA 3.4) links decision → scan; this layer links
-- decision → settlement. With both, every decision is fully audited
-- end-to-end (intent → execution → outcome).
--
-- Append-by-update model: settlement columns are NULL until close.
-- A NULL settled_at means: position still open, never opened, or
-- gladiator was paper-only (phantom bet but no wallet position).
--
-- Generated: 2026-04-20
-- ============================================================

ALTER TABLE polymarket_decisions
  ADD COLUMN IF NOT EXISTS settled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settled_pnl_pct   NUMERIC,        -- realized PnL as % of capital allocated (net of fees)
  ADD COLUMN IF NOT EXISTS settled_pnl_usd   NUMERIC,        -- realized PnL in USD (net of fees)
  ADD COLUMN IF NOT EXISTS settled_outcome   TEXT,           -- 'YES' | 'NO' | 'CANCEL'
  ADD COLUMN IF NOT EXISTS horizon_ms        BIGINT;         -- enteredAt → settled_at, ms

-- Partial index: only rows with settlement (used by learning loop WR/PF queries)
CREATE INDEX IF NOT EXISTS idx_poly_dec_settled
  ON polymarket_decisions(settled_at DESC)
  WHERE settled_at IS NOT NULL;

-- Composite index for per-division settled stats (learning loop window scans)
CREATE INDEX IF NOT EXISTS idx_poly_dec_division_settled
  ON polymarket_decisions(division, settled_at DESC)
  WHERE settled_at IS NOT NULL;
