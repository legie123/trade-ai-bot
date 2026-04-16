#!/bin/bash
# TRADE AI — Autonomous Push + Cloud Run Deploy
# Double-click din Finder. Zero intervenție manuală.
# Folosește: .claude-creds (GitHub PAT) + .gcp-key.json (GCP SA)

set -e

PROJECT_ID="evident-trees-453923-f9"
REGION="europe-west1"
SERVICE="trade-ai"
DIR="/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"
URL="https://trade-ai-657910053930.europe-west1.run.app"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║  TRADE AI — Auto Push + Deploy               ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""

cd "$DIR" || { echo -e "${RED}❌ Directory not found: $DIR${NC}"; exit 1; }

# ── Load GitHub PAT ──────────────────────────────────────────
if [ ! -f ".claude-creds" ]; then
  echo -e "${RED}❌ .claude-creds not found${NC}"; exit 1
fi
source .claude-creds
[ -z "$GITHUB_TOKEN" ] && echo -e "${RED}❌ GITHUB_TOKEN lipsă${NC}" && exit 1
echo -e "${GREEN}✓ GitHub PAT loaded${NC}"

# ── Load GCP Service Account ─────────────────────────────────
GCP_AUTH=false
if [ -f ".gcp-key.json" ]; then
  gcloud auth activate-service-account --key-file=".gcp-key.json" \
    --project="$PROJECT_ID" 2>/dev/null && \
    echo -e "${GREEN}✓ GCP Service Account activated${NC}" && GCP_AUTH=true || \
    echo -e "${YELLOW}⚠  gcloud auth failed — deploy via Cloud Build trigger${NC}"
else
  echo -e "${YELLOW}⚠  .gcp-key.json lipsă — deploy via Cloud Build trigger${NC}"
fi

echo ""
echo -e "${DIM}── Git ─────────────────────────────────────────${NC}"

# ── Remove stale locks ───────────────────────────────────────
for LOCK in ".git/index.lock" ".git/HEAD.lock" ".git/MERGE_HEAD.lock" ".git/COMMIT_EDITMSG.lock"; do
  [ -f "$LOCK" ] && rm -f "$LOCK" && echo -e "${YELLOW}⟳ Removed $LOCK${NC}"
done

# ── Stage + commit ───────────────────────────────────────────
git add -A
if git diff --cached --quiet; then
  echo -e "${DIM}ℹ  Nothing to commit${NC}"
else
  git commit -m "chore: deploy $(date '+%Y-%m-%d %H:%M')

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
  echo -e "${GREEN}✓ Commit creat${NC}"
fi

# ── Push cu PAT ──────────────────────────────────────────────
git remote set-url origin "https://${GITHUB_TOKEN}@github.com/legie123/trade-ai-bot.git"
git push origin main
git remote set-url origin "https://github.com/legie123/trade-ai-bot.git"
echo -e "${GREEN}✓ Push OK → github.com/legie123/trade-ai-bot${NC}"

echo ""
echo -e "${DIM}── Deploy ──────────────────────────────────────${NC}"

if [ "$GCP_AUTH" = true ]; then
  echo -e "${CYAN}⟳ Cloud Build submit (5-8 min)...${NC}"
  gcloud builds submit --config=cloudbuild.yaml --project="$PROJECT_ID" --suppress-logs && \
    echo -e "${GREEN}✓ Cloud Build complete${NC}" || \
    echo -e "${YELLOW}⚠  Verifică: https://console.cloud.google.com/cloud-build/builds?project=$PROJECT_ID${NC}"
else
  echo -e "${CYAN}⟳ Cloud Build auto-trigger din push. Aștept 5 min...${NC}"
  echo -e "${DIM}   Monitor: https://console.cloud.google.com/cloud-build/builds?project=$PROJECT_ID${NC}"
  for i in $(seq 1 10); do
    sleep 30
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$URL/api/v2/health" 2>/dev/null)
    printf "\r   [%02d/10] health → %s " $i "$STATUS"
  done
  echo ""
fi

echo ""
echo -e "${DIM}── Smoke Tests ────────────────────────────────${NC}"
smoke() {
  CODE=$(curl -o /dev/null -s -w "%{http_code}" -L --max-time 10 "$URL$1" 2>/dev/null)
  TIME=$(curl -o /dev/null -s -w "%{time_total}" -L --max-time 10 "$URL$1" 2>/dev/null)
  [[ "$CODE" == "200" ]] && \
    echo -e "${GREEN}  ✓${NC} $1 → ${CODE} ${DIM}(${TIME}s)${NC}" || \
    echo -e "${YELLOW}  ⚠${NC} $1 → ${CODE} ${DIM}(${TIME}s)${NC}"
}
smoke "/api/v2/health"
smoke "/arena"
smoke "/cockpit"
smoke "/crypto-radar"
smoke "/polymarket"
smoke "/dashboard"
smoke "/api/v2/omega-status"

echo ""
echo -e "${DIM}── Deschid în Chrome ──────────────────────────${NC}"
open -a "Google Chrome" \
  "$URL/arena" "$URL/cockpit" "$URL/dashboard" \
  "$URL/crypto-radar" "$URL/polymarket" 2>/dev/null || \
open "$URL/arena" "$URL/cockpit" "$URL/dashboard" "$URL/crypto-radar" "$URL/polymarket"

echo ""
echo -e "${GREEN}${BOLD}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║  ✅ Done! $URL  ║${NC}"
echo -e "${GREEN}${BOLD}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
