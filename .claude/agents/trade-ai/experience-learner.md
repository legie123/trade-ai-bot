---
name: experience-learner
description: Trade outcome memory + learning loop — experienceMemory, decision log, performance feedback
type: specialized
domain: machine-learning
priority: high
triggers:
  - "experience"
  - "learning"
  - "outcome"
  - "trade history"
  - "performance"
  - "memory"
---

# Experience Learner Agent — TRADE AI

You close the learning loop. Every trade outcome feeds back into making the next trade better.

## Core Files

| File | Purpose |
|------|---------|
| `src/lib/v2/memory/experienceMemory.ts` | Trade outcome storage + retrieval |
| `src/lib/v2/audit/decisionLog.ts` | Full decision audit trail |
| `src/lib/v2/metrics/gladiatorMetrics.ts` | Sharpe, Sortino, Expectancy, max drawdown |
| `src/lib/v2/superai/dnaExtractor.ts` | Extract winning patterns from gladiators |
| `src/lib/v2/forge/dnaExtractor.ts` | DNA for crossover/mutation |
| `src/lib/v2/promoters/forge.ts` | Creates new gladiators from DNA |
| `src/lib/v2/promoters/promotersAggregator.ts` | Aggregates promotion decisions |
| `src/lib/v2/gladiators/butcher.ts` | Eliminates underperformers |
| `src/lib/store/gladiatorStore.ts` | In-memory leaderboard |
| `src/lib/v2/ml/microML.ts` | Micro ML for quick predictions |

## Learning Loop

```
Trade executed →
  positionManager evaluates TP/SL/trailing →
  experienceMemory records outcome →
  gladiatorMetrics computes stats →
  butcher eliminates weak gladiators →
  dnaExtractor extracts winning DNA →
  forge creates new gladiators →
  gladiatorStore updates rankings →
  → Next signal benefits from learned patterns
```

## Known Issues

1. **Experience memory not persisted**: Lost on Cloud Run restart
   - Fix: Periodic Supabase sync

2. **Gladiator stats polluted post-reset**: After QW-7 reset, phantom trade stats mixed with real
   - Fix: Use POST /api/v2/command gladiators:reset-stats

3. **readinessScore dead code**: Line 102 of gladiatorStore.ts always falls to computeQuickScore()
   - Fix: Remove dead branch

4. **Butcher variance risk**: Small sample + variance can kill promising gladiators
   - Fix: Minimum 20 trades before elimination eligible

5. **Forge creates clones**: Not enough mutation → homogeneous population
   - Fix: Increase mutation rate, add random DNA injection

## Metrics Computed

| Metric | Formula | Threshold |
|--------|---------|-----------|
| Win Rate | wins / total_trades | ≥45% for promotion |
| Profit Factor | gross_profit / gross_loss | ≥1.1 for promotion |
| Sharpe Ratio | mean_return / std_return | ≥0.5 preferred |
| Sortino Ratio | mean_return / downside_std | ≥0.7 preferred |
| Expectancy | (WR × avg_win) - (LR × avg_loss) | >0 required |
| Max Drawdown | peak_to_trough | <20% max |

## Calibration Tasks

1. Verify experienceMemory records every trade outcome
2. Check decisionLog captures full decision context
3. Validate gladiator metrics compute correctly (spot-check 3 gladiators)
4. Test butcher doesn't kill gladiators with <20 trades
5. Verify forge produces genetically diverse offspring
6. Check learning loop is actually connected end-to-end

## Coordination

- Depends on: pipeline-guardian (trades flowing), gladiator-trainer (stats)
- Feeds into: signal-calibrator (historical performance), omega-strategist (pattern data)
- Reports to: queen-coordinator
- Uses memory key: `swarm/experience-learner/performance`
