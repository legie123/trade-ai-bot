-- ============================================================
-- RUFLO FAZA 3 Batch 5/9 — Gladiators Graveyard
-- Purpose: Fix survivorship bias in aggregate Kelly/WR stats.
-- Until now TheButcher purged killed gladiators via
-- saveGladiatorsToDb(survivors) with zero audit trail.
-- Population stats (alive ∪ killed) need the killed set preserved.
-- Append-only, no FK, degrades gracefully if missing (see graveyard.ts).
-- Generated: 2026-04-19
-- ============================================================

CREATE TABLE IF NOT EXISTS gladiators_graveyard (
  id             BIGSERIAL   PRIMARY KEY,
  gladiator_id   TEXT        NOT NULL,
  name           TEXT        NOT NULL,
  arena          TEXT,
  rank           INTEGER,
  dna            JSONB,
  final_stats    JSONB       NOT NULL,
  kill_reason    TEXT        NOT NULL,
  killed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Lookup by original gladiator id (forensics / correlation)
CREATE INDEX IF NOT EXISTS idx_graveyard_gid ON gladiators_graveyard(gladiator_id);
-- Chronological scan for population rolling stats
CREATE INDEX IF NOT EXISTS idx_graveyard_killed_at ON gladiators_graveyard(killed_at DESC);
-- Reason aggregation (memorized vs WR fail vs PF fail)
CREATE INDEX IF NOT EXISTS idx_graveyard_reason ON gladiators_graveyard(kill_reason);
