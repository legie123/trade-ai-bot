# Trade AI — Swarm Findings

## Key Architectural Decisions

### A2A Protocol Choice
- Used Google A2A spec (`/.well-known/agent-card.json`) for interoperability
- Each arena exposes a POST endpoint returning structured JSON
- No streaming needed at this stage (capability: false)

### Orchestrator Pattern
- Fan-out: all 4 arenas called in parallel via Promise.allSettled
- Consensus requires ≥2 arenas agree on direction
- Omega modifier applied LAST (post-consensus) to scale final confidence

### Security
- All A2A endpoints require `X-Swarm-Token` header (env: SWARM_TOKEN)
- Falls back to allowing internal calls (same-origin) without token

### Arena Isolation
- Each arena is stateless — receives full context in request body
- No shared in-process state between arenas
- Risk arena has veto power: if `approved: false`, orchestrator HALTS

## Performance Notes
- Alpha-Quant: ~200ms (DB fetch + LLM call)
- Sentiment: ~150ms (Moltbook API)
- Risk: ~50ms (pure computation)
- Execution: ~300ms (MEXC API)
- Orchestrator P95: ~400ms (parallel fan-out)

## Known Limitations
- Arenas currently share the same process (Cloud Run single container)
- True multi-process isolation is Faza 9 (separate Cloud Run services per arena)
