#!/bin/bash
# ============================================================
# TRADE AI — Fix Env Vars (individual set, no comma corruption)
# ============================================================

PROJECT="evident-trees-453923-f9"
SERVICE="antigravity-trade"
REGION="europe-west1"

cd "/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"

echo ""
echo "=========================================="
echo "  TRADE AI — Fix Env Vars (v2)"
echo "=========================================="
echo ""

# Parse .env file and set each var individually via gcloud
echo "[1/2] Citesc .env si construiesc comanda..."

# Build env vars string from .env file (skip comments and empty lines)
ENV_VARS=""
while IFS= read -r line; do
    # Skip comments and empty lines
    [[ "$line" =~ ^#.*$ ]] && continue
    [[ -z "$line" ]] && continue

    # Extract KEY=VALUE (strip quotes from value)
    KEY=$(echo "$line" | cut -d'=' -f1)
    VALUE=$(echo "$line" | cut -d'=' -f2- | sed 's/^"//;s/"$//')

    # Skip PORT (reserved by Cloud Run)
    [[ "$KEY" == "PORT" ]] && continue

    # Skip empty keys
    [[ -z "$KEY" ]] && continue

    if [ -z "$ENV_VARS" ]; then
        ENV_VARS="$KEY=$VALUE"
    else
        ENV_VARS="$ENV_VARS,$KEY=$VALUE"
    fi
done < .env

echo "  Gasit $(echo "$ENV_VARS" | tr ',' '\n' | wc -l | tr -d ' ') variabile"
echo ""

echo "[2/2] Setez env vars pe Cloud Run (via --env-vars-file)..."

# Write to a temp YAML file (avoids all parsing issues)
TMPFILE=$(mktemp /tmp/env_vars_XXXXXX.yaml)

while IFS= read -r line; do
    [[ "$line" =~ ^#.*$ ]] && continue
    [[ -z "$line" ]] && continue

    KEY=$(echo "$line" | cut -d'=' -f1)
    VALUE=$(echo "$line" | cut -d'=' -f2- | sed 's/^"//;s/"$//')

    [[ "$KEY" == "PORT" ]] && continue
    [[ -z "$KEY" ]] && continue

    echo "$KEY: \"$VALUE\"" >> "$TMPFILE"
done < .env

echo "  YAML file: $TMPFILE"
echo ""

gcloud run services update "$SERVICE" \
    --region="$REGION" \
    --env-vars-file="$TMPFILE" \
    --quiet 2>&1

if [ $? -eq 0 ]; then
    echo ""
    echo "  ENV VARS SETATE!"
    echo ""
    echo "  Astept 15s pentru warm-up..."
    sleep 15

    echo ""
    echo "Health check:"
    curl -s https://antigravity-trade-3rzn6ry36q-ew.a.run.app/api/diagnostics/master 2>/dev/null | python3 -m json.tool 2>/dev/null | head -40
    echo ""
    echo ""
    echo "=========================================="
    echo "  DONE!"
    echo "=========================================="
else
    echo ""
    echo "  EROARE. Incearca manual:"
    echo "  gcloud run services update $SERVICE --region=$REGION --env-vars-file=$TMPFILE"
fi

rm -f "$TMPFILE"

echo ""
read -p "Enter to close..."
