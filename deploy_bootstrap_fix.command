#!/bin/bash
# ============================================================
# TRADE AI — Deploy Bootstrap Fix
# Commit + Push + Cloud Build
# Dublu-click sau: ./deploy_bootstrap_fix.command
# ============================================================

set -e

PROJECT="evident-trees-453923-f9"
REPO_DIR="/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"

cd "$REPO_DIR"

echo ""
echo "=========================================="
echo "  TRADE AI — Deploy Bootstrap Fix"
echo "=========================================="
echo ""

# 1. Remove stale git locks
echo "[1/5] Sterg lock files vechi..."
rm -f .git/HEAD.lock .git/index.lock .git/objects/maintenance.lock 2>/dev/null
echo "     OK"

# 2. Stage changes
echo "[2/5] Stage files..."
git add src/lib/v2/manager/managerVizionar.ts setup_cloud_scheduler.command setup_cloud_nat.command
echo "     OK"

# 3. Commit
echo "[3/5] Commit..."
git commit -m "fix: RL bootstrap deadlock — new gladiators can now place first trades

Gladiators with 0 trades had winRate=0 → confidence capped at 40% → forced FLAT.
This created a cold-start deadlock: no trades → no winrate → no trades.

Fix: gladiators with <20 trades get full confidence (bootstrap warm-up period).
After 20 trades, normal RL caps apply based on actual performance.

Also adds Cloud Scheduler + Cloud NAT setup scripts.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
echo "     OK"

# 4. Push to GitHub
echo "[4/5] Push to origin/main..."
git push origin main
echo "     OK"

# 5. Trigger Cloud Build
echo "[5/5] Trigger Cloud Build deploy..."
echo ""
echo "Optiuni:"
echo "  A) Cloud Build automat (daca ai trigger pe push)"
echo "  B) Manual build:"
echo ""

if command -v gcloud &> /dev/null; then
    echo "  gcloud detectat. Lansez build..."
    gcloud builds submit --project="$PROJECT" --timeout=600s 2>&1 | tail -20

    echo ""
    echo "=========================================="
    echo "  BUILD LANSAT!"
    echo "=========================================="
    echo ""
    echo "Verifica deployment:"
    echo "  curl https://antigravity-trade-3rzn6ry36q-ew.a.run.app/api/diagnostics/master | jq ."
    echo ""
    echo "Sau in GCP Console:"
    echo "  https://console.cloud.google.com/cloud-build/builds?project=$PROJECT"
else
    echo "  gcloud nu e instalat. Push-ul a fost facut."
    echo "  Daca ai Cloud Build trigger pe push, deploy-ul porneste automat."
    echo ""
    echo "  Altfel, ruleaza manual:"
    echo "    gcloud builds submit --project=$PROJECT"
fi

echo ""
read -p "Apasa Enter pentru a inchide..."
