"""
TRADE AI — Premium Performance Dashboard (single dashboard, UID: tradeai-premium).
Hero KPIs + PnL + Activity + Pool + LLM + Cron in one pane. Variables: mode, range.
Idempotent via overwrite=true.
"""
import os, json, urllib.request, urllib.error

GRAFANA_URL = os.environ.get("GRAFANA_STACK_URL", "https://legie123.grafana.net")
TOKEN = os.environ.get("GRAFANA_DASHBOARD_TOKEN")
if not TOKEN:
    raise SystemExit("Set GRAFANA_DASHBOARD_TOKEN env var (see .env)")
DS = {"type": "prometheus", "uid": "grafanacloud-prom"}


def req(method, path, data=None):
    headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(f"{GRAFANA_URL}{path}", method=method, headers=headers, data=body)
    try:
        with urllib.request.urlopen(r) as resp:
            txt = resp.read().decode()
            return json.loads(txt) if txt else {}
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} {path}: {e.read().decode()[:500]}")
        raise


def ts_panel(pid, title, x, y, w, h, targets, unit=None, decimals=None, stack=False,
             fill=10, line_width=2, description=None):
    fc = {"defaults": {"color": {"mode": "palette-classic"},
                        "custom": {"drawStyle": "line", "lineWidth": line_width, "fillOpacity": fill,
                                    "gradientMode": "opacity", "showPoints": "never",
                                    "stacking": {"mode": "normal" if stack else "none", "group": "A"},
                                    "lineInterpolation": "smooth"},
                        "mappings": []},
          "overrides": []}
    if unit:
        fc["defaults"]["unit"] = unit
    if decimals is not None:
        fc["defaults"]["decimals"] = decimals
    p = {
        "id": pid, "type": "timeseries", "title": title, "datasource": DS,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": [{"expr": t, "legendFormat": lf, "refId": chr(65 + i), "datasource": DS}
                    for i, (t, lf) in enumerate(targets)],
        "fieldConfig": fc,
        "options": {"legend": {"displayMode": "table", "placement": "bottom", "showLegend": True,
                                "calcs": ["mean", "last", "max"]},
                    "tooltip": {"mode": "multi", "sort": "desc"}},
    }
    if description:
        p["description"] = description
    return p


def stat(pid, title, x, y, w, h, expr, unit=None, decimals=None, thresholds=None,
         color_mode="value", graph_mode="area", description=None):
    fc = {"defaults": {"mappings": []}, "overrides": []}
    if unit:
        fc["defaults"]["unit"] = unit
    if decimals is not None:
        fc["defaults"]["decimals"] = decimals
    if thresholds:
        fc["defaults"]["thresholds"] = {"mode": "absolute", "steps": thresholds}
        fc["defaults"]["color"] = {"mode": "thresholds"}
    p = {
        "id": pid, "type": "stat", "title": title, "datasource": DS,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": [{"expr": expr, "refId": "A", "datasource": DS, "legendFormat": ""}],
        "fieldConfig": fc,
        "options": {"colorMode": color_mode, "graphMode": graph_mode, "justifyMode": "auto",
                     "textMode": "auto", "orientation": "auto",
                     "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}},
    }
    if description:
        p["description"] = description
    return p


def gauge(pid, title, x, y, w, h, expr, unit=None, min_v=0, max_v=100, thresholds=None,
          description=None):
    fc = {"defaults": {"min": min_v, "max": max_v, "mappings": []}, "overrides": []}
    if unit:
        fc["defaults"]["unit"] = unit
    if thresholds:
        fc["defaults"]["thresholds"] = {"mode": "absolute", "steps": thresholds}
        fc["defaults"]["color"] = {"mode": "thresholds"}
    p = {
        "id": pid, "type": "gauge", "title": title, "datasource": DS,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": [{"expr": expr, "refId": "A", "datasource": DS, "legendFormat": ""}],
        "fieldConfig": fc,
        "options": {"orientation": "auto", "showThresholdLabels": False, "showThresholdMarkers": True,
                     "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}},
    }
    if description:
        p["description"] = description
    return p


def pie(pid, title, x, y, w, h, targets, unit=None):
    fc = {"defaults": {"color": {"mode": "palette-classic"}, "mappings": []}, "overrides": []}
    if unit:
        fc["defaults"]["unit"] = unit
    return {
        "id": pid, "type": "piechart", "title": title, "datasource": DS,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": [{"expr": t, "legendFormat": lf, "refId": chr(65 + i), "datasource": DS}
                    for i, (t, lf) in enumerate(targets)],
        "fieldConfig": fc,
        "options": {"legend": {"displayMode": "table", "placement": "right", "showLegend": True,
                                "values": ["value", "percent"]},
                     "pieType": "donut", "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
                     "tooltip": {"mode": "single"}},
    }


def bar(pid, title, x, y, w, h, targets, unit=None, orientation="horizontal"):
    fc = {"defaults": {"color": {"mode": "palette-classic"}, "mappings": []}, "overrides": []}
    if unit:
        fc["defaults"]["unit"] = unit
    return {
        "id": pid, "type": "bargauge", "title": title, "datasource": DS,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": [{"expr": t, "legendFormat": lf, "refId": chr(65 + i), "datasource": DS}
                    for i, (t, lf) in enumerate(targets)],
        "fieldConfig": fc,
        "options": {"displayMode": "lcd", "orientation": orientation, "showUnfilled": True,
                     "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}},
    }


def heatmap(pid, title, x, y, w, h, expr, unit="s"):
    return {
        "id": pid, "type": "heatmap", "title": title, "datasource": DS,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": [{"expr": expr, "format": "heatmap", "legendFormat": "{{le}}",
                      "refId": "A", "datasource": DS}],
        "fieldConfig": {"defaults": {"unit": unit, "custom": {"hideFrom": {}, "scaleDistribution": {"type": "linear"}}}},
        "options": {"calculate": False, "color": {"mode": "scheme", "scheme": "Turbo", "exponent": 0.5, "steps": 64,
                                                     "reverse": False, "fill": "dark-orange"},
                     "yAxis": {"axisPlacement": "left", "unit": unit},
                     "cellGap": 1, "rowsFrame": {"layout": "auto"}, "tooltip": {"show": True, "yHistogram": False}},
    }


def row(pid, title, y, collapsed=False):
    return {"id": pid, "type": "row", "title": title, "collapsed": collapsed,
             "gridPos": {"x": 0, "y": y, "w": 24, "h": 1}, "panels": []}


# ============================================================
# PANELS — premium layout
# ============================================================
MODE = '$mode'  # template variable; resolved at render

panels = []

# ── ROW 1: Hero KPIs ──────────────────────────────────────────
panels.append(row(100, "Hero KPIs (last 24h)", 0))
panels.append(stat(101, "Net PnL %", 0, 1, 4, 5,
    f'(sum(increase(tradeai_trade_pnl_positive_sum{{service="trade-ai",mode=~"{MODE}"}}[24h])) '
    f'- sum(increase(tradeai_trade_pnl_loss_abs_sum{{service="trade-ai",mode=~"{MODE}"}}[24h])))',
    unit="percent", decimals=2,
    thresholds=[{"color": "red", "value": None}, {"color": "orange", "value": 0},
                 {"color": "green", "value": 2}],
    description="Σpositive − Σ|losses| over 24h window. Monotonic counters diff."))
panels.append(stat(102, "Profit Factor", 4, 1, 4, 5,
    f'sum(increase(tradeai_trade_pnl_positive_sum{{service="trade-ai",mode=~"{MODE}"}}[24h])) '
    f'/ clamp_min(sum(increase(tradeai_trade_pnl_loss_abs_sum{{service="trade-ai",mode=~"{MODE}"}}[24h])), 0.0001)',
    decimals=2,
    thresholds=[{"color": "red", "value": None}, {"color": "orange", "value": 1.0},
                 {"color": "green", "value": 1.3}],
    description="Σpositive / Σ|losses|. ≥1.3 institutional bar."))
panels.append(stat(103, "Win Rate", 8, 1, 4, 5,
    f'sum(increase(tradeai_trade_executions_total{{service="trade-ai",mode=~"{MODE}",result="win"}}[24h])) '
    f'/ clamp_min(sum(increase(tradeai_trade_executions_total{{service="trade-ai",mode=~"{MODE}",result=~"win|loss"}}[24h])), 1)',
    unit="percentunit", decimals=1,
    thresholds=[{"color": "red", "value": None}, {"color": "orange", "value": 0.50},
                 {"color": "green", "value": 0.58}]))
panels.append(stat(104, "Trades closed", 12, 1, 4, 5,
    f'sum(increase(tradeai_trade_executions_total{{service="trade-ai",mode=~"{MODE}",result=~"win|loss"}}[24h]))',
    decimals=0))
panels.append(stat(105, "LLM Burn $", 16, 1, 4, 5,
    'sum(increase(tradeai_llm_cost_dollars_total{service="trade-ai"}[24h]))',
    unit="currencyUSD", decimals=3,
    thresholds=[{"color": "green", "value": None}, {"color": "orange", "value": 5},
                 {"color": "red", "value": 15}]))
panels.append(stat(106, "Selection lift %", 20, 1, 4, 5,
    'tradeai_selection_lift_pct{service="trade-ai"}',
    unit="percent", decimals=1,
    thresholds=[{"color": "red", "value": None}, {"color": "orange", "value": 0},
                 {"color": "green", "value": 5}],
    description="Alive pool WR − random baseline. Negative = pool worse than random."))

# ── ROW 2: PnL Performance ────────────────────────────────────
panels.append(row(200, "PnL performance", 6))
panels.append(ts_panel(201, "Cumulative gains vs losses (Σ %)", 0, 7, 16, 9, [
    (f'tradeai_trade_pnl_positive_sum{{service="trade-ai",mode=~"{MODE}"}}', "pos — {{mode}}"),
    (f'tradeai_trade_pnl_loss_abs_sum{{service="trade-ai",mode=~"{MODE}"}}', "loss_abs — {{mode}}"),
], unit="percent", fill=20,
    description="Σpositive and Σ|loss| as monotonic counters. Gap = net profit."))
panels.append(ts_panel(202, "Net PnL % rolling 1h", 16, 7, 8, 9, [
    (f'sum(increase(tradeai_trade_pnl_positive_sum{{service="trade-ai",mode=~"{MODE}"}}[1h])) '
     f'- sum(increase(tradeai_trade_pnl_loss_abs_sum{{service="trade-ai",mode=~"{MODE}"}}[1h]))',
     "net {{mode}}"),
], unit="percent", fill=30))

panels.append(ts_panel(203, "Profit Factor rolling 24h", 0, 16, 12, 8, [
    (f'sum(increase(tradeai_trade_pnl_positive_sum{{service="trade-ai",mode=~"{MODE}"}}[24h])) '
     f'/ clamp_min(sum(increase(tradeai_trade_pnl_loss_abs_sum{{service="trade-ai",mode=~"{MODE}"}}[24h])), 0.0001)',
     "PF 24h"),
], decimals=2, fill=10))
panels.append(heatmap(204, "Trade hold-time distribution", 12, 16, 12, 8,
    f'sum by (le) (rate(tradeai_trade_duration_seconds_bucket{{service="trade-ai",mode=~"{MODE}"}}[5m]))',
    unit="s"))

# ── ROW 3: Activity flow ──────────────────────────────────────
panels.append(row(300, "Decision → Execution flow", 24))
panels.append(ts_panel(301, "Decisions/min by verdict", 0, 25, 12, 8, [
    ('sum by (verdict) (rate(tradeai_decisions_total{service="trade-ai"}[5m])) * 60',
     "{{verdict}}"),
], stack=True, fill=40))
panels.append(ts_panel(302, "Executions/min by side × result", 12, 25, 12, 8, [
    (f'sum by (side, result) (rate(tradeai_trade_executions_total{{service="trade-ai",mode=~"{MODE}"}}[5m])) * 60',
     "{{side}} / {{result}}"),
], stack=True, fill=40))

panels.append(pie(303, "Executions result split (24h)", 0, 33, 8, 8, [
    (f'sum by (result) (increase(tradeai_trade_executions_total{{service="trade-ai",mode=~"{MODE}"}}[24h]))',
     "{{result}}"),
]))
panels.append(stat(304, "Exec / Decision %", 8, 33, 8, 8,
    'sum(rate(tradeai_trade_executions_total{service="trade-ai"}[15m])) '
    '/ clamp_min(sum(rate(tradeai_decisions_total{service="trade-ai",verdict!="flat"}[15m])), 0.0001)',
    unit="percentunit", decimals=1, graph_mode="area",
    description="How many non-flat decisions became executions."))
panels.append(ts_panel(305, "Cumulative executions", 16, 33, 8, 8, [
    (f'sum(tradeai_trade_executions_total{{service="trade-ai",mode=~"{MODE}",result="win"}})', "wins"),
    (f'sum(tradeai_trade_executions_total{{service="trade-ai",mode=~"{MODE}",result="loss"}})', "losses"),
    (f'sum(tradeai_trade_executions_total{{service="trade-ai",mode=~"{MODE}",result="open"}})', "open"),
], fill=10))

# ── ROW 4: Pool / Arena ───────────────────────────────────────
panels.append(row(400, "Gladiator pool health", 41))
panels.append(gauge(401, "Selection lift %", 0, 42, 6, 7,
    'tradeai_selection_lift_pct{service="trade-ai"}', unit="percent",
    min_v=-50, max_v=50,
    thresholds=[{"color": "red", "value": -1000}, {"color": "orange", "value": -5},
                 {"color": "yellow", "value": 0}, {"color": "green", "value": 5}]))
panels.append(gauge(402, "Pop-weighted PF", 6, 42, 6, 7,
    'tradeai_pop_weighted_pf{service="trade-ai"}',
    min_v=0, max_v=3,
    thresholds=[{"color": "red", "value": None}, {"color": "orange", "value": 1.0},
                 {"color": "green", "value": 1.3}]))
panels.append(gauge(403, "Pop-weighted WR", 12, 42, 6, 7,
    'tradeai_pop_weighted_winrate{service="trade-ai"}', unit="percentunit",
    min_v=0, max_v=1,
    thresholds=[{"color": "red", "value": None}, {"color": "orange", "value": 0.50},
                 {"color": "green", "value": 0.58}]))
panels.append(stat(404, "Pool alive / killed", 18, 42, 6, 7,
    'tradeai_arena_alive_total{service="trade-ai"} - tradeai_arena_killed_total{service="trade-ai"}',
    decimals=0, graph_mode="area",
    description="Net alive gladiators."))

panels.append(ts_panel(405, "Pool size + alive + killed", 0, 49, 12, 8, [
    ('tradeai_arena_pool_size{service="trade-ai"}', "pool"),
    ('tradeai_arena_alive_total{service="trade-ai"}', "alive (cum)"),
    ('tradeai_arena_killed_total{service="trade-ai"}', "killed (cum)"),
], fill=5))
panels.append(bar(406, "Kills by reason (24h)", 12, 49, 6, 8, [
    ('sum by (reason) (increase(tradeai_gladiator_kills_total{service="trade-ai"}[24h]))',
     "{{reason}}"),
]))
panels.append(bar(407, "Forge outcomes (24h)", 18, 49, 6, 8, [
    ('sum by (outcome) (increase(tradeai_gladiator_forges_total{service="trade-ai"}[24h]))',
     "{{outcome}}"),
]))

# ── ROW 5: LLM cost & health ──────────────────────────────────
panels.append(row(500, "LLM cost & provider health", 57))
panels.append(ts_panel(501, "LLM $/hr by provider", 0, 58, 12, 8, [
    ('sum by (provider) (rate(tradeai_llm_cost_dollars_total{service="trade-ai"}[1h])) * 3600',
     "{{provider}}"),
], unit="currencyUSD", decimals=4, stack=True, fill=30))
panels.append(ts_panel(502, "LLM calls/min by status", 12, 58, 12, 8, [
    ('sum by (status) (rate(tradeai_llm_calls_total{service="trade-ai"}[5m])) * 60',
     "{{status}}"),
], stack=True, fill=40,
    description="status=ok|error|timeout"))

panels.append(pie(503, "Provider mix (24h)", 0, 66, 8, 7, [
    ('sum by (provider) (increase(tradeai_llm_calls_total{service="trade-ai",status="ok"}[24h]))',
     "{{provider}}"),
]))
panels.append(stat(504, "LLM error rate 5m", 8, 66, 8, 7,
    'sum(rate(tradeai_llm_calls_total{service="trade-ai",status=~"error|timeout"}[5m])) '
    '/ clamp_min(sum(rate(tradeai_llm_calls_total{service="trade-ai"}[5m])), 0.0001)',
    unit="percentunit", decimals=2,
    thresholds=[{"color": "green", "value": None}, {"color": "orange", "value": 0.05},
                 {"color": "red", "value": 0.20}]))
panels.append(stat(505, "$/1k calls (24h)", 16, 66, 8, 7,
    '(sum(increase(tradeai_llm_cost_dollars_total{service="trade-ai"}[24h])) '
    '/ clamp_min(sum(increase(tradeai_llm_calls_total{service="trade-ai",status="ok"}[24h])), 1)) * 1000',
    unit="currencyUSD", decimals=3,
    description="Blended cost per 1000 successful LLM calls."))

# ── ROW 6: Cron reliability ───────────────────────────────────
panels.append(row(600, "Cron reliability", 73))
panels.append(ts_panel(601, "Cron runs/min by job × result", 0, 74, 12, 8, [
    ('sum by (job, result) (rate(tradeai_cron_runs_total{service="trade-ai"}[5m])) * 60',
     "{{job}} / {{result}}"),
], stack=False, fill=10))
panels.append(ts_panel(602, "Cron duration p95 by job", 12, 74, 12, 8, [
    ('histogram_quantile(0.95, sum by (le, job) (rate(tradeai_cron_duration_seconds_bucket{service="trade-ai"}[10m])))',
     "{{job}} p95"),
], unit="s", fill=10))

panels.append(bar(603, "Cron runs by result (24h)", 0, 82, 12, 6, [
    ('sum by (result) (increase(tradeai_cron_runs_total{service="trade-ai"}[24h]))',
     "{{result}}"),
]))
panels.append(stat(604, "Cron error rate 1h", 12, 82, 6, 6,
    'sum(rate(tradeai_cron_runs_total{service="trade-ai",result="error"}[1h])) '
    '/ clamp_min(sum(rate(tradeai_cron_runs_total{service="trade-ai"}[1h])), 0.0001)',
    unit="percentunit", decimals=2,
    thresholds=[{"color": "green", "value": None}, {"color": "orange", "value": 0.05},
                 {"color": "red", "value": 0.20}]))
panels.append(stat(605, "Cron runs total 24h", 18, 82, 6, 6,
    'sum(increase(tradeai_cron_runs_total{service="trade-ai"}[24h]))',
    decimals=0))


# ============================================================
# DASHBOARD OBJECT
# ============================================================
dashboard_obj = {
    "uid": "tradeai-premium",
    "title": "TRADE AI — Premium Performance",
    "tags": ["tradeai", "premium", "performance"],
    "timezone": "browser",
    "schemaVersion": 38,
    "version": 1,
    "refresh": "30s",
    "time": {"from": "now-24h", "to": "now"},
    "timepicker": {
        "refresh_intervals": ["10s", "30s", "1m", "5m", "15m", "30m", "1h", "6h"],
    },
    "templating": {
        "list": [
            {
                "name": "mode",
                "label": "Mode",
                "type": "custom",
                "query": "paper,live,paper|live",
                "current": {"text": "All", "value": "paper|live"},
                "options": [
                    {"text": "paper", "value": "paper", "selected": False},
                    {"text": "live", "value": "live", "selected": False},
                    {"text": "All", "value": "paper|live", "selected": True},
                ],
                "includeAll": False,
                "multi": False,
                "datasource": DS,
            },
        ]
    },
    "annotations": {
        "list": [
            {
                "name": "Kills",
                "datasource": DS,
                "enable": True,
                "hide": False,
                "iconColor": "red",
                "titleFormat": "Gladiator kill: {{reason}}",
                "expr": 'changes(tradeai_gladiator_kills_total{service="trade-ai"}[1m]) > 0',
                "step": "1m",
            },
            {
                "name": "Forges",
                "datasource": DS,
                "enable": True,
                "hide": False,
                "iconColor": "green",
                "titleFormat": "Forge: {{outcome}}",
                "expr": 'changes(tradeai_gladiator_forges_total{service="trade-ai",outcome="accepted"}[1m]) > 0',
                "step": "1m",
            },
        ]
    },
    "panels": panels,
}


# ============================================================
# PROVISION
# ============================================================
# Resolve folder uid
folder_uid = ""
try:
    folders = req("GET", "/api/folders")
    for f in folders:
        if f.get("uid") == "tradeai" or f.get("title") == "TRADE AI":
            folder_uid = f["uid"]
            break
except urllib.error.HTTPError:
    pass
if not folder_uid:
    try:
        created = req("POST", "/api/folders", {"uid": "tradeai", "title": "TRADE AI"})
        folder_uid = created["uid"]
    except urllib.error.HTTPError:
        folder_uid = ""

print(f"folder_uid={folder_uid or '(root)'}")

res = req("POST", "/api/dashboards/db", {
    "dashboard": dashboard_obj,
    "folderUid": folder_uid,
    "overwrite": True,
    "message": "Premium Performance dashboard — initial provision",
})
print(f"OK  {dashboard_obj['uid']:22s} status={res.get('status')} v{res.get('version')} url={GRAFANA_URL}{res.get('url','')}")
