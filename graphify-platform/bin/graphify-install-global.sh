#!/usr/bin/env bash
# graphify-install-global.sh — ONE-TIME install on a new Mac.
# Installs pinned graphifyy via pipx, registers global Claude skill,
# writes the global protocol into ~/.claude/antigravity/knowledge/,
# patches ~/.claude/CLAUDE.md with the Graphify section.

set -euo pipefail

VERSION="0.4.23"
GRN=$'\033[0;32m'; YLW=$'\033[0;33m'; RED=$'\033[0;31m'; NC=$'\033[0m'
log()  { printf "%s[graphify-global]%s %s\n" "$GRN" "$NC" "$*"; }
warn() { printf "%s[graphify-global]%s %s\n" "$YLW" "$NC" "$*" >&2; }
die()  { printf "%s[graphify-global ERR]%s %s\n" "$RED" "$NC" "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 1. pipx present ──────────────────────────────────────────────
if ! command -v pipx >/dev/null 2>&1; then
  warn "pipx not found. Install: brew install pipx && pipx ensurepath"
  die "install pipx first, then re-run"
fi

# ── 2. Install pinned graphifyy ──────────────────────────────────
if pipx list 2>/dev/null | grep -q "package graphifyy $VERSION"; then
  log "graphifyy==$VERSION already installed"
else
  log "installing graphifyy==$VERSION via pipx"
  pipx install "graphifyy==$VERSION" --force
fi

# ── 3. Global skill registration ─────────────────────────────────
log "registering /graphify skill (writes ~/.claude/skills/graphify/SKILL.md)"
graphify install

# ── 4. Global protocol file ──────────────────────────────────────
GLOBAL_KB="$HOME/.claude/antigravity/knowledge"
mkdir -p "$GLOBAL_KB"
cp -f "$PLATFORM_DIR/GRAPHIFY_PROTOCOL.md" "$GLOBAL_KB/Graphify_Protocol.md"
log "wrote $GLOBAL_KB/Graphify_Protocol.md"

# ── 5. Patch global CLAUDE.md ───────────────────────────────────
CLAUDE_MD="$HOME/.claude/CLAUDE.md"
touch "$CLAUDE_MD"
if grep -q "GRAPHIFY_PROTOCOL_BEGIN" "$CLAUDE_MD"; then
  log "global CLAUDE.md already has graphify block"
else
  printf "\n" >> "$CLAUDE_MD"
  # Strip the first comment lines from snippet (they explain the snippet, not for CLAUDE.md)
  awk '/<!-- GRAPHIFY_PROTOCOL_BEGIN -->/,/<!-- GRAPHIFY_PROTOCOL_END -->/' \
    "$PLATFORM_DIR/CLAUDE_SNIPPET.md" >> "$CLAUDE_MD"
  log "appended graphify block to $CLAUDE_MD"
fi

# ── 6. PATH helper ───────────────────────────────────────────────
SHELL_RC="$HOME/.zshrc"
[[ -f "$HOME/.bashrc" && ! -f "$SHELL_RC" ]] && SHELL_RC="$HOME/.bashrc"
EXPORT_LINE="export GRAPHIFY_PLATFORM=\"$PLATFORM_DIR\""
ALIAS_NEW="alias graphify-new-project=\"bash $PLATFORM_DIR/bin/graphify-new-project.sh\""
ALIAS_BRIDGE="alias graphify-bridge=\"python3 $PLATFORM_DIR/bin/graphify-obsidian-bridge.py\""
if ! grep -q "GRAPHIFY_PLATFORM" "$SHELL_RC" 2>/dev/null; then
  {
    echo ""
    echo "# ═══ Graphify platform ═══"
    echo "$EXPORT_LINE"
    echo "$ALIAS_NEW"
    echo "$ALIAS_BRIDGE"
  } >> "$SHELL_RC"
  log "wrote GRAPHIFY_PLATFORM + graphify-new-project + graphify-bridge aliases to $SHELL_RC"
elif ! grep -q "graphify-bridge" "$SHELL_RC" 2>/dev/null; then
  echo "$ALIAS_BRIDGE" >> "$SHELL_RC"
  log "appended graphify-bridge alias to $SHELL_RC"
fi

# ── 7. Verify ────────────────────────────────────────────────────
log "Verifying install..."
graphify --help >/dev/null && log "graphify CLI OK"
[[ -f "$HOME/.claude/skills/graphify/SKILL.md" ]] && log "skill file present"
[[ -f "$GLOBAL_KB/Graphify_Protocol.md" ]] && log "global protocol present"

log "DONE. Open a new shell and run: graphify-new-project   (inside any project root)"
