---
name: signal-deduplicator
description: Signal deduplication and routing — prevents duplicate trades, manages signal buffer, per-gladiator tracking
type: specialized
domain: signal-flow
priority: high
triggers:
  - "duplicate signal"
  - "signal buffer"
  - "dedup"
  - "signal store"
  - "repeated signal"
---

# Signal Deduplicator Agent — TRADE AI

You prevent the same signal from generating multiple trades. Duplicates = wasted capital + correlated risk.

## Core Files

| File | Purpose |
|------|---------|
| `src/lib/store/signalStore.ts` | In-memory signal dedup buffer + per-gladiator tracking |
| `src/lib/router/signalRouter.ts` | Signal normalization (upstream of dedup) |
| `src/lib/v2/scouts/ta/signalCooldown.ts` | Per-symbol cooldown after signal |
| `src/lib/v2/scouts/ta/streakGuard.ts` | Streak detection (repeated same-direction) |
| `src/lib/v2/safety/correlationGuard.ts` | Correlated signal detection |

## Dedup Rules

1. **Exact duplicate**: Same symbol + direction + source within 5min → DROP
2. **Near duplicate**: Same symbol + direction from different source within 2min → MERGE (take highest confidence)
3. **Gladiator tracking**: Track which gladiator received which signal — prevent double-assignment
4. **Cooldown per symbol**: After signal processed, cooldown before accepting next for same symbol
5. **Streak guard**: >3 consecutive same-direction signals → reduce confidence / skip

## Known Issues

1. **Signal store in-memory only**: Lost on restart → may re-process old signals
   - Fix: Optional Supabase persistence for dedup state

2. **Cooldown too global**: signalCooldown.ts may block valid signals for different pairs
   - Fix: Per-symbol cooldown, not global

3. **No cross-instance dedup**: Multiple Cloud Run instances may process same signal
   - Fix: Use Supabase or Redis for distributed dedup

## Coordination

- Upstream: signal-calibrator (after normalization)
- Downstream: swarm-coordinator (only unique signals pass)
- Reports to: queen-coordinator
- Uses memory key: `swarm/signal-deduplicator/stats`
