#!/bin/bash
# ============================================================
# TRADE AI — Deploy Current Code to Cloud Run
# Double-click this file to deploy.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_ID="evident-trees-453923-f9"
REGION="europe-west1"
SERVICE_NAME="antigravity-trade"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"
TAG=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")

echo ""
echo "=========================================="
echo "  TRADE AI — DEPLOY TO CLOUD RUN"
echo "=========================================="
echo "  Project:  ${PROJECT_ID}"
echo "  Service:  ${SERVICE_NAME}"
echo "  Image:    ${IMAGE}:${TAG}"
echo ""

# Pre-flight
if [ ! -f ".env.local" ]; then
  echo "ERROR: .env.local not found."
  exit 1
fi

echo "Step 1/4: Building Docker image..."
docker build -t "${IMAGE}:${TAG}" -t "${IMAGE}:latest" .

echo "Step 2/4: Pushing to GCR..."
docker push "${IMAGE}:${TAG}"
docker push "${IMAGE}:latest"

echo "Step 3/4: Preparing env vars..."
ENV_VARS=$(grep -v '^#' .env.local | grep -v '^\s*$' | grep '=' | tr '\n' ',' | sed 's/,$//')

echo "Step 4/4: Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --image "${IMAGE}:${TAG}" \
  --region "${REGION}" \
  --platform managed \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 3 \
  --timeout 300 \
  --concurrency 80 \
  --allow-unauthenticated \
  --set-env-vars "${ENV_VARS}"

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --project "${PROJECT_ID}" --region "${REGION}" --format 'value(status.url)')

echo ""
echo "=========================================="
echo "  DEPLOY COMPLETE"
echo "=========================================="
echo "  URL: ${SERVICE_URL}"
echo "  Health: ${SERVICE_URL}/api/health"
echo "  Dashboard: ${SERVICE_URL}/dashboard"
echo "  Radar: ${SERVICE_URL}/crypto-radar"
echo "  Arena: ${SERVICE_URL}/arena"
echo ""

# Setup Cloud Scheduler cron jobs
echo "Setting up cron jobs..."
CRON_SECRET_VAL=$(grep 'CRON_SECRET=' .env.local | cut -d'=' -f2)

# Main evaluation cycle (every 5 minutes)
gcloud scheduler jobs create http "${SERVICE_NAME}-cron-5min" \
  --project "${PROJECT_ID}" \
  --location="${REGION}" \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/api/cron" \
  --http-method=GET \
  --headers="Authorization=Bearer ${CRON_SECRET_VAL}" \
  --attempt-deadline=120s \
  --time-zone="UTC" \
  2>/dev/null || gcloud scheduler jobs update http "${SERVICE_NAME}-cron-5min" \
  --project "${PROJECT_ID}" \
  --location="${REGION}" \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/api/cron" \
  --http-method=GET \
  --headers="Authorization=Bearer ${CRON_SECRET_VAL}" \
  --attempt-deadline=120s

# Position management (every 2 minutes)
gcloud scheduler jobs create http "${SERVICE_NAME}-cron-positions" \
  --project "${PROJECT_ID}" \
  --location="${REGION}" \
  --schedule="*/2 * * * *" \
  --uri="${SERVICE_URL}/api/v2/cron/positions" \
  --http-method=GET \
  --headers="Authorization=Bearer ${CRON_SECRET_VAL}" \
  --attempt-deadline=60s \
  --time-zone="UTC" \
  2>/dev/null || gcloud scheduler jobs update http "${SERVICE_NAME}-cron-positions" \
  --project "${PROJECT_ID}" \
  --location="${REGION}" \
  --schedule="*/2 * * * *" \
  --uri="${SERVICE_URL}/api/v2/cron/positions" \
  --http-method=GET \
  --headers="Authorization=Bearer ${CRON_SECRET_VAL}" \
  --attempt-deadline=60s

# Arena phantom trade evaluation (every 3 minutes)
gcloud scheduler jobs create http "${SERVICE_NAME}-cron-arena" \
  --project "${PROJECT_ID}" \
  --location="${REGION}" \
  --schedule="*/3 * * * *" \
  --uri="${SERVICE_URL}/api/v2/arena" \
  --http-method=GET \
  --headers="Authorization=Bearer ${CRON_SECRET_VAL}" \
  --attempt-deadline=90s \
  --time-zone="UTC" \
  2>/dev/null || gcloud scheduler jobs update http "${SERVICE_NAME}-cron-arena" \
  --project "${PROJECT_ID}" \
  --location="${REGION}" \
  --schedule="*/3 * * * *" \
  --uri="${SERVICE_URL}/api/v2/arena" \
  --http-method=GET \
  --headers="Authorization=Bearer ${CRON_SECRET_VAL}" \
  --attempt-deadline=90s

# Watchdog ping (every 10 minutes)
gcloud scheduler jobs create http "${SERVICE_NAME}-watchdog" \
  --project "${PROJECT_ID}" \
  --location="${REGION}" \
  --schedule="*/10 * * * *" \
  --uri="${SERVICE_URL}/api/watchdog/ping" \
  --http-method=GET \
  --attempt-deadline=30s \
  --time-zone="UTC" \
  2>/dev/null || gcloud scheduler jobs update http "${SERVICE_NAME}-watchdog" \
  --project "${PROJECT_ID}" \
  --location="${REGION}" \
  --schedule="*/10 * * * *" \
  --uri="${SERVICE_URL}/api/watchdog/ping" \
  --http-method=GET \
  --attempt-deadline=30s

echo "Cron jobs configured."
echo ""

# Health check
echo "Checking health..."
sleep 5
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/api/health" || echo "000")
if [ "${HTTP_CODE}" = "200" ]; then
  echo "Health check PASSED (HTTP 200)"
else
  echo "Health check returned HTTP ${HTTP_CODE}"
fi

echo ""
echo "All done. Press Enter to close..."
read
