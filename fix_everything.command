#!/bin/bash
# ============================================================
# TRADE AI — FIX EVERYTHING: Env Vars + Verify + Report
# Rulează acest script de pe Mac (dublu-click)
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
echo "║   TRADE AI — FIX EVERYTHING              ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── STEP 1: Check gcloud auth ───
echo "[1/5] Verificare autentificare GCP..."
ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null)
echo "  Cont activ: $ACCOUNT"
if [[ -z "$ACCOUNT" ]]; then
    echo "  Nu esti autentificat. Deschid browser..."
    gcloud auth login 2>&1
    ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null)
fi
if [[ "$ACCOUNT" == *"claude-deploy"* ]]; then
    echo "  Service Account detectat. Trec pe cont personal..."
    gcloud auth login 2>&1
    ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null)
fi
gcloud config set project "$PROJECT" 2>/dev/null
echo "  ✓ Cont: $ACCOUNT"
echo ""

# ─── STEP 2: Generate YAML from .env ───
echo "[2/5] Generez YAML din .env (metoda sigura)..."
rm -f "$YAMLFILE"

# Use Python for safe YAML generation (handles all special chars)
python3 - "$ENVFILE" "$YAMLFILE" << 'PYEOF'
import sys, re

envfile = sys.argv[1]
yamlfile = sys.argv[2]
skip_keys = {'PORT'}  # Reserved by Cloud Run

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
        # Remove surrounding quotes
        if (value.startswith('"') and value.endswith('"')) or \
           (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        # YAML: use double quotes, escape internal double quotes and backslashes
        value_escaped = value.replace('\\', '\\\\').replace('"', '\\"')
        lines.append(f'{key}: "{value_escaped}"')

with open(yamlfile, 'w') as f:
    f.write('\n'.join(lines) + '\n')

print(f"  {len(lines)} variabile generate")
for l in lines[:3]:
    k = l.split(':')[0]
    v = l.split(': ', 1)[1]
    print(f"  {k}: {v[:20]}...")
print(f"  ... si inca {len(lines)-3}")
PYEOF

if [ $? -ne 0 ]; then
    echo "  EROARE: Python3 nu a putut genera YAML"
    read -p "Enter to close..."
    exit 1
fi
echo ""

# ─── STEP 3: Apply env vars to Cloud Run ───
echo "[3/5] Aplic env vars pe Cloud Run (--env-vars-file)..."
gcloud run services update "$SERVICE" \
    --region="$REGION" \
    --project="$PROJECT" \
    --env-vars-file="$YAMLFILE" \
    --quiet 2>&1

RC=$?
rm -f "$YAMLFILE"

if [ $RC -ne 0 ]; then
    echo ""
    echo "  ✗ EROARE la update Cloud Run!"
    echo "  Incearca: gcloud auth login"
    read -p "Enter to close..."
    exit 1
fi
echo "  ✓ Env vars aplicate cu succes!"
echo ""

# ─── STEP 4: Wait for warm-up ───
echo "[4/5] Astept 30s pentru warm-up si new revision..."
for i in $(seq 30 -1 1); do
    printf "\r  %2d secunde ramase..." $i
    sleep 1
done
echo ""
echo ""

# ─── STEP 5: Full health check ───
echo "[5/5] Health check complet..."
echo ""

# Master diagnostics
echo "=== MASTER DIAGNOSTICS ==="
curl -s --max-time 20 "$BASE/api/diagnostics/master" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)['data']
    print(f'  Status:     {d[\"status\"]}')
    print(f'  Health:     {d[\"overallHealth\"]}')
    print(f'  MEXC:       {d[\"mexc\"][\"status\"]} — {d[\"mexc\"].get(\"error\", \"OK\")}')
    sb = d['supabase']
    print(f'  Supabase:   {sb[\"status\"]} (write:{sb[\"writeLatencyMs\"]}ms read:{sb[\"readLatencyMs\"]}ms)')
    if sb.get('writeError'):
        print(f'              Write Error: {sb[\"writeError\"]}')
    if sb.get('readError'):
        print(f'              Read Error: {sb[\"readError\"]}')
    eq = d['equity']
    print(f'  Mode:       {eq[\"mode\"]}')
    print(f'  Balance:    \${eq[\"currentBalance\"]}')
    print(f'  Trades:     {eq[\"totalTrades\"]} (W:{eq[\"wins\"]} L:{eq[\"losses\"]})')
    print(f'  Sentinel:   Halted={d[\"sentinel\"][\"isHalted\"]}')
    print(f'  Memory:     {d[\"system\"][\"memoryUsageMB\"][\"rss\"]}MB')
except Exception as e:
    print(f'  Parse error: {e}')
" 2>/dev/null
echo ""

# V2 Health
echo "=== V2 HEALTH ==="
curl -s --max-time 10 "$BASE/api/v2/health" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)['data']
    for name, sys_data in d.get('systems', {}).items():
        print(f'  {name}: {sys_data[\"status\"]} ({sys_data[\"latency_ms\"]}ms)')
    print(f'  Trading: {d[\"trading_mode\"][\"mode\"]}')
except Exception as e:
    print(f'  Parse error: {e}')
" 2>/dev/null
echo ""

# Arena
echo "=== ARENA ==="
curl -s --max-time 10 "$BASE/api/v2/arena" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)['data']
    print(f'  Gladiators: {d[\"activeFighters\"]} (Live:{d[\"liveFighters\"]} Shadow:{d[\"shadowFighters\"]})')
    for g in d.get('leaderboard', [])[:3]:
        print(f'    #{g[\"rank\"]} {g[\"name\"]} [{g[\"status\"]}] WR:{g[\"winRate\"]}% Trades:{g[\"totalTrades\"]}')
except Exception as e:
    print(f'  Parse error: {e}')
" 2>/dev/null
echo ""

# Cron
echo "=== CRON ==="
curl -s --max-time 15 "$BASE/api/cron?secret=tradeai_cron_secret_2026" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(f'  Status: {d.get(\"status\", \"?\")}')
    print(f'  ScanCount: {d.get(\"scanCount\", \"?\")}')
    print(f'  Duration: {d.get(\"durationMs\", \"?\")}ms')
except Exception as e:
    print(f'  Parse error: {e}')
" 2>/dev/null
echo ""

# DeepSeek credits
echo "=== AI CREDITS ==="
curl -s --max-time 10 "$BASE/api/diagnostics/credits" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(f'  DeepSeek: {d[\"deepseek\"][\"balance\"]} ({d[\"deepseek\"][\"status\"]})')
    print(f'  OpenAI:   {d[\"openai\"][\"status\"]}')
except Exception as e:
    print(f'  Parse error: {e}')
" 2>/dev/null
echo ""

# Intelligence
echo "=== INTELLIGENCE ==="
curl -s --max-time 10 "$BASE/api/v2/intelligence/feed-health" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)['data']
    for category, adapters in d.get('adapters', {}).items():
        for a in adapters:
            print(f'  {a[\"adapter\"]}: ok={a[\"lastFetchOk\"]} items={a[\"totalItems\"]}')
except Exception as e:
    print(f'  Parse error: {e}')
" 2>/dev/null
echo ""

echo "╔══════════════════════════════════════════╗"
echo "║   VERIFICARE COMPLETA                     ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Final verdict
curl -s --max-time 20 "$BASE/api/diagnostics/master" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)['data']
    h = d['overallHealth']
    mexc = d['mexc']['status']
    supa = d['supabase']['status']

    if h == 'CRITICAL':
        print('  ✗ SYSTEM CRITICAL — env vars still broken')
        if mexc == 'ERROR':
            print(f'    MEXC: {d[\"mexc\"].get(\"error\", \"unknown\")}')
        if supa == 'DEGRADED':
            print(f'    Supabase: {d[\"supabase\"].get(\"writeError\", \"unknown\")}')
    elif h == 'DEGRADED':
        print('  ⚠ SYSTEM DEGRADED — partial fix, check above')
    else:
        print('  ✓ SYSTEM HEALTHY — ALL SYSTEMS GO!')
        print(f'    Mode: {d[\"equity\"][\"mode\"]}')
        print(f'    Ready for paper trading!')
except Exception as e:
    print(f'  Cannot determine status: {e}')
" 2>/dev/null
echo ""
echo ""
read -p "Enter to close..."
