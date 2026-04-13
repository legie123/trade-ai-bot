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

gcloud config set project "$PROJECT_ID" 2>/dev/null

echo "Enabling Cloud Scheduler API..."
gcloud services enable cloudscheduler.googleapis.com 2>/dev/null || true

echo ""
echo "Creating scheduler jobs..."

# 1. Sentiment heartbeat — every 30 minutes
echo "  [1/4] Sentiment NLP heartbeat (every 30 min)..."
gcloud scheduler jobs delete sentiment-heartbeat --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http sentiment-heartbeat \
  --location="$REGION" \
  --schedule="*/30 * * * *" \
  --uri="$SERVICE_URL/api/v2/cron/sentiment" \
  --http-method=GET \
  --attempt-deadline=60s \
  --description="NLP sentiment analysis heartbeat for Moltbook feed" \
  --quiet

# 2. Auto-LIVE promotion check — every hour
echo "  [2/4] Auto-LIVE promotion gate (every hour)..."
gcloud scheduler jobs delete auto-live-check --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http auto-live-check \
  --location="$REGION" \
  --schedule="0 * * * *" \
  --uri="$SERVICE_URL/api/v2/cron/auto-promote" \
  --http-method=GET \
  --attempt-deadline=120s \
  --description="Hourly check: promote qualifying gladiators from PHANTOM to LIVE" \
  --quiet

# 3. Daily rotation trigger — once per day at 00:05 UTC
echo "  [3/4] Daily Darwinian rotation (daily 00:05 UTC)..."
gcloud scheduler jobs delete daily-rotation --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http daily-rotation \
  --location="$REGION" \
  --schedule="5 0 * * *" \
  --uri="$SERVICE_URL/api/cron" \
  --http-method=GET \
  --attempt-deadline=300s \
  --description="Daily Darwinian rotation: Butcher + Forge + Leaderboard" \
  --quiet

# 4. Health watchdog — every 5 minutes
echo "  [4/4] Health watchdog (every 5 min)..."
gcloud scheduler jobs delete health-watchdog --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http health-watchdog \
  --location="$REGION" \
  --schedule="*/5 * * * *" \
  --uri="$SERVICE_URL/api/health" \
  --http-method=GET \
  --attempt-deadline=30s \
  --description="Health check watchdog — keeps Cloud Run warm + monitors uptime" \
  --quiet

echo ""
echo "============================================"
echo "  SCHEDULER SETUP COMPLETE"
echo "============================================"
echo ""
echo "  Jobs created:"
echo "    - sentiment-heartbeat    : */30 * * * *"
echo "    - auto-live-check        : 0 * * * *"
echo "    - daily-rotation         : 5 0 * * *"
echo "    - health-watchdog        : */5 * * * *"
echo ""
echo "  Verify: gcloud scheduler jobs list --location=$REGION"
echo ""
echo "Press Enter to close..."
read
