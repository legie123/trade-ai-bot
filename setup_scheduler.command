#!/bin/bash
set -e

echo "============================================"
echo "  TRADE AI — CLOUD SCHEDULER SETUP"
echo "============================================"

PROJECT_ID="evident-trees-453923-f9"
REGION="europe-west1"
SERVICE_URL="https://antigravity-trade-3rzn6ry36q-ew.a.run.app"

echo "  Project:  $PROJECT_ID"
echo "  Region:   $REGION"
echo "  Service:  $SERVICE_URL"
echo ""

CRON_SECRET="${CRON_SECRET:?Set CRON_SECRET env var before running}"

gcloud config set project "$PROJECT_ID" 2>/dev/null

echo "Enabling Cloud Scheduler API..."
gcloud services enable cloudscheduler.googleapis.com 2>/dev/null || true

echo ""
echo "Creating scheduler jobs..."

# 1. Sentiment heartbeat — every 30 minutes
echo "  [1/8] Sentiment NLP heartbeat (every 30 min)..."
gcloud scheduler jobs delete sentiment-heartbeat --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http sentiment-heartbeat \
  --location="$REGION" \
  --schedule="*/30 * * * *" \
  --uri="$SERVICE_URL/api/v2/cron/sentiment" \
  --http-method=GET \
  --headers="x-cron-secret=$CRON_SECRET" \
  --attempt-deadline=60s \
  --description="NLP sentiment analysis heartbeat for Moltbook feed" \
  --quiet

# 2. Auto-LIVE promotion check — every hour
echo "  [2/8] Auto-LIVE promotion gate (every hour)..."
gcloud scheduler jobs delete auto-live-check --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http auto-live-check \
  --location="$REGION" \
  --schedule="0 * * * *" \
  --uri="$SERVICE_URL/api/v2/cron/auto-promote" \
  --http-method=GET \
  --headers="x-cron-secret=$CRON_SECRET" \
  --attempt-deadline=120s \
  --description="Hourly check: promote qualifying gladiators from PHANTOM to LIVE" \
  --quiet

# 3. Main cron loop — every 3 minutes (trading engine + watchdog)
echo "  [3/8] Main cron loop (every 3 min)..."
gcloud scheduler jobs delete main-cron-loop --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http main-cron-loop \
  --location="$REGION" \
  --schedule="*/3 * * * *" \
  --uri="$SERVICE_URL/api/cron" \
  --http-method=GET \
  --headers="x-cron-secret=$CRON_SECRET" \
  --attempt-deadline=180s \
  --description="Main trading engine: BTC engine, scanners, position eval, DNA extraction" \
  --quiet

# 4. Health watchdog — every 5 minutes (keeps Cloud Run warm)
echo "  [4/8] Health watchdog (every 5 min)..."
gcloud scheduler jobs delete health-watchdog --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http health-watchdog \
  --location="$REGION" \
  --schedule="*/5 * * * *" \
  --uri="$SERVICE_URL/api/v2/health" \
  --http-method=GET \
  --attempt-deadline=30s \
  --description="Health check watchdog — keeps Cloud Run warm + monitors uptime" \
  --quiet

# 5. Polymarket scan — every hour (find new prediction markets)
echo "  [5/8] Polymarket scanner (every hour)..."
gcloud scheduler jobs delete polymarket-scan --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http polymarket-scan \
  --location="$REGION" \
  --schedule="15 * * * *" \
  --uri="$SERVICE_URL/api/v2/polymarket/cron/scan" \
  --http-method=GET \
  --headers="x-cron-secret=$CRON_SECRET" \
  --attempt-deadline=120s \
  --description="Scan Polymarket for new prediction market opportunities" \
  --quiet

# 6. Polymarket MTM — every 30 minutes (mark to market)
echo "  [6/8] Polymarket MTM (every 30 min)..."
gcloud scheduler jobs delete polymarket-mtm --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http polymarket-mtm \
  --location="$REGION" \
  --schedule="*/30 * * * *" \
  --uri="$SERVICE_URL/api/v2/polymarket/cron/mtm" \
  --http-method=GET \
  --headers="x-cron-secret=$CRON_SECRET" \
  --attempt-deadline=60s \
  --description="Polymarket mark-to-market: update position prices + PnL" \
  --quiet

# 7. Polymarket resolve — every 6 hours (settle resolved markets)
echo "  [7/8] Polymarket resolve (every 6h)..."
gcloud scheduler jobs delete polymarket-resolve --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http polymarket-resolve \
  --location="$REGION" \
  --schedule="0 */6 * * *" \
  --uri="$SERVICE_URL/api/v2/polymarket/cron/resolve" \
  --http-method=GET \
  --headers="x-cron-secret=$CRON_SECRET" \
  --attempt-deadline=120s \
  --description="Polymarket resolver: settle resolved markets, update gladiator stats" \
  --quiet

# 8. Daily rotation — once per day at 00:05 UTC
echo "  [8/8] Daily Darwinian rotation (daily 00:05 UTC)..."
gcloud scheduler jobs delete daily-rotation --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http daily-rotation \
  --location="$REGION" \
  --schedule="5 0 * * *" \
  --uri="$SERVICE_URL/api/cron" \
  --http-method=GET \
  --headers="x-cron-secret=$CRON_SECRET" \
  --attempt-deadline=300s \
  --description="Daily Darwinian rotation: Butcher + Forge + Leaderboard" \
  --quiet

echo ""
echo "============================================"
echo "  SCHEDULER SETUP COMPLETE"
echo "============================================"
echo ""
echo "  Jobs created:"
echo "    - sentiment-heartbeat    : */30 * * * *"
echo "    - auto-live-check        : 0 * * * *"
echo "    - main-cron-loop         : */3 * * * *"
echo "    - health-watchdog        : */5 * * * *"
echo "    - polymarket-scan        : 15 * * * *"
echo "    - polymarket-mtm         : */30 * * * *"
echo "    - polymarket-resolve     : 0 */6 * * *"
echo "    - daily-rotation         : 5 0 * * *"
echo ""
echo "  Verify: gcloud scheduler jobs list --location=$REGION"
echo ""
echo "Press Enter to close..."
read
