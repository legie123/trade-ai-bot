# CLAUDE TECHNICAL HANDOVER — TRADE AI SECRET INFRASTRUCTURE

> **Status**: Hardened & Consolidated
> **Primary Authority**: Antigravity Executor Root

## Environment & Secrets
The project now uses a consolidated secret management system. 

### 1. Local Development (Source of Truth)
- All production-grade keys are located in `/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI/.env`.
- **Action for Claude Desktop**: Always parse this file before running any scripts or providing logic that requires API access. This file is ignored by Git.

### 2. GCP Secret Manager Sync
- We use a dedicated script `./push-secrets.sh` to sync local `.env` values to GCP Secret Manager.
- All 16 critical secrets (MEXC, AI, Supabase, Telegram, etc.) are now live in the `evident-trees-453923-f9` project.

### 3. Production Deployment (run.app)
- **Deployment Script**: `DEPLOY_PRODUCTION.sh` is now updated to source `.env` automatically.
- **Official Pipeline**: `cloudbuild.yaml` has been hardened. It now maps all 16 secrets from Secret Manager into the Cloud Run environment. The `--clear-secrets` flag has been removed to ensure persistent configuration.

## Key Service Details
- **Project ID**: `evident-trees-453923-f9`
- **Region**: `europe-west1`
- **Service Name**: `trade-ai`
- **Live URL**: `https://trade-ai-657910053930.europe-west1.run.app`

## Maintenance Instructions
If you need to rotate a key:
1. Update value in local `.env`.
2. Run `./push-secrets.sh` to update GCP.
3. Run `./DEPLOY_PRODUCTION.sh` (or trigger via Git push) to update the Cloud Run revision.

---
*Signed by Antigravity — Hard Mode Protocol Engaged.*
