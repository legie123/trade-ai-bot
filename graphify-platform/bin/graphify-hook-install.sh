#!/usr/bin/env bash
# graphify-hook-install.sh — install post-commit hook in current git repo.
# Idempotent. Safe to re-run.
# Disable per-commit: GRAPHIFY_HOOK_ENABLED=0 git commit -m "..."
# Disable globally:   rm .git/hooks/post-commit

set -euo pipefail

GRN=$'\033[0;32m'; YLW=$'\033[0;33m'; RED=$'\033[0;31m'; NC=$'\033[0m'
log()  { printf "%s[graphify-hook]%s %s\n" "$GRN" "$NC" "$*"; }
warn() { printf "%s[graphify-hook]%s %s\n" "$YLW" "$NC" "$*" >&2; }
die()  { printf "%s[graphify-hook ERR]%s %s\n" "$RED" "$NC" "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$PLATFORM_DIR/templates/post-commit.sample"
[[ -f "$TEMPLATE" ]] || die "Template missing: $TEMPLATE"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "Not in a git repo"
HOOK_PATH="$REPO_ROOT/.git/hooks/post-commit"

if [[ -f "$HOOK_PATH" ]] && ! grep -q "graphify-hook" "$HOOK_PATH"; then
  warn "post-commit hook exists and isn't ours — backing up to $HOOK_PATH.bak"
  cp "$HOOK_PATH" "$HOOK_PATH.bak"
fi

cp "$TEMPLATE" "$HOOK_PATH"
chmod +x "$HOOK_PATH"
log "installed $HOOK_PATH"
log "scan target: \${GRAPHIFY_SCAN_TARGET:-./src}"
log "disable per-commit: GRAPHIFY_HOOK_ENABLED=0 git commit ..."
