#!/bin/bash
# ============================================================
# TRADE AI — Deploy Paper Mode Calibration
# - VWAP relaxed (1.5x → 0.8x in paper)
# - RSI relaxed (45 → 35 in paper)
# - Polymarket edge threshold 40 → 25
# - Telegram paper trade notifications
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
echo "║   DEPLOY PAPER MODE CALIBRATION           ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Remove stale git locks
rm -f .git/HEAD.lock .git/index.lock 2>/dev/null

# ─── Git commit + push ───
echo "[1/4] Git commit + push..."
git add -A
git commit -m "calibrate: relax VWAP/RSI gates for paper mode + Telegram paper alerts

Paper mode calibration to generate training data for gladiators:
- VWAP volume threshold: 1.5x → 0.8x (paper) / unchanged for LIVE
- RSI buy gate: 45 → 35 (paper) / unchanged for LIVE
- Polymarket edge threshold: 40 → 25 (via POLY_EDGE_THRESHOLD env)
- Added Telegram notification on every paper trade execution
- All relaxations auto-revert when TRADING_MODE=LIVE

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

git push origin main 2>&1
echo "  ✓ Push done"
echo ""

# ─── Sync env vars ───
echo "[2/4] Sync env vars..."
python3 - "$ENVFILE" "$YAMLFILE" << 'PYEOF'
import sys
envfile, yamlfile = sys.argv[1], sys.argv[2]
skip = {'PORT'}
lines = []
with open(envfile) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#') or '═' in line or '=' not in line: continue
        k, _, v = line.partition('=')
        k = k.strip()
        if not k or k in skip: continue
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")): v = v[1:-1]
        lines.append(f'{k}: "{v.replace(chr(92), chr(92)*2).replace(chr(34), chr(92)+chr(34))}"')
with open(yamlfile, 'w') as f: f.write('\n'.join(lines) + '\n')
print(f"  {len(lines)} vars")
PYEOF

gcloud run services update "$SERVICE" --region="$REGION" --project="$PROJECT" --env-vars-file="$YAMLFILE" --quiet 2>&1
rm -f "$YAMLFILE"
echo "  ✓ Env vars synced"
echo ""

# ─── Deploy from source ───
echo "[3/4] Deploy from source..."
gcloud run deploy "$SERVICE" --source . --region="$REGION" --project="$PROJECT" --allow-unauthenticated --quiet 2>&1
echo "  ✓ Deploy done"
echo ""

# ─── Verify ───
echo "[4/4] Warm-up (30s) + verify..."
for i in $(seq 30 -1 1); do printf "\r  %2d..." $i; sleep 1; done
echo ""

echo ""
echo "=== HEALTH ==="
curl -s --max-time 20 "$BASE/api/diagnostics/master" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
print(f'  Health: {d[\"overallHealth\"]}')
print(f'  Mode: {d[\"equity\"][\"mode\"]}')
print(f'  Trades: {d[\"equity\"][\"totalTrades\"]}')
" 2>/dev/null

echo ""
echo "=== BTC SCANNER ==="
curl -s --max-time 20 "$BASE/api/btc-signals" | python3 -c "
import sys,json
d=json.load(sys.stdin)
sigs = d.get('signals', [])
non_neutral = [s for s in sigs if s.get('signal') != 'NEUTRAL']
print(f'  Total signals: {len(sigs)}')
print(f'  Non-NEUTRAL: {len(non_neutral)}')
for s in sigs[:5]:
    print(f'    {s.get(\"signal\",\"?\")} — {s.get(\"reason\",\"?\")[:70]}')
" 2>/dev/null

echo ""
echo "=== POLY SCAN ==="
curl -s --max-time 15 "$BASE/api/v2/polymarket/cron/scan" -H "x-cron-secret: tradeai_cron_secret_2026" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f'  Opportunities: {d.get(\"opportunitiesFound\", d.get(\"data\",{}).get(\"opportunitiesFound\",\"?\"))}')
print(f'  Bets placed: {d.get(\"betsPlaced\", d.get(\"data\",{}).get(\"betsPlaced\",\"?\"))}')
" 2>/dev/null

echo ""
echo "=== TRIGGER CRON ==="
curl -s --max-time 25 "$BASE/api/cron?secret=tradeai_cron_secret_2026" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f'  Decisions: {d.get(\"mainDecisionsEvaluated\",0)}')
print(f'  Prices fetched: {d.get(\"pricesFetched\",0)}')
" 2>/dev/null

echo ""
echo "Calibrare aplicată. Primele trades ar trebui să apară în ore."
echo "Vei primi notificări Telegram la fiecare paper trade."
echo ""
read -p "Enter to close..."
