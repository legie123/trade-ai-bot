# GRAPHIFY PROTOCOL — Global Platform Standard

> Canonical source of truth. Copy to `~/.claude/antigravity/knowledge/Graphify_Protocol.md`.
> Versioned in: `TRADE AI/graphify-platform/GRAPHIFY_PROTOCOL.md` (the "platform repo").

## 1. WHAT GRAPHIFY IS (calibrated)
- **Local Python CLI** + **Claude Code skill** (`/graphify`). MIT, pinned version `graphifyy==0.4.23`.
- Walks a folder, builds AST (tree-sitter, 25 langs), clusters with Leiden, emits interactive knowledge graph + `GRAPH_REPORT.md`.
- **NOT a cloud service.** No server, no API endpoint, no Cloud Run deploy. Portability = same CLI on any machine.
- **NOT a search engine.** Complements `gitnexus` (which we already use for impact analysis). Graphify = exploratory / god-node / community detection. gitnexus = surgical impact.

## 2. CANONICAL INSTALL (one-shot, per machine)
```bash
# Pinned, isolated from pip system env
pipx install graphifyy==0.4.23

# Global skill: writes ~/.claude/skills/graphify/SKILL.md + registers /graphify
graphify install

# Verify
graphify --help
ls ~/.claude/skills/graphify/
```

## 3. HARD RULES (TRADE AI + any sensitive repo)
1. **NEVER run `graphify .` from repo root** if `.env`, `*.key`, `credentials/` exist there. Graphify v0.4.23 has NO built-in ignore config.
2. **ALWAYS target a subpath**: `graphify ./v2/`, `graphify ./src/`, `graphify ./lib/`. Source code only.
3. **ALWAYS run `graphify-safe` wrapper** (from `graphify-platform/bin/`) — scans for secret patterns pre-flight and aborts if hit.
4. **NEVER commit `graphify-out/`** — already in template `.gitignore`. Contains graph.json + cache which may embed source snippets.
5. `graphify hook install` (git post-commit auto-rebuild) is **OPT-IN only** after first manual run validated the scan path.

## 4. STANDARD WORKFLOW (any project)

### First time in a project
```bash
cd <project>
graphify-new-project          # bootstrap: copies template .graphifyignore + updates CLAUDE.md + .gitignore
graphify-safe ./src --mode deep   # initial build; --mode deep uses Claude subagents (costs tokens)
```

### Daily use
```bash
graphify-safe                 # incremental update on last target
graphify query "how does auth flow work"
graphify path "functionA" "functionB"
graphify explain "OMNI-X decision pipeline"
```

### Inside Claude Code
- Skill auto-triggers on `/graphify` or phrases like "map this code", "what are the god nodes", "build knowledge graph".
- Claude reads `graphify-out/GRAPH_REPORT.md` before answering architecture questions (per-project `CLAUDE.md` section added by `graphify claude install`).

## 5. WHERE IT LIVES
| Scope | Path | Purpose |
|---|---|---|
| Global skill | `~/.claude/skills/graphify/SKILL.md` | Written by `graphify install`. |
| Global CLAUDE hook | `~/.claude/CLAUDE.md` | Graphify appends `/graphify` trigger. |
| Global protocol (this file) | `~/.claude/antigravity/knowledge/Graphify_Protocol.md` | Rules Claude reads every session. |
| Platform source of truth | `TRADE AI/graphify-platform/` | Versioned templates + scripts. Symlink target for dotfiles. |
| Per-project config (our convention) | `<repo>/.graphifyignore` | Read by our `graphify-safe` wrapper (NOT by graphify itself). |
| Per-project artifacts | `<repo>/graphify-out/` | Gitignored. Regenerable. |
| Per-project CLAUDE hook | `<repo>/CLAUDE.md` Graphify section | Written by `graphify claude install`. |

## 6. DEFAULT `.graphifyignore` (blocked from scan)
```
# Secrets / credentials
.env
.env.*
*.key
*.pem
.claude-creds
.gcp-*.json
credentials/
secrets/

# Vendored / build artifacts
node_modules/
.next/
dist/
build/
.venv/
venv/
__pycache__/
.pytest_cache/

# VCS / tooling
.git/
.gitnexus/
.graphify/
graphify-out/
.swarm/
.monitoring/
.obsidian/
.DS_Store

# Large data
*.log
*.sqlite
data/
backups/
```

## 7. COST CONTROL (Claude API)
- `--mode deep` uses Claude subagents → **real token cost**. Default = fast local-only AST mode.
- Rebuild only what changed: `graphify <path> --update`.
- TRADE AI: limit deep mode to major refactors or monthly audit.

## 8. INTERACTION WITH gitnexus (already in TRADE AI)
- **gitnexus** = authoritative call-graph + impact analysis (MCP-backed, indexed). Use for: "what breaks if I edit X", renames, blast radius.
- **graphify** = concept/community-level knowledge graph + exploration. Use for: "explain architecture", god nodes, cross-doc/image/paper ingestion.
- **Order of use:** gitnexus first for surgical questions. Graphify for "show me the shape of this codebase". Do NOT replace gitnexus with graphify for impact analysis.

## 9. NEW PROJECT BOOTSTRAP (default for everything going forward)
Run from any new project root:
```bash
~/dev/trade-ai/graphify-platform/bin/graphify-new-project.sh
```
This script:
1. Copies `.graphifyignore` template.
2. Appends graphify section to project `CLAUDE.md` (or creates it).
3. Adds `graphify-out/` to `.gitignore`.
4. Symlinks `scripts/graphify-safe` → platform wrapper.
5. Prints next command to run.

## 10. LIMITATIONS (do not hide)
- No native ignore config → wrapper enforces safety, not the tool itself.
- Token cost on `--mode deep` scales with folder size. Cap via subpath targeting.
- Graph regeneration on large repos (>10k files) is slow; use `--watch` + `--update`.
- Graphify skill in `~/.claude/` is machine-local. To sync across machines, either re-run `graphify install` or version the global dotfiles repo.
- Rapid release cadence (100+ versions / 3 months). Pin `==0.4.23` and upgrade deliberately after reading CHANGELOG.

## 11. UPGRADE PROTOCOL
```bash
# Never auto-upgrade. Manual only.
pipx list | grep graphifyy               # current version
pipx upgrade graphifyy                   # explicit choice
graphify install --force                 # re-register skill
# Verify TRADE AI still scans cleanly; commit platform bundle changes.
```

## 12. SESSION ACTIVATION (orice sesiune Claude noua)
Activarea e in 4 layere — primele 2 deja live dupa install, ultimele 2 per-proiect:

| Layer | Mecanism | Activat de |
|---|---|---|
| L1 — Skill global | `~/.claude/skills/graphify/` registered | `graphify install` (one-shot per Mac) |
| L2 — Protocol global | `~/.claude/CLAUDE.md` `GRAPHIFY_PROTOCOL_BEGIN/END` block | `graphify-install-global.sh` |
| L3 — Project rules | proiect `CLAUDE.md` `GRAPHIFY_PROJECT_BEGIN/END` block + "ON SESSION START" instructiuni | `graphify-new-project.sh` |
| L4 — Session bootstrap script | `scripts/graphify-session-init.sh` (TL;DR + freshness, 0 tokeni) | added by bootstrap, run on demand |

**Reguli minime pe orice sesiune Claude in proiect cu Graphify:**
1. Citeste `<scan-target>/graphify-out/GRAPH_REPORT.md` daca exista (Summary + God Nodes + Communities) inainte de orice raspuns arhitectural.
2. Daca lipseste sau e >7 zile vechi → ruleaza session-init script. Sugereaza rebuild la nevoie.
3. Pentru intrebari "cum functioneaza X" / "ce apeleaza Y" → `graphify query` sau `graphify path`. NU grep blind.
4. Refactor major → graphify update inainte de raportul final (god-nodes shift = signal).

**NU activam:**
- `graphify claude install` PreToolUse hook — adauga latenta pe fiecare Edit, conflict potential cu gitnexus hook. Opt-in doar daca utilizatorul cere explicit.
- Auto-rebuild la fiecare commit — costa timp; rebuild manual / saptamanal e suficient pentru exploratory layer.

## 13. KILL-SWITCH
If any secret leaks via graphify-out/:
```bash
# 1. Nuke artifacts
rm -rf graphify-out/ .graphify/
# 2. Rotate ALL exposed credentials (MEXC, Supabase, Telegram, GCP SA, GitHub PAT, Anthropic)
# 3. Uninstall global skill until post-mortem done
graphify claude uninstall   # per-project
rm -rf ~/.claude/skills/graphify/
# 4. Audit git log for any accidental commit of graphify-out/
```
