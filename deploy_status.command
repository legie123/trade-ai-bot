#!/bin/bash
# ============================================================
# TRADE AI — Deploy Status Command Center
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

echo ""
echo "============================================"
echo "  TRADE AI — Status Command Center Deploy"
echo "============================================"

# Clear stale locks
rm -f .git/index.lock .git/MERGE_HEAD 2>/dev/null || true

# ─── 1. Git push ─────────────────────────────────────────────
echo ""
echo "[1/2] Pushing to GitHub..."
git add src/app/dashboard/page.tsx
git commit -m "feat(status): Command Center — full operational truth dashboard

- Mission status banner: health dot + version + uptime + SSE pill
- Core services strip: Stream / Heartbeat / Watchdog / Kill Switch / Supabase / Mode
- Exchange connectivity: Binance, DexScreener, CoinGecko, MEXC, Bybit, OKX
  with latency, mode badge, LIVE/DOWN/OFF indicator
- AI Providers: OpenAI status + DeepSeek balance + Supabase R/W latency & grade
- Trading Operations: KPI strip + battle summary (W/L/WR/Equity/Peak/MaxDD/Streak)
- Top Gladiator: omega card with training progress bar + forge progress
- V2 Entities: masters status + sentinel guards (risk shield + daily loss)
- System Resources: RSS, heap, uptime, Node version, sync queue, update count
- Live Console: scrollable log feed with ERR/WARN/ALL filter tabs + error count
- Syndicate last decision: Architect + Oracle reasoning cards
- Data Providers: heartbeat provider chips with latency
- Kill Switch alert: pulsing red banner if engaged
- Auto-refresh: light (20s) + diagnostics (90s) + SSE stream
- TypeScript: zero errors"
git push origin main
echo "  ✓ GitHub push complete"

# ─── 2. Cloud Run deploy ─────────────────────────────────────
echo ""
echo "[2/2] Deploying to Cloud Run..."

if ! command -v gcloud &>/dev/null; then
  echo "  ✗ gcloud not found — skipping Cloud Run step"
  echo "    Run manually: gcloud run deploy antigravity-trade --source . --region europe-west1 --project evident-trees-453923-f9"
  exit 0
fi

# Load env vars
ENV_ARGS=""
if [ -f ".env.local" ]; then
  while IFS='=' read -r key val; do
    [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
    val="${val%\"}"
    val="${val#\"}"
    ENV_ARGS="${ENV_ARGS}${key}=${val},"
  done < .env.local
  ENV_ARGS="${ENV_ARGS%,}"
fi

gcloud config set project evident-trees-453923-f9 --quiet

if [ -n "$ENV_ARGS" ]; then
  gcloud run deploy antigravity-trade \
    --source . \
    --region europe-west1 \
    --allow-unauthenticated \
    --set-env-vars "$ENV_ARGS" \
    --quiet
else
  gcloud run deploy antigravity-trade \
    --source . \
    --region europe-west1 \
    --allow-unauthenticated \
    --quiet
fi

SERVICE_URL=$(gcloud run services describe antigravity-trade --region europe-west1 --format 'value(status.url)' 2>/dev/null || echo "https://antigravity-trade-3rzn6ry36q-ew.a.run.app")

echo ""
echo "============================================"
echo "  ✓ DEPLOY COMPLETE"
echo "  URL: ${SERVICE_URL}/dashboard"
echo "============================================"
echo ""

open "${SERVICE_URL}/dashboard"
