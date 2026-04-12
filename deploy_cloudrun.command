#!/bin/bash
# ============================================================
# TRADE AI — Deploy to Cloud Run (no Docker needed)
# Uses Cloud Build to build in the cloud.
# Double-click to deploy.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

PROJECT_ID="evident-trees-453923-f9"
REGION="europe-west1"
SERVICE_NAME="antigravity-trade"

echo ""
echo "=============================================="
echo "  TRADE AI — CLOUD RUN DEPLOY (Cloud Build)"
echo "=============================================="
echo ""

if [ ! -f ".env.local" ]; then
  echo "ERROR: .env.local not found."
  exit 1
fi

if ! command -v gcloud &>/dev/null; then
  echo "ERROR: gcloud not found."
  echo "Install from https://cloud.google.com/sdk/docs/install"
  echo ""
  echo "Press Enter to close..."
  read
  exit 1
fi

# Set active project
gcloud config set project "${PROJECT_ID}" --quiet

echo "[1/3] Preparing environment variables..."
ENV_VARS=$(grep -v '^#' .env.local | grep -v '^\s*$' | grep '=' | tr '\n' ',' | sed 's/,$//')
echo "  Loaded $(echo "$ENV_VARS" | tr ',' '\n' | wc -l | tr -d ' ') env vars."

echo ""
echo "[2/3] Deploying via Cloud Build (no Docker needed)..."
echo "  This will build & deploy directly from source."
echo "  Project: ${PROJECT_ID} | Region: ${REGION}"
echo ""

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project "${PROJECT_ID}" \
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

echo ""
echo "[3/3] Getting service URL..."
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format 'value(status.url)')

echo ""
echo "=============================================="
echo "  DEPLOY COMPLETE ✓"
echo "=============================================="
echo "  Radar:  ${SERVICE_URL}/crypto-radar"
echo "  Arena:  ${SERVICE_URL}/arena"
echo "  Status: ${SERVICE_URL}/dashboard"
echo ""

# Health check
echo "Checking health..."
sleep 5
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/api/health" || echo "000")
if [ "${HTTP}" = "200" ]; then
  echo "  Health: OK (HTTP 200) ✓"
  echo ""
  echo "Opening app in browser..."
  open "${SERVICE_URL}/crypto-radar"
else
  echo "  Health: HTTP ${HTTP} — warming up, check in 30s"
fi

echo ""
echo "Press Enter to close..."
read
