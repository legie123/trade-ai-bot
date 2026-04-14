-- LLM Response Caching Table
-- Stores LLM responses with expiry for 24-hour fallback on API failures

CREATE TABLE IF NOT EXISTS llm_cache (
  hash TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_llm_cache_role ON llm_cache(role);
CREATE INDEX IF NOT EXISTS idx_llm_cache_created_at ON llm_cache(created_at);

-- Enable RLS (Row Level Security)
ALTER TABLE llm_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Allow reads (cache lookups from API routes)
CREATE POLICY "Allow read llm_cache" ON llm_cache
  FOR SELECT
  USING (true);

-- Policy: Allow inserts/updates from authenticated requests
CREATE POLICY "Allow write llm_cache" ON llm_cache
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow update llm_cache" ON llm_cache
  FOR UPDATE
  USING (true);

-- Auto-cleanup: Delete cache entries older than 24 hours
-- This runs via a scheduled job (set in Supabase dashboard)
-- SQL: DELETE FROM llm_cache WHERE created_at < NOW() - INTERVAL '24 hours'
