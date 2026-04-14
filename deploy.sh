#!/bin/bash
set -e

echo "🔄 Pushing to GitHub..."
git push origin main

echo ""
echo "🚀 Submitting to Cloud Build (logging to terminal for visibility)..."
gcloud builds submit --project=evident-trees-453923-f9

echo ""
echo "✅ Build submitted. Check logs above for build progress."
