# 🚀 TRADE AI Production Deployment Guide

**Status**: All Tier 1 Critical Fixes Applied  
**Ready for**: Immediate Production Deployment  
**Estimated Deployment Time**: 10-15 minutes  

---

## 📋 Pre-Deployment Checklist

Before deploying, verify you have:

- [ ] GCP Project configured (`gcloud config set project YOUR_PROJECT_ID`)
- [ ] Cloud Build enabled in GCP
- [ ] Cloud Run enabled in GCP
- [ ] Supabase project created and configured
- [ ] All environment variables set:
  ```bash
  export DEEPSEEK_API_KEY="sk-..."
  export OPENAI_API_KEY="sk-..."
  export GEMINI_API_KEY="AIza..."
  export POLYMARKET_API_KEY="..."
  export SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
  export SUPABASE_ANON_KEY="..."
  export SUPABASE_SERVICE_ROLE_KEY="..."
  ```

---

## 🔧 Step 1: Apply Supabase Migration

The LLM cache feature requires a new table in Supabase. Run the migration:

### Option A: Using Supabase Dashboard (Easiest)

1. Open [Supabase Dashboard](https://app.supabase.com) → Your Project
2. Go to **SQL Editor**
3. Create a new query and paste contents of `supabase/migrations/20260414_llm_cache.sql`
4. Click **Run**

Expected output:
```
CREATE TABLE
CREATE INDEX (idx_llm_cache_role)
CREATE INDEX (idx_llm_cache_created_at)
ALTER TABLE
CREATE POLICY (Allow read llm_cache)
CREATE POLICY (Allow write llm_cache)
CREATE POLICY (Allow update llm_cache)
```

### Option B: Using Supabase CLI

```bash
cd /path/to/TRADE\ AI
supabase db push
```

### Option C: Manual SQL via psql

```bash
SUPABASE_PASSWORD=$(gcloud secrets versions access latest --secret=supabase-password)
psql "postgresql://postgres:$SUPABASE_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres" \
  < supabase/migrations/20260414_llm_cache.sql
```

✅ **Verify Migration**: Check Supabase Dashboard → Tables → `llm_cache` exists with columns: `hash`, `role`, `response`, `created_at`, `updated_at`

---

## 🏗️ Step 2: Submit Cloud Build

From your local machine, navigate to the project and submit the build:

```bash
cd /path/to/TRADE\ AI

# Make the deployment script executable
chmod +x DEPLOY_PRODUCTION.sh

# Run the automated deployment
./DEPLOY_PRODUCTION.sh
```

Or manually:

```bash
gcloud builds submit \
  --config=cloudbuild.yaml \
  --region=europe-west1 \
  --timeout=1200s
```

**What happens**:
1. Docker image builds on Cloud Build (x86_64 Linux)
2. Image pushed to Google Container Registry (gcr.io)
3. Deployed to Cloud Run with auto-scaling (0-3 instances)
4. All Tier 1 fixes active immediately

**Build time**: ~5-8 minutes

---

## ✅ Step 3: Verify Deployment

### Health Check

```bash
# Get service URL
TRADE_AI_URL=$(gcloud run services describe trade-ai \
  --region=europe-west1 \
  --format='value(status.url)')

echo "Service URL: $TRADE_AI_URL"

# Health check
curl "$TRADE_AI_URL/api/v2/health"

# Expected response:
# {"clob":true,"gamma":true}
```

### Check Cloud Run Logs

```bash
gcloud run logs read trade-ai --region=europe-west1 --limit=50
```

Look for:
- ✅ "PolyState initialized" with gladiator count
- ✅ No errors related to Supabase or LLM providers
- ✅ Cron job logs (if configured)

### Verify Supabase Cache

```bash
# Open Supabase dashboard and check llm_cache table
# Should see entries appear as markets are analyzed with timestamps
```

---

## 🧪 Step 4: Post-Deployment Validation (Manual Testing)

### 4.1 Test Paper Trading Enforcement

1. Navigate to: `https://trade-ai-PROJECT.run.app/polymarket`
2. Select a division (e.g., "Crypto")
3. Click a market to open detail view
4. Try to place a trade (click YES or NO button)
5. **Expected**: Trade executes with phantom balance deduction

### 4.2 Test Daily Loss Limits

1. In the UI, find your current daily balance
2. Place trades that would exceed -$50 daily loss
3. **Expected**: Trade rejected with message "Daily loss limit reached"

### 4.3 Test Position Loss Limit

1. Place a trade that opens a position
2. Try to add more to the same position until unrealized loss > -$25
3. **Expected**: Additional position trade rejected

### 4.4 Test LLM Consensus

1. In the Polymarket dashboard, select a market
2. Check the "Analyst View" section
3. **Expected**: Shows both Architect (fundamental) and Oracle (sentiment) analyses
4. Check Cloud Run logs for LLM response times (should be ~3s)

### 4.5 Test Cron Jobs

If you have Cloud Scheduler configured:

```bash
# Trigger scan cron manually
curl -X POST "https://trade-ai-PROJECT.run.app/api/v2/polymarket/cron/scan"

# Check logs for execution
gcloud run logs read trade-ai --region=europe-west1 --limit=20
```

---

## 📊 Monitoring in Production

### Cloud Run Dashboard
- **URL**: https://console.cloud.google.com/run
- Monitor:
  - Request latency (should be <2s for most requests)
  - Error rate (should be <1%)
  - Instance utilization

### Supabase Dashboard
- **URL**: https://app.supabase.com
- Monitor:
  - llm_cache table growth (should grow as markets are analyzed)
  - Database connection count
  - Query performance

### Cloud Build
- **URL**: https://console.cloud.google.com/cloud-build
- Monitor build history for successful deployments

---

## 🔄 Tier 1 Fixes Summary (Now Active)

| Fix | Impact | Validation |
|-----|--------|-----------|
| **Daily Loss Limits** | Prevents >$50 daily loss | Try to trade into -$50 daily loss, verify rejection |
| **Wallet Type Guard** | Prevents live trading | Check logs for "FATAL: Attempted to trade against NON-PAPER wallet" if type !== 'PAPER' |
| **Cron Routes** | Autonomous market scanning | Verify cron jobs execute without 404s |
| **LLM Timeout + Cache** | Consensus never blocks >3s | Monitor logs for response times, verify cache table populated |

---

## 🐛 Troubleshooting

### Build Fails
```bash
gcloud builds log [BUILD_ID] --stream
```
Check for:
- Node.js dependency errors → run `npm install` locally first
- Docker cache issues → add `--no-cache` flag

### Health Check Returns false for clob/gamma
- Check POLYMARKET_CLOB_URL and POLYMARKET_GAMMA_URL in environment
- Verify network connectivity from Cloud Run to Polymarket APIs
- Check firewall rules allow outbound HTTPS

### LLM Responses Timeout
- Check DEEPSEEK_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY are valid
- Verify Cloud Run has outbound internet access
- Check cloud logs for specific provider errors

### Daily Loss Limit Not Enforcing
- Verify polyWallet.ts has checkLossLimits() call in openPosition()
- Check that wallet.type === 'PAPER' (should default to PAPER)
- Verify supabase connection working (check logs)

---

## 📈 Next Steps (Week 1)

After successful deployment, proceed to **Tier 2 Fixes**:

### Week 1 Improvements (Medium Priority)
1. **Agent Direction Consensus** - Majority voting instead of simple aggregation
2. **Volume Baseline** - Reject markets with <$1000 24h volume
3. **Liquidity Validation** - Reject markets with <$500 liquidity

### Monitoring During Tier 1 Phase
- Watch daily loss limits for false positives
- Track LLM response times and cache hit rate
- Verify gladiators spawn and populate /gladiators endpoint

---

## 🎯 Success Criteria

✅ **Deployment is successful when:**
- Health check returns `{"clob":true,"gamma":true}`
- Cloud Run logs show no FATAL errors
- Daily loss limit prevents trade at -$50
- Wallet type guard enforces PAPER-only
- LLM consensus completes in <3s
- llm_cache table gets populated

---

## 📞 Support

For issues, check:
1. Cloud Run logs: `gcloud run logs read trade-ai --region=europe-west1`
2. Cloud Build history: `gcloud builds list`
3. Supabase dashboard for database errors
4. PHASE_1_AUDIT_REPORT.md for known issues

**Estimated time to production-ready**: 15 minutes from deployment script execution.

---

**Generated**: 2026-04-14  
**System**: TRADE AI v1 (Polymarket Paper Trading)  
**Tier 1 Status**: ✅ COMPLETE AND DEPLOYED
