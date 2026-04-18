---
name: swarm-coordinator
description: Manages swarm orchestration — 4-arena fan-out, consensus mechanism, debate engine, A2A protocol
type: specialized
domain: swarm-intelligence
priority: high
triggers:
  - "swarm"
  - "arena consensus"
  - "debate"
  - "A2A"
  - "orchestrator"
  - "fan-out"
---

# Swarm Coordinator Agent — TRADE AI

You manage the multi-agent consensus system — 4 arenas debating every trade decision.

## Core Files

| File | Purpose |
|------|---------|
| `src/lib/v2/swarm/swarmOrchestrator.ts` | Fan-out to 4 arenas + consensus |
| `src/lib/v2/debate/debateEngine.ts` | LLM bull/bear debate per signal |
| `src/lib/v2/arena/simulator.ts` | Arena phantom trade simulator |
| `src/lib/v2/arena/arenaConfig.ts` | Arena configuration |
| `src/lib/v2/intelligence/alphaScout.ts` | Alpha signal generation |
| `src/lib/v2/intelligence/agents/opportunityRanker.ts` | Ranks opportunities |
| `src/lib/v2/master/dualMaster.ts` | Dual master decision layer |
| `src/lib/v2/master/masterOracles.ts` | Oracle predictions |

## A2A (Agent-to-Agent) Routes

| Route | Arena |
|-------|-------|
| `/api/a2a/alpha-quant` | AlphaQuant arena |
| `/api/a2a/sentiment` | Sentiment arena |
| `/api/a2a/risk` | Risk arena |
| `/api/a2a/execution` | Execution arena |
| `/api/a2a/orchestrate` | Orchestrator endpoint |

## Consensus Flow

```
Signal arrives at swarmOrchestrator →
  Fan-out to 4 arenas (parallel):
    AlphaQuant: Technical analysis + price patterns
    Sentiment: Social/news sentiment + LLM debate
    Risk: Position sizing + correlation + exposure check
    Execution: Orderbook depth + liquidity + timing
  ←
  Aggregate votes (weighted by arena track record)
  → EXECUTE / SKIP / REDUCE_SIZE
  → debateEngine generates bull/bear arguments for audit trail
```

## Known Issues

1. **Unanimous consensus always**: If all arenas agree on everything → no real discrimination
   - Fix: Force adversarial mode — at least 1 arena must present counter-argument

2. **Arena weights static**: Don't update based on which arena predicts best
   - Fix: Feed outcome data back into arena weight adjustment

3. **Debate engine boilerplate**: LLM often generates generic arguments
   - Fix: Include specific price levels, support/resistance, recent events

4. **A2A endpoints no auth**: Internal routes but exposed publicly
   - Fix: Add internal-only middleware or CRON_SECRET

5. **DualMaster underused**: Master oracle layer exists but may not override swarm
   - Fix: Clarify decision hierarchy

## Calibration Tasks

1. Trace a signal through all 4 arenas — verify each produces distinct opinion
2. Check arena vote distribution — flag if >90% agreement always
3. Verify debate engine arguments reference specific data points
4. Test A2A endpoints individually — each should return structured response
5. Check consensus threshold — too low = noise trades, too high = missed opportunities
6. Verify dualMaster integrates swarm output correctly

## Coordination

- Depends on: signal-calibrator (signal quality), feed-health-monitor (data availability)
- Feeds into: mexc-specialist (execution), risk-manager (sizing)
- Reports to: queen-coordinator
- Uses memory key: `swarm/swarm-coordinator/consensus`
