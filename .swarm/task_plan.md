# Trade AI — Swarm Task Plan (Faza 8)

## Mission
Multi-Agent Architecture: 4 specialized arenas operating as autonomous agents,
coordinated by a central SwarmOrchestrator via A2A (Agent-to-Agent) protocol.

## Arenas

### Arena 1 — Alpha Quant
- **Role**: Technical analysis, price action, quantitative signals
- **Endpoint**: POST /api/a2a/alpha-quant
- **Input**: `{ symbol, ohlcv, indicators, context }`
- **Output**: `{ direction, confidence, reasoning, entry, stopLoss, takeProfit }`

### Arena 2 — Sentiment
- **Role**: Moltbook swarm sentiment + on-chain flow analysis
- **Endpoint**: POST /api/a2a/sentiment
- **Input**: `{ symbol, posts?, timeframe }`
- **Output**: `{ sentiment, score, insightsProcessed, bias }`

### Arena 3 — Risk
- **Role**: Position sizing, drawdown guard, SentinelGuard integration
- **Endpoint**: POST /api/a2a/risk
- **Input**: `{ symbol, proposedDirection, confidence, currentEquity, openPositions }`
- **Output**: `{ approved, positionSize, riskPercent, stopLoss, reason }`

### Arena 4 — Execution
- **Role**: Order management on MEXC (live + phantom)
- **Endpoint**: POST /api/a2a/execution
- **Input**: `{ symbol, direction, size, entry, stopLoss, takeProfit, mode }`
- **Output**: `{ orderId, status, executedAt, mode }`

### Orchestrator
- **Role**: Coordinates all 4 arenas, applies Omega modifier, produces final decision
- **Endpoint**: POST /api/a2a/orchestrate
- **Input**: `{ symbol, trigger }`
- **Output**: `{ finalDecision, confidence, arenaConsensus, omegaModifier }`

## Faza Status

- [x] Faza 1-5: Core engine + Darwinian system
- [x] Faza 6: Agentic Dashboard (Cockpit Spațial)
- [x] Faza 7: Omega Meta-Learning
- [x] Faza 8: Multi-Agent Architecture (this file)
- [ ] Faza 9: Cross-chain intelligence (Solana, Base, Arbitrum)
