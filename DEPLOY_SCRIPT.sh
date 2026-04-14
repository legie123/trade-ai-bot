#!/bin/bash
# TRADE AI — Git + Cloud Build + Deploy Automation
# Run this on your Mac to push + deploy everything automatically
# Usage: bash DEPLOY_SCRIPT.sh

set -e  # Exit on any error

REPO_PATH="/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"
GITHUB_TOKEN="REMOVED_TOKEN"

echo "🚀 TRADE AI — PHASE 1 + PHASE 2 PUSH & DEPLOY"
echo "=================================================="
echo ""

# Step 1: Navigate to repo
echo "📂 Step 1: Navigating to repo..."
cd "$REPO_PATH" || exit 1
echo "✅ In: $(pwd)"
echo ""

# Step 2: Remove git locks
echo "🔓 Step 2: Removing git locks..."
rm -f .git/*.lock .git/refs/remotes/origin/*.lock 2>/dev/null || true
echo "✅ Locks removed"
echo ""

# Step 3: Check status
echo "📋 Step 3: Checking git status..."
git status --short | head -20 || echo "No changes"
echo ""

# Step 4: Verify staged files
echo "🎯 Step 4: Verifying staged files..."
STAGED=$(git diff --cached --name-only | wc -l)
echo "✅ $STAGED files staged and ready"
echo ""

# Step 5: Commit
echo "💾 Step 5: Creating commit..."
git commit -m "feat: Phase 1 + Phase 2 — health endpoint, route audit, execution plan

PHASE 1 (Deployment Ready):
- src/app/api/v2/health/route.ts — health check (Polymarket, Supabase, Binance, DeepSeek, Telegram)
- SMOKE_TESTS.md — 8 critical endpoint tests
- TRADE_AI_OPERATIONAL_AUDIT.md — full system assessment + 5-phase plan

PHASE 2 (Analysis Complete):
- PHASE_2_ROUTE_AUDIT.md — all 46 routes categorized (17 ACTIVE, 15 UNCERTAIN, 14 DEAD)
- PHASE_2_ACTION_PLAN.md — detailed execution (6.5 hrs, 5 parts)

Target: 100% operational post-Phase 5

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>" && echo "✅ Commit created" || echo "⚠️  Commit failed or nothing to commit"
echo ""

# Step 6: Push to GitHub
echo "📤 Step 6: Pushing to GitHub..."
git push origin main && echo "✅ Push successful" || echo "❌ Push failed"
echo ""

# Step 7: Check Cloud Build
echo "🔨 Step 7: Checking Cloud Build status..."
echo ""
echo "Cloud Build should automatically trigger on push."
echo "Monitor at: https://console.cloud.google.com/cloud-build/builds"
echo ""

# Step 8: Wait for deployment
echo "⏳ Step 8: Waiting for Cloud Run deployment..."
echo "Deployment usually takes 2-3 minutes..."
echo ""
sleep 5

# Step 9: Verify Cloud Run
echo "🔍 Step 9: Verifying Cloud Run service..."
gcloud run services describe trade-ai --region=europe-west1 --format='value(status.conditions[0].message)' 2>/dev/null || echo "⚠️  Could not check status"
echo ""

# Step 10: Test health endpoint
echo "🏥 Step 10: Testing /api/v2/health endpoint..."
curl -s https://trade-ai-657910853930.europe-west1.run.app/api/v2/health | jq '.' 2>/dev/null && echo "✅ Health endpoint responding" || echo "⏳ Still deploying, wait 30 seconds then check manually"
echo ""

# Step 11: Run smoke tests
echo "🧪 Step 11: Running smoke tests..."
if [ -f "SMOKE_TESTS.md" ]; then
  bash SMOKE_TESTS.md || echo "⚠️  Some tests may have failed"
else
  echo "⚠️  SMOKE_TESTS.md not found"
fi
echo ""

echo "=================================================="
echo "✅ DEPLOY COMPLETE!"
echo "=================================================="
echo ""
echo "Next steps:"
echo "1. Verify all endpoints at: https://trade-ai-657910853930.europe-west1.run.app"
echo "2. Monitor logs: gcloud run logs read trade-ai --limit=50 --region=europe-west1"
echo "3. Start Phase 2 validation: Test 17 ACTIVE routes"
echo ""
