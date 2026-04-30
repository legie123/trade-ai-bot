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
               runbook_url=None, operator="gte"):
    """Standard 3-node rule: A=query, B=reduce(last), C=threshold.

    `operator` selects the threshold evaluator type:
      - "gte" (default) — fires when value >= threshold (classic upper-bound alert)
      - "lt"            — fires when value < threshold (for low-water alerts)
      - "gt"/"lte"      — strict variants, rarely needed

    For composite conditions (e.g. "coverage low AND volume high") prefer
    PromQL `bool` conjunction inside `expr` + default `gte` threshold=1 — keeps
    the DAG single-node and easy to debug in Grafana UI. Use `operator="lt"`
    only when the metric itself is the thing being bound below.
    """
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
                            "evaluator": {"type": operator, "params": [threshold]},
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
    # 2026-04-29 — ops-AMBER persistence alert. Catches the FE-1 env-wipe
    # incident class: when a Cloud Build deploy creates a revision missing
    # critical kill-switch env vars (DIRECTION_LONG_DISABLED, etc.), ops
    # signal sits at AMBER permanently while the COMPOSITE brain stays at
    # AMBER (not RED) — so tradeai-brain-red threshold=3 NEVER fires. This
    # rule explicitly catches a single-signal AMBER+ persistence at 30m,
    # giving ops 30 minutes to detect a silent kill-switch bypass before
    # negative-EV LONG bucket damages capital.
    #
    # Threshold=2 also fires on RED (3) — that's correct, RED ops is at
    # least as bad as AMBER ops. Severity=warning to avoid double-paging
    # alongside tradeai-brain-red when both fire on RED scenarios.
    build_rule(
        uid="tradeai-brain-signal-ops-amber-persist",
        title="TRADE AI — Brain signal OPS AMBER+ (env-wipe watchdog)",
        expr='max(tradeai_polymarket_brain_signal_status{service="trade-ai",source="ops"})',
        threshold=2,
        for_duration="30m",
        severity="warning",
        summary="Polymarket brain ops signal at AMBER+ for 30+ minutes — possible env-wipe regression",
        description=(
            "tradeai_polymarket_brain_signal_status{source=\"ops\"} >= 2 (AMBER or RED) for 30m. "
            "Most common cause: a Cloud Build deploy created a revision MISSING critical kill-switch "
            "env vars (DIRECTION_LONG_DISABLED, KELLY_POP_GATE_ENABLED, etc.) — see project_buttons_audit_env_wipe_2026_04_29 memory. "
            "Drill: probe /api/v2/polymarket/ops-flags; verify rawValue for DIRECTION_LONG_DISABLED is '1'. "
            "If null or undefined, re-apply env: gcloud run services update trade-ai --update-env-vars "
            "\"DIRECTION_LONG_DISABLED=1,...\". Defaults to 'disabled (LONGs allowed)' which silently "
            "re-opens the negative-EV LONG bucket from AUDIT-R2."
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
    # Batch 3.19 2026-04-20 — per-signal attribution. Composite rule above
    # pages first at 5m; these four fire at 10m ONLY if a single source has
    # been stuck RED for that long (composite already fired → this tells
    # ops which signal is holding the brain red). Severity=info to avoid
    # double-paging on the same root cause. Expressions target the
    # tradeai_polymarket_brain_signal_status gauge emitted by
    # src/lib/observability/brainStatusGauges.ts (FAZA 3.15).
    #
    # Encoding reminder: 0=unknown 1=green 2=amber 3=red.
    build_rule(
        uid="tradeai-brain-signal-edge-red",
        title="TRADE AI — Brain signal EDGE RED (polymarket)",
        expr='max(tradeai_polymarket_brain_signal_status{service="trade-ai",source="edge"})',
        threshold=3,
        for_duration="10m",
        severity="info",
        summary="Polymarket brain edge (watchdog) signal stuck RED for 10+ minutes",
        description=(
            "tradeai_polymarket_brain_signal_status{source=\"edge\"} at RED (3) for 10m. "
            "Source: edgeWatchdog realized PF/WR over recent settled trades. "
            "RED means profit factor collapsed OR win rate below floor AND sample ≥ minimum "
            "(see batch 3.13 — EDGE_WATCHDOG_ENABLED). Check /polymarket/audit (scorecard + edge panel). "
            "If UNHEALTHY persists 30m+ consider flipping EDGE_WATCHDOG_ENFORCE=1 (blocks new bets) until recovery."
        ),
        runbook_url=f"{GRAFANA_URL}/d/tradeai-premium",
    ),
    build_rule(
        uid="tradeai-brain-signal-settlement-red",
        title="TRADE AI — Brain signal SETTLEMENT RED (polymarket)",
        expr='max(tradeai_polymarket_brain_signal_status{service="trade-ai",source="settlement"})',
        threshold=3,
        for_duration="10m",
        severity="info",
        summary="Polymarket brain settlement pipeline signal RED for 10+ minutes",
        description=(
            "tradeai_polymarket_brain_signal_status{source=\"settlement\"} at RED (3) for 10m. "
            "Source: probeSettlementHealth — 30d window with acted ≥ 50 but settled = 0 and "
            "oldest pending > 30d. Indicates the settlement cron stopped writing or the CLOB "
            "resolve endpoint is dead. Check /polymarket/audit (settlement stats) and the cron "
            "that calls settlePolymarketPositions. Kill-switch: POLYMARKET_SETTLE_ENABLED."
        ),
        runbook_url=f"{GRAFANA_URL}/d/tradeai-premium",
    ),
    build_rule(
        uid="tradeai-brain-signal-feed-red",
        title="TRADE AI — Brain signal FEED RED (polymarket)",
        expr='max(tradeai_polymarket_brain_signal_status{service="trade-ai",source="feed"})',
        threshold=3,
        for_duration="10m",
        severity="info",
        summary="Polymarket brain feed aggregate signal RED for 10+ minutes",
        description=(
            "tradeai_polymarket_brain_signal_status{source=\"feed\"} at RED (3) for 10m. "
            "Source: getFeedHealth aggregate (goldsky + scanner + polymarket). "
            "After FAZA 3.17 unconfigured feeds map to 'unconfigured' (0, not 3) so any RED "
            "is a real stale/error condition on a CONFIGURED feed. Check /polymarket/audit/feed-health "
            "to isolate which feed is stale. Typical cause: Goldsky pipeline stopped or Polymarket "
            "scanner cron failed."
        ),
        runbook_url=f"{GRAFANA_URL}/d/tradeai-premium",
    ),
    build_rule(
        uid="tradeai-brain-signal-ops-red",
        title="TRADE AI — Brain signal OPS RED (polymarket)",
        expr='max(tradeai_polymarket_brain_signal_status{service="trade-ai",source="ops"})',
        threshold=3,
        for_duration="10m",
        severity="info",
        summary="Polymarket brain ops-flags signal RED for 10+ minutes",
        description=(
            "tradeai_polymarket_brain_signal_status{source=\"ops\"} at RED (3) for 10m. "
            "Source: opsFlags — at least one CRITICAL kill-switch is at state='off'. "
            "This is usually intentional (operator pulled the switch). If unexpected, inspect "
            "/polymarket/audit/flags for the off-CRITICAL flag(s). Current steady-state is AMBER "
            "because DIRECTION_LONG_DISABLED is active (HIGH risk); RED means someone flipped a "
            "CRITICAL protection off."
        ),
        runbook_url=f"{GRAFANA_URL}/d/tradeai-premium",
    ),
    # Probe watchdog — detects when the brain-status gauge stops emitting at all.
    # Uses absent() so it only fires when the series is truly missing (scrape
    # failure, BRAIN_STATUS_METRICS_ENABLED=0, app crash loop, Grafana Agent
    # misconfigured). for=15m absorbs transient scrape gaps. Severity=warning:
    # no brain-status readings means we're flying blind, which is as bad as
    # a sustained RED — maybe worse because alerts can't fire.
    build_rule(
        uid="tradeai-brain-probe-absent",
        title="TRADE AI — Brain Status probe ABSENT (polymarket)",
        expr='absent(tradeai_polymarket_brain_status{service="trade-ai"})',
        threshold=1,
        for_duration="15m",
        severity="warning",
        summary="Polymarket brain status gauge absent for 15+ minutes — probe dead",
        description=(
            "tradeai_polymarket_brain_status series missing from Prometheus for 15m. "
            "Root causes (in order of likelihood): (1) Cloud Run revision crash-looping; "
            "(2) BRAIN_STATUS_METRICS_ENABLED env flipped to 0; "
            "(3) Grafana Agent scrape misconfigured; "
            "(4) /api/metrics returning non-200 (check METRICS_TOKEN auth). "
            "With the probe dead all other brain-* rules stop firing — this IS the top-level "
            "dead-man-switch. Immediate action: `gcloud run services describe trade-ai --region=europe-west1` "
            "to check revision health, then `curl -H \"Authorization: Bearer $METRICS_TOKEN\" "
            "https://trade-ai-3rzn6ry36q-ew.a.run.app/api/metrics | grep polymarket_brain`."
        ),
        runbook_url=f"{GRAFANA_URL}/d/tradeai-premium",
    ),
    # Batch 3.20 2026-04-20 — data-quality sentinel. Fires when settlement
    # coverage drops below 50% BUT we also have material acted volume (>50
    # trades in window). The bool conjunction ensures we don't page during
    # cold-start / low-volume windows where coverage is arithmetically 0
    # because denominator is tiny. This catches the silent-writeback-regression
    # failure mode: positions being acted on but settled_* writeback stops
    # (supabase drop / CLOB resolve dead / FAZA 3.7 hook fails) — brain-status
    # settlement signal won't turn RED until acted >=50 AND oldest >30d, so
    # this alert fills the earlier-warning gap.
    #
    # `for=6h` tolerates slow eventual-consistency: settled writes lag acted
    # writes by design (CLOB resolution window = hours), so short dips below
    # 0.5 are expected during active trading bursts. A sustained 6h deficit
    # means the settlement pipeline is genuinely broken.
    build_rule(
        uid="tradeai-poly-settlement-coverage-low",
        title="TRADE AI — Polymarket settlement coverage LOW (data-quality)",
        expr=(
            'max((tradeai_polymarket_settlement_coverage{service="trade-ai"} < bool 0.5)'
            ' * (tradeai_polymarket_settlement_acted{service="trade-ai"} > bool 50))'
        ),
        threshold=1,
        for_duration="6h",
        severity="warning",
        summary="Polymarket settlement coverage <50% with acted>50 for 6+ hours",
        description=(
            "tradeai_polymarket_settlement_coverage has been < 0.5 while "
            "tradeai_polymarket_settlement_acted > 50 for 6h. This means bets are "
            "being placed but settled_* writeback is stalled — the learning loop "
            "(FAZA 3.7) is starved of real outcomes and will regress to seed stats. "
            "Likely causes: (1) probeSettlementHealth cron stopped; (2) CLOB resolve "
            "endpoint dead; (3) Supabase write error on settled_* columns; (4) the "
            "FAZA 3.7 hook (src/lib/polymarket/settlement/writeback.ts) silently "
            "throwing. Inspect /api/v2/polymarket/settlement-health (7d+30d windows) "
            "and grep Cloud Run logs for `[settlement-writeback]` + `[probeSettle]`. "
            "Kill-switches: POLYMARKET_SETTLE_ENABLED, SETTLEMENT_WRITEBACK_ENABLED."
        ),
        runbook_url=f"{GRAFANA_URL}/d/tradeai-premium",
    ),
    # Batch 3.20 2026-04-20 — pool-state sentinel. Fires when arena_pool_size
    # > 50 for 30m. Current steady-state is 14-37 gladiators (validated
    # post-zombie-purge commit da57168). A jump to 50+ means either:
    #   (a) Forge is running without Butcher (asymmetric rotation);
    #   (b) Butcher's saveGladiatorsToDb writes are being dropped (covered
    #       partially by arena-zombie rule, but that measures killed-but-alive
    #       mismatch, not total cardinality);
    #   (c) Someone raised MAX_GLADIATORS env without tuning Butcher.
    # Pool size > 50 blows up phantomEval cost (O(N^2) DNA similarity in
    # Forge dedup) and degrades scan latency; catching early prevents a
    # cost/perf incident. `for=30m` absorbs the 60s refresh TTL plus forge
    # burst windows.
    # Batch 3.21 2026-04-20 — LIVE position stuck sentinel. Uses the FAZA 3.12
    # shadow gauge tradeai_live_position_over_max_hold. Gauge increments when
    # a LIVE position ages past LIVE_MAX_HOLD_SEC (env-controlled). Currently
    # shadow-only (doesn't force-close); gauge = count of positions over
    # threshold. Sustained >= 1 for 30m means either (1) LIVE_MAX_HOLD_SEC was
    # set aggressively and a real position is aging past it without ops
    # knowing, or (2) the positions cron that would normally rotate/close is
    # stuck, or (3) enforcement was never turned on and we're piling up
    # stale LIVE positions.
    #
    # Dormancy: with the current DIRECTION_LONG_DISABLED=1 + no LIVE trading
    # the gauge is flat at 0 — rule stays inactive until operator re-enables
    # LIVE + sets LIVE_MAX_HOLD_SEC, at which point it becomes a real signal.
    # severity=warning because a stuck LIVE position bleeds real capital;
    # info feels too weak for a money-at-risk condition.
    build_rule(
        uid="tradeai-live-position-stuck",
        title="TRADE AI — LIVE position stuck past max hold",
        expr='max(tradeai_live_position_over_max_hold{service="trade-ai"})',
        threshold=1,
        for_duration="30m",
        severity="warning",
        summary="At least one LIVE position has been over max hold for 30+ minutes",
        description=(
            "tradeai_live_position_over_max_hold counts LIVE positions aged past "
            "LIVE_MAX_HOLD_SEC. Sustained >=1 for 30m means a position is stuck and "
            "shadow enforcement (FAZA 3.12) isn't closing it. Likely causes: "
            "(1) LIVE_MAX_HOLD_SEC set but enforcement shadow-only (intended); "
            "(2) positions cron failed or instance crashed before close-side ran; "
            "(3) exchange order rejected and fallback close logic missing. "
            "Immediate action: inspect /api/v2/trades (filter status=open) and "
            "tradeai_live_position_oldest_age_sec gauge to get the aged position's "
            "symbol, then decide: manual close via exchange UI OR flip "
            "LIVE_MAX_HOLD_ENFORCE=1 (if implemented). Cross-check with "
            "tradeai_live_position_oldest_age_sec for exact stall duration."
        ),
        runbook_url=f"{GRAFANA_URL}/d/tradeai-premium",
    ),
    # 2026-04-29 — WS reconnect churn watchdog (P1-2 follow-up).
    # Counter wired in commit aad80f9 (mexc-ws + polymarket-ws onClose handlers).
    # Memory `project_ws_reconnect_counter_2026_04_25` confirmed baseline ~1.5/min
    # over 5d uptime (mexc=9906, polymarket=12792 reconnects). Threshold of 5/min
    # gives ~3x headroom: catches IP-throttle / rate-limit / network outage spikes
    # while staying quiet at steady-state. Per-provider grouping via `max by`
    # surfaces which feed is misbehaving.
    #
    # Why 15m for: short bursts during exchange maintenance windows are normal
    # (sub-15min). A 15min sustained burst = real persistent churn worth paging.
    # Severity=warning because reconnect churn does NOT halt trading (feeds reconnect
    # automatically); it just degrades tick freshness.
    build_rule(
        uid="tradeai-ws-churn-high",
        title="TRADE AI — WebSocket reconnect churn HIGH",
        expr='max by (provider) (rate(tradeai_ws_reconnects_total{service="trade-ai"}[5m])) * 60',
        threshold=5,
        for_duration="15m",
        severity="warning",
        summary="WebSocket reconnect rate >5/min for 15+ minutes — feed instability",
        description=(
            "tradeai_ws_reconnects_total rate (per provider) > 5/min for 15m. "
            "Baseline is ~1.5/min steady-state (per memory `project_ws_reconnect_counter_2026_04_25`); "
            "5/min indicates persistent feed churn — likely cause: (1) IP rate-limit "
            "(memory `project_dedicated_ip` — 149.174.89.163 monthly renewal); "
            "(2) exchange-side throttle / maintenance; (3) network egress flap; "
            "(4) ping/pong timeout misconfigured. "
            "Drill: GET /api/v2/health → inspect feeds.{mexcWs,polymarketWs}.totalReconnects "
            "and compare reasons via PromQL: sum by (provider, reason) "
            "(rate(tradeai_ws_reconnects_total[1h])). If reason=stale_watchdog dominates, "
            "server pong intervals likely changed; if reason=close dominates, upstream is "
            "force-closing connections (rate-limit or IP block)."
        ),
        runbook_url=f"{GRAFANA_URL}/d/tradeai-premium",
    ),
    build_rule(
        uid="tradeai-arena-pool-oversized",
        title="TRADE AI — Arena pool size OVERSIZED (rotation imbalance)",
        expr='max(tradeai_arena_pool_size{service="trade-ai"} > bool 50)',
        threshold=1,
        for_duration="30m",
        severity="warning",
        summary="Arena gladiator pool > 50 for 30+ minutes — rotation imbalance",
        description=(
            "tradeai_arena_pool_size has been > 50 for 30m. Steady-state is "
            "14-37 gladiators. A sustained excess indicates Forge is minting without "
            "Butcher reaping (arena:rotation manual cadence broken) OR MAX_GLADIATORS "
            "env was raised without retuning Butcher's killWeak threshold. Impact: "
            "phantomEval cost grows O(N^2) via Forge dedup DNA similarity (70/30 "
            "num/cat) — scan latency can double at 60+ gladiators. "
            "Immediate action: POST /api/v2/admin with {\"command\":\"arena:rotation\"} "
            "to force a Butcher pass (see memory `Zombie Purge fix 2026-04-20`). "
            "If pool stays high, check ARENA_ROTATION_FLUSH_MS and FORGE_DEDUP_ENABLED."
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
