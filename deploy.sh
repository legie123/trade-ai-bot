#!/bin/bash
# ============================================================
# PHOENIX V2 — One-Click Deploy to Google Cloud Run
#
# Prerequisites:
#   1. gcloud CLI installed: https://cloud.google.com/sdk/install
#   2. Authenticated: gcloud auth login
#   3. Project set: gcloud config set project YOUR_PROJECT_ID
#   4. APIs enabled (run once):
#      gcloud services enable run.googleapis.com containerregistry.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com
#   5. .env.local file with all secrets filled in
#
# Usage: chmod +x deploy.sh && ./deploy.sh
# ============================================================

set -euo pipefail

# ── Configuration ──
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
REGION="europe-west1"
SERVICE_NAME="trade-ai"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"
TAG=$(git rev-parse --short HEAD 2>/dev/null || echo "manual")

echo "═══════════════════════════════════════════════════"
echo "  PHOENIX V2 — DEPLOY TO GOOGLE CLOUD RUN"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  Project:  ${PROJECT_ID}"
echo "  Region:   ${REGION}"
echo "  Service:  ${SERVICE_NAME}"
echo "  Image:    ${IMAGE}:${TAG}"
echo ""

# ── Step 0: Pre-flight checks ──
if [ -z "${PROJECT_ID}" ]; then
  echo "❌ No GCP project set. Run: gcloud config set project YOUR_PROJECT_ID"
  exit 1
fi

if [ ! -f ".env.local" ]; then
  echo "❌ .env.local not found. Copy .env.example to .env.local and fill in secrets."
  exit 1
fi

# Check for critical env vars
source .env.local 2>/dev/null || true
MISSING=""
for VAR in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY OPENAI_API_KEY MEXC_API_KEY MEXC_API_SECRET; do
  if [ -z "${!VAR:-}" ]; then
    MISSING="${MISSING} ${VAR}"
  fi
done

if [ -n "${MISSING}" ]; then
  echo "❌ Missing critical env vars in .env.local:${MISSING}"
  echo "   Fill these in before deploying."
  exit 1
fi

echo "✅ Pre-flight checks passed."
echo ""

# ── Step 1: Prepare env vars ──
ENV_VARS=$(grep -v '^#' .env.local | grep -v '^\s*$' | grep '=' | tr '\n' ',' | sed 's/,$//')

# ── Step 2: Build & Deploy via Google Cloud (Serverless Build) ──
echo "🚀 Building and Deploying to Cloud Run via --source..."
gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --region "${REGION}" \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 300 \
  --concurrency 80 \
  --cpu-throttling \
  --allow-unauthenticated \
  --set-env-vars "${ENV_VARS}"

# ── Step 5: Get the service URL ──
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --format 'value(status.url)')

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ DEPLOY COMPLETE"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  🌐 URL: ${SERVICE_URL}"
echo "  🏥 Health: ${SERVICE_URL}/api/health"
echo "  📊 Dashboard: ${SERVICE_URL}/api/dashboard"
echo "  🔬 Diagnostics: ${SERVICE_URL}/api/diagnostics/master"
echo "  📈 Signal Quality: ${SERVICE_URL}/api/diagnostics/signal-quality"
echo ""

# ── Step 6: Setup Cloud Scheduler for cron jobs ──
echo "⏰ Setting up Cloud Scheduler cron jobs..."

CRON_SECRET_VAL=$(grep 'CRON_SECRET=' .env.local | cut -d'=' -f2)

# Cron: Main evaluation cycle (every 5 minutes)
gcloud scheduler jobs delete "${SERVICE_NAME}-cron-main" --location="${REGION}" --quiet 2>/dev/null || true
gcloud scheduler jobs create http "${SERVICE_NAME}-cron-main" \
  --location="${REGION}" \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/api/cron" \
  --http-method=GET \
  --headers="Authorization=Bearer ${CRON_SECRET_VAL}" \
  --attempt-deadline=120s \
  --time-zone="UTC"

# Cron: Position management (every 2 minutes)
gcloud scheduler jobs delete "${SERVICE_NAME}-cron-positions" --location="${REGION}" --quiet 2>/dev/null || true
gcloud scheduler jobs create http "${SERVICE_NAME}-cron-positions" \
  --location="${REGION}" \
  --schedule="*/2 * * * *" \
  --uri="${SERVICE_URL}/api/v2/cron/positions" \
  --http-method=GET \
  --headers="Authorization=Bearer ${CRON_SECRET_VAL}" \
  --attempt-deadline=60s \
  --time-zone="UTC"

# Cron: Arena phantom trade evaluation (every 3 minutes)
gcloud scheduler jobs delete "${SERVICE_NAME}-cron-arena" --location="${REGION}" --quiet 2>/dev/null || true
gcloud scheduler jobs create http "${SERVICE_NAME}-cron-arena" \
  --location="${REGION}" \
  --schedule="*/3 * * * *" \
  --uri="${SERVICE_URL}/api/v2/arena" \
  --http-method=GET \
  --headers="Authorization=Bearer ${CRON_SECRET_VAL}" \
  --attempt-deadline=90s \
  --time-zone="UTC"

# Cron: Daily rotation / Butcher / Forge (once daily at 00:05 UTC)
gcloud scheduler jobs delete "${SERVICE_NAME}-cron-daily" --location="${REGION}" --quiet 2>/dev/null || true
gcloud scheduler jobs create http "${SERVICE_NAME}-cron-daily" \
  --location="${REGION}" \
  --schedule="5 0 * * *" \
  --uri="${SERVICE_URL}/api/cron" \
  --http-method=POST \
  --headers="Authorization=Bearer ${CRON_SECRET_VAL},Content-Type=application/json" \
  --message-body='{"action":"dailyRotation"}' \
  --attempt-deadline=300s \
  --time-zone="UTC"

# Cron: Watchdog ping (every 10 minutes)
gcloud scheduler jobs delete "${SERVICE_NAME}-watchdog" --location="${REGION}" --quiet 2>/dev/null || true
gcloud scheduler jobs create http "${SERVICE_NAME}-watchdog" \
  --location="${REGION}" \
  --schedule="*/10 * * * *" \
  --uri="${SERVICE_URL}/api/watchdog/ping" \
  --http-method=GET \
  --attempt-deadline=30s \
  --time-zone="UTC"

echo ""
echo "✅ Cloud Scheduler cron jobs configured."
echo ""

# ── Step 7: Verify health ──
echo "🏥 Checking health endpoint..."
sleep 5
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/api/health" || echo "000")

if [ "${HTTP_CODE}" = "200" ]; then
  echo "✅ Health check PASSED (HTTP 200)"
else
  echo "⚠️  Health check returned HTTP ${HTTP_CODE}. Check logs:"
  echo "   gcloud run logs read --service=${SERVICE_NAME} --region=${REGION} --limit=50"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  🎯 NEXT STEPS"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  1. Run Supabase schema migration:"
echo "     Copy src/lib/store/schema.sql into Supabase SQL Editor and execute"
echo ""
echo "  2. Reset for fresh PAPER mode:"
echo "     npx tsx src/scripts/reset_paper_mode.ts"
echo ""
echo "  3. Run pre-LIVE validation:"
echo "     npx tsx src/scripts/pre_live_check.ts"
echo ""
echo "  4. Monitor for 14 days at:"
echo "     ${SERVICE_URL}/api/diagnostics/master"
echo "     ${SERVICE_URL}/api/diagnostics/signal-quality"
echo ""
echo "  5. View logs:"
echo "     gcloud run logs read --service=${SERVICE_NAME} --region=${REGION} --limit=100"
echo ""
