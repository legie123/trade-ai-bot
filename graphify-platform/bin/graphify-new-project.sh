#!/usr/bin/env bash
# graphify-new-project.sh — bootstrap Graphify integration in any project.
# Run from INSIDE the target project root.
#
# Writes: .graphifyignore, appends graphify-out/ to .gitignore, appends CLAUDE.md section,
# symlinks scripts/graphify-safe -> platform wrapper.

set -euo pipefail

GRN=$'\033[0;32m'; YLW=$'\033[0;33m'; RED=$'\033[0;31m'; NC=$'\033[0m'
log()  { printf "%s[graphify-new]%s %s\n" "$GRN" "$NC" "$*"; }
warn() { printf "%s[graphify-new]%s %s\n" "$YLW" "$NC" "$*" >&2; }
die()  { printf "%s[graphify-new ERR]%s %s\n" "$RED" "$NC" "$*" >&2; exit 1; }

# Resolve platform dir (this script lives inside graphify-platform/bin/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
[[ -f "$PLATFORM_DIR/templates/.graphifyignore" ]] || die "Platform templates missing at $PLATFORM_DIR"

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$PROJECT_ROOT" ]] || die "Not inside a git repo. cd into project root first."

cd "$PROJECT_ROOT"
log "Bootstrapping Graphify in: $PROJECT_ROOT"

# ── 1. .graphifyignore ───────────────────────────────────────────
if [[ -f .graphifyignore ]]; then
  warn ".graphifyignore exists — not overwriting"
else
  cp "$PLATFORM_DIR/templates/.graphifyignore" .graphifyignore
  log "wrote .graphifyignore"
fi

# ── 2. .gitignore entries ────────────────────────────────────────
touch .gitignore
for entry in "graphify-out/" ".graphify/"; do
  if ! grep -qxF "$entry" .gitignore 2>/dev/null; then
    printf "\n# ═══ Graphify ═══\n%s\n" "$entry" >> .gitignore
    log "added $entry to .gitignore"
  fi
done

# ── 3. CLAUDE.md section ─────────────────────────────────────────
[[ -f CLAUDE.md ]] || { echo "# CLAUDE.md" > CLAUDE.md; log "created CLAUDE.md"; }
if grep -q "GRAPHIFY_PROJECT_BEGIN" CLAUDE.md; then
  warn "CLAUDE.md already has graphify section"
else
  printf "\n" >> CLAUDE.md
  cat "$PLATFORM_DIR/templates/CLAUDE_MD_SECTION.md" >> CLAUDE.md
  log "appended graphify section to CLAUDE.md"
fi

# ── 4. scripts/graphify-safe symlink ─────────────────────────────
mkdir -p scripts
if [[ -e scripts/graphify-safe && ! -L scripts/graphify-safe ]]; then
  warn "scripts/graphify-safe exists and is not a symlink — skipping"
else
  ln -sf "$PLATFORM_DIR/bin/graphify-safe" scripts/graphify-safe
  log "symlinked scripts/graphify-safe -> $PLATFORM_DIR/bin/graphify-safe"
fi

# ── 4b. scripts/graphify-bridge symlink (Obsidian wiki-links) ────
if [[ -e scripts/graphify-bridge && ! -L scripts/graphify-bridge ]]; then
  warn "scripts/graphify-bridge exists and is not a symlink — skipping"
else
  ln -sf "$PLATFORM_DIR/bin/graphify-obsidian-bridge.py" scripts/graphify-bridge
  log "symlinked scripts/graphify-bridge -> $PLATFORM_DIR/bin/graphify-obsidian-bridge.py"
fi

# ── 4c. scripts/graphify-digest symlink (TL;DR for session-init) ─
if [[ -e scripts/graphify-digest && ! -L scripts/graphify-digest ]]; then
  warn "scripts/graphify-digest exists and is not a symlink — skipping"
else
  ln -sf "$PLATFORM_DIR/bin/graphify-digest.py" scripts/graphify-digest
  log "symlinked scripts/graphify-digest -> $PLATFORM_DIR/bin/graphify-digest.py"
fi

# ── 4d. post-commit hook (opt-out via env: GRAPHIFY_HOOK_INSTALL=0) ─
if [[ "${GRAPHIFY_HOOK_INSTALL:-1}" != "0" ]]; then
  bash "$PLATFORM_DIR/bin/graphify-hook-install.sh" || warn "hook install failed (non-fatal)"
fi

# ── 5. Verify graphify CLI available ─────────────────────────────
if ! command -v graphify >/dev/null 2>&1; then
  warn "graphify CLI not found globally. Install: pipx install graphifyy==0.4.23 && graphify install"
fi

# ── 6. Per-project CLAUDE hook (graphify's own) ──────────────────
if command -v graphify >/dev/null 2>&1; then
  graphify claude install 2>/dev/null || warn "graphify claude install failed (non-fatal)"
fi

log "DONE. Next:"
log "  1. ./scripts/graphify-safe ./src      (build graph)"
log "  2. ./scripts/graphify-bridge ./src/graphify-out   (resolve Obsidian wiki-links)"
