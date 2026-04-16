#!/bin/bash
# ============================================================
# TRADE AI — Deploy via Cloud Run (direct source deploy)
# Foloseste gcloud run deploy --source . (nu cloud builds submit)
# ============================================================

cd "/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"

echo ""
echo "=========================================="
echo "  TRADE AI — Deploy to Cloud Run"
echo "=========================================="
echo ""

# Check auth
echo "[1/3] Verific autentificarea..."
ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null)
echo "  Cont activ: $ACCOUNT"
echo ""

if [ -z "$ACCOUNT" ]; then
    echo "  Nu esti autentificat! Ruleaza:"
    echo "    gcloud auth login"
    read -p "Enter to close..."
    exit 1
fi

# Set project
echo "[2/3] Setez proiectul..."
gcloud config set project evident-trees-453923-f9 --quiet
echo "     OK"
echo ""

# Deploy with source (this builds remotely and deploys in one step)
echo "[3/3] Deploy pe Cloud Run (source build)..."
echo "  Asta dureaza 3-5 minute..."
echo ""

gcloud run deploy antigravity-trade \
    --source . \
    --region europe-west1 \
    --platform managed \
    --allow-unauthenticated \
    --port 8080 \
    --memory 512Mi \
    --timeout 300 \
    --set-env-vars NODE_ENV=production \
    --quiet 2>&1

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "  DEPLOY REUSIT!"
    echo "=========================================="
    echo ""
    echo "Verifica:"
    curl -s https://antigravity-trade-3rzn6ry36q-ew.a.run.app/api/diagnostics/master | head -5
    echo ""
else
    echo ""
    echo "=========================================="
    echo "  DEPLOY ESUAT - incearca varianta alternativa:"
    echo "=========================================="
    echo ""
    echo "  1. Verifica contul: gcloud auth login"
    echo "  2. Sau foloseste: gcloud run deploy antigravity-trade --source . --region europe-west1"
    echo ""
fi

read -p "Enter to close..."
