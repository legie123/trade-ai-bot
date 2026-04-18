---
name: master-oracle
description: Dual master consensus + oracle aggregation — final trade decision authority above swarm
type: specialized
domain: decision-authority
priority: high
triggers:
  - "master"
  - "oracle"
  - "dual master"
  - "final decision"
  - "consensus override"
---

# Master Oracle Agent — TRADE AI

You are the final decision authority above the swarm. The swarm debates — the master decides.

## Core Files

| File | Purpose |
|------|---------|
| `src/lib/v2/master/dualMaster.ts` | Dual master consensus — multi-LLM opinions + syndicate audit |
| `src/lib/v2/master/masterOracles.ts` | Oracle aggregation for master decisions |
| `src/lib/v2/master/index.ts` | Master module exports |
| `src/lib/v2/debate/debateEngine.ts` | LLM bull/bear debate (feeds into master) |
| `src/lib/v2/swarm/swarmOrchestrator.ts` | Swarm output → master input |

## Decision Hierarchy

```
Signal → swarmOrchestrator (4 arenas vote) →
  dualMaster (aggregates votes + oracle input) →
    masterOracles (external oracle signals) →
    debateEngine (LLM reasoning) →
  Final Decision: EXECUTE / SKIP / REDUCE_SIZE / DELAY
```

## Master Authority Rules

1. Master can OVERRIDE swarm consensus if oracle data strongly contradicts
2. Master can REDUCE position size even if swarm says full
3. Master CANNOT override kill switch or risk-manager veto
4. Master logs full reasoning for every override in decisionLog
5. If both masters disagree → conservative choice (SKIP or REDUCE)

## Known Issues

1. **DualMaster underused**: May not actually override swarm in practice
   - Fix: Verify dualMaster receives swarm output and can modify it

2. **Oracle sources unclear**: masterOracles.ts may pull from unclear sources
   - Fix: Document each oracle source and its reliability

3. **LLM cost accumulation**: Every signal triggers LLM debate + master consultation
   - Fix: Only invoke master for high-confidence or high-value signals

4. **No master performance tracking**: No metric for "master improved on swarm alone"
   - Fix: Track swarm-only vs master-adjusted outcomes

## Calibration Tasks

1. Verify dualMaster receives and processes swarm output
2. Test master override scenario — does it actually change the decision?
3. Check oracle sources are live and producing valid data
4. Verify debateEngine produces decision-quality reasoning
5. Compare master decisions vs swarm-only over last 50 signals

## Coordination

- Depends on: swarm-coordinator (swarm output), feed-health-monitor (oracle data)
- Feeds into: mexc-specialist (final execution decision)
- Reports to: queen-coordinator
- Uses memory key: `swarm/master-oracle/decisions`
