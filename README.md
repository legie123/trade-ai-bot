# 🐉 TRADE AI — Phoenix V2 Trading Engine

**Autonomous Darwinian Crypto Trading System**
Built with Next.js 16 + TypeScript 5 + Supabase + Multi-LLM Consensus

[![Status](https://img.shields.io/badge/status-production-green)]()
[![Cloud Run](https://img.shields.io/badge/deploy-Google%20Cloud%20Run-blue)]()
[![License](https://img.shields.io/badge/license-private-red)]()

---

## 🏗️ Architecture

Phoenix V2 is a **Darwinian trading engine** that evolves trading strategies through simulated natural selection:

```
Signal Sources (TradingView / BTC Engine / Meme Engine / Solana Engine)
    ↓
SignalRouter → normalization + routing
    ↓
AlphaScout → market context (CoinGecko, Fear&Greed, CryptoCompare)
    ↓
DNAExtractor → RL intelligence digest per gladiator
    ↓
DualMasterConsciousness → PARALLEL LLM Consensus:
    ├─ ARCHITECT (OpenAI GPT-4o) → technical analysis
    └─ ORACLE (DeepSeek) → behavioral sentiment
    ↓ Jaccard hallucination defense + market anchoring
SentinelGuard → WR guard + StreakBreaker + MDD check + daily loss limit
    ↓
ManagerVizionar → distributed trade lock + position validation
    ↓
ExecutionMEXC → market order execution
    ↓
PositionManager → Asymmetric TP (T1@1%) + Trailing SL (5%)
    ↓
DNAExtractor.logBattle → RL feedback loop
    ↓
Daily Cron → ArenaSimulator → TheButcher → TheForge → Leaderboard
```

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 16.1.6 + TypeScript 5 + React 19 |
| Runtime | Google Cloud Run (serverless) |
| Database | Supabase (PostgreSQL) + in-memory cache |
| Primary Broker | MEXC (market orders) |
| Fallback Brokers | Binance, OKX (price feed + emergency) |
| LLM Architect | OpenAI GPT-4o |
| LLM Oracle | DeepSeek Chat |
| LLM Fallback | Gemini 2.5 Flash |
| Scheduling | Cloud Scheduler (HTTP cron) |
| Social | Moltbook API |
| CI/CD | Google Cloud Build → Cloud Run |

## 📁 Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── cron/               ← Main evaluation + daily rotation trigger
│   │   ├── v2/arena/           ← Phantom trade evaluation
│   │   ├── v2/cron/positions/  ← Live position management
│   │   ├── dashboard/          ← Dashboard data API
│   │   ├── diagnostics/        ← Health, credits, signal-quality
│   │   ├── health/             ← Health check endpoint
│   │   ├── watchdog/           ← Watchdog ping
│   │   ├── tradingview/        ← TradingView webhook receiver
│   │   ├── btc-signals/        ← BTC signal engine
│   │   ├── meme-signals/       ← Meme token engine
│   │   └── solana-signals/     ← Solana signal engine
│   ├── dashboard/              ← Trading dashboard UI
│   ├── bot-center/             ← Bot management center
│   └── crypto-radar/           ← Crypto radar page
├── components/                 ← React UI components (15 modules)
├── hooks/                      ← React hooks (stats, realtime, debounce)
├── lib/
│   ├── v2/                     ← Phoenix V2 Core Engine
│   │   ├── master/             ← DualMasterConsciousness (LLM consensus)
│   │   ├── safety/             ← SentinelGuard + AutoDebugEngine
│   │   ├── manager/            ← ManagerVizionar + PositionManager
│   │   ├── arena/              ← ArenaSimulator (phantom trading)
│   │   ├── gladiators/         ← TheButcher + GladiatorRegistry
│   │   ├── promoters/          ← TheForge + PromotersAggregator
│   │   ├── superai/            ← DNAExtractor (RL learning)
│   │   ├── intelligence/       ← AlphaScout (market context)
│   │   ├── scouts/             ← Execution + TA indicators (14 modules)
│   │   └── forge/              ← DNA extraction utilities
│   ├── exchange/               ← Exchange clients (MEXC, Binance, OKX, Bybit)
│   ├── cache/                  ← PriceCache (TTL + dedup + fallback chain)
│   ├── core/                   ← Logger, Watchdog, KillSwitch, Heartbeat
│   ├── store/                  ← GladiatorStore, DB layer, SignalStore
│   ├── providers/              ← Market data providers (8 adapters)
│   ├── scoring/                ← V1 scoring engine (pre-processor)
│   ├── router/                 ← Signal routing
│   ├── alerts/                 ← Telegram alerts
│   ├── auth/                   ← Authentication
│   ├── ml/                     ← ML predictor
│   ├── moltbook/               ← Moltbook social integration
│   ├── normalizers/            ← Provider data normalizers
│   └── types/                  ← TypeScript type definitions
├── scripts/                    ← Operational scripts
│   ├── cron_dailyRotation.ts   ← Daily Darwinian rotation
│   ├── pre_live_check.ts       ← Pre-LIVE validation checklist
│   └── reset_paper_mode.ts     ← Paper mode reset utility
├── tradingview/                ← Pine Script indicators
│   └── crypto_radar_btc.pine   ← BTC signal indicator
└── data/                       ← Runtime data (gitignored)
```

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Google Cloud CLI (`gcloud`)
- Supabase project with schema applied

### Local Development
```bash
# Install dependencies
npm install

# Copy env template and fill in secrets
cp .env.example .env.local

# Start dev server
npm run dev
```

### Deploy to Cloud Run
```bash
# One-click deploy (builds, pushes, deploys, sets up cron)
chmod +x deploy.sh && ./deploy.sh
```

Or via Cloud Build CI/CD (auto-triggers on push to `main`):
```bash
git push origin main
```

## 📊 API Endpoints

### Core Engine
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cron` | `GET` | Main evaluation cycle (5-min cron) |
| `/api/cron` | `POST` | Daily rotation trigger |
| `/api/v2/arena` | `GET` | Phantom trade evaluation |
| `/api/v2/cron/positions` | `GET` | Live position management |
| `/api/health` | `GET` | System health check |
| `/api/watchdog/ping` | `GET` | Watchdog keepalive |

### Dashboard & Diagnostics
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dashboard` | `GET` | Full dashboard data |
| `/api/diagnostics/master` | `GET` | Component health matrix |
| `/api/diagnostics/signal-quality` | `GET` | Per-source signal WR analysis |
| `/api/diagnostics/credits` | `GET` | LLM API credit status |

### Signal Sources
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tradingview` | `POST` | TradingView webhook receiver |
| `/api/btc-signals` | `GET` | BTC engine signals |
| `/api/meme-signals` | `GET` | Meme token signals |
| `/api/solana-signals` | `GET` | Solana signals |

## 🔒 Security
- All secrets via environment variables (`.env.local` / Cloud Run secrets)
- Cron endpoints protected with `CRON_SECRET` bearer token
- TradingView webhook authenticated via `TV_SECRET_TOKEN`
- HTTPS enforced via Cloud Run auto-SSL
- No API keys in source code

## 📋 Key Documentation
- **[MASTER_BLUEPRINT_V1.md](./MASTER_BLUEPRINT_V1.md)** — Complete system architecture, bug audit, and implementation plan
- **[.env.example](./.env.example)** — All environment variables with descriptions
- **[deploy.sh](./deploy.sh)** — One-click deploy script with Cloud Scheduler setup

## ⚙️ Cloud Run Configuration
| Parameter | Value |
|-----------|-------|
| Memory | 1Gi |
| CPU | 1 vCPU |
| Min Instances | 1 (always warm) |
| Max Instances | 3 |
| Port | 8080 |
| Timeout | 300s |
| Region | europe-west1 |

---

**Antigravity** · Built for autonomous trading · Phoenix V2
