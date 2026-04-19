"""
TRADE AI — Grafana dashboards provisioner (FAZA B.3).
Creates 6 dashboards in a 'TRADE AI' folder via HTTP API.
Idempotent via overwrite=true + deterministic UIDs.
"""
import os, json, urllib.request, urllib.error

GRAFANA_URL = os.environ.get("GRAFANA_STACK_URL", "https://legie123.grafana.net")
TOKEN = os.environ.get("GRAFANA_DASHBOARD_TOKEN")
if not TOKEN:
    raise SystemExit("Set GRAFANA_DASHBOARD_TOKEN env var (see .env)")
DS_UID = "grafanacloud-prom"


def req(method, path, data=None):
    headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(f"{GRAFANA_URL}{path}", method=method, headers=headers, data=body)
    try:
        with urllib.request.urlopen(r) as resp:
            txt = resp.read().decode()
            return json.loads(txt) if txt else {}
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} {path}: {e.read().decode()[:400]}")
        raise


def panel(pid, title, x, y, w, h, targets, ptype="timeseries", unit=None, decimals=None):
    fc = {"defaults": {}, "overrides": []}
    if unit:
        fc["defaults"]["unit"] = unit
    if decimals is not None:
        fc["defaults"]["decimals"] = decimals
    return {
        "id": pid,
        "type": ptype,
        "title": title,
        "datasource": {"type": "prometheus", "uid": DS_UID},
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": [{"expr": t, "legendFormat": lf, "refId": chr(65 + i), "datasource": {"type": "prometheus", "uid": DS_UID}}
                    for i, (t, lf) in enumerate(targets)],
        "fieldConfig": fc,
        "options": {"legend": {"displayMode": "list", "placement": "bottom", "showLegend": True}, "tooltip": {"mode": "multi"}},
    }


def stat_panel(pid, title, x, y, w, h, expr, unit=None, color_mode="value", thresholds=None):
    p = panel(pid, title, x, y, w, h, [(expr, "{{service}}")], ptype="stat", unit=unit)
    p["options"] = {"colorMode": color_mode, "graphMode": "area", "justifyMode": "auto", "textMode": "auto",
                     "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}}
    if thresholds:
        p["fieldConfig"]["defaults"]["thresholds"] = {"mode": "absolute", "steps": thresholds}
    return p


def dashboard(uid, title, tags, panels):
    return {
        "uid": uid, "title": title, "tags": ["tradeai"] + tags, "timezone": "browser",
        "schemaVersion": 38, "version": 1, "refresh": "30s",
        "time": {"from": "now-1h", "to": "now"},
        "panels": panels,
    }


# --- 1. System Overview ---
dash1 = dashboard("tradeai-system", "TRADE AI — System Overview", ["system"], [
    stat_panel(1, "Primary up", 0, 0, 6, 4, 'up{service="trade-ai"}',
               thresholds=[{"color":"red","value":None},{"color":"green","value":1}]),
    stat_panel(2, "Secondary up", 6, 0, 6, 4, 'up{service="antigravity-trade"}',
               thresholds=[{"color":"red","value":None},{"color":"green","value":1}]),
    stat_panel(3, "Samples/scrape", 12, 0, 6, 4, 'scrape_samples_scraped{service="trade-ai"}'),
    stat_panel(4, "Scrape duration (s)", 18, 0, 6, 4, 'scrape_duration_seconds{service="trade-ai"}', unit="s"),
    panel(5, "up (by service)", 0, 4, 24, 8, [
        ('up{job=~"trade-ai|antigravity-trade"}', "{{service}}")
    ]),
    panel(6, "scrape_samples_scraped", 0, 12, 12, 8, [
        ('scrape_samples_scraped{job=~"trade-ai|antigravity-trade"}', "{{service}}")
    ]),
    panel(7, "scrape_duration_seconds", 12, 12, 12, 8, [
        ('scrape_duration_seconds{job=~"trade-ai|antigravity-trade"}', "{{service}}")
    ], unit="s"),
])

# --- 2. Runtime Health (Node.js) ---
dash2 = dashboard("tradeai-runtime", "TRADE AI — Runtime Health", ["runtime", "nodejs"], [
    panel(1, "Heap used (MB)", 0, 0, 12, 8, [
        ('tradeai_nodejs_heap_size_used_bytes{service="trade-ai"} / 1024 / 1024', "heap used"),
        ('tradeai_nodejs_heap_size_total_bytes{service="trade-ai"} / 1024 / 1024', "heap total"),
    ], unit="decmbytes"),
    panel(2, "RSS / External (MB)", 12, 0, 12, 8, [
        ('tradeai_process_resident_memory_bytes{service="trade-ai"} / 1024 / 1024', "rss"),
        ('tradeai_nodejs_external_memory_bytes{service="trade-ai"} / 1024 / 1024', "external"),
    ], unit="decmbytes"),
    panel(3, "Event-loop lag (p50/p90/p99)", 0, 8, 12, 8, [
        ('tradeai_nodejs_eventloop_lag_p50_seconds{service="trade-ai"}', "p50"),
        ('tradeai_nodejs_eventloop_lag_p90_seconds{service="trade-ai"}', "p90"),
        ('tradeai_nodejs_eventloop_lag_p99_seconds{service="trade-ai"}', "p99"),
    ], unit="s"),
    panel(4, "CPU user/system (rate 5m)", 12, 8, 12, 8, [
        ('rate(tradeai_process_cpu_user_seconds_total{service="trade-ai"}[5m])', "user"),
        ('rate(tradeai_process_cpu_system_seconds_total{service="trade-ai"}[5m])', "system"),
    ], unit="percentunit"),
    panel(5, "GC duration (rate 5m)", 0, 16, 12, 8, [
        ('rate(tradeai_nodejs_gc_duration_seconds_sum{service="trade-ai"}[5m])', "{{kind}}")
    ], unit="s"),
    panel(6, "Open FDs / Active handles", 12, 16, 12, 8, [
        ('tradeai_process_open_fds{service="trade-ai"}', "open fds"),
        ('tradeai_nodejs_active_handles_total{service="trade-ai"}', "active handles"),
        ('tradeai_nodejs_active_requests_total{service="trade-ai"}', "active requests"),
    ]),
])

# --- 3. Trading Engine ---
dash3 = dashboard("tradeai-engine", "TRADE AI — Trading Engine", ["engine", "decisions"], [
    stat_panel(1, "Decisions/min", 0, 0, 8, 4,
               'sum(rate(tradeai_decisions_total{service="trade-ai"}[5m])) * 60'),
    stat_panel(2, "Executions/min", 8, 0, 8, 4,
               'sum(rate(tradeai_trade_executions_total{service="trade-ai"}[5m])) * 60'),
    stat_panel(3, "Exec / Decision ratio", 16, 0, 8, 4,
               '(sum(rate(tradeai_trade_executions_total{service="trade-ai"}[15m])) / clamp_min(sum(rate(tradeai_decisions_total{service="trade-ai"}[15m])), 0.0001))',
               unit="percentunit"),
    panel(4, "Decisions (rate 5m)", 0, 4, 12, 8, [
        ('sum by (decision) (rate(tradeai_decisions_total{service="trade-ai"}[5m]))', "{{decision}}"),
        ('sum(rate(tradeai_decisions_total{service="trade-ai"}[5m]))', "total"),
    ]),
    panel(5, "Executions (rate 5m)", 12, 4, 12, 8, [
        ('sum by (side) (rate(tradeai_trade_executions_total{service="trade-ai"}[5m]))', "{{side}}"),
        ('sum(rate(tradeai_trade_executions_total{service="trade-ai"}[5m]))', "total"),
    ]),
    panel(6, "Cumulative decisions", 0, 12, 12, 8, [
        ('tradeai_decisions_total{service="trade-ai"}', "{{decision}}")
    ]),
    panel(7, "Cumulative executions", 12, 12, 12, 8, [
        ('tradeai_trade_executions_total{service="trade-ai"}', "{{side}}")
    ]),
])

# --- 4. Arena Pool ---
dash4 = dashboard("tradeai-arena", "TRADE AI — Arena / Gladiator Pool", ["arena", "pool"], [
    stat_panel(1, "Pool size", 0, 0, 6, 4, 'tradeai_arena_pool_size{service="trade-ai"}'),
    stat_panel(2, "Alive (cum)", 6, 0, 6, 4, 'tradeai_arena_alive_total{service="trade-ai"}'),
    stat_panel(3, "Killed (cum)", 12, 0, 6, 4, 'tradeai_arena_killed_total{service="trade-ai"}'),
    stat_panel(4, "Selection lift %", 18, 0, 6, 4, 'tradeai_selection_lift_pct{service="trade-ai"}', unit="percent"),
    panel(5, "Pool size over time", 0, 4, 12, 8, [
        ('tradeai_arena_pool_size{service="trade-ai"}', "pool")
    ]),
    panel(6, "Selection lift %", 12, 4, 12, 8, [
        ('tradeai_selection_lift_pct{service="trade-ai"}', "lift %")
    ], unit="percent"),
    panel(7, "Alive vs Killed (rate 1h)", 0, 12, 12, 8, [
        ('increase(tradeai_arena_alive_total{service="trade-ai"}[1h])', "alive +/h"),
        ('increase(tradeai_arena_killed_total{service="trade-ai"}[1h])', "killed +/h"),
    ]),
    panel(8, "Kill ratio", 12, 12, 12, 8, [
        ('increase(tradeai_arena_killed_total{service="trade-ai"}[1h]) / clamp_min(increase(tradeai_arena_alive_total{service="trade-ai"}[1h]), 1)', "kill/alive ratio")
    ]),
])

# --- 5. Population Performance ---
dash5 = dashboard("tradeai-popperf", "TRADE AI — Population Performance", ["population", "pf", "winrate"], [
    stat_panel(1, "Pop-weighted PF", 0, 0, 12, 4, 'tradeai_pop_weighted_pf{service="trade-ai"}',
               thresholds=[{"color":"red","value":None},{"color":"orange","value":1.0},{"color":"green","value":1.3}]),
    stat_panel(2, "Pop-weighted WR", 12, 0, 12, 4, 'tradeai_pop_weighted_winrate{service="trade-ai"}',
               unit="percentunit",
               thresholds=[{"color":"red","value":None},{"color":"orange","value":0.50},{"color":"green","value":0.58}]),
    panel(3, "Population PF", 0, 4, 12, 10, [
        ('tradeai_pop_weighted_pf{service="trade-ai"}', "pop PF")
    ]),
    panel(4, "Population WR", 12, 4, 12, 10, [
        ('tradeai_pop_weighted_winrate{service="trade-ai"}', "pop WR")
    ], unit="percentunit"),
])

# --- 6. Scrape Pipeline ---
dash6 = dashboard("tradeai-scrape", "TRADE AI — Scrape Pipeline", ["scrape", "observability"], [
    stat_panel(1, "up primary", 0, 0, 6, 4, 'up{service="trade-ai"}',
               thresholds=[{"color":"red","value":None},{"color":"green","value":1}]),
    stat_panel(2, "up secondary", 6, 0, 6, 4, 'up{service="antigravity-trade"}',
               thresholds=[{"color":"red","value":None},{"color":"green","value":1}]),
    stat_panel(3, "Samples/min primary", 12, 0, 6, 4,
               'sum(rate(scrape_samples_scraped{service="trade-ai"}[5m])) * 60'),
    stat_panel(4, "Series added/min", 18, 0, 6, 4,
               'sum(rate(scrape_series_added{service="trade-ai"}[5m])) * 60'),
    panel(5, "up by job", 0, 4, 12, 8, [
        ('up{job=~"trade-ai|antigravity-trade"}', "{{service}}")
    ]),
    panel(6, "scrape_duration_seconds", 12, 4, 12, 8, [
        ('scrape_duration_seconds{job=~"trade-ai|antigravity-trade"}', "{{service}}")
    ], unit="s"),
    panel(7, "scrape_samples_scraped", 0, 12, 12, 8, [
        ('scrape_samples_scraped{job=~"trade-ai|antigravity-trade"}', "{{service}}")
    ]),
    panel(8, "scrape_samples_post_metric_relabeling", 12, 12, 12, 8, [
        ('scrape_samples_post_metric_relabeling{job=~"trade-ai|antigravity-trade"}', "{{service}}")
    ]),
])

ALL = [dash1, dash2, dash3, dash4, dash5, dash6]

# Create folder
try:
    folder = req("POST", "/api/folders", {"uid": "tradeai", "title": "TRADE AI"})
    print(f"folder created: uid={folder['uid']} title={folder['title']}")
    folder_uid = folder["uid"]
except urllib.error.HTTPError:
    # Already exists
    folders = req("GET", "/api/folders")
    for f in folders:
        if f.get("uid") == "tradeai" or f.get("title") == "TRADE AI":
            folder_uid = f["uid"]
            print(f"folder exists: uid={folder_uid}")
            break
    else:
        folder_uid = ""

# POST each dashboard
for d in ALL:
    try:
        res = req("POST", "/api/dashboards/db", {
            "dashboard": d,
            "folderUid": folder_uid,
            "overwrite": True,
            "message": "FAZA B.3 provision via API",
        })
        print(f"OK  {d['uid']:22s} {res.get('status')} v{res.get('version')} url={GRAFANA_URL}{res.get('url','')}")
    except urllib.error.HTTPError as e:
        print(f"ERR {d['uid']}: {e}")
