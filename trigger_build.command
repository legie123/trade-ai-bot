#!/bin/bash
# Quick Cloud Build trigger
cd "/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"
echo "Triggering Cloud Build..."
gcloud builds submit --project=evident-trees-453923-f9 --timeout=600s 2>&1
echo ""
echo "Done! Verifica:"
echo "  curl https://antigravity-trade-3rzn6ry36q-ew.a.run.app/api/diagnostics/master | jq ."
read -p "Enter to close..."
