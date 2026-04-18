#!/usr/bin/env bash
# graphify-session-init.sh — printeaza TL;DR-ul graph-ului la start de sesiune
# Cost: 0 tokeni, 0 reteq, citeste doar artefactele locale.
#
# Use:
#   ./scripts/graphify-session-init.sh           # raport scurt
#   ./scripts/graphify-session-init.sh --quiet   # numai semafor + freshness
#   ./scripts/graphify-session-init.sh --json    # date masina-readable
#
# Exit codes:
#   0 ok (raport printat)
#   1 missing graph (sugereaza rebuild)
#   2 stale graph (>7 zile, dar afiseaza ce avem)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$REPO_ROOT" ]] || { echo "[graphify-init] not in a git repo" >&2; exit 1; }
cd "$REPO_ROOT"

REPORT="src/graphify-out/GRAPH_REPORT.md"
QUIET=0
JSON=0
for a in "$@"; do
  case "$a" in
    --quiet) QUIET=1 ;;
    --json)  JSON=1 ;;
  esac
done

# ── 1. Existence ─────────────────────────────────────────────────
if [[ ! -f "$REPORT" ]]; then
  if [[ $JSON -eq 1 ]]; then
    printf '{"status":"missing","report":"%s","action":"./scripts/graphify-rebuild.sh"}\n' "$REPORT"
  else
    echo "[graphify-init] STATUS: NO GRAPH"
    echo "  Missing: $REPORT"
    echo "  Run:     ./scripts/graphify-rebuild.sh"
  fi
  exit 1
fi

# ── 2. Freshness (zile de la ultima generare) ────────────────────
# stat e diferit pe Mac/Linux → bash arithmetic pe seconds since epoch
if stat -f %m "$REPORT" >/dev/null 2>&1; then
  MTIME=$(stat -f %m "$REPORT")           # macOS
else
  MTIME=$(stat -c %Y "$REPORT")            # Linux
fi
NOW=$(date +%s)
AGE_DAYS=$(( (NOW - MTIME) / 86400 ))

STATUS="fresh"
[[ $AGE_DAYS -ge 7 ]]  && STATUS="stale"
[[ $AGE_DAYS -ge 30 ]] && STATUS="ancient"

# ── 3. Extract metrics (line 8: "1272 nodes · 2448 edges · 80 communities") ──
SUMMARY=$(sed -n '8p' "$REPORT" | sed 's/^- //')

# ── 4. Top 5 god-nodes (sectiunea ## God Nodes incepe la ~line 94) ──
GODS=$(awk '/^## God Nodes/{flag=1; next} flag && /^##/{flag=0} flag && NF' "$REPORT" | head -5)

# ── 5. Output ────────────────────────────────────────────────────
if [[ $JSON -eq 1 ]]; then
  # minimal json (no jq)
  printf '{"status":"%s","age_days":%d,"summary":"%s","report":"%s"}\n' \
    "$STATUS" "$AGE_DAYS" "$SUMMARY" "$REPORT"
  exit 0
fi

if [[ $QUIET -eq 1 ]]; then
  echo "[graphify-init] STATUS=$STATUS age=${AGE_DAYS}d  $SUMMARY"
  [[ "$STATUS" != "fresh" ]] && exit 2
  exit 0
fi

# Verbose
case "$STATUS" in
  fresh)   ICON="OK   " ;;
  stale)   ICON="STALE" ;;
  ancient) ICON="OLD  " ;;
esac

cat <<EOF
[graphify-init] $ICON  age=${AGE_DAYS}d  ($REPORT)
$SUMMARY

Top god-nodes:
$GODS

Read full report: src/graphify-out/GRAPH_REPORT.md
Rebuild:          ./scripts/graphify-rebuild.sh
EOF

[[ "$STATUS" != "fresh" ]] && {
  echo
  echo "[graphify-init] Graph e $STATUS (>=7d). Considera rebuild dupa commits majore."
  exit 2
}
exit 0
