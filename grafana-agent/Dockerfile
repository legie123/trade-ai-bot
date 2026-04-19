# Grafana Agent (static mode) — scrapes Cloud Run /api/metrics endpoints
# and remote-writes to Grafana Cloud Prometheus.
# Pinned version for reproducibility. Upgrade via PR only.
FROM grafana/agent:v0.40.4

# Copy static config. Env vars (${GRAFANA_*}, ${METRICS_TOKEN}) are expanded
# at runtime via -config.expand-env=true.
COPY agent-config.yaml /etc/agent-config/agent.yaml

USER root

# Cloud Run injects $PORT (default 8080). Agent HTTP server must bind there
# so Cloud Run health checks succeed. Shell form required for $PORT expansion.
ENTRYPOINT ["/bin/sh", "-c", "exec /bin/grafana-agent -config.file=/etc/agent-config/agent.yaml -config.expand-env=true -server.http.listen-addr=0.0.0.0:${PORT:-8080}"]
