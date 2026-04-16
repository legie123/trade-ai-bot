#!/bin/bash
# TRADE AI — Git Push + Cloud Run Deploy
# Double-click pentru rulare. Se deschide automat în Terminal.

set -e

PROJECT_ID="evident-trees-453923-f9"
REGION="europe-west1"
SERVICE="trade-ai"
DIR="/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"
BASE_URL="https://trade-ai-3rzn6ry36q-ew.a.run.app"

echo "╔══════════════════════════════════════════════════╗"
echo "║  TRADE AI — Push + Deploy                        ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

cd "$DIR" || { echo "❌ Directory not found: $DIR"; exit 1; }

# ── Remove stale lock if exists ──
if [ -f ".git/index.lock" ]; then
  echo "⟳ Removing stale .git/index.lock..."
  rm -f ".git/index.lock"
fi

echo "⟳ Git status..."
git status --short
echo ""

echo "⟳ Staging all changes..."
git add -A

echo ""
echo "⟳ Commit..."
TIMESTAMP=$(date +"%Y-%m-%d %H:%M")
git commit -m "fix: Sidebar + CommandPalette missing Cockpit entry

- Sidebar.tsx: added Cockpit 🚀 (shortcut C) between Arena and Status
- CommandPalette.tsx: added nav-cockpit + nav-polymarket entries
- Both nav systems now have all 5 pages: Radar Poly Arena Cockpit Status
- Deploy: $TIMESTAMP

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" 2>/dev/null || echo "⚠️  Nothing new to commit"

echo ""
echo "⟳ Push to origin main..."
git push origin main

echo ""
echo "✅ Push complete!"
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Starting Cloud Run Deploy...                    ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

gcloud config set project "$PROJECT_ID"

echo ""
echo "⟳ Cloud Build submit (poate dura 5-8 min)..."
gcloud builds submit --config=cloudbuild.yaml --project="$PROJECT_ID"

echo ""
echo "⟳ Obțin URL serviciu..."
URL=$(gcloud run services describe "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format='value(status.url)' 2>/dev/null || echo "$BASE_URL")

echo ""
echo "✅ Deploy OK → $URL"
echo ""
echo "── Smoke Tests ────────────────────────────────────"
curl -o /dev/null -s -w "health:        %{http_code}  %{time_total}s\n" "$URL/api/v2/health"
curl -o /dev/null -s -w "cockpit:       %{http_code}  %{time_total}s\n" "$URL/cockpit"
curl -o /dev/null -s -w "arena:         %{http_code}  %{time_total}s\n" "$URL/arena"
curl -o /dev/null -s -w "crypto-radar:  %{http_code}  %{time_total}s\n" "$URL/crypto-radar"
curl -o /dev/null -s -w "polymarket:    %{http_code}  %{time_total}s\n" "$URL/polymarket"
curl -o /dev/null -s -w "omega-status:  %{http_code}  %{time_total}s\n" "$URL/api/v2/omega-status"
echo ""
echo "── Deschid paginile în browser... ────────────────"
open -a "Google Chrome" \
  "$URL/arena" \
  "$URL/cockpit" \
  "$URL/dashboard" \
  "$URL/crypto-radar" \
  "$URL/polymarket" 2>/dev/null || \
open "$URL/arena" "$URL/cockpit" "$URL/dashboard" "$URL/crypto-radar" "$URL/polymarket"
echo ""
echo "✅ Deploy + Browser Open Complete"
echo "   URL: $URL"
