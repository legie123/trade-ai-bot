#!/bin/bash
# ============================================================
# TRADE AI — Full Deploy: GitHub + Cloud Run
# Double-click this file to commit, push & deploy.
# ============================================================

set -euo pipefail
cd "$(dirname "$0")"

PROJECT_ID="evident-trees-453923-f9"
REGION="europe-west1"
SERVICE_NAME="antigravity-trade"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo ""
echo "=============================================="
echo "  TRADE AI — FULL DEPLOY"
echo "=============================================="
echo ""

# ── Step 0: Clear stale git lock ───────────────────────────
echo "[0/5] Clearing stale git locks..."
rm -f .git/index.lock .git/MERGE_HEAD .git/rebase-merge 2>/dev/null || true
echo "  Done."

# ── Step 1: Git add + commit ────────────────────────────────
echo ""
echo "[1/5] Staging all changes..."
git add \
  src/app/crypto-radar/page.tsx \
  src/app/arena/page.tsx \
  src/app/dashboard/page.tsx \
  src/app/api/bot/route.ts \
  src/app/api/live-stream/route.ts \
  src/app/api/moltbook-cron/route.ts \
  src/components/BottomNav.tsx \
  src/components/CommandPalette.tsx \
  src/components/Sidebar.tsx \
  src/components/AgentStatusHero.tsx \
  src/components/DecisionMatrix.tsx \
  src/components/MoltbookSwarmFeed.tsx \
  src/components/TerminalOverlay.tsx \
  src/lib/core/killSwitch.ts \
  src/lib/moltbook/discoveryFeed.ts \
  src/lib/v2/gladiators/butcher.ts \
  src/app/arena/ \
  MASTER_BLUEPRINT_V2.md \
  TAKEOVER_AUDIT_REPORT.md \
  deploy_now.command \
  deploy_full.command \
  fix_shortcut.command \
  fix_shortcut_perms.sh \
  2>/dev/null || true

git status --short
echo ""

CHANGES=$(git diff --cached --name-only | wc -l | tr -d ' ')
if [ "$CHANGES" -eq "0" ]; then
  echo "Nothing staged to commit. Skipping to deploy."
else
  echo "[2/5] Committing $CHANGES files..."
  git commit -m "$(cat <<'COMMITMSG'
feat(ux): complete UX overhaul — Radar, Arena, Status + Phoenix V2

- Radar: sticky BTC anchor, consensus+signals grid, sortable token scanner
- Arena: clean podium, sortable leaderboard, Omega progress bar
- Status: operational clarity layout, kill switch in sticky bar, equity hero
- Dashboard: Agentic Mode (Faza 6) — AgentStatusHero, DecisionMatrix, MoltbookSwarmFeed
- Fixed desktop shortcut → points to live Cloud Run URL
- deploy_full.command: one-click GitHub + Cloud Run deploy
COMMITMSG
)"
  echo "  Committed."
fi

# ── Step 3: Push to GitHub ──────────────────────────────────
echo ""
echo "[3/5] Pushing to GitHub (origin/main)..."
git push origin main
echo "  Pushed."

# ── Step 4: Build + push Docker image ──────────────────────
echo ""
echo "[4/5] Building Docker image..."
if ! command -v docker &>/dev/null; then
  echo "  ERROR: Docker not found. Please install Docker Desktop and retry."
  echo "  Skipping deploy — code is live on GitHub."
  echo ""
  echo "  To deploy manually later, run: ./deploy_now.command"
  echo ""
  echo "Press Enter to close..."
  read
  exit 0
fi

TAG=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")

if [ ! -f ".env.local" ]; then
  echo "  ERROR: .env.local not found. Skipping deploy."
  echo "Press Enter to close..."
  read
  exit 1
fi

echo "  Tag: ${TAG}"
docker build -t "${IMAGE}:${TAG}" -t "${IMAGE}:latest" .
echo "  Build complete. Pushing..."
docker push "${IMAGE}:${TAG}"
docker push "${IMAGE}:latest"
echo "  Docker push complete."

# ── Step 5: Deploy to Cloud Run ─────────────────────────────
echo ""
echo "[5/5] Deploying to Cloud Run..."
ENV_VARS=$(grep -v '^#' .env.local | grep -v '^\s*$' | grep '=' | tr '\n' ',' | sed 's/,$//')

gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --image "${IMAGE}:${TAG}" \
  --region "${REGION}" \
  --platform managed \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 3 \
  --timeout 300 \
  --concurrency 80 \
  --allow-unauthenticated \
  --set-env-vars "${ENV_VARS}"

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format 'value(status.url)')

echo ""
echo "=============================================="
echo "  DEPLOY COMPLETE ✓"
echo "=============================================="
echo "  Radar:  ${SERVICE_URL}/crypto-radar"
echo "  Arena:  ${SERVICE_URL}/arena"
echo "  Status: ${SERVICE_URL}/dashboard"
echo ""

# Health check
sleep 4
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/api/health" || echo "000")
if [ "${HTTP}" = "200" ]; then
  echo "  Health: OK (HTTP 200) ✓"
else
  echo "  Health: HTTP ${HTTP} — give it 30s to warm up"
fi

echo ""
echo "Press Enter to close..."
read
