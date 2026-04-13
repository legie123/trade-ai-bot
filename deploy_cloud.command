#!/bin/bash
# ============================================================
# TRADE AI — Deploy via Cloud Build (NO Docker required)
# Uses: gcloud run deploy --source . (builds in Google Cloud)
# Double-click this file to deploy.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_ID="evident-trees-453923-f9"
REGION="europe-west1"
SERVICE_NAME="antigravity-trade"

echo ""
echo "=========================================="
echo "  TRADE AI — CLOUD BUILD DEPLOY"
echo "=========================================="
echo "  Project:  ${PROJECT_ID}"
echo "  Service:  ${SERVICE_NAME}"
echo "  Region:   ${REGION}"
echo "  Method:   gcloud run deploy --source ."
echo ""

# Pre-flight
if [ ! -f ".env.local" ]; then
  echo "ERROR: .env.local not found."
  exit 1
fi

# Check gcloud auth
ACCOUNT=$(gcloud config get-value account 2>/dev/null || echo "")
if [ -z "${ACCOUNT}" ]; then
  echo "Not authenticated. Running gcloud auth login..."
  gcloud auth login
fi

echo "Authenticated as: $(gcloud config get-value account 2>/dev/null)"
gcloud config set project "${PROJECT_ID}" 2>/dev/null

# Enable required APIs (idempotent)
echo "Enabling required APIs..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com --quiet 2>/dev/null || true

echo ""
echo "Step 1/3: Preparing env vars..."
ENV_VARS=$(grep -v '^#' .env.local | grep -v '^\s*$' | grep '=' | tr '\n' ',' | sed 's/,$//')

echo "Step 2/3: Building in Cloud + Deploying to Cloud Run..."
echo "(This builds remotely — no Docker needed on your Mac)"
echo ""

gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --source . \
  --region "${REGION}" \
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
echo "  Arena: ${SERVICE_URL}/arena"
echo "  Agent Card: ${SERVICE_URL}/api/agent-card"
echo "  Swarm: ${SERVICE_URL}/api/a2a/orchestrate"
echo ""

echo "Step 3/3: Health check..."
sleep 8
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/api/health" || echo "000")
if [ "${HTTP_CODE}" = "200" ]; then
  echo "Health check PASSED (HTTP 200)"
else
  echo "Health check returned HTTP ${HTTP_CODE}"
  echo "Check logs: gcloud run logs read --service=${SERVICE_NAME} --region=${REGION} --limit=50"
fi

echo ""
echo "Faze 6+7+8 deployed. Press Enter to close..."
read
