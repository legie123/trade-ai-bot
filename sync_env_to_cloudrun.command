#!/bin/bash
# ============================================================
# TRADE AI — Sync .env to Cloud Run (YAML method, no corruption)
# Reads current .env, writes YAML, applies to Cloud Run
# ============================================================

SERVICE="antigravity-trade"
REGION="europe-west1"
ENVFILE="/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI/.env"
YAMLFILE="/tmp/trade_ai_env.yaml"

cd "/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"

echo ""
echo "=========================================="
echo "  Sync .env → Cloud Run"
echo "=========================================="
echo ""

# Check account
ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null)
echo "Cont: $ACCOUNT"
if [[ "$ACCOUNT" == *"claude-deploy"* ]]; then
    echo "  SA detectat. Schimb pe cont personal..."
    gcloud auth login --quiet 2>&1
fi
echo ""

# Generate YAML from .env
echo "Generez YAML din .env..."
rm -f "$YAMLFILE"

while IFS= read -r line || [ -n "$line" ]; do
    # Skip comments, empty lines, lines starting with #
    [[ -z "$line" ]] && continue
    [[ "$line" == \#* ]] && continue
    [[ "$line" == *"═"* ]] && continue

    # Split on first = only
    KEY="${line%%=*}"
    VALUE="${line#*=}"

    # Remove surrounding quotes
    VALUE="${VALUE#\"}"
    VALUE="${VALUE%\"}"
    VALUE="${VALUE#\'}"
    VALUE="${VALUE%\'}"

    # Skip reserved/empty
    [[ -z "$KEY" ]] && continue
    [[ "$KEY" == "PORT" ]] && continue

    # Write YAML (value in single quotes to prevent any interpretation)
    echo "${KEY}: '${VALUE}'" >> "$YAMLFILE"
done < "$ENVFILE"

COUNT=$(wc -l < "$YAMLFILE" | tr -d ' ')
echo "  $COUNT variabile in YAML"
echo ""
echo "Preview (primele 5):"
head -5 "$YAMLFILE"
echo "  ..."
echo ""

# Apply to Cloud Run
echo "Aplic pe Cloud Run..."
gcloud run services update "$SERVICE" \
    --region="$REGION" \
    --env-vars-file="$YAMLFILE" \
    --quiet 2>&1

RC=$?
rm -f "$YAMLFILE"

if [ $RC -eq 0 ]; then
    echo ""
    echo "  ENV VARS APLICATE!"
    echo ""
    echo "Astept 20s warm-up..."
    sleep 20
    echo ""
    echo "=== HEALTH CHECK ==="
    curl -s https://antigravity-trade-3rzn6ry36q-ew.a.run.app/api/diagnostics/master | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
print(f\"Status:    {d['status']}\")
print(f\"Health:    {d['overallHealth']}\")
print(f\"MEXC:      {d['mexc']['status']} - {d['mexc'].get('error','OK')}\")
print(f\"Supabase:  {d['supabase']['status']} (write:{d['supabase']['writeLatencyMs']}ms)\")
print(f\"Mode:      {d['equity']['mode']}\")
print(f\"Trades:    {d['equity']['totalTrades']}\")
" 2>/dev/null || echo "(health check failed, asteapta 30s si incearca manual)"
    echo ""
    echo "=========================================="
    echo "  DONE!"
    echo "=========================================="
else
    echo ""
    echo "  EROARE la deploy."
    echo "  Verifica: gcloud auth list"
    echo "  Sau ruleaza: gcloud auth login"
fi

echo ""
read -p "Enter to close..."
