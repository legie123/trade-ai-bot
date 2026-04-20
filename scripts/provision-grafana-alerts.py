"""
TRADE AI — Grafana alert rules provisioner.
Creates unified-alerting rules via /api/v1/provisioning/alert-rules.
Idempotent: uses deterministic UIDs; PUT replaces on rerun.

Current alerts:
- tradeai-brain-red: tradeai_polymarket_brain_status >= 3 for 5m (sev-3 warn)
  Fires when the composite Brain Status gauge stays at RED (3) for 5 minutes.
  Safe after Batch 3.17 eliminated false-RED from unconfigured feeds.
  Rolls through Grafana default notification policy (no PagerDuty wired yet).

Reversibility: DELETE /api/v1/provisioning/alert-rules/<uid>
"""
import os, json, urllib.request, urllib.error

GRAFANA_URL = os.environ.get("GRAFANA_STACK_URL", "https://legie123.grafana.net")
TOKEN = os.environ.get("GRAFANA_DASHBOARD_TOKEN")
if not TOKEN:
    raise SystemExit("Set GRAFANA_DASHBOARD_TOKEN env var (see .env)")
DS_UID = "grafanacloud-prom"
FOLDER_UID = "tradeai"
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID")
CONTACT_POINT_NAME = "TRADE AI Telegram"
CONTACT_POINT_UID = "tradeai-telegram"


def req(method, path, data=None, headers_extra=None):
    headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
    if headers_extra:
        headers.update(headers_extra)
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(f"{GRAFANA_URL}{path}", method=method, headers=headers, data=body)
    try:
        with urllib.request.urlopen(r) as resp:
            txt = resp.read().decode()
            return resp.getcode(), (json.loads(txt) if txt else {})
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:800]


def build_rule(uid, title, expr, threshold, for_duration, severity, summary, description,
               runbook_url=None):
    """Standard 3-node rule: A=query, B=reduce(last), C=threshold."""
    return {
        "uid": uid,
        "title": title,
        "ruleGroup": "tradeai-brain",
        "folderUID": FOLDER_UID,
        "noDataState": "OK",             # no data == not red
        "execErrState": "Error",
        "for": for_duration,
        "orgID": 1,
        "condition": "C",
        "data": [
            {
                "refId": "A",
                "queryType": "",
                "relativeTimeRange": {"from": 600, "to": 0},
                "datasourceUid": DS_UID,
                "model": {
                    "refId": "A",
                    "expr": expr,
                    "intervalMs": 1000,
                    "maxDataPoints": 43200,
                    "instant": True,
                    "range": False,
                    "datasource": {"type": "prometheus", "uid": DS_UID},
                },
            },
            {
                "refId": "B",
                "queryType": "",
                "relativeTimeRange": {"from": 0, "to": 0},
                "datasourceUid": "__expr__",
                "model": {
                    "refId": "B",
                    "type": "reduce",
                    "reducer": "last",
                    "expression": "A",
                    "datasource": {"type": "__expr__", "uid": "__expr__"},
                },
            },
            {
                "refId": "C",
                "queryType": "",
                "relativeTimeRange": {"from": 0, "to": 0},
                "datasourceUid": "__expr__",
                "model": {
                    "refId": "C",
                    "type": "threshold",
                    "expression": "B",
                    "conditions": [
                        {
                            "evaluator": {"type": "gte", "params": [threshold]},
                            "operator": {"type": "and"},
                            "query": {"params": ["B"]},
                            "reducer": {"type": "last", "params": []},
                            "type": "query",
                        }
                    ],
                    "datasource": {"type": "__expr__", "uid": "__expr__"},
                },
            },
        ],
        "labels": {
            "severity": severity,
            "service": "trade-ai",
            "domain": "polymarket",
        },
        "annotations": {
            "summary": summary,
            "description": description,
            **({"runbook_url": runbook_url} if runbook_url else {}),
        },
    }


RULES = [
    build_rule(
        uid="tradeai-brain-red",
        title="TRADE AI — Brain Status RED (polymarket)",
        expr='max(tradeai_polymarket_brain_status{service="trade-ai"})',
        threshold=3,
        for_duration="5m",
        severity="warning",
        summary="Polymarket brain composite status RED for 5+ minutes",
        description=(
            "tradeai_polymarket_brain_status has been at RED (3) continuously for 5m. "
            "Strictest-wins verdict over edge + settlement + feed + ops signals. "
            "Check /polymarket/audit/flags and /polymarket/audit/feed-health to isolate which signal pulled to red. "
            "After Batch 3.17, unconfigured feeds no longer trip this; any RED is a real degradation."
        ),
        runbook_url=f"{GRAFANA_URL}/d/tradeai-premium",
    ),
    # FAZA 3/4 2026-04-20 — zombie survey alert. gauge = |alive ∩ graveyard|.
    # Steady-state 0. Non-zero > 15 for 2h indicates either a persistence race
    # (saveGladiatorsToDb write swallowed post-response) or a false-positive
    # graveyard write (Butcher killed something still alive in pool). 2h gate
    # filters out the ~60s eventual-consistency window where Butcher has just
    # fired but the pool refresh hasn't propagated to all Cloud Run instances.
    build_rule(
        uid="tradeai-arena-zombie",
        title="TRADE AI — Arena zombie gladiators (persistence race)",
        expr='max(tradeai_arena_zombie_count{service="trade-ai"})',
        threshold=15,
        for_duration="2h",
        severity="warning",
        summary="Arena zombie count >15 for 2+ hours — persistence race suspected",
        description=(
            "tradeai_arena_zombie_count measures gladiators present in BOTH the alive pool "
            "and the graveyard (killed_at set). Expected steady-state: 0. "
            "A sustained non-zero > 15 for 2h indicates Butcher's saveGladiatorsToDb write "
            "is being dropped (Cloud Run CPU-throttles post-response) OR a false-positive "
            "graveyard insert. Investigate: check logs for `[Butcher] skipRemoteMerge` vs "
            "`[MERGE-SEED] Blacklist blocked` frequency, then audit executeWeaklings call-sites "
            "for any new fire-and-forget invoker lacking `flushPendingSyncs` at tail."
        ),
        runbook_url=f"{GRAFANA_URL}/d/tradeai-premium",
    ),
]


def upsert(rule):
    uid = rule["uid"]
    # Try PUT first (idempotent update); fall back to POST for creation.
    code, body = req(
        "PUT",
        f"/api/v1/provisioning/alert-rules/{uid}",
        rule,
        headers_extra={"X-Disable-Provenance": "true"},
    )
    if code in (200, 201, 202):
        print(f"[OK] PUT {uid}: {code}")
        return
    if code == 404:
        code2, body2 = req(
            "POST",
            "/api/v1/provisioning/alert-rules",
            rule,
            headers_extra={"X-Disable-Provenance": "true"},
        )
        print(f"[OK] POST {uid}: {code2} {body2 if code2 >= 400 else ''}")
        return
    print(f"[ERR] {uid}: {code} {body}")


def upsert_telegram_contact_point():
    if not (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID):
        print("[SKIP] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set — contact point not provisioned")
        return False
    cp = {
        "uid": CONTACT_POINT_UID,
        "name": CONTACT_POINT_NAME,
        "type": "telegram",
        "settings": {
            "bottoken": TELEGRAM_BOT_TOKEN,
            "chatid": TELEGRAM_CHAT_ID,
            "parse_mode": "HTML",
            "disable_notifications": False,
        },
        "disableResolveMessage": False,
    }
    # PUT is idempotent; provisioning API accepts it for contact points.
    code, body = req(
        "PUT",
        f"/api/v1/provisioning/contact-points/{CONTACT_POINT_UID}",
        cp,
        headers_extra={"X-Disable-Provenance": "true"},
    )
    if code in (200, 201, 202):
        print(f"[OK] PUT contact-point {CONTACT_POINT_UID}: {code}")
        return True
    # Fallback to POST (new-install path).
    code2, body2 = req(
        "POST",
        "/api/v1/provisioning/contact-points",
        cp,
        headers_extra={"X-Disable-Provenance": "true"},
    )
    if code2 in (200, 201, 202):
        print(f"[OK] POST contact-point {CONTACT_POINT_UID}: {code2}")
        return True
    print(f"[ERR] contact-point {CONTACT_POINT_UID}: put={code}/{body} post={code2}/{body2}")
    return False


def set_default_policy(receiver_name):
    """Set root notification policy to route to `receiver_name` by default."""
    policy = {
        "receiver": receiver_name,
        "group_by": ["grafana_folder", "alertname"],
        "group_wait": "30s",
        "group_interval": "5m",
        "repeat_interval": "1h",
    }
    code, body = req(
        "PUT",
        "/api/v1/provisioning/policies",
        policy,
        headers_extra={"X-Disable-Provenance": "true"},
    )
    if code in (200, 201, 202):
        print(f"[OK] policy default receiver -> {receiver_name}: {code}")
    else:
        print(f"[ERR] policy update: {code} {body}")


if __name__ == "__main__":
    tg_ok = upsert_telegram_contact_point()
    if tg_ok:
        set_default_policy(CONTACT_POINT_NAME)
    for r in RULES:
        upsert(r)
    # List to confirm
    code, body = req("GET", "/api/v1/provisioning/alert-rules")
    if code == 200:
        print(f"\nTotal rules after provision: {len(body)}")
        for r in body:
            print(f"  - {r.get('uid')}: {r.get('title')} (for={r.get('for')})")
    code, body = req("GET", "/api/v1/provisioning/contact-points")
    if code == 200 and isinstance(body, list):
        print(f"Contact points: {len(body)}")
        for c in body:
            print(f"  - {c.get('uid')}: {c.get('name')} ({c.get('type')})")
