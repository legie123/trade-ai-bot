# Crypto Deal Radar

Real-time crypto monitoring dashboard with TradingView webhook integration.

## Quick Start

```bash
# Install dependencies
npm install

# Copy env and add your API keys
cp .env.example .env.local

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → redirects to `/crypto-radar`

## API Keys

Add to `.env.local` (optional — dashboard works with free providers):

| Key | Required | Provider |
|-----|----------|----------|
| `BIRDEYE_API_KEY` | Optional | Birdeye token intelligence |
| `RUGCHECK_API_KEY` | Optional | Bulk rugcheck reports |
| `JUPITER_API_KEY` | Optional | Higher rate limits |

Free providers (no key needed): **DEX Screener**, **GeckoTerminal**, **Rugcheck** (public), **Pump** (composite)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tradingview` | `POST` | Receive TradingView webhook alerts |
| `/api/tradingview` | `GET` | Get recent signals + stats |
| `/api/tokens` | `GET` | Aggregated scored token list |
| `/api/tokens/[address]` | `GET` | Single token detail |
| `/api/health` | `GET` | Provider health status |
| `/api/alerts` | `GET` | Evaluated live alerts |

## TradingView Webhook

Send POST to `/api/tradingview`:

```json
{
  "symbol": "SOL",
  "signal": "BUY",
  "timeframe": "15m",
  "price": 148.55,
  "message": "Optional message"
}
```

Valid signals: `BUY`, `SELL`, `LONG`, `SHORT`, `ALERT`, `NEUTRAL`

## Project Structure

```
src/
├── app/
│   ├── crypto-radar/page.tsx   ← Main dashboard
│   └── api/
│       ├── tradingview/        ← Webhook endpoint
│       ├── tokens/             ← Token aggregation
│       ├── health/             ← Provider health
│       └── alerts/             ← Alert evaluation
├── lib/
│   ├── providers/              ← 6 provider adapters
│   ├── scoring/                ← Deal/Risk/Conviction engine
│   ├── normalizers/            ← Per-provider → unified model
│   ├── alerts/                 ← Alert rule evaluation
│   ├── cache/                  ← TTL cache with freshness
│   ├── store/                  ← Signal store (dedup)
│   └── types/                  ← All TypeScript types
```

## Bot Preparation

Schema ready in `src/lib/types/radar.ts` (BotRuleSet):
- Entry/exit rules with signal types and confirmations
- Stop loss, take profit, trailing stop
- Position sizing, max positions, risk/reward ratio
- **Not active** — infrastructure only, activate when ready

## Provider Status

| Provider | Status | Key Required |
|----------|--------|-------------|
| DEX Screener | ✅ Healthy | No |
| Rugcheck | ✅ Healthy | No (public) |
| GeckoTerminal | ✅ Healthy | No |
| Pump (composite) | ✅ Healthy | No |
| Birdeye | ⚠️ Needs key | Yes |
| Jupiter | ⚠️ Needs key | Optional |
