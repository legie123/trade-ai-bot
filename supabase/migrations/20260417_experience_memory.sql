-- Experience Memory Store — Step 3.2
-- Stores trade outcomes with full context for historical insight queries

CREATE TABLE IF NOT EXISTS experience_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  outcome TEXT NOT NULL CHECK (outcome IN ('WIN', 'LOSS')),
  pnl_percent DOUBLE PRECISION NOT NULL,
  regime TEXT,
  indicators JSONB DEFAULT '{}'::jsonb,
  confidence DOUBLE PRECISION,
  debate_verdict TEXT,
  gladiator_id TEXT,
  slippage_bps DOUBLE PRECISION,
  latency_ms INTEGER,
  mode TEXT NOT NULL DEFAULT 'PAPER' CHECK (mode IN ('LIVE', 'PAPER'))
);

-- Query patterns: by symbol, by regime, by gladiator, by time
CREATE INDEX idx_xp_symbol ON experience_memory (symbol);
CREATE INDEX idx_xp_regime ON experience_memory (regime);
CREATE INDEX idx_xp_gladiator ON experience_memory (gladiator_id);
CREATE INDEX idx_xp_timestamp ON experience_memory (timestamp DESC);
CREATE INDEX idx_xp_symbol_direction ON experience_memory (symbol, direction);
CREATE INDEX idx_xp_mode ON experience_memory (mode);
