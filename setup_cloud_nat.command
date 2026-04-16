#!/bin/bash
# ============================================================
# TRADE AI — Cloud NAT + Static IP Setup
# Ruteaza Cloud Run prin IP-ul dedicat 149.174.89.163
# pentru MEXC API whitelist
#
# ATENTIE: Acest script configureaza networking GCP.
# Necesita billing activ si permisiuni de admin.
# Dublu-click sau: ./setup_cloud_nat.command
# ============================================================

set -e

PROJECT="evident-trees-453923-f9"
REGION="europe-west1"
SERVICE="antigravity-trade"

# Dedicated IP from provider (already purchased, whitelisted on MEXC)
DEDICATED_IP="149.174.89.163"

echo ""
echo "=========================================="
echo "  TRADE AI — Cloud NAT Setup"
echo "=========================================="
echo ""
echo "NOTA: Cloud Run nu suporta direct Cloud NAT."
echo "Optiuni disponibile:"
echo ""
echo "  OPTIUNEA A: VPC + Serverless Connector + Cloud NAT"
echo "    - Cea mai corecta, dar complexa"
echo "    - Cloud Run -> VPC Connector -> Cloud NAT -> Static IP"
echo ""
echo "  OPTIUNEA B: Adauga IP-ul Cloud Run in MEXC whitelist"
echo "    - Mai simplu dar IP-ul Cloud Run se poate schimba"
echo "    - IP curent: 34.96.41.222"
echo ""
echo "  OPTIUNEA C: Proxy prin VM cu IP static"
echo "    - VM f1-micro (free tier) cu IP-ul dedicat"
echo "    - Cloud Run -> Proxy VM -> MEXC"
echo ""

read -p "Alege optiunea (A/B/C): " OPTION

case "$OPTION" in
    A|a)
        echo ""
        echo "[1/5] Activez API-urile necesare..."
        gcloud services enable vpcaccess.googleapis.com compute.googleapis.com --quiet

        echo "[2/5] Creez VPC Connector..."
        gcloud compute networks vpc-access connectors create trade-ai-connector \
            --region="$REGION" \
            --network=default \
            --range="10.8.0.0/28" \
            --min-instances=2 \
            --max-instances=3 \
            --quiet 2>/dev/null || echo "  (connector deja exista)"

        echo "[3/5] Rezerv IP static..."
        gcloud compute addresses create trade-ai-nat-ip \
            --region="$REGION" \
            --quiet 2>/dev/null || echo "  (IP deja rezervat)"

        STATIC_IP=$(gcloud compute addresses describe trade-ai-nat-ip --region="$REGION" --format="value(address)")
        echo "  IP static GCP: $STATIC_IP"
        echo ""
        echo "  IMPORTANT: Acest IP ($STATIC_IP) trebuie adaugat in MEXC whitelist!"
        echo "  IP-ul dedicat ($DEDICATED_IP) e de la alt provider si nu poate fi"
        echo "  folosit direct cu Cloud NAT. Trebuie whitelistat IP-ul GCP."
        echo ""

        echo "[4/5] Creez Cloud Router + NAT..."
        gcloud compute routers create trade-ai-router \
            --region="$REGION" \
            --network=default \
            --quiet 2>/dev/null || echo "  (router deja exista)"

        gcloud compute routers nats create trade-ai-nat \
            --router=trade-ai-router \
            --region="$REGION" \
            --nat-all-subnet-ip-ranges \
            --nat-external-ip-pool=trade-ai-nat-ip \
            --quiet 2>/dev/null || echo "  (NAT deja exista)"

        echo "[5/5] Conectez Cloud Run la VPC..."
        gcloud run services update "$SERVICE" \
            --region="$REGION" \
            --vpc-connector=trade-ai-connector \
            --vpc-egress=all-traffic \
            --quiet

        echo ""
        echo "DONE! Cloud Run ruteaza acum prin IP: $STATIC_IP"
        echo ""
        echo "NEXT: Adauga $STATIC_IP in MEXC API whitelist:"
        echo "  1. Login pe mexc.com"
        echo "  2. API Management -> Edit API key"
        echo "  3. Adauga IP: $STATIC_IP"
        echo ""
        ;;

    B|b)
        echo ""
        echo "Adauga manual IP-ul Cloud Run in MEXC:"
        echo ""
        echo "  IP de adaugat: 34.96.41.222"
        echo ""
        echo "  1. Login pe https://www.mexc.com"
        echo "  2. Profile -> API Management"
        echo "  3. Edit API key mx0vglnLXZTKBL2dUz"
        echo "  4. Adauga IP: 34.96.41.222"
        echo "  5. Confirma cu 2FA"
        echo ""
        echo "  NOTA: Acest IP se poate schimba la redeploy!"
        echo "  Pentru solutie permanenta, foloseste Optiunea A."
        echo ""
        ;;

    C|c)
        echo ""
        echo "Setup proxy VM (cel mai ieftin)..."
        echo ""

        echo "[1/3] Creez VM f1-micro cu IP static..."
        gcloud compute instances create trade-ai-proxy \
            --zone="${REGION}-b" \
            --machine-type=e2-micro \
            --image-family=debian-12 \
            --image-project=debian-cloud \
            --tags=trade-ai-proxy \
            --quiet 2>/dev/null || echo "  (VM deja exista)"

        echo "[2/3] Configurez firewall..."
        gcloud compute firewall-rules create allow-trade-ai-proxy \
            --allow=tcp:3128 \
            --target-tags=trade-ai-proxy \
            --source-ranges="0.0.0.0/0" \
            --quiet 2>/dev/null || echo "  (rule deja exista)"

        PROXY_IP=$(gcloud compute instances describe trade-ai-proxy --zone="${REGION}-b" --format="value(networkInterfaces[0].accessConfigs[0].natIP)")
        echo ""
        echo "  Proxy VM IP: $PROXY_IP"
        echo "  Adauga acest IP in MEXC whitelist."
        echo ""
        echo "[3/3] Trebuie configurat manual squid proxy pe VM."
        echo "  ssh trade-ai-proxy si instaleaza squid."
        echo ""
        ;;

    *)
        echo "Optiune invalida. Ruleaza din nou."
        ;;
esac

read -p "Apasa Enter pentru a inchide..."
