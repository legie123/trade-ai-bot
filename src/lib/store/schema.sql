-- ==============================================================================
-- PHOENIX V2: Supabase / Postgres Migration Schema
-- Execute this script in your Supabase SQL Editor.
-- These tables replace the fragile `json_store` blob and provide true atomicity,
-- preventing memory amnesia during Cloud Run cold starts.
-- ==============================================================================

-- 1. Equity history tracking (Line chart on dashboard)
CREATE TABLE IF NOT EXISTS public.equity_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    pnl NUMERIC(15, 2) NOT NULL DEFAULT 0,
    balance NUMERIC(15, 2) NOT NULL,
    outcome VARCHAR(50) DEFAULT 'WIN',
    signal VARCHAR(50) DEFAULT 'SEED',
    symbol VARCHAR(50) DEFAULT 'SYSTEM'
);

-- Index for fast time-series fetching
CREATE INDEX IF NOT EXISTS idx_equity_history_timestamp ON public.equity_history(timestamp DESC);

-- 2. Store all trading decisions for auditing
CREATE TABLE IF NOT EXISTS public.syndicate_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp NUMERIC(20, 0) NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    finalDirection VARCHAR(20) NOT NULL,
    weightedConfidence NUMERIC(5, 4) NOT NULL,
    opinions JSONB NOT NULL DEFAULT '[]'::jsonb,
    hallucinationReport JSONB
);

CREATE INDEX IF NOT EXISTS idx_audits_timestamp ON public.syndicate_audits(timestamp DESC);

-- 3. Live active positions managed by the Engine
CREATE TABLE IF NOT EXISTS public.live_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gladiatorId VARCHAR(100) NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    direction VARCHAR(20) NOT NULL,
    entryPrice NUMERIC(20, 8) NOT NULL,
    size NUMERIC(20, 8) NOT NULL,
    leverage INTEGER NOT NULL DEFAULT 1,
    openedAt TIMESTAMPTZ NOT NULL DEFAULT now(),
    lastCheckedAt TIMESTAMPTZ NOT NULL DEFAULT now(),
    isActive BOOLEAN NOT NULL DEFAULT true,
    pnl NUMERIC(15, 2) DEFAULT 0
);

-- 4. Gladiator memory & stats (instead of rewriting a whole JSON file)
CREATE TABLE IF NOT EXISTS public.gladiator_stats (
    gladiator_id VARCHAR(100) PRIMARY KEY,
    totalTrades INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    profitFactor NUMERIC(10, 4) DEFAULT 0.0,
    winRate NUMERIC(5, 2) DEFAULT 0.0,
    pnl NUMERIC(15, 2) DEFAULT 0.0,
    lastUpdate TIMESTAMPTZ NOT NULL DEFAULT now(),
    dna_digest TEXT,
    confidence_modifier NUMERIC(5, 4) DEFAULT 1.0
);

-- 5. Gladiator Battle History (dedicated RL memory — replaces json_store blob)
-- This is the core reinforcement learning table. Every phantom and live trade result
-- is recorded here with full context. No more 2000-record cap.
CREATE TABLE IF NOT EXISTS public.gladiator_battles (
    id TEXT PRIMARY KEY,
    gladiator_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    decision TEXT NOT NULL,                   -- 'LONG' | 'SHORT' | 'FLAT'
    entry_price NUMERIC(20, 8) NOT NULL,
    outcome_price NUMERIC(20, 8) NOT NULL,
    pnl_percent NUMERIC(10, 4) NOT NULL,
    is_win BOOLEAN NOT NULL,
    timestamp BIGINT NOT NULL,
    market_context JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_battles_gladiator ON public.gladiator_battles(gladiator_id);
CREATE INDEX IF NOT EXISTS idx_battles_symbol ON public.gladiator_battles(symbol);
CREATE INDEX IF NOT EXISTS idx_battles_timestamp ON public.gladiator_battles(timestamp DESC);

-- 6. Distributed Trade Locks (prevents duplicate execution across Cloud Run instances)
CREATE TABLE IF NOT EXISTS public.trade_locks (
    symbol TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- 6. Set correct RLS (Row Level Security) if the API is exposed
-- If the API uses ANON_KEY and we want it completely permissive for the bot (since it's only server-side accessed in Cloud Run)
ALTER TABLE public.equity_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syndicate_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gladiator_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read/write for all users" ON public.equity_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all users" ON public.syndicate_audits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all users" ON public.live_positions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all users" ON public.gladiator_stats FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.gladiator_battles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read/write for all users" ON public.gladiator_battles FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.trade_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read/write for all users" ON public.trade_locks FOR ALL USING (true) WITH CHECK (true);
