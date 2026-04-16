#!/bin/bash
# ============================================================
# TRADE AI — Push + Deploy (one-click)
# Double-click from Finder or run: ./push-deploy.command
# ============================================================

set -e

# Navigate to project
cd "/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TRADE AI — Push & Deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. Git status ──
echo "📋 Git status:"
git status --short
echo ""

# ── 2. Push to GitHub ──
echo "🚀 Pushing to GitHub (main)..."
git push origin main
echo "✅ Push complete"
echo ""

# ── 3. Deploy to Cloud Run ──
echo "☁️  Deploying to Cloud Run (europe-west1)..."
gcloud run deploy antigravity-trade \
  --source . \
  --project evident-trees-453923-f9 \
  --region europe-west1 \
  --allow-unauthenticated \
  --quiet

echo ""
echo "✅ Deploy complete!"
echo ""

# ── 4. Health check ──
echo "🏥 Health check..."
sleep 5
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" https://trade-ai-657910053930.europe-west1.run.app/api/v2/health)
if [ "$HEALTH" = "200" ]; then
  echo "✅ Health: OK (200)"
else
  echo "⚠️  Health: $HEALTH — check logs"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Done! Dashboard: https://trade-ai-657910053930.europe-west1.run.app/dashboard"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
read -p "Press Enter to close..."
