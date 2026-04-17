-- ============================================================
-- Step 1.1 — Decision Audit Trail
-- Stores every trade/skip decision for full observability
-- ============================================================

CREATE TABLE IF NOT EXISTS decision_audit (
  id TEXT PRIMARY KEY,
  timestamp BIGINT NOT NULL,
  symbol TEXT NOT NULL,
  gladiator_id TEXT,
  mode TEXT NOT NULL DEFAULT 'PAPER',

  -- Agent votes (JSONB for flexibility)
  alpha_quant_vote JSONB,
  sentiment_vote JSONB,
  risk_vote JSONB,

  -- Enrichment
  regime TEXT,
  omega_modifier REAL,
  consensus_ratio REAL,
  debate_verdict JSONB,

  -- Sentinel
  sentinel_safe BOOLEAN NOT NULL DEFAULT true,
  sentinel_reason TEXT,

  -- Outcome
  action TEXT NOT NULL,
  skip_reason TEXT,

  -- Post-trade (filled async)
  slippage REAL,
  fill_price REAL,
  latency_ms INTEGER,

  -- Experience memory link (Step 3.2)
  experience_insight JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_decision_audit_symbol ON decision_audit(symbol);
CREATE INDEX IF NOT EXISTS idx_decision_audit_ts ON decision_audit(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_decision_audit_action ON decision_audit(action);
CREATE INDEX IF NOT EXISTS idx_decision_audit_gladiator ON decision_audit(gladiator_id);
CREATE INDEX IF NOT EXISTS idx_decision_audit_mode ON decision_audit(mode);
