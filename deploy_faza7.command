#!/bin/bash
# TRADE AI — Deploy FAZA 7 (Omega Status endpoint + OmegaEngine cron)
# Dublu-click pentru rulare. Se deschide automat în Terminal.

set -e

PROJECT_ID="evident-trees-453923-f9"
REGION="europe-west1"
SERVICE="trade-ai"
DIR="/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"

echo "╔══════════════════════════════════════════╗"
echo "║  TRADE AI — Deploy FAZA 7                ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "→ Proiect : $PROJECT_ID"
echo "→ Region  : $REGION"
echo "→ Serviciu: $SERVICE"
echo ""

cd "$DIR" || { echo "❌ Directory not found: $DIR"; exit 1; }

echo "⟳ Set project..."
gcloud config set project "$PROJECT_ID"

echo ""
echo "⟳ Cloud Build submit..."
gcloud builds submit --config=cloudbuild.yaml --project="$PROJECT_ID"

echo ""
echo "⟳ Obțin URL serviciu..."
URL=$(gcloud run services describe "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format='value(status.url)')

echo "✅ Deploy OK → $URL"
echo ""
echo "── Smoke Tests ────────────────────────────"
curl -o /dev/null -s -w "cockpit:       %{http_code}  %{time_total}s\n" "$URL/cockpit"
curl -o /dev/null -s -w "dashboard:     %{http_code}  %{time_total}s\n" "$URL/dashboard"
curl -o /dev/null -s -w "omega-status:  %{http_code}  %{time_total}s\n" "$URL/api/v2/omega-status"
echo ""
echo "── Cockpit Health ─────────────────────────"
curl -fsS "$URL/api/v2/cockpit-health" | python3 -m json.tool 2>/dev/null || echo "(json parse failed)"
echo ""
echo "── Omega Status ───────────────────────────"
curl -fsS "$URL/api/v2/omega-status" | python3 -m json.tool 2>/dev/null | head -40
echo ""
echo "✅ FAZA 7 Deploy + Smoke Test Complete"
