-- ============================================================
-- TRADE AI — Missing Tables Migration
-- Generated: 2026-04-17 by Antigravity Audit
-- Creates 6 tables referenced in code but missing from DB
-- ============================================================

-- 1. llm_cache — DualMaster LLM response cache
CREATE TABLE IF NOT EXISTS llm_cache (
  hash        TEXT PRIMARY KEY,
  role        TEXT        NOT NULL,
  response    TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. poly_paper_signals — Polymarket paper trading signals
CREATE TABLE IF NOT EXISTS poly_paper_signals (
  id            BIGSERIAL   PRIMARY KEY,
  signal_id     TEXT,
  market_id     TEXT        NOT NULL,
  market_title  TEXT,
  division      TEXT        NOT NULL,
  recommendation TEXT       NOT NULL,
  edge_score    NUMERIC,
  risk_level    TEXT,
  yes_price     NUMERIC,
  no_price      NUMERIC,
  liquidity_usd NUMERIC,
  volume_24h    NUMERIC,
  reasoning     TEXT,
  emitted_at    TIMESTAMPTZ NOT NULL,
  mode          TEXT        DEFAULT 'PAPER'
);

-- 3. poly_backtest_snapshots — Polymarket backtest results
CREATE TABLE IF NOT EXISTS poly_backtest_snapshots (
  id                  BIGSERIAL   PRIMARY KEY,
  captured_at         TIMESTAMPTZ NOT NULL,
  evaluated           INTEGER     NOT NULL,
  hit_rate            NUMERIC,
  total_pnl_usd       NUMERIC,
  avg_pnl_usd         NUMERIC,
  wins                INTEGER,
  losses              INTEGER,
  min_edge_score      NUMERIC,
  notional_per_signal NUMERIC
);

-- 4. poly_backtest_snapshots_division — Backtest results per division
CREATE TABLE IF NOT EXISTS poly_backtest_snapshots_division (
  id             BIGSERIAL   PRIMARY KEY,
  captured_at    TIMESTAMPTZ NOT NULL,
  division       TEXT        NOT NULL,
  n              INTEGER     NOT NULL,
  pnl_usd        NUMERIC,
  min_edge_score NUMERIC
);

-- 5. poly_ranker_config — Threshold tuner recommendations
CREATE TABLE IF NOT EXISTS poly_ranker_config (
  id                    BIGSERIAL   PRIMARY KEY,
  generated_at          TIMESTAMPTZ NOT NULL,
  recommended_min_edge  NUMERIC,
  recommended_avg_pnl   NUMERIC,
  recommended_hit_rate  NUMERIC,
  recommended_sample    INTEGER,
  current_floor         NUMERIC,
  note                  TEXT
);

-- 6. poly_ranker_active — Active ranker config (singleton)
CREATE TABLE IF NOT EXISTS poly_ranker_active (
  id           INTEGER     PRIMARY KEY DEFAULT 1,
  global_floor NUMERIC,
  per_division JSONB       DEFAULT '{}'::jsonb,
  updated_at   TIMESTAMPTZ,
  source       TEXT        DEFAULT 'auto-tune'
);

-- Enable RLS
ALTER TABLE llm_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE poly_paper_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE poly_backtest_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE poly_backtest_snapshots_division ENABLE ROW LEVEL SECURITY;
ALTER TABLE poly_ranker_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE poly_ranker_active ENABLE ROW LEVEL SECURITY;

-- Permissive policies (service_role bypasses RLS, but needed if anon key used)
CREATE POLICY "service_all" ON llm_cache FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON poly_paper_signals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON poly_backtest_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON poly_backtest_snapshots_division FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON poly_ranker_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON poly_ranker_active FOR ALL USING (true) WITH CHECK (true);
