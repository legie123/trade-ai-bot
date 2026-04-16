#!/bin/bash
# ============================================================
# TRADE AI Production Deployment Script
# Runs Tier 1 fixes and deploys to Cloud Run
# ============================================================

set -e

PROJECT_ID="$(gcloud config get-value project)"
REGION="europe-west1"
SERVICE_NAME="trade-ai"

echo "🚀 TRADE AI Production Deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"
echo ""
 
# Step 0: Load local .env
if [ -f .env ]; then
  echo "✓ Loading local .env..."
  set -a; source .env; set +a
fi

# Step 1: Verify gcloud is configured
echo "✓ Checking gcloud configuration..."
gcloud config list

# Step 2: Verify environment variables
echo ""
echo "✓ Checking required environment variables..."
required_vars=(
  "DEEPSEEK_API_KEY"
  "OPENAI_API_KEY"
  "GEMINI_API_KEY"
  "MEXC_API_KEY"
  "MEXC_API_SECRET"
  "NEXT_PUBLIC_SUPABASE_URL"
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  "SUPABASE_SERVICE_ROLE_KEY"
)

for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "❌ ERROR: Missing $var in environment"
    exit 1
  fi
done
echo "✓ All required variables configured"

# Step 3: Run Supabase migration for llm_cache table
echo ""
echo "✓ Applying Supabase migration for llm_cache table..."
# You can automate this via Supabase CLI if set up:
# supabase migration up
echo "  ⚠️  Manual step: Run the migration in supabase/migrations/20260414_llm_cache.sql"
echo "     via Supabase dashboard → SQL Editor, or:"
echo "     supabase db push"

# Step 4: Submit Cloud Build
echo ""
echo "✓ Submitting Cloud Build deployment..."
gcloud builds submit \
  --config=cloudbuild.yaml \
  --timeout=1200s \
  --region=$REGION

BUILD_ID=$(gcloud builds list --limit=1 --format='value(id)')
echo ""
echo "✓ Build submitted: $BUILD_ID"
echo ""
echo "Monitoring build logs..."
gcloud builds log --stream $BUILD_ID

# Step 5: Wait for deployment to complete
echo ""
echo "✓ Waiting for Cloud Run service to be ready..."
sleep 10

# Step 6: Verify deployment
echo ""
echo "✓ Verifying deployment..."
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')
echo "Service URL: $SERVICE_URL"

# Health check
echo ""
echo "✓ Running health check..."
HEALTH_RESPONSE=$(curl -s "$SERVICE_URL/api/v2/health")
echo "Health check response: $HEALTH_RESPONSE"

if echo "$HEALTH_RESPONSE" | grep -q "clob"; then
  echo "✓ Health check passed"
else
  echo "⚠️  Health check response unexpected, check Cloud Run logs"
fi

# Step 7: Show next steps
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ DEPLOYMENT COMPLETE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📍 Service URL: $SERVICE_URL"
echo ""
echo "📋 Next Steps:"
echo "  1. Check Cloud Run logs:    gcloud run logs read $SERVICE_NAME --region=$REGION --limit=50"
echo "  2. Navigate to UI:          $SERVICE_URL/polymarket"
echo "  3. Test a market trade (paper)"
echo "  4. Verify daily loss limits"
echo "  5. Check gladiator spawning"
echo ""
echo "📊 Monitoring:"
echo "  - Cloud Run Console: https://console.cloud.google.com/run"
echo "  - Supabase Dashboard: https://app.supabase.com"
echo "  - Cloud Build Logs: https://console.cloud.google.com/cloud-build"
echo ""
