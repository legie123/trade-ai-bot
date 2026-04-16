#!/bin/bash
# ============================================================
# TRADE AI — Fix Auth + Deploy
# Problema: service account-ul claude-deploy nu are Storage perms
# Solutie: deploy cu contul personal lemuriandeals@gmail.com
# ============================================================

cd "/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"

PROJECT="evident-trees-453923-f9"

echo ""
echo "=========================================="
echo "  TRADE AI — Fix Auth + Deploy"
echo "=========================================="
echo ""

# Step 1: Switch to personal account
echo "[1/4] Schimb pe contul personal..."
echo "  (Se va deschide browser-ul pentru login)"
echo ""
gcloud auth login --project="$PROJECT" 2>&1

# Step 2: Verify account
echo ""
echo "[2/4] Verific contul activ..."
ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null)
echo "  Cont activ: $ACCOUNT"

if [[ "$ACCOUNT" == *"gserviceaccount"* ]]; then
    echo "  EROARE: Inca pe service account. Trebuie cont personal."
    echo "  Ruleaza: gcloud config set account lemuriandeals@gmail.com"
    read -p "Enter to close..."
    exit 1
fi

# Step 3: Also fix SA permissions (so future deploys work)
echo ""
echo "[3/4] Adaug Storage Admin la service account claude-deploy..."
gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:claude-deploy@${PROJECT}.iam.gserviceaccount.com" \
    --role="roles/storage.admin" \
    --quiet 2>/dev/null && echo "     OK" || echo "     (skip - poate nu ai permisiuni IAM)"

# Step 4: Deploy
echo ""
echo "[4/4] Deploy pe Cloud Run..."
echo "  Dureaza 3-5 minute..."
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

    # Switch back to SA for future automated deploys
    echo ""
    echo "Revenire la service account pentru deploys automate..."
    gcloud config set account "claude-deploy@${PROJECT}.iam.gserviceaccount.com" --quiet 2>/dev/null

    echo ""
    echo "Verifica health:"
    sleep 10
    curl -s https://antigravity-trade-3rzn6ry36q-ew.a.run.app/api/diagnostics/master 2>/dev/null | python3 -m json.tool 2>/dev/null | head -20
    echo ""
else
    echo ""
    echo "  DEPLOY ESUAT."
    echo ""
    echo "  Incearca manual:"
    echo "    gcloud auth login"
    echo "    gcloud run deploy antigravity-trade --source . --region europe-west1"
fi

read -p "Enter to close..."
