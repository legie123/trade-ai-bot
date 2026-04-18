#!/usr/bin/env bash
# graphify-rebuild.sh — TRADE AI specific rebuild (targets ./v2 by default).
# Uses the safe wrapper. Fails if secrets leak into scan path.
#
# Usage:
#   ./scripts/graphify-rebuild.sh                  # incremental update v2/
#   ./scripts/graphify-rebuild.sh --deep           # full rebuild with Claude subagents (costs tokens)
#   ./scripts/graphify-rebuild.sh --target ./app   # override target

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$REPO_ROOT" ]] || { echo "[graphify-rebuild] not in a git repo" >&2; exit 1; }
cd "$REPO_ROOT"

TARGET="./src"
EXTRA=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)   TARGET="$2"; shift 2 ;;
    --watch)    EXTRA+=("--watch"); shift ;;
    *)          EXTRA+=("$1"); shift ;;
  esac
done

# Prefer local symlinked wrapper, fall back to platform wrapper
if [[ -x ./scripts/graphify-safe ]]; then
  WRAPPER="./scripts/graphify-safe"
elif [[ -x ./graphify-platform/bin/graphify-safe ]]; then
  WRAPPER="./graphify-platform/bin/graphify-safe"
else
  echo "[graphify-rebuild] graphify-safe wrapper not found" >&2
  exit 1
fi

echo "[graphify-rebuild] target=$TARGET extra=${EXTRA[*]:-none}"
exec "$WRAPPER" "$TARGET" "${EXTRA[@]}"
