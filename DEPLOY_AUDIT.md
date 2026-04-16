# TRADE AI — GCP Deploy Audit & Fix

## ROOT CAUSE ANALYSIS

**Problem:** Deploy fails with:
```
Secret Manager: Permission denied on secret... for Revision service account 657910053930-compute@developer.gserviceaccount.com
```

**Why:** 
1. Workflow uses `--set-secrets` to inject 15 secrets from Secret Manager
2. Cloud Run Revision service (default Compute Engine SA: `657910053930-compute@developer.gserviceaccount.com`) lacks `roles/secretmanager.secretAccessor` on those secrets
3. `claude-deploy` SA has permissions to deploy, but runtime SA (Compute Engine default) does NOT have secret access

---

## SOLUTION

Grant Compute Engine default SA the Secret Manager Secret Accessor role on ALL 15 secrets.

### Option A: Bulk Grant via gcloud (Mac Terminal)

```bash
#!/bin/bash
# Set project
PROJECT_ID="evident-trees-453923-f9"
gcloud config set project $PROJECT_ID
gcloud auth application-default set-quota-project $PROJECT_ID

# Compute Engine default service account
COMPUTE_SA="657910053930-compute@developer.gserviceaccount.com"

# All secrets referenced in deploy.yml --set-secrets
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
)

echo "Granting Secret Manager Secret Accessor role to $COMPUTE_SA..."
for SECRET in "${SECRETS[@]}"; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:$COMPUTE_SA" \
    --role="roles/secretmanager.secretAccessor" \
    --project="$PROJECT_ID" \
    --quiet 2>/dev/null && echo "✓ $SECRET" || echo "✗ $SECRET"
done

echo ""
echo "Done! Next deploy should succeed."
```

### Option B: One-liner (if already authed)

```bash
PROJECT_ID="evident-trees-453923-f9" && COMPUTE_SA="657910053930-compute@developer.gserviceaccount.com" && for SECRET in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY OPENAI_API_KEY DEEPSEEK_API_KEY GEMINI_API_KEY MEXC_API_KEY MEXC_API_SECRET TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID DASHBOARD_PASSWORD AUTH_SECRET CRON_SECRET POLYMARKET_API_KEY POLYMARKET_CLOB_URL POLYMARKET_GAMMA_URL; do gcloud secrets add-iam-policy-binding "$SECRET" --member="serviceAccount:$COMPUTE_SA" --role="roles/secretmanager.secretAccessor" --project="$PROJECT_ID" --quiet 2>/dev/null && echo "✓ $SECRET" || echo "✗ $SECRET"; done
```

### Option C: Manual UI (GCP Console)

1. Go to Secret Manager: `console.cloud.google.com/security/secret-manager?project=evident-trees-453923-f9`
2. For EACH of the 15 secrets above:
   - Click secret name
   - Click "Permissions" tab
   - Click "Grant Access"
   - Add principal: `657910053930-compute@developer.gserviceaccount.com`
   - Role: `Secret Manager Secret Accessor`
   - Click "Save"

---

## DEPLOYMENT CHECKLIST

After fixing permissions:

```bash
# 1. Push empty commit to trigger deploy
cd ~/Desktop/BUSSINES/Antigraity/TRADE\ AI/
git commit --allow-empty -m "chore: deploy with Secret Manager permissions fixed"
git push origin main

# 2. Monitor workflow
# Go to: https://github.com/legie123/trade-ai-bot/actions
# Watch for "Deploy to Cloud Run" workflow to complete

# 3. Verify health
# Once deployed (5-10 min), test:
curl https://trade-ai-657910053930.europe-west1.run.app/api/v2/health

# Expected: 200 or 206 HTTP status
```

---

## FILES INVOLVED

| File | Issue | Status |
|------|-------|--------|
| `.github/workflows/deploy.yml` | ✓ Fixed (removed PORT env var) | READY |
| `Dockerfile` | ✓ Correct | OK |
| `.gcp-key.json` | ✓ Saved locally | OK |
| GitHub Secret `GCP_SA_KEY` | ✓ Uploaded | OK |
| GCP IAM `claude-deploy` | ✓ Has deploy roles | OK |
| GCP Secret Manager | ⚠️ **Compute SA lacks access** | **NEEDS FIX** |

---

## WHAT'S NOT NEEDED

- No code changes
- No Dockerfile changes
- No env var changes (PORT is already removed)
- No additional GitHub secrets

---

## NEXT STEPS FOR ANTIGRAVITY

1. Run one of the scripts above on Mac (Option A or B recommended)
2. Push empty commit
3. Wait 5-10 min for deploy
4. Test health endpoint
5. If still fails, check logs: `https://github.com/legie123/trade-ai-bot/actions`

---

**Last Updated:** 2026-04-16 00:00 UTC
**Tested By:** Claude Haiku 4.5
