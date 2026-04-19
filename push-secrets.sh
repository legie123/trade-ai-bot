#!/bin/bash

# ==============================================================================
# TRADE AI — GCP Secret Manager Automatic Sync Script
# ==============================================================================

PROJECT_ID="evident-trees-453923-f9"
COMPUTE_SA="657910053930-compute@developer.gserviceaccount.com"

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ Eroare: Fișierul .env nu a fost găsit în $(pwd)"
    echo "Te rog creează fișierul .env (poți folosi ca șablon .env.example) și rulează din nou."
    exit 1
fi

echo "🔐 Se încarcă .env..."
# Load variables from .env if it exists
while IFS='=' read -r key value; do
  # Skip comments and empty lines
  [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
  # Remove possible quotes from value and export
  value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
  export "$key"="$value"
done < .env

SECRETS=(
  "NEXT_PUBLIC_SUPABASE_URL"
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  "SUPABASE_SERVICE_ROLE_KEY"
  "OPENAI_API_KEY"
  "DEEPSEEK_API_KEY"
  "GEMINI_API_KEY"
  "MEXC_API_KEY"
  "MEXC_API_SECRET"
  "TELEGRAM_BOT_TOKEN"
  "TELEGRAM_CHAT_ID"
  "DASHBOARD_PASSWORD"
  "AUTH_SECRET"
  "CRON_SECRET"
  "POLYMARKET_API_KEY"
  "POLYMARKET_CLOB_URL"
  "POLYMARKET_GAMMA_URL"
  "SWARM_TOKEN"
  "METRICS_TOKEN"
  "GRAFANA_REMOTE_WRITE_URL"
  "GRAFANA_PROM_USERNAME"
  "GRAFANA_PROM_API_KEY"
  "GRAFANA_DASHBOARD_TOKEN"
)

echo "☁️ Setare context proiect GCP..."
gcloud config set project $PROJECT_ID
gcloud auth application-default set-quota-project $PROJECT_ID >/dev/null 2>&1

echo "🚀 Inițiere sincronizare secrete către GCP Secret Manager..."

for SECRET in "${SECRETS[@]}"; do
  # Extragere valoare variabilă cu indirect expansion din bash
  VALUE="${!SECRET}"
  
  if [ -z "$VALUE" ]; then
    echo "⚠️ Trecut peste $SECRET: nu există valoare setată în .env"
    continue
  fi

  # Verificăm dacă secretul există deja
  if gcloud secrets describe "$SECRET" --project="$PROJECT_ID" >/dev/null 2>&1; then
      echo "🔄 Secretul $SECRET există deja, se adaugă o versiune nouă..."
      printf "%s" "$VALUE" | gcloud secrets versions add "$SECRET" --data-file=- --project="$PROJECT_ID" --quiet >/dev/null
  else
      echo "✨ Se creează secretul $SECRET..."
      printf "%s" "$VALUE" | gcloud secrets create "$SECRET" --data-file=- --replication-policy="automatic" --project="$PROJECT_ID" --quiet >/dev/null
  fi

  # Acordăm acces la IAM
  echo "🔑 Se acordă acces la $SECRET pentru Compute SA..."
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:$COMPUTE_SA" \
    --role="roles/secretmanager.secretAccessor" \
    --project="$PROJECT_ID" \
    --quiet >/dev/null

  echo "✅ $SECRET sincronizat și criptat!"
done

echo ""
echo "🎉 Toate secretele au fost actualizate și securizate cu succes în GCP!"
echo "Puteți rula acum fără probleme un nou deploy."
