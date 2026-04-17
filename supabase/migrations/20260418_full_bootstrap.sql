-- ============================================================
-- TRADE AI — Full Database Bootstrap for New Supabase Instance
-- Generated: 2026-04-18
-- Run this in Supabase SQL Editor to initialize all tables
-- ============================================================

-- ─── 1. json_store — Core key/value store ───
-- Used with two patterns: (id, data) and (key, value)
CREATE TABLE IF NOT EXISTS json_store (
  id          TEXT PRIMARY KEY,
  key         TEXT,
  data        JSONB DEFAULT '{}'::jsonb,
  value       JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_json_store_key ON json_store(key);

-- ─── 2. equity_history — Portfolio equity tracking ───
CREATE TABLE IF NOT EXISTS equity_history (
  id          BIGSERIAL PRIMARY KEY,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  equity      NUMERIC NOT NULL,
  cash        NUMERIC,
  positions   JSONB DEFAULT '[]'::jsonb,
  pnl_day     NUMERIC DEFAULT 0,
  pnl_total   NUMERIC DEFAULT 0,
  mode        TEXT DEFAULT 'PAPER'
);

CREATE INDEX IF NOT EXISTS idx_equity_history_ts ON equity_history(timestamp);

-- ─── 3. gladiator_battles — Trade history per gladiator ───
CREATE TABLE IF NOT EXISTS gladiator_battles (
  id              BIGSERIAL PRIMARY KEY,
  gladiator_id    TEXT NOT NULL,
  gladiator_name  TEXT,
  symbol          TEXT NOT NULL,
  direction       TEXT NOT NULL,
  entry_price     NUMERIC,
  exit_price      NUMERIC,
  pnl_percent     NUMERIC,
  pnl_usd         NUMERIC,
  confidence      NUMERIC,
  regime          TEXT,
  entry_time      TIMESTAMPTZ,
  exit_time       TIMESTAMPTZ,
  duration_ms     BIGINT,
  mode            TEXT DEFAULT 'PAPER',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_battles_gladiator ON gladiator_battles(gladiator_id);
CREATE INDEX IF NOT EXISTS idx_battles_symbol ON gladiator_battles(symbol);
CREATE INDEX IF NOT EXISTS idx_battles_created ON gladiator_battles(created_at);

-- ─── 4. live_positions — Currently open positions ───
CREATE TABLE IF NOT EXISTS live_positions (
  id              TEXT PRIMARY KEY,
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL,
  entry_price     NUMERIC NOT NULL,
  quantity        NUMERIC NOT NULL,
  usd_value       NUMERIC,
  stop_loss       NUMERIC,
  take_profit     NUMERIC,
  gladiator_id    TEXT,
  status          TEXT DEFAULT 'OPEN',
  opened_at       TIMESTAMPTZ DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  close_reason    TEXT,
  pnl_usd         NUMERIC,
  mode            TEXT DEFAULT 'PAPER'
);

CREATE INDEX IF NOT EXISTS idx_positions_status ON live_positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON live_positions(symbol);

-- ─── 5. decision_audit — Full decision trail ───
CREATE TABLE IF NOT EXISTS decision_audit (
  id                  BIGSERIAL PRIMARY KEY,
  timestamp           BIGINT NOT NULL,
  symbol              TEXT NOT NULL,
  gladiator_id        TEXT,
  mode                TEXT NOT NULL DEFAULT 'PAPER',
  alpha_quant_vote    JSONB,
  sentiment_vote      JSONB,
  risk_vote           JSONB,
  regime              TEXT,
  omega_modifier      NUMERIC,
  consensus_ratio     NUMERIC,
  debate_verdict      JSONB,
  sentinel_safe       BOOLEAN,
  sentinel_reason     TEXT,
  action              TEXT NOT NULL,
  skip_reason         TEXT,
  slippage            NUMERIC,
  fill_price          NUMERIC,
  latency_ms          INTEGER,
  experience_insight  JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_symbol ON decision_audit(symbol);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON decision_audit(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_gladiator ON decision_audit(gladiator_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON decision_audit(action);
CREATE INDEX IF NOT EXISTS idx_audit_mode ON decision_audit(mode);

-- ─── 6. llm_cache — DualMaster LLM response cache ───
CREATE TABLE IF NOT EXISTS llm_cache (
  hash        TEXT PRIMARY KEY,
  role        TEXT NOT NULL,
  response    TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 7. Polymarket tables ───
CREATE TABLE IF NOT EXISTS poly_paper_signals (
  id              BIGSERIAL PRIMARY KEY,
  signal_id       TEXT,
  market_id       TEXT NOT NULL,
  market_title    TEXT,
  division        TEXT NOT NULL,
  recommendation  TEXT NOT NULL,
  edge_score      NUMERIC,
  risk_level      TEXT,
  yes_price       NUMERIC,
  no_price        NUMERIC,
  liquidity_usd   NUMERIC,
  volume_24h      NUMERIC,
  reasoning       TEXT,
  emitted_at      TIMESTAMPTZ NOT NULL,
  mode            TEXT DEFAULT 'PAPER'
);

CREATE TABLE IF NOT EXISTS poly_backtest_snapshots (
  id                  BIGSERIAL PRIMARY KEY,
  captured_at         TIMESTAMPTZ NOT NULL,
  evaluated           INTEGER NOT NULL,
  hit_rate            NUMERIC,
  total_pnl_usd       NUMERIC,
  avg_pnl_usd         NUMERIC,
  wins                INTEGER,
  losses              INTEGER,
  min_edge_score      NUMERIC,
  notional_per_signal NUMERIC
);

CREATE TABLE IF NOT EXISTS poly_backtest_snapshots_division (
  id              BIGSERIAL PRIMARY KEY,
  captured_at     TIMESTAMPTZ NOT NULL,
  division        TEXT NOT NULL,
  n               INTEGER NOT NULL,
  pnl_usd         NUMERIC,
  min_edge_score  NUMERIC
);

CREATE TABLE IF NOT EXISTS poly_ranker_config (
  id                      BIGSERIAL PRIMARY KEY,
  generated_at            TIMESTAMPTZ NOT NULL,
  recommended_min_edge    NUMERIC,
  recommended_avg_pnl     NUMERIC,
  recommended_hit_rate    NUMERIC,
  recommended_sample      INTEGER,
  current_floor           NUMERIC,
  note                    TEXT
);

CREATE TABLE IF NOT EXISTS poly_ranker_active (
  id              INTEGER PRIMARY KEY DEFAULT 1,
  global_floor    NUMERIC,
  per_division    JSONB DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ,
  source          TEXT DEFAULT 'auto-tune'
);

-- ─── 8. experience_memory — Gladiator experience patterns ───
CREATE TABLE IF NOT EXISTS experience_memory (
  id              BIGSERIAL PRIMARY KEY,
  symbol          TEXT NOT NULL,
  direction       TEXT NOT NULL,
  gladiator_id    TEXT,
  outcome         TEXT NOT NULL,
  pnl_percent     NUMERIC,
  regime          TEXT,
  indicators      JSONB,
  lesson          TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_xp_symbol ON experience_memory(symbol);
CREATE INDEX IF NOT EXISTS idx_xp_gladiator ON experience_memory(gladiator_id);

-- ─── Enable RLS on all tables ───
ALTER TABLE json_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE gladiator_battles ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE poly_paper_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE poly_backtest_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE poly_backtest_snapshots_division ENABLE ROW LEVEL SECURITY;
ALTER TABLE poly_ranker_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE poly_ranker_active ENABLE ROW LEVEL SECURITY;
ALTER TABLE experience_memory ENABLE ROW LEVEL SECURITY;

-- ─── Permissive RLS policies (service_role bypasses, anon gets read) ───
CREATE POLICY "service_all" ON json_store FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON equity_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON gladiator_battles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON live_positions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON decision_audit FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON llm_cache FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON poly_paper_signals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON poly_backtest_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON poly_backtest_snapshots_division FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON poly_ranker_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON poly_ranker_active FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON experience_memory FOR ALL USING (true) WITH CHECK (true);

-- ─── Seed initial json_store entries ───
INSERT INTO json_store (id, key, data, value) VALUES
  ('gladiators', 'gladiators', '{}'::jsonb, '{}'::jsonb),
  ('decisions', 'decisions', '[]'::jsonb, '[]'::jsonb),
  ('phantom_trades', 'phantom_trades', '[]'::jsonb, '[]'::jsonb),
  ('kill_switch', 'kill_switch', '{"engaged": false}'::jsonb, '{"engaged": false}'::jsonb),
  ('optimizer', 'optimizer', '{"riskPerTrade": 1.0}'::jsonb, '{"riskPerTrade": 1.0}'::jsonb),
  ('bot_config', 'bot_config', '{"paperBalance": 10000, "tradingMode": "PAPER"}'::jsonb, '{"paperBalance": 10000, "tradingMode": "PAPER"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
