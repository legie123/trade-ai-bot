# Grafana Agent (TRADE AI observability collector)

Scrapes Cloud Run `/api/metrics` endpoints every 30s and remote-writes to
Grafana Cloud Prometheus. Runs as a dedicated Cloud Run service in the same
region as `trade-ai` (zero egress cost).

## Architecture

```
trade-ai (Cloud Run)             ┐
 ├─ /api/metrics (Bearer)        ├─► grafana-agent (Cloud Run, min=1)
antigravity-trade (Cloud Run)    ┘         │
 └─ /api/metrics (Bearer)                  ▼
                                  Grafana Cloud Prometheus (remote-write)
                                           │
                                           ▼
                                  Grafana Cloud dashboards
```

## Deploy

Manual trigger (no auto-deploy on git push — changes here are infra-level):

```bash
# Via GitHub Actions UI → workflow_dispatch on deploy-agent.yml
# OR via gcloud directly:
gcloud builds submit \
  --config=cloudbuild-agent.yaml \
  --project=evident-trees-453923-f9
```

## Required secrets (GCP Secret Manager)

| Secret | Purpose |
|---|---|
| `METRICS_TOKEN` | Bearer auth when scraping `/api/metrics` (shared with apps) |
| `GRAFANA_REMOTE_WRITE_URL` | e.g. `https://prometheus-prod-XX.grafana.net/api/prom/push` |
| `GRAFANA_PROM_USERNAME` | Numeric Grafana Cloud instance ID |
| `GRAFANA_PROM_API_KEY` | API key with `metrics:write` scope |

Sync from local `.env` via `./push-secrets.sh` (project root).

## Cloud Run shape

- `min-instances=1, max-instances=1` — single scraper, no duplicates
- `cpu=0.5, memory=256Mi`
- `--no-cpu-throttling` — CPU always allocated (required for background scrape loop)
- `--no-allow-unauthenticated` — agent is internal; no public HTTP surface needed

## Kill-switch

If agent misbehaves, scale to zero without deleting config:

```bash
gcloud run services update grafana-agent \
  --region=europe-west1 \
  --min-instances=0 \
  --max-instances=0 \
  --project=evident-trees-453923-f9
```

Metrics stop flowing. App-side `/api/metrics` endpoint is unaffected.

## Validation

After deploy, check Grafana Cloud Explore for series `tradeai_*`:

```promql
{service="trade-ai"}
```

If empty, tail agent logs:

```bash
gcloud run services logs tail grafana-agent \
  --region=europe-west1 \
  --project=evident-trees-453923-f9
```
