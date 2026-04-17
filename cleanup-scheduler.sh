#!/bin/bash
# ============================================================
# Cleanup duplicate Cloud Scheduler jobs
# Keeps only the 6 canonical jobs from setup-scheduler.sh
# ============================================================
PROJECT="evident-trees-453923-f9"
REGION="europe-west1"

# Canonical jobs (DO NOT DELETE):
# trade-ai-cron-main, trade-ai-cron-positions, trade-ai-cron-promote
# trade-ai-cron-sentiment, trade-ai-cron-poly-scan, trade-ai-cron-poly-mtm
# daily-rotation, polymarket-resolve

# Old duplicates to remove:
DUPLICATES=(
  "main-cron-loop"
  "trade-ai-cron"
  "trade-ai-auto-promote"
  "trade-ai-cron-sentiment"
  "trade-ai-watchdog"
  "trade-ai-moltbook"
  "trade-ai-cron-loop"
  "health-watchdog"
  "moltbook-daily-sweep"
  "auto-live-check"
  "trade-ai-polymarket-mtm"
  "trade-ai-sentiment"
  "trade-ai-position-manager"
  "trade-ai-positions"
  "trade-ai-polymarket-scan"
  "polymarket-mtm"
  "trade-ai-cron-arena"
  "ds-app-cron"
  "sentiment-heartbeat"
  "polymarket-scan"
  "trade-ai-cron-daily"
)

echo "Cleaning up duplicate Cloud Scheduler jobs..."
echo "Project: $PROJECT | Region: $REGION"
echo ""

for JOB in "${DUPLICATES[@]}"; do
  if gcloud scheduler jobs describe "$JOB" --project="$PROJECT" --location="$REGION" >/dev/null 2>&1; then
    echo "Deleting duplicate: $JOB..."
    gcloud scheduler jobs delete "$JOB" --project="$PROJECT" --location="$REGION" --quiet 2>/dev/null && echo "  ✓ Deleted" || echo "  ✗ Failed"
  else
    echo "  - $JOB (not found, skip)"
  fi
done

echo ""
echo "Remaining jobs (should be ~8 canonical):"
gcloud scheduler jobs list --project="$PROJECT" --location="$REGION"
