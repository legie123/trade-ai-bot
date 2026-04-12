# TRADE AI PHOENIX V2 — MASTER BLUEPRINT V2

**Versiunea**: 2.0 (Post-Implementare Faze 0-5 Complete)  
**Data consolidării**: 12 Aprilie 2026  
**Surse integrate**: MASTER_BLUEPRINT_V1.md, CLAUDE_MASTER_PROMPT.md, ANTIGRAVITY_CLAUDE_SYNC.md, docs/gemini_analysis_v2.md, implementation_plan.md, inspecție directă cod sursă  
**Status**: Document unic de referință activ. V1 și toate documentele anterioare sunt **ARHIVATE** (nu mai sunt surse de adevăr).

---

## PROGRESS IMPLEMENTARE (Status 12 Apr 2026)

| Fază | Status | Detalii |
|---|---|---|
| FAZA 0 — Validare Infrastructură | ✅ COMPLET | Schema SQL validată, `trade_locks` tabel creat |
| FAZA 1 — Fix-uri Critice (3 buguri) | ✅ COMPLET | Seed stats=0, Emergency exit → MEXC, PriceCache în PositionManager |
| FAZA 2 — Fix-uri Majore (5 buguri) | ✅ COMPLET | Persist leaderboard, Forge paralel, Arena TTL, Audits persist, TradeLock |
| FAZA 3 — Migrare DNA la tabel dedicat | ✅ COMPLET | `gladiator_battles` tabel + DNAExtractor async Postgres path |
| FAZA 4 — Îmbunătățire Calitate Semnale | ✅ COMPLET | Signal-quality endpoint, SentinelGuard hardened, LIVE consensus 75%, riskPerTrade 1.0%, maxPositions 2 |
| FAZA 4+ — Forge pre-screening + gladiator gate | ✅ COMPLET | `miniBacktest` + `isDNASane` gates, WR ≥ 45% + PF ≥ 1.1 pentru live |
| FAZA 5 — Validare End-to-End | 🔄 TOOLING READY | `reset_paper_mode.ts` + `pre_live_check.ts` create. **Awaiting deploy + 14-day monitoring.** |
| FAZA 6 — Dashboard Agentic Mode | 🔲 PLANIFICAT | Redesign complet UI → Cockpit Spațial (detalii Secțiunea 5) |
| FAZA 7 — Omega Gladiator + Meta-Learning | 🔲 PLANIFICAT | Implementare logică Omega (agregare DNA top 3) |

---

## SECȚIUNEA 1 — VERDICT EXECUTIV

Sistemul este **arhitectural solid și infrastructural blindat**. Toate bug-urile critice și majore din V1 au fost remediate. Fazele 0–4+ sunt finalizate cu TypeScript 0 erori.

**Stare curentă**:
- Infrastructura SRE: ✅ Hardened (Cloud Run serverless, fără `setInterval`, fără zombie positions)
- Execuție ordine: ✅ Zero slippage (`STOP_LOSS` market pe MEXC, nu limit)
- Darwinian loop: ✅ Funcțional cu stats reale (seed stats = 0, gladiatorii câștigă `isLive` exclusiv prin merit)
- Emergency exit: ✅ Corectat → MEXC (nu Binance)
- RL Memory: ✅ Tabel `gladiator_battles` dedicat (fără limita de 2000 records)
- Signal quality: ✅ Endpoint activ, SentinelGuard hardened

**Win Rate estimat la pornire**: ~26% (gladiatori fără track record real).  
**Target 30 zile paper**: >45%.  
**Target 90 zile**: >65%.

**Concluzie gap**: Gap-ul 26%→70% nu este în arhitectură. Este în (1) calitatea semnalelor per sursă și (2) numărul de rotații Darwiniene complete necesare selecției naturale a gladiatorilor performanți. Sistemul are acum mecanismele corecte pentru a converge.

---

## SECȚIUNEA 2 — ARHITECTURA FINALĂ

### 2.1 Stack Tehnic (Production-Grade Confirmat)

| Componentă | Tehnologie | Status |
|---|---|---|
| Framework | Next.js 16.1.6 + TypeScript 5 + React 19 | ✅ ACTIV |
| Runtime | Node.js serverless pe Google Cloud Run | ✅ ACTIV |
| Baza de date | Supabase (PostgreSQL) cu in-memory cache | ✅ ACTIV |
| Broker primar | MEXC (Market orders + OCO pending) | ✅ ACTIV |
| Brokeri fallback | Binance, OKX (price feed + emergency secondary) | ✅ ACTIV |
| LLM primar (ARCHITECT) | OpenAI GPT-4o | ✅ ACTIV |
| LLM primar (ORACLE) | DeepSeek Chat | ✅ ACTIV |
| LLM fallback | Gemini 2.5 Flash | ✅ ACTIV |
| Scheduling | Cloud Scheduler → HTTP Cron Routes | ✅ ACTIV |
| Social broadcast | Moltbook API | ✅ ACTIV |
| Agent communication | MCP (Model Context Protocol) + A2A | 🔲 PLANIFICAT (Faza 7+) |

### 2.2 Harta Modulelor — Fluxul Complet de Decizie

```
SEMNAL EXTERN
(TradingView webhook / btcEngine / memeEngine / solanaEngine / btc-signals API)
        ↓
  [SignalRouter] → normalizare + routing per tip semnal
        ↓
  [AlphaScout] → context de piață (CoinGecko, CryptoCompare, Fear&Greed Index)
        ↓
  [DNAExtractor] → intelligence digest per gladiator (RL modifier: 0.5x–1.5x)
        ↓
  [DualMasterConsciousness] → PARALLEL:
      ├─ ARCHITECT (OpenAI GPT-4o) → analiză TA pură
      └─ ORACLE (DeepSeek Chat)   → sentiment behavioral
        ↓
  Jaccard hallucination defense (>70% similaritate = redundancy block)
  Market anchoring (≥15% numere din prompt trebuie în reasoning)
  Confidence penalizare până la -30% pe hallucination detectat
  LONG vs SHORT → FLAT automat dacă conflict
        ↓
  [SentinelGuard] → WinRate guard (rolling 20 trades, threshold 40%)
                    StreakBreaker (4 pierderi consecutive)
                    MDD equity check (10%)
                    Daily loss limit (3)
                    Cooldown 4h cu auto-resume
        ↓ APROBAT
  [ManagerVizionar] → acquireTradeLock (distributed, Supabase RPC)
                       isPositionOpenStrict (anti-duplicat)
        ↓
  [ExecutionMEXC] → Market order pe MEXC (zero slippage)
        ↓
  [PositionManager] → T1@1% qty 30% (Limit Order)
                       Trailing SL post-T1: 5% de la peak
                       Initial Fixed SL pre-T1: 5%
                       Zombie prevention (min qty check)
        ↓
  [DNAExtractor.logBattle] → INSERT în gladiator_battles (PostgreSQL)
        ↓
  [GladiatorStore.updateStats] → actualizare WR / PF / totalTrades
        ↓
  [Cron 00:00 UTC] → ArenaSimulator → TheButcher → TheForge → Leaderboard → Moltbook
```

### 2.3 Stratificarea Datelor (Supabase PostgreSQL)

```
Tables:
├── json_store           → config, decisions, optimizer, gladiators, phantom_trades
├── equity_history       → equity curve (append-only, non-destructiv)
├── syndicate_audits     → LLM consensus logs
│   ├── final_direction  TEXT         ← ADĂUGAT în Faza 2
│   └── hallucination_report JSONB    ← ADĂUGAT în Faza 2
├── live_positions       → poziții deschise pe MEXC
├── trade_locks          → distributed lock anti-duplicat
└── gladiator_battles    → RL memory (fără limită 2000) ← CREAT în Faza 3

RPC Functions:
└── acquire_trade_lock(p_symbol, p_instance_id, p_expires_at) → BOOLEAN
```

### 2.4 Arhitectura Multi-Agent (Viziune Faza 7+)

Bazată pe analiza Gemini 3.1 — framework pentru extindere la sistem multi-agent distribuit:

```
MASTER AI (Ramura Legislativă)
  └─ Constituția proiectului (AGENTS.md, Rules)
  └─ Definește ce este permis, ce este interzis

MANAGER AI (Ramura Executivă)
  └─ Task decomposition → până la 5 agenți simultan
  └─ Git Worktrees per agent (izolare conflicte)
  └─ Director .swarm/ → task_plan.md / progress.md / findings.md

AGENȚI SPECIALIZAȚI (Execuție)
  ├─ Arena 1: Analiză Cantitativă & Alpha Generation (Sharpe, Monte Carlo, Backtesting)
  ├─ Arena 2: Sentiment, Social & Moltbook Integration (NLP, heartbeat 30min)
  ├─ Arena 3: Risk Management & Cybersecurity (Kill Switch, IAM, VPC-SC)
  └─ Arena 4: Execuție, Browser-Use & Verificare (MCP, BigQuery, Browser recordings)

Protocoale de comunicare:
  ├─ MCP (Model Context Protocol) — "USB-C pentru AI", acces uniform la unelte/DB
  └─ A2A (Agent-to-Agent) — Lingua franca inter-arene, Agent Cards la /.well-known/agent-card.json
```

---

## SECȚIUNEA 3 — STATUS PER MODUL (Post-Fix)

### 3.1 DualMasterConsciousness
**Fișier**: `src/lib/v2/master/dualMaster.ts` | **Status**: ✅ PRODUCȚIE — Fără modificări necesare

Funcționează corect: apeluri LLM paralele via `Promise.allSettled`, fallback chain (OpenAI → DeepSeek → Gemini), Jaccard similarity (redundancy defense >70%), market data anchoring (≥15% numere), penalizare confidence -30% pe hallucination, FLAT dacă ambii masters sunt unanchored, arbitrare LONG vs SHORT → FLAT automat.

---

### 3.2 SentinelGuard
**Fișier**: `src/lib/v2/safety/sentinelGuard.ts` | **Status**: ✅ PRODUCȚIE — Fix aplicat în Faza 1

Implementat: MDD pe equity curve compusă, WinRate guard rolling 20 trades (40%), StreakBreaker 4 pierderi, daily loss limit 3, cooldown 4h, kill switch → OBSERVATION mode.

**Fix aplicat (BUG #3)**: `emergencyExitAllPositions()` apelează acum MEXC (via `getLivePositions()` + `cancelAllMexcOrders` + `placeMexcMarketOrder`). Binance rămâne fallback secundar doar pentru assets migrate accidental.

---

### 3.3 DNAExtractor
**Fișier**: `src/lib/v2/superai/dnaExtractor.ts` | **Status**: ✅ PRODUCȚIE — Migrat la Postgres în Faza 3

Calculează: winRate, recentWinRate (last 20), streak detection, direction bias (LONG vs SHORT WR), expectancy per simbol, avgHoldTime, confidenceModifier (0.5–1.5x). DNA stocat în `gladiator_battles` (PostgreSQL dedicat, fără limita de 2000 records). Paginare la ultimele 500 batalii per gladiator pentru `extractIntelligence`.

---

### 3.4 TheForge
**Fișier**: `src/lib/v2/promoters/forge.ts` | **Status**: ✅ PRODUCȚIE — Fixes aplicate în Faza 2 + 4+

LLM genetic mutation cu fallback chain (DeepSeek → OpenAI → Gemini → deterministic crossover → randomDNA). Spawning paralel via `Promise.allSettled` (nu secvențial). Pre-screening: `miniBacktest` pe ultimele 50 ticks + `isDNASane` gate. Un gladiator nou intră în Arena **doar dacă** backtest expectancy > 0.

---

### 3.5 TheButcher
**Fișier**: `src/lib/v2/gladiators/butcher.ts` | **Status**: ✅ PRODUCȚIE — Fără modificări necesare

Hard delete din DB + hydrate store. Criterii: `totalTrades ≥ 20`, `WinRate ≥ 40%` OR `PF ≥ 0.9`. Omega Gladiator imun. Fără shadow mode sau reset PnL.

---

### 3.6 ArenaSimulator
**Fișier**: `src/lib/v2/arena/simulator.ts` | **Status**: ✅ PRODUCȚIE — Fix aplicat în Faza 2

`getCachedPrice` deleghează la `getOrFetchPrice` (PriceCache global). Batch prefetch prețuri înainte de evaluare. TTL refresh gladiatori: 60s (nu la fiecare cycle). Phantom TTL: 15 minute. Min hold: 60s.

---

### 3.7 PositionManager
**Fișier**: `src/lib/v2/manager/positionManager.ts` | **Status**: ✅ PRODUCȚIE — Fix aplicat în Faza 1

Asymmetric TP (T1@1%, 30% qty), Trailing SL post-T1 (5% de la peak), Initial Fixed SL (5%), zombie prevention, DNA logging, Moltbook broadcast. Prețul curent vine din `getOrFetchPrice` (PriceCache) — nu direct MEXC API.

---

### 3.8 PriceCache
**Fișier**: `src/lib/cache/priceCache.ts` | **Status**: ✅ PRODUCȚIE — Singleton de referință

Singleton via `globalThis` (supraviețuiește Next.js hot reload), dedup lock per simbol, TTL 30s normal / 120s fallback, fallback chain MEXC → Binance → OKX → DexScreener → CoinGecko, batch cu chunk 10 + 200ms delay.

---

### 3.9 GladiatorStore (seed)
**Fișier**: `src/lib/store/gladiatorStore.ts` | **Status**: ✅ FIX CRITIC APLICAT în Faza 1

`seedGladiators()` inițializează toți gladiatorii cu:
```typescript
stats: { winRate: 0, profitFactor: 1.0, maxDrawdown: 0, sharpeRatio: 0, totalTrades: 0 },
isLive: false,
status: 'IN_TRAINING',
trainingProgress: 0,
```
`isLive: true` se acordă **exclusiv** prin rotația Darwiniană (cron 00:00 UTC → top 3 după ≥20 trades cu WR ≥ 45% și PF ≥ 1.1).

---

### 3.10 Database (db.ts)
**Fișier**: `src/lib/store/db.ts` | **Status**: ✅ PRODUCȚIE — Fixes aplicate în Faze 2-3

Task queue cu debounce per ID, distributed trade lock via Supabase RPC + fallback INSERT, equity curve compusă (non-destructivă), merge multi-instance pe gladiatori. Schema `syndicate_audits` are coloanele `final_direction` și `hallucination_report`. RPC `acquire_trade_lock` creat în Supabase.

---

### 3.11 CronDailyRotation
**Fișier**: `src/scripts/cron_dailyRotation.ts` | **Status**: ✅ PRODUCȚIE — Fix aplicat în Faza 2

Flux corect: evaluate phantoms → Butcher → Forge → leaderboard update → `saveGladiatorsToDb(gladiators)` → Moltbook broadcast. Rankings și `isLive` persistă la restart.

---

### 3.12 V1 Scoring Engine
**Fișiere**: `src/lib/scoring/` | **Status**: 🟡 ROLUL SCHIMBAT — Pre-procesor, nu trigger

VWAP/RSI/volume-based scoring operează **exclusiv** ca input pentru `alphaContext`. Nu declanșează trade-uri direct. Toate rutele care importau din `src/lib/scoring/` ca trigger final au fost redirecționate prin `ManagerVizionar`.

---

## SECȚIUNEA 4 — BUGS STATUS (Lista Completă)

| # | Severitate | Fișier | Descriere | Status |
|---|---|---|---|---|
| 1 | CRITIC | `gladiatorStore.ts` | Seed cu stats fictive | ✅ FIX APLICAT — Stats = 0 |
| 2 | CRITIC | `positionManager.ts:46` | `getMexcPrice()` direct, bypass PriceCache | ✅ FIX APLICAT — `getOrFetchPrice()` |
| 3 | CRITIC | `sentinelGuard.ts` | Emergency exit apelează Binance, nu MEXC | ✅ FIX APLICAT — MEXC first |
| 4 | MAJOR | `db.ts` | `syndicate_audits` schema lipsă coloane | ✅ FIX APLICAT — ALTER TABLE executat |
| 5 | MAJOR | `cron_dailyRotation.ts` | Lipsă `saveGladiatorsToDb` după leaderboard | ✅ FIX APLICAT |
| 6 | MAJOR | `forge.ts` | Spawn LLM secvențial (5 calls în serie) | ✅ FIX APLICAT — `Promise.allSettled` |
| 7 | MEDIU | `simulator.ts` | `refreshGladiatorsFromCloud` la fiecare cycle | ✅ FIX APLICAT — TTL 60s |
| 8 | MEDIU | `db.ts` | RPC `acquire_trade_lock` absent | ✅ FIX APLICAT — RPC creat în Supabase |
| 9 | MEDIU | `db.ts` | `gladiator_dna` în `json_store` (cap 2000) | ✅ FIX APLICAT — Tabel `gladiator_battles` |
| 10 | MINOR | `gladiatorStore.ts` seed | Omega Gladiator `isLive: false`, stats 0 | ✅ CORECT — `isOmega: true` păstrat |

**Toți cei 10 buguri confirmați în V1 sunt remediați.**

---

## SECȚIUNEA 5 — DASHBOARD AGENTIC MODE (Faza 6 — Planificat)

### 5.1 Schimbarea de Paradigmă

Trecerea de la "Trading Bot Monitor" la **Agent Consciousness Dashboard**. Interfața reflectă conștiința și deciziile autonome ale agentului, nu statistici statice de bot.

| Vechi | Nou | Descriere |
|---|---|---|
| Core Monitor | **Agent Core Engine (Cortex)** | Starea de gândire: Idle / Ingesting / Synthesizing / Executing |
| Trading Pipeline | **Autonomous Decision Pipeline** | Confidence Level per trade, autonomia portofoliului |
| Provider Health | **Swarm Connectivity (Ecosystem)** | Conexiunea Moltbook, calitatea semnalului inter-agent |
| System Execution Logs | **Live Neural Logs & Evolution** | Execution (acțiuni de piață) + Learning/Thoughts (raționament AI) |

### 5.2 Componente Noi

**AgentStatusHero** (header)
- Vizualizare live a stării: memorie alocată AI, latența de gândire
- Animație "Synapse Pulse" generată cu Canvas — pulsație accelerată la procesare decizii
- Kill Switch repoziționat: copertă de sticlă roșie tip "Panic Button" premium (vizibil la hover, nu permanent în header)

**DecisionMatrix** (centru)
- Grafice decizionale: Confidence % per coin în timp real
- "Live Logic Engine": când se generează un semnal, afișează raționamentul AI:
  ```
  Action: SELL XAUUSD
  Reasoning: Conflicting AVWAP lines with negative sentiment from swarm (-82%)
  Confidence: 78% | SentinelGuard: APPROVED | Gladiator: ARES-7
  ```

**MoltbookSwarmFeed** (lateral stânga/dreapta)
- Flux live de descoperiri de pe rețea
- Ce postări a citit agentul recent
- Market Sentiment derivat: `Bullish +80% după procesare 12 insight-uri AI`

**TerminalOverlay** (footer)
- Loguri mutate într-un terminal custom integrat discret
- Stil hacker-console, compactat jos (gen DevTools drawer)
- Împărțit: Execution logs | Learning/Thoughts

### 5.3 Design System

- Temă: Cyberpunk neuromorphic — **Cyan + Dark Violet** (culori principale), **Auriu** la execuții premium
- Glassmorphism profund pe toate panelurile
- Grid asimetric "Cockpit Spațial" — nu card-uri standard
- Implementare: React/CSS Modules fără librării third-party masive (compatibil Cloud Run)

### 5.4 Modificări Cod (`src/app/dashboard/page.tsx`)

**Eliminat**:
- `styles.grid` cu cele 3 card-uri standard (Monitor, Pipeline, Health)
- `styles.logBox` vertical extins

**Adăugat**:
```
src/app/dashboard/
├── components/
│   ├── AgentStatusHero.tsx    → stare agent + synapse animation
│   ├── DecisionMatrix.tsx     → confidence charts + live logic
│   ├── MoltbookSwarmFeed.tsx  → swarm intelligence panel
│   └── TerminalOverlay.tsx    → hacker-console logs drawer
```

---

## SECȚIUNEA 6 — ZONE INCOMPLETE / INCERTE (Status Curent)

### ⚠️ ZONA 1: Omega Gladiator (Dead Code — Prioritate Medie)
`OMEGA-GLADIATOR` există cu `isOmega: true`, `isLive: false`, `stats: { totalTrades: 0 }`. Nicio logică de activare sau meta-learning implementată.

**Decizie necesară**: Implementează logica Omega (agregare DNA din top 3, model meta-learning) sau șterge placeholder-ul din codebase pentru curățenie.

---

### ⚠️ ZONA 2: Moltbook Integration (Neauditat)
`postActivity()` este apelat în multiple locuri (SentinelGuard, PositionManager, DailyRotation, PromotersAggregator). `moltbookClient.ts` nu a fost auditat complet.

**Risc**: Apeluri Moltbook non-await sau cu `.catch(() => {})` pot masca erori silențios. Verifică că toate call-urile sunt fire-and-forget cu timeout explicit (≤5s).

---

### ⚠️ ZONA 3: Signal Quality per Sursă (Cauza Principală WR 26%)
Există endpoint `/api/diagnostics/signal-quality` (creat în Faza 4), dar datele per sursă (btcEngine, memeEngine, solanaEngine, tradingview) necesită minim 30 zile de acumulare pentru a fi acționabile.

**Acțiune după 30 zile paper**:
1. Citește WR per sursă din endpoint
2. Dezactivează sursele cu WR < 35%
3. Crește `weightedConfidence` threshold în SentinelGuard de la 0.75 la 0.80 dacă WR global depășește 50%

---

### ⚠️ ZONA 4: Schema SQL (Validată Parțial)
`src/lib/store/schema.sql` este sursa de adevăr pentru structura Supabase. Verifică la fiecare deploy major că schema din fișier este sincronizată cu tabelele live, în special `gladiator_battles` (creat în Faza 3) și coloanele noi din `syndicate_audits`.

---

## SECȚIUNEA 7 — ROADMAP FAZA 6+ (Next Steps)

### FAZA 6 — Dashboard Agentic Mode (Target: Săptămânile 3-4)
**Obiectiv**: UX complet renovat pentru a reflecta natura agentică a sistemului.

1. Implementează `AgentStatusHero` cu animație Canvas Synapse
2. Implementează `DecisionMatrix` cu live confidence charts
3. Implementează `MoltbookSwarmFeed` (conectat la API Moltbook)
4. Implementează `TerminalOverlay` (hacker-console drawer)
5. Redesign layout global — grid asimetric, glassmorphism, Kill Switch repoziționat
6. Deploy pe Cloud Run + verificare performanță (fără librării masive)

---

### FAZA 7 — Omega Gladiator & Meta-Learning (Target: Luna 2)
**Obiectiv**: Activarea gladiatorului meta care agregă intelligence din top performeri.

1. Definește schema DNA Omega: agregat ponderat din top 3 gladiatori (media ponderată WR × PF)
2. Implementează `OmegaExtractor.synthesize()` — rulează post-Forge în cron zilnic
3. Omega nu tranzacționează direct — modifică `confidenceModifier` al celorlalți gladiatori (meta-signal)
4. Test: WR Omega agregat vs WR mediu gladiatori individuali pe 30 zile phantom

---

### FAZA 8 — Arhitectura Multi-Agent (Target: Luna 3)
**Obiectiv**: Extindere la sistem distribuit cu 4 arene și comunicare A2A.

1. Implementează `/.well-known/agent-card.json` pentru fiecare arenă
2. Configurare MCP server pentru acces uniform la DB + unelte
3. Director `.swarm/` cu `task_plan.md`, `progress.md`, `findings.md` per agent
4. Arena 1 (Alpha Quant): Sharpe ratio live, Monte Carlo simulare, backtesting on-demand
5. Arena 2 (Sentiment): NLP pe Moltbook feed, heartbeat 30 min
6. Arena 3 (Risk): Kill switch evoluат cu Velocity Kill Switch formula:
   ```
   IF ΔT < Threshold_Minutes AND Spend%Delta >= Threshold_Increase → TRIGGER KILL SWITCH
   ```
7. Arena 4 (Execution + Verification): Browser-Use pentru verificare cross-platform, BigQuery analytics

---

### FAZA 9 — Live Deployment (Target: Ziua 14+ post-Faza 5)
**Condiții obligatorii pentru LIVE**:
- ≥ 1 gladiator cu 20+ phantom trades și WR ≥ 45% real (nu seeded)
- Kill switch testat: trigger → emergency exit pe MEXC verificat manual
- Signal quality: cel puțin o sursă cu WR ≥ 50% pe 30 zile phantom
- `GET /api/diagnostics/master` → toate componentele verzi
- `riskPerTrade` ≤ 1.0% (primele 30 zile live)
- Capital inițial: < 5% din total (capital sacrificabil)

---

## SECȚIUNEA 8 — STANDARDE DE PRODUCȚIE

### Configurație Obligatorie `.env.local` / Cloud Run
```
NEXT_PUBLIC_SUPABASE_URL=https://[project].supabase.co
SUPABASE_SERVICE_ROLE_KEY=[service_role_key]      # OBLIGATORIU — bypass RLS
NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon_key]
OPENAI_API_KEY=[key]
DEEPSEEK_API_KEY=[key]
GEMINI_API_KEY=[key]
MEXC_API_KEY=[key]
MEXC_API_SECRET=[key]
BINANCE_API_KEY=[key]                             # Fallback only
BINANCE_API_SECRET=[key]
TELEGRAM_BOT_TOKEN=[token]
MOLTBOOK_API_KEY=[key]
```

### Parametri Operaționali (Stare Curentă)

| Parametru | Valoare Curentă | Justificare |
|---|---|---|
| `mddThreshold` | 10% | Nu schimba |
| `dailyLossLimit` | 3 | Conservator pentru calibrare |
| `minWinRate` (SentinelGuard) | 40% | Aliniat cu criteriul Butcher |
| `maxLossStreak` | 4 | Reacție rapidă |
| `consensus threshold` (LIVE) | 75% | Filtrare strictă |
| `riskPerTrade` | 1.0% (primele 30 zile) | Protecție capital calibrare |
| `maxOpenPositions` | 2 (primele 30 zile) | Reducerea corelației |
| Phantom trade TTL | 15 min | Nu schimba |
| Gladiator LIVE threshold | 20 trades + WR ≥ 45% + PF ≥ 1.1 | Prag exigent |

### Reguli Hard (Nenegociabile)

1. **Stats seed = ZERO** — Orice cod care inițializează stats > 0 fără trade real este interzis.
2. **Kill switch → MEXC first** — Binance doar pentru assets migrate accidental. Verificat cu test controlled.
3. **`gladiator_dna` paginare ≤ 500 records per gladiator** în memorie pentru `extractIntelligence`.
4. **DualMaster FLAT = NO TRADE** — Zero override extern.
5. **`isLive: true` exclusiv prin rotație Darwiniană** — Niciodată setat manual sau inițial.
6. **Moltbook calls: fire-and-forget cu timeout ≤ 5s** — Nu blochează execuția ordinelor.

---

## SECȚIUNEA 9 — METRICI DE SUCCES

| Metric | Valoare Actuală | Target 30 Zile | Target 90 Zile |
|---|---|---|---|
| Win Rate (phantom) | ~26% (estimat) | >45% | >65% |
| Profit Factor | Necunoscut | >1.2 | >1.5 |
| Expectancy per trade | Negativ | >0 | >0.3% |
| Gladiatori activi cu stats reale | 0 (reset la 0) | 5-10 | 10-15 (Darwinian) |
| Rotații Darwiniane complete | 0 | ≥ 5 | ≥ 20 |
| Kill switch false positives | N/A | 0 | 0 |
| Latență evaluare phantom batch | Necunoscută | < 5s per cycle | < 2s |
| Surse semnal active (WR ≥ 35%) | Necunoscut | Identificate | ≥ 2 surse curate |

---

## SECȚIUNEA 10 — SELF-CHECK FINAL ÎNAINTE DE LIVE

- [ ] `seedGladiators()` — zero valori > 0 pentru stats
- [ ] `emergencyExitAllPositions()` apelează MEXC, nu Binance
- [ ] `positionManager.ts` importă `getOrFetchPrice` din PriceCache
- [ ] `cron_dailyRotation.ts` apelează `saveGladiatorsToDb` după leaderboard update
- [ ] `syndicate_audits` tabel are coloanele `final_direction` și `hallucination_report`
- [ ] Schema SQL sincronizată cu `db.ts` (incl. `gladiator_battles`, RPC `acquire_trade_lock`)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` (nu anon key) activ în Cloud Run
- [ ] Cel puțin un gladiator cu 20+ phantom trades și stats reale
- [ ] Nicio sursă de semnal cu WR < 35% nu este activă
- [ ] `GET /api/health` → 200 OK
- [ ] `GET /api/diagnostics/master` → toate componentele OK
- [ ] Kill switch testat manual în PAPER mode (trigger + MEXC exit verificat)
- [ ] `riskPerTrade` ≤ 1.0% pentru primele 30 zile live
- [ ] Capital inițial live < 5% din total

---

## SECȚIUNEA 11 — DOCUMENTE ARHIVATE

Toate documentele de mai jos sunt **superseded** de acest Blueprint V2. Nu le folosi ca referință.

| Document | Motiv Arhivare |
|---|---|
| `MASTER_BLUEPRINT_V1.md` | Superseded de V2. Fazele 0-5 sunt complete; body-ul V1 era forward-looking. |
| `CLAUDE_MASTER_PROMPT.md` | Document de onboarding inițial. Context integrat în V2. |
| `ANTIGRAVITY_CLAUDE_SYNC.md` | Document de coordonare inter-agent. Fix-urile executate sunt reflectate în Sec. 3-4. |
| `docs/gemini_analysis_v2.md` | Analiza Gemini integrată în Sec. 2.4 (Multi-Agent) și Sec. 7 (Faza 8). |
| `implementation_plan.md` | Planul de Agentic Mode integrat în Sec. 5. |
| `audit_trade_ai.md` | Auditul inițial. Toate bug-urile identificate sunt rezolvate (Sec. 4). |

---

*MASTER_BLUEPRINT_V2.md — Singurul document activ. Ultima actualizare: 12 Aprilie 2026.*
