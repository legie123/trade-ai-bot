#!/bin/bash
# ============================================================
# TRADE AI — Cloud Scheduler Setup
# Configureaza cron jobs automate pe GCP
# Dublu-click pe acest fisier sau: ./setup_cloud_scheduler.command
# ============================================================

set -e

PROJECT="evident-trees-453923-f9"
REGION="europe-west1"
# 2026-05-03 fix: SERVICE_URL changed from antigravity-trade-3rzn6ry36q
# to trade-ai-657910053930 (canonical service per deploy.yml + memory).
# Previous URL pointed to a legacy/secondary service whose state diverges
# from the live wallet/decisions. Re-running this script idempotently
# updates all 8 jobs to use the canonical service.
SERVICE_URL="https://trade-ai-657910053930.europe-west1.run.app"
CRON_SECRET="tradeai_cron_secret_2026"

echo ""
echo "=========================================="
echo "  TRADE AI — Cloud Scheduler Setup"
echo "=========================================="
echo ""

if ! command -v gcloud &> /dev/null; then
    echo "ERROR: gcloud CLI nu e instalat."
    echo ""
    echo "Instaleaza de aici: https://cloud.google.com/sdk/docs/install"
    echo "Sau cu brew: brew install --cask google-cloud-sdk"
    echo ""
    read -p "Apasa Enter pentru a iesi..."
    exit 1
fi

echo "[1/6] Setez proiectul GCP: $PROJECT"
gcloud config set project "$PROJECT" 2>/dev/null

echo "[2/6] Activez Cloud Scheduler API..."
gcloud services enable cloudscheduler.googleapis.com --quiet 2>/dev/null || true

echo "[3/6] Verific App Engine..."
gcloud app describe --project="$PROJECT" 2>/dev/null || {
    echo "  -> Creez App Engine app in $REGION..."
    gcloud app create --region="$REGION" --project="$PROJECT" --quiet 2>/dev/null || true
}

echo ""
echo "[4/6] Creez Cloud Scheduler Jobs..."
echo ""

echo "  -> Job: trade-ai-cron-loop (every 5 min)"
gcloud scheduler jobs delete trade-ai-cron-loop --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http trade-ai-cron-loop \
    --location="$REGION" \
    --schedule="*/5 * * * *" \
    --uri="${SERVICE_URL}/api/cron?secret=${CRON_SECRET}" \
    --http-method=GET \
    --attempt-deadline=180s \
    --description="Main trading loop: scanners, arena, positions, heartbeat" \
    --quiet
echo "     OK"

echo "  -> Job: trade-ai-polymarket-scan (every 15 min)"
gcloud scheduler jobs delete trade-ai-polymarket-scan --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http trade-ai-polymarket-scan \
    --location="$REGION" \
    --schedule="*/15 * * * *" \
    --uri="${SERVICE_URL}/api/v2/polymarket?action=scan" \
    --http-method=GET \
    --attempt-deadline=120s \
    --description="Polymarket division scan: trending, crypto, politics" \
    --quiet
echo "     OK"

echo "  -> Job: trade-ai-polymarket-mtm (every 30 min)"
gcloud scheduler jobs delete trade-ai-polymarket-mtm --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http trade-ai-polymarket-mtm \
    --location="$REGION" \
    --schedule="*/30 * * * *" \
    --uri="${SERVICE_URL}/api/v2/polymarket/cron/mtm?secret=${CRON_SECRET}" \
    --http-method=GET \
    --attempt-deadline=120s \
    --description="Polymarket mark-to-market: update position values" \
    --quiet
echo "     OK"

echo "  -> Job: trade-ai-sentiment (every 30 min)"
gcloud scheduler jobs delete trade-ai-sentiment --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http trade-ai-sentiment \
    --location="$REGION" \
    --schedule="5,35 * * * *" \
    --uri="${SERVICE_URL}/api/v2/cron/sentiment" \
    --http-method=GET \
    --headers="Authorization=Bearer ${CRON_SECRET}" \
    --attempt-deadline=120s \
    --description="Sentiment analysis: NLP + LLM scoring" \
    --quiet
echo "     OK"

echo "  -> Job: trade-ai-auto-promote (every hour)"
gcloud scheduler jobs delete trade-ai-auto-promote --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http trade-ai-auto-promote \
    --location="$REGION" \
    --schedule="10 * * * *" \
    --uri="${SERVICE_URL}/api/v2/cron/auto-promote?secret=${CRON_SECRET}" \
    --http-method=GET \
    --attempt-deadline=60s \
    --description="Auto-promote gladiators meeting win criteria" \
    --quiet
echo "     OK"

echo "  -> Job: trade-ai-positions (every 5 min)"
gcloud scheduler jobs delete trade-ai-positions --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http trade-ai-positions \
    --location="$REGION" \
    --schedule="*/5 * * * *" \
    --uri="${SERVICE_URL}/api/v2/cron/positions?secret=${CRON_SECRET}" \
    --http-method=GET \
    --attempt-deadline=120s \
    --description="Evaluate open positions: TP/SL/trailing" \
    --quiet
echo "     OK"

echo "  -> Job: trade-ai-moltbook (every 30 min)"
gcloud scheduler jobs delete trade-ai-moltbook --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http trade-ai-moltbook \
    --location="$REGION" \
    --schedule="15,45 * * * *" \
    --uri="${SERVICE_URL}/api/moltbook-cron" \
    --http-method=GET \
    --headers="Authorization=Bearer ${CRON_SECRET}" \
    --attempt-deadline=60s \
    --description="Moltbook social feed scraper" \
    --quiet
echo "     OK"

echo "  -> Job: trade-ai-polymarket-resolve (every 10 min) [NEW]"
gcloud scheduler jobs delete trade-ai-polymarket-resolve --location="$REGION" --quiet 2>/dev/null || true
gcloud scheduler jobs create http trade-ai-polymarket-resolve \
    --location="$REGION" \
    --schedule="*/10 * * * *" \
    --uri="${SERVICE_URL}/api/v2/polymarket/cron/resolve" \
    --http-method=GET \
    --headers="Authorization=Bearer ${CRON_SECRET}" \
    --attempt-deadline=180s \
    --description="Polymarket settlement loop: close resolved positions, settle PnL (legacy + DB-driven)" \
    --quiet
echo "     OK"

echo ""
echo "[5/6] Verific joburile create..."
echo ""
gcloud scheduler jobs list --location="$REGION" --format="table(name,schedule,state,httpTarget.uri)"

echo ""
echo "[6/6] Trigger manual pe toate joburile (prima rulare)..."
echo ""
for JOB in trade-ai-cron-loop trade-ai-polymarket-scan trade-ai-polymarket-mtm trade-ai-sentiment trade-ai-auto-promote trade-ai-positions trade-ai-moltbook trade-ai-polymarket-resolve; do
    echo "  -> Trigger: $JOB"
    gcloud scheduler jobs run "$JOB" --location="$REGION" --quiet 2>/dev/null || echo "     (skip - va rula la urmatorul interval)"
done

echo ""
echo "=========================================="
echo "  DONE! 8 cron jobs create si pornite."
echo "=========================================="
echo ""
echo "Jobs active (TOATE pe trade-ai-657910053930 — canonical):"
echo "  - Cron loop:           every 5 min"
echo "  - Polymarket scan:     every 15 min"
echo "  - Polymarket MTM:      every 30 min"
echo "  - Polymarket resolve:  every 10 min   [settlement loop, A+B paths]"
echo "  - Sentiment:           every 30 min"
echo "  - Auto-promote:        every hour"
echo "  - Positions:           every 5 min"
echo "  - Moltbook:            every 30 min"
echo ""
echo "NOTA: 8 joburi vechi pe antigravity-trade au fost LEFT INTACT."
echo "Daca vrei sa le stergi: gcloud scheduler jobs delete <job-name> --location=$REGION"
echo ""
echo "Verifica in GCP Console:"
echo "  https://console.cloud.google.com/cloudscheduler?project=$PROJECT"
echo ""
read -p "Apasa Enter pentru a inchide..."
