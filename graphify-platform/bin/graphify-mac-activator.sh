#!/usr/bin/env bash
# Graphify Mac Activator — single-shot end-to-end fix
# Resolves: lock cleanup, dirty-tree stash, pull, smoke-test hook, Gemini mirror.
# Usage: bash graphify-platform/bin/graphify-mac-activator.sh
# Re-runnable. Auto-stashes WIP. Self-reports GREEN/RED per step.

set -uo pipefail

REPO_DEFAULT="/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"
REPO="${GRAPHIFY_REPO:-$REPO_DEFAULT}"

GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'
ok()   { echo "${GREEN}[OK]${NC} $1"; }
fail() { echo "${RED}[FAIL]${NC} $1"; }
warn() { echo "${YELLOW}[WARN]${NC} $1"; }
hr()   { echo "----------------------------------------"; }

cd "$REPO" 2>/dev/null || { fail "cd failed: $REPO"; exit 1; }
ok "cwd: $REPO"

# === STEP 1/6: identify FD holder on .git/ ===
hr; echo "STEP 1/6: Identify .git FD holders"
LSOF_OUT=$(lsof +D .git 2>/dev/null | awk 'NR>1 {print $2,$1}' | sort -u)
if [ -z "$LSOF_OUT" ]; then
  ok "no process holds FDs on .git/"
else
  warn "FD holders found:"
  echo "$LSOF_OUT" | while read -r p name; do
    args=$(ps -p "$p" -o args= 2>/dev/null | head -c 90)
    echo "  PID $p ($name) $args"
  done
  warn "If GUI git tool (Fork/GitKraken/SourceTree/Tower) is open, close it before re-running."
fi

# === STEP 2/6: clear stale locks ===
hr; echo "STEP 2/6: Clear stale .git locks"
LOCK_COUNT=$(find .git -name "*.lock" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$LOCK_COUNT" -gt 0 ]; then
  find .git -name "*.lock" -type f -print -delete 2>/dev/null | sed 's/^/  removed /'
  ok "cleared $LOCK_COUNT lock(s)"
else
  ok "no locks present"
fi

# === STEP 3/6: stash dirty WIP ===
hr; echo "STEP 3/6: Stash any WIP"
DIRTY_COUNT=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "$DIRTY_COUNT" -gt 0 ]; then
  echo "  $DIRTY_COUNT dirty path(s) detected:"
  git status --porcelain | head -10 | sed 's/^/    /'
  STASH_MSG="auto-stash-mac-activator-$(date +%s)"
  if git stash push -u -m "$STASH_MSG" >/tmp/graphify-stash.log 2>&1; then
    ok "stashed: $STASH_MSG"
    warn "recover later with: git stash list && git stash pop stash@{0}"
  else
    fail "stash failed:"
    cat /tmp/graphify-stash.log
    exit 1
  fi
else
  ok "tree clean, nothing to stash"
fi

# === STEP 4/6: pull origin/main ===
hr; echo "STEP 4/6: Pull origin/main"
HEAD_BEFORE=$(git rev-parse --short HEAD 2>/dev/null)
if git pull --ff-only origin main >/tmp/graphify-pull.log 2>&1; then
  HEAD_AFTER=$(git rev-parse --short HEAD)
  if [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
    ok "advanced ${HEAD_BEFORE} -> ${HEAD_AFTER}"
  else
    ok "already at origin (${HEAD_AFTER})"
  fi
else
  fail "fast-forward pull failed:"
  tail -15 /tmp/graphify-pull.log
  warn "manual fix needed — likely diverged history. Try: git pull --rebase origin main"
  exit 1
fi

# === STEP 5/6: smoke-test post-commit hook ===
hr; echo "STEP 5/6: Smoke-test post-commit hook"
if [ ! -x .git/hooks/post-commit ]; then
  fail "post-commit hook missing or not executable at .git/hooks/post-commit"
  warn "install with: bash graphify-platform/bin/graphify-hook-install.sh"
  exit 1
fi
ok "hook present and executable"

# Hook bails if commit doesn't touch src/, so we create a marker file there.
MARKER="src/.graphify-activated"
mkdir -p src 2>/dev/null
echo "graphify-mac-activator: $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MARKER"
git add "$MARKER" >/dev/null 2>&1

if git commit -m "graphify: smoke-test post-commit hook" >/tmp/graphify-hook.log 2>&1; then
  if grep -q "\[graphify-hook\]" /tmp/graphify-hook.log; then
    ok "hook fired:"
    grep "\[graphify-hook\]" /tmp/graphify-hook.log | sed 's/^/    /'
  else
    warn "commit succeeded but no [graphify-hook] line in output"
    echo "  Last 15 lines:"
    tail -15 /tmp/graphify-hook.log | sed 's/^/    /'
    warn "hook may have bailed silently — check that 'graphify' is on PATH and src/graphify-out exists"
  fi
else
  fail "commit failed:"
  tail -15 /tmp/graphify-hook.log
  exit 1
fi

# === STEP 6/6: Gemini cross-AI mirror ===
hr; echo "STEP 6/6: Propagate Gemini mirror"
INSTALLER="graphify-platform/bin/graphify-install-global.sh"
if [ -x "$INSTALLER" ]; then
  bash "$INSTALLER" >/tmp/graphify-install.log 2>&1 || warn "installer returned non-zero (may be benign)"
  if [ -f "$HOME/.gemini/antigravity/knowledge/AI_INTEROP.md" ]; then
    ok "Gemini mirror live: ~/.gemini/antigravity/knowledge/AI_INTEROP.md"
  else
    warn "Gemini mirror not found at expected path (installer log: /tmp/graphify-install.log)"
  fi
else
  warn "installer missing or not executable: $INSTALLER"
fi

# === FINAL SUMMARY ===
hr; echo "FINAL STATUS"
HEAD_NOW=$(git rev-parse --short HEAD)
ORIGIN_NOW=$(git rev-parse --short origin/main 2>/dev/null || echo "?")
DIGEST_PATH="src/graphify-out/_GRAPHIFY_DIGEST.md"
DIGEST_BYTES=$([ -f "$DIGEST_PATH" ] && wc -c < "$DIGEST_PATH" | tr -d ' ' || echo MISSING)
HOOK_STATE=$([ -x .git/hooks/post-commit ] && echo armed || echo MISSING)
GEMINI_STATE=$([ -f "$HOME/.gemini/antigravity/knowledge/AI_INTEROP.md" ] && echo live || echo absent)
STASH_LATEST=$(git stash list | head -1 | tr -d '\n' || echo none)

echo "  HEAD          : $HEAD_NOW"
echo "  origin/main   : $ORIGIN_NOW"
echo "  hook          : $HOOK_STATE"
echo "  digest bytes  : $DIGEST_BYTES"
echo "  Gemini mirror : $GEMINI_STATE"
echo "  latest stash  : ${STASH_LATEST:-none}"
hr
echo "Anthropic console A/B (NOT AUTOMATABLE):"
echo "  1. Open 2 fresh sessions in console.anthropic.com"
echo "  2. Session A: paste contents of $DIGEST_PATH"
echo "  3. Session B: paste contents of src/graphify-out/GRAPH_REPORT.md"
echo "  4. Compare 'Input tokens' counter — expect ~30-35x difference"
hr
ok "Activator finished. Review output above for any [WARN]/[FAIL]."
