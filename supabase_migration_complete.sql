-- ============================================================
-- TRADE AI PHOENIX V2 — SUPABASE COMPLETE MIGRATION
-- Run this ENTIRE script in Supabase SQL Editor (one shot).
-- Safe to run multiple times (IF NOT EXISTS everywhere).
-- ============================================================

-- ─── 1. json_store — Primary key-value blob store ────────────
-- Used by db.ts for: gladiators, decisions, config, optimizer,
-- gladiator_dna, invalid_symbols, phantom_trades
CREATE TABLE IF NOT EXISTS public.json_store (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.json_store ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON public.json_store;
CREATE POLICY "Allow all for service role" ON public.json_store
    FOR ALL USING (true) WITH CHECK (true);

-- ─── 2. equity_history — Line chart PnL tracking ─────────────
CREATE TABLE IF NOT EXISTS public.equity_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    pnl NUMERIC(15, 2) NOT NULL DEFAULT 0,
    balance NUMERIC(15, 2) NOT NULL,
    outcome VARCHAR(50) DEFAULT 'WIN',
    signal VARCHAR(50) DEFAULT 'SEED',
    symbol VARCHAR(50) DEFAULT 'SYSTEM'
);

CREATE INDEX IF NOT EXISTS idx_equity_history_timestamp ON public.equity_history(timestamp DESC);

ALTER TABLE public.equity_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON public.equity_history;
CREATE POLICY "Allow all for service role" ON public.equity_history
    FOR ALL USING (true) WITH CHECK (true);

-- ─── 3. syndicate_audits — Trade decision audit log ──────────
CREATE TABLE IF NOT EXISTS public.syndicate_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp NUMERIC(20, 0) NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    finalDirection VARCHAR(20) NOT NULL,
    weightedConfidence NUMERIC(5, 4) NOT NULL,
    opinions JSONB NOT NULL DEFAULT '[]'::jsonb,
    hallucinationReport JSONB,
    final_direction VARCHAR(20),
    hallucination_report JSONB
);

CREATE INDEX IF NOT EXISTS idx_audits_timestamp ON public.syndicate_audits(timestamp DESC);

ALTER TABLE public.syndicate_audits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON public.syndicate_audits;
CREATE POLICY "Allow all for service role" ON public.syndicate_audits
    FOR ALL USING (true) WITH CHECK (true);

-- ─── 4. live_positions — Active trading positions ─────────────
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

ALTER TABLE public.live_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON public.live_positions;
CREATE POLICY "Allow all for service role" ON public.live_positions
    FOR ALL USING (true) WITH CHECK (true);

-- ─── 5. gladiator_stats — Per-gladiator aggregated stats ─────
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

ALTER TABLE public.gladiator_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON public.gladiator_stats;
CREATE POLICY "Allow all for service role" ON public.gladiator_stats
    FOR ALL USING (true) WITH CHECK (true);

-- ─── 6. gladiator_battles — RL memory (no 2000-record cap) ───
CREATE TABLE IF NOT EXISTS public.gladiator_battles (
    id TEXT PRIMARY KEY,
    gladiator_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    decision TEXT NOT NULL,
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

ALTER TABLE public.gladiator_battles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON public.gladiator_battles;
CREATE POLICY "Allow all for service role" ON public.gladiator_battles
    FOR ALL USING (true) WITH CHECK (true);

-- ─── 7. trade_locks — Distributed execution locks ────────────
CREATE TABLE IF NOT EXISTS public.trade_locks (
    symbol TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.trade_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON public.trade_locks;
CREATE POLICY "Allow all for service role" ON public.trade_locks
    FOR ALL USING (true) WITH CHECK (true);

-- RPC function for atomic trade lock acquisition
CREATE OR REPLACE FUNCTION acquire_trade_lock(
    p_symbol TEXT,
    p_instance_id TEXT,
    p_ttl_seconds INTEGER DEFAULT 30
) RETURNS BOOLEAN AS $$
DECLARE
    v_locked BOOLEAN;
BEGIN
    -- Delete any expired locks first
    DELETE FROM public.trade_locks
    WHERE symbol = p_symbol AND expires_at < NOW();

    -- Try to insert (will fail if lock exists and not expired)
    INSERT INTO public.trade_locks (symbol, instance_id, expires_at)
    VALUES (p_symbol, p_instance_id, NOW() + (p_ttl_seconds || ' seconds')::INTERVAL)
    ON CONFLICT (symbol) DO NOTHING;

    -- Check if WE own the lock
    SELECT EXISTS (
        SELECT 1 FROM public.trade_locks
        WHERE symbol = p_symbol AND instance_id = p_instance_id
    ) INTO v_locked;

    RETURN v_locked;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 8. sentiment_heartbeat — NLP sentiment scores (Faza 9) ──
CREATE TABLE IF NOT EXISTS public.sentiment_heartbeat (
    symbol TEXT PRIMARY KEY,
    score INTEGER NOT NULL DEFAULT 0,
    direction TEXT NOT NULL DEFAULT 'NEUTRAL',
    bullish_count INTEGER DEFAULT 0,
    bearish_count INTEGER DEFAULT 0,
    neutral_count INTEGER DEFAULT 0,
    posts_analyzed INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.sentiment_heartbeat ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON public.sentiment_heartbeat;
CREATE POLICY "Allow all for service role" ON public.sentiment_heartbeat
    FOR ALL USING (true) WITH CHECK (true);

-- ─── 9. phantom_trades — Shadow execution log (Faza 8) ───────
CREATE TABLE IF NOT EXISTS public.phantom_trades (
    id TEXT PRIMARY KEY,
    gladiator_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    signal TEXT NOT NULL,
    entry_price NUMERIC(20, 8),
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phantom_gladiator ON public.phantom_trades(gladiator_id);
CREATE INDEX IF NOT EXISTS idx_phantom_timestamp ON public.phantom_trades(timestamp DESC);

ALTER TABLE public.phantom_trades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON public.phantom_trades;
CREATE POLICY "Allow all for service role" ON public.phantom_trades
    FOR ALL USING (true) WITH CHECK (true);

-- ─── Verify all tables exist ─────────────────────────────────
SELECT
    tablename,
    CASE WHEN rowsecurity THEN 'RLS ON' ELSE 'RLS OFF' END as rls_status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'json_store', 'equity_history', 'syndicate_audits', 'live_positions',
    'gladiator_stats', 'gladiator_battles', 'trade_locks',
    'sentiment_heartbeat', 'phantom_trades'
  )
ORDER BY tablename;
