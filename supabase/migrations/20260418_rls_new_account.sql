-- ============================================================
-- TRADE AI — RLS Hardening for NEW Supabase Account
-- Applies to: rdowjxnuyawhrjppxzuu.supabase.co
-- Uses IF EXISTS on all tables — safe to run on partial schemas
-- ============================================================

-- ─── json_store (decisions, gladiators, kill_switch, phantom_trades) ───
ALTER TABLE IF EXISTS json_store ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all" ON json_store;
DROP POLICY IF EXISTS "anon_read_only" ON json_store;
DROP POLICY IF EXISTS "service_write" ON json_store;
CREATE POLICY "anon_read_only" ON json_store
  FOR SELECT USING (auth.role() = 'anon' OR auth.role() = 'authenticated' OR auth.role() = 'service_role');
CREATE POLICY "service_write" ON json_store
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ─── syndicate_audits ───
ALTER TABLE IF EXISTS syndicate_audits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all" ON syndicate_audits;
DROP POLICY IF EXISTS "anon_read" ON syndicate_audits;
DROP POLICY IF EXISTS "service_write" ON syndicate_audits;
CREATE POLICY "anon_read" ON syndicate_audits
  FOR SELECT USING (true);
CREATE POLICY "service_write" ON syndicate_audits
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- ─── gladiator_battles ───
ALTER TABLE IF EXISTS gladiator_battles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all" ON gladiator_battles;
DROP POLICY IF EXISTS "anon_read" ON gladiator_battles;
DROP POLICY IF EXISTS "service_write" ON gladiator_battles;
CREATE POLICY "anon_read" ON gladiator_battles
  FOR SELECT USING (true);
CREATE POLICY "service_write" ON gladiator_battles
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- ─── live_positions (SENSITIVE — real money) ───
ALTER TABLE IF EXISTS live_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all" ON live_positions;
DROP POLICY IF EXISTS "service_only" ON live_positions;
CREATE POLICY "service_only" ON live_positions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ─── equity_history ───
ALTER TABLE IF EXISTS equity_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all" ON equity_history;
DROP POLICY IF EXISTS "anon_read" ON equity_history;
DROP POLICY IF EXISTS "service_write" ON equity_history;
CREATE POLICY "anon_read" ON equity_history
  FOR SELECT USING (true);
CREATE POLICY "service_write" ON equity_history
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- ─── trade_locks (SENSITIVE — prevents double-execution) ───
ALTER TABLE IF EXISTS trade_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all" ON trade_locks;
DROP POLICY IF EXISTS "service_only" ON trade_locks;
CREATE POLICY "service_only" ON trade_locks
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ─── poly_backtest_snapshots ───
ALTER TABLE IF EXISTS poly_backtest_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all" ON poly_backtest_snapshots;
DROP POLICY IF EXISTS "anon_read" ON poly_backtest_snapshots;
DROP POLICY IF EXISTS "service_write" ON poly_backtest_snapshots;
CREATE POLICY "anon_read" ON poly_backtest_snapshots FOR SELECT USING (true);
CREATE POLICY "service_write" ON poly_backtest_snapshots
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- ─── poly_backtest_snapshots_division ───
ALTER TABLE IF EXISTS poly_backtest_snapshots_division ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all" ON poly_backtest_snapshots_division;
DROP POLICY IF EXISTS "anon_read" ON poly_backtest_snapshots_division;
DROP POLICY IF EXISTS "service_write" ON poly_backtest_snapshots_division;
CREATE POLICY "anon_read" ON poly_backtest_snapshots_division FOR SELECT USING (true);
CREATE POLICY "service_write" ON poly_backtest_snapshots_division
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- ─── llm_cache ───
ALTER TABLE IF EXISTS llm_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all" ON llm_cache;
DROP POLICY IF EXISTS "service_only" ON llm_cache;
CREATE POLICY "service_only" ON llm_cache
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
