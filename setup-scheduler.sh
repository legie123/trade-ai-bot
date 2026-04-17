#!/bin/bash
PROJECT="evident-trees-453923-f9"
REGION="europe-west1"
BASE="https://trade-ai-657910053930.europe-west1.run.app"
CRON_SECRET=$(grep CRON_SECRET .env | cut -d= -f2 | tr -d '"' | tr -d "'")

echo "Setting up GCP Cloud Scheduler for Trade AI..."
echo "Project: $PROJECT | Region: $REGION"
echo ""

create_job() {
  local NAME=$1 SCHEDULE=$2 URI=$3 DEADLINE=$4 DESC=$5

  if gcloud scheduler jobs describe "$NAME" --project="$PROJECT" --location="$REGION" >/dev/null 2>&1; then
    echo "Updating $NAME..."
    gcloud scheduler jobs update http "$NAME" \
      --project="$PROJECT" --location="$REGION" \
      --schedule="$SCHEDULE" \
      --uri="$URI" \
      --http-method=GET \
      --update-headers="x-cron-secret=$CRON_SECRET" \
      --attempt-deadline="$DEADLINE"
  else
    echo "Creating $NAME..."
    gcloud scheduler jobs create http "$NAME" \
      --project="$PROJECT" --location="$REGION" \
      --schedule="$SCHEDULE" \
      --uri="$URI" \
      --http-method=GET \
      --headers="x-cron-secret=$CRON_SECRET" \
      --attempt-deadline="$DEADLINE" \
      --description="$DESC"
  fi
}

create_job "trade-ai-cron-main" \
  "*/5 * * * *" \
  "$BASE/api/cron" \
  "60s" \
  "Main trading loop - signals, phantom trades, decisions"

create_job "trade-ai-cron-positions" \
  "*/2 * * * *" \
  "$BASE/api/v2/cron/positions" \
  "30s" \
  "Position evaluation and TP/SL management"

create_job "trade-ai-cron-promote" \
  "*/10 * * * *" \
  "$BASE/api/v2/cron/auto-promote" \
  "30s" \
  "Gladiator auto-promote based on performance"

create_job "trade-ai-cron-sentiment" \
  "*/30 * * * *" \
  "$BASE/api/v2/cron/sentiment" \
  "30s" \
  "Sentiment analysis from news/social feeds"

create_job "trade-ai-cron-poly-scan" \
  "*/15 * * * *" \
  "$BASE/api/v2/polymarket/cron/scan" \
  "60s" \
  "Polymarket opportunity scanner"

create_job "trade-ai-cron-poly-mtm" \
  "*/5 * * * *" \
  "$BASE/api/v2/polymarket/cron/mtm" \
  "30s" \
  "Polymarket mark-to-market position updates"

echo ""
echo "✅ All 6 Cloud Scheduler jobs configured:"
gcloud scheduler jobs list --project="$PROJECT" --location="$REGION"
