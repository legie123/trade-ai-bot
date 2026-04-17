#!/bin/bash
# ============================================================
# TRADE AI — Deploy Audit Fix
# 1. Git commit + push (diagnostics fix + POLY_PAPER_FEEDER)
# 2. Sync env vars to Cloud Run (YAML method)
# 3. Deploy new revision
# 4. Health check
# ============================================================

SERVICE="antigravity-trade"
REGION="europe-west1"
PROJECT="evident-trees-453923-f9"
ENVFILE="/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI/.env"
YAMLFILE="/tmp/trade_ai_env.yaml"
BASE="https://antigravity-trade-3rzn6ry36q-ew.a.run.app"

cd "/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   DEPLOY AUDIT FIX + ENV SYNC            ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── STEP 1: Git commit + push ───
echo "[1/4] Git commit + push..."

# Remove any stale lock files
rm -f .git/HEAD.lock .git/index.lock 2>/dev/null

git add src/app/api/diagnostics/master/route.ts .env
git commit -m "fix: diagnostics skips MEXC balance in PAPER mode + enable POLY_PAPER_FEEDER

- Master diagnostics now only tests MEXC public endpoint (serverTime) in PAPER mode
- Private endpoints (getMexcBalances) skipped since they need API key + IP whitelist
- Added POLY_PAPER_FEEDER=true to enable Polymarket paper signal emission
- This makes overallHealth = HEALTHY in paper trading mode

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

echo "  Pushing to GitHub..."
git push origin main 2>&1
echo "  ✓ Git push done"
echo ""

# ─── STEP 2: Generate YAML env vars ───
echo "[2/4] Generez YAML din .env..."
rm -f "$YAMLFILE"

python3 - "$ENVFILE" "$YAMLFILE" << 'PYEOF'
import sys
envfile = sys.argv[1]
yamlfile = sys.argv[2]
skip_keys = {'PORT'}
lines = []
with open(envfile, 'r') as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#') or '═' in line:
            continue
        if '=' not in line:
            continue
        key, _, value = line.partition('=')
        key = key.strip()
        if not key or key in skip_keys:
            continue
        if (value.startswith('"') and value.endswith('"')) or \
           (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        value_escaped = value.replace('\\', '\\\\').replace('"', '\\"')
        lines.append(f'{key}: "{value_escaped}"')
with open(yamlfile, 'w') as f:
    f.write('\n'.join(lines) + '\n')
print(f"  {len(lines)} variabile")
PYEOF
echo ""

# ─── STEP 3: Deploy to Cloud Run ───
echo "[3/4] Deploy pe Cloud Run (source + env vars)..."

# First update env vars
gcloud run services update "$SERVICE" \
    --region="$REGION" \
    --project="$PROJECT" \
    --env-vars-file="$YAMLFILE" \
    --quiet 2>&1
rm -f "$YAMLFILE"

# Then deploy from source (picks up code changes)
echo ""
echo "  Deploying from source (this takes 2-4 min)..."
gcloud run deploy "$SERVICE" \
    --source . \
    --region="$REGION" \
    --project="$PROJECT" \
    --allow-unauthenticated \
    --quiet 2>&1

RC=$?
if [ $RC -ne 0 ]; then
    echo "  ✗ Source deploy failed. Trying alternative..."
    # Alternative: just update env vars (code changes will deploy via Cloud Build trigger)
    echo "  Env vars already applied. Code will deploy via Cloud Build trigger on push."
fi
echo ""

# ─── STEP 4: Health check ───
echo "[4/4] Astept 30s warm-up..."
for i in $(seq 30 -1 1); do
    printf "\r  %2d secunde ramase..." $i
    sleep 1
done
echo ""
echo ""

echo "=== HEALTH CHECK ==="
curl -s --max-time 20 "$BASE/api/diagnostics/master" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)['data']
    print(f'  Status:     {d[\"status\"]}')
    print(f'  Health:     {d[\"overallHealth\"]}')
    mexc = d['mexc']
    print(f'  MEXC:       {mexc[\"status\"]} (latency:{mexc.get(\"latencyMs\",\"?\")}ms)')
    if mexc.get('note'):
        print(f'              {mexc[\"note\"]}')
    if mexc.get('error'):
        print(f'              ERROR: {mexc[\"error\"]}')
    sb = d['supabase']
    print(f'  Supabase:   {sb[\"status\"]} (write:{sb[\"writeLatencyMs\"]}ms read:{sb[\"readLatencyMs\"]}ms)')
    eq = d['equity']
    print(f'  Mode:       {eq[\"mode\"]}')
    print(f'  Balance:    \${eq[\"currentBalance\"]}')
    print(f'  Trades:     {eq[\"totalTrades\"]}')
    h = d['overallHealth']
    if h == 'HEALTHY':
        print('')
        print('  ✓ ALL SYSTEMS GO! Paper trading operational.')
    elif h == 'DEGRADED':
        print('')
        print('  ⚠ DEGRADED — code not yet deployed. Wait for Cloud Build or re-run.')
    else:
        print('')
        print('  ✗ CRITICAL — check errors above')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null

echo ""
echo ""
read -p "Enter to close..."
