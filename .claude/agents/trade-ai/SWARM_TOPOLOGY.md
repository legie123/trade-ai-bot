---
name: trade-ai-swarm
version: "1.0"
mode: autonomous
restart_policy: always
---

# TRADE AI — Swarm Topology

## Architecture

```
                    ┌─────────────────────┐
                    │  QUEEN COORDINATOR   │
                    │  (master orchestrator)│
                    └──────────┬──────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                      │
    ┌────▼────┐          ┌────▼────┐           ┌────▼────┐
    │ CRITICAL │          │  HIGH   │           │ MEDIUM  │
    │  LAYER   │          │  LAYER  │           │  LAYER  │
    └────┬────┘          └────┬────┘           └────┬────┘
         │                    │                     │
  ┌──────┼──────┐      ┌─────┼─────┐         ┌────┼────┐
  │      │      │      │     │     │         │    │    │
  ▼      ▼      ▼      ▼     ▼     ▼         ▼    ▼    ▼
```

## Layer 0: CRITICAL (run first, can block all others)

| Agent | Runs | Blocks |
|-------|------|--------|
| security-sentinel | On spawn, pre-deploy | ALL agents if CRITICAL vuln |
| pipeline-guardian | Continuous | gladiator-trainer, swarm-coordinator |
| risk-manager | Pre-execution | mexc-specialist, position-tracker |
| mexc-specialist | On demand | None |
| position-tracker | Every 1min (via cron) | None |
| deploy-commander | On deploy | ALL agents during deploy |
| auth-gatekeeper | On spawn, continuous | Blocks unauthorized access |
| supabase-guardian | Continuous | ALL agents lose persistence if down |
| pre-live-gate | Before LIVE transition | Blocks PAPER→LIVE if any check fails |

## Layer 1: HIGH (core operations)

| Agent | Runs | Depends On |
|-------|------|-----------|
| gladiator-trainer | Post-trade, periodic | pipeline-guardian |
| signal-calibrator | Per-signal | feed-health-monitor |
| confidence-auditor | Periodic audit | signal-calibrator |
| swarm-coordinator | Per-signal | signal-calibrator, feed-health-monitor |
| cron-orchestrator | Continuous | deploy-commander |
| feed-health-monitor | Continuous | None (independent) |
| experience-learner | Post-trade | pipeline-guardian, gladiator-trainer |
| omega-strategist | Periodic | feed-health-monitor |
| observability-agent | Continuous | None (independent) |
| polymarket-overseer | Continuous | pipeline-guardian |
| master-oracle | Per-signal (high-value) | swarm-coordinator |
| backtest-engine | Pre-promotion | feed-health-monitor |
| auto-debugger | Continuous | observability-agent |
| telegram-alerter | Event-driven | None (independent) |
| paper-wallet-auditor | Continuous | mexc-specialist |
| signal-deduplicator | Per-signal | signal-calibrator |
| daily-rotation-manager | Daily midnight UTC | gladiator-trainer, experience-learner |

## Layer 2: MEDIUM (enrichment)

| Agent | Runs | Depends On |
|-------|------|-----------|
| sentiment-analyst | Every 30min | feed-health-monitor |
| intelligence-scout | Continuous | feed-health-monitor |
| dashboard-validator | Periodic | observability-agent |
| asset-engine-btc | Per BTC signal | feed-health-monitor |
| asset-engine-sol | Per SOL signal | feed-health-monitor |
| asset-engine-meme | Per meme signal | feed-health-monitor, sentiment-analyst |

## Signal Flow (end-to-end)

```
External Signal → 
  feed-health-monitor (verify sources) →
  signal-deduplicator (prevent duplicates) →
  signal-calibrator (quality + confidence) →
  asset-engine-{btc|sol|meme} (asset-specific rules) →
  omega-strategist (regime context) →
  swarm-coordinator (4-arena consensus) →
  master-oracle (final decision authority) →
  risk-manager (safety gates) →
  mexc-specialist (execution) →
  position-tracker (lifecycle) →
  telegram-alerter (notify human) →
  experience-learner (outcome → learning) →
  gladiator-trainer (evolution) →
  daily-rotation-manager (daily lifecycle)
```

## Startup Sequence

```
Phase 1: security-sentinel (audit)
Phase 2: feed-health-monitor + observability-agent (parallel)
Phase 3: mexc-specialist + pipeline-guardian (parallel)
Phase 4: risk-manager + cron-orchestrator (parallel)
Phase 5: ALL remaining agents (parallel)
```

## Communication

All agents communicate via memory keys under `swarm/` namespace:
- Write: `swarm/{agent-name}/{topic}`
- Read: Any agent can read any other agent's state
- Queen polls all agents every cycle

## Health Aggregation

Queen coordinator aggregates:
- SYSTEM_HEALTHY: All agents report OK
- DEGRADED: ≥1 HIGH agent reports issues
- CRITICAL: Any CRITICAL agent reports failure → engage kill switch
