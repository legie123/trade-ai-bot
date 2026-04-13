#!/bin/bash
# ============================================================
# TRADE AI — Deploy Status Command Center
# Double-click this file from Finder to deploy.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

echo ""
echo "============================================"
echo "  TRADE AI — Status Command Center Deploy"
echo "============================================"

# ─── Clean up any stale git locks ────────────────────────────
for f in .git/index.lock .git/HEAD.lock .git/MERGE_HEAD .git/COMMIT_EDITMSG.lock; do
  [ -f "$f" ] && rm -f "$f" && echo "  Cleared $f"
done

# ─── 1. Git push ─────────────────────────────────────────────
echo ""
echo "[1/2] Pushing to GitHub..."
git push origin main
echo "  ✓ GitHub push complete"

# ─── 2. Cloud Run deploy ─────────────────────────────────────
echo ""
echo "[2/2] Deploying to Cloud Run (Cloud Build — no Docker needed)..."

if ! command -v gcloud &>/dev/null; then
  echo "  ✗ gcloud not found"
  echo "    Install from: https://cloud.google.com/sdk/docs/install"
  exit 1
fi

gcloud config set project evident-trees-453923-f9 --quiet

# Build env vars from .env.local
ENV_ARGS=""
if [ -f ".env.local" ]; then
  while IFS='=' read -r key val; do
    [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
    val="${val%\"}"
    val="${val#\"}"
    ENV_ARGS="${ENV_ARGS}${key}=${val},"
  done < .env.local
  ENV_ARGS="${ENV_ARGS%,}"
fi

if [ -n "$ENV_ARGS" ]; then
  gcloud run deploy antigravity-trade \
    --source . \
    --region europe-west1 \
    --allow-unauthenticated \
    --set-env-vars "$ENV_ARGS" \
    --quiet
else
  gcloud run deploy antigravity-trade \
    --source . \
    --region europe-west1 \
    --allow-unauthenticated \
    --quiet
fi

SERVICE_URL="https://antigravity-trade-3rzn6ry36q-ew.a.run.app"

echo ""
echo "============================================"
echo "  ✓ DEPLOY COMPLETE"
echo "  STATUS: ${SERVICE_URL}/dashboard"
echo "============================================"
echo ""

open "${SERVICE_URL}/dashboard"
