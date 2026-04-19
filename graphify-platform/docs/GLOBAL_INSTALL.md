# GRAPHIFY GLOBAL INSTALL — One-shot per Mac

Versionat in: `TRADE AI/graphify-platform/`. Sursa de adevar pentru a pune Graphify + Obsidian bridge ca standard global pe orice masina noua.

## 0. Prerequisite (verifica)
```bash
brew --version || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install pipx
pipx ensurepath
exec $SHELL
```

## 1. Rulează scriptul global (one-shot)
```bash
bash "/Users/$USER/...path/to.../TRADE AI/graphify-platform/bin/graphify-install-global.sh"
```

Ce face efectiv (verifiable pas cu pas):
1. `pipx install graphifyy==0.4.23 --force` — pinneaza versiunea.
2. `graphify install` — scrie `~/.claude/skills/graphify/SKILL.md` + inregistreaza `/graphify`.
3. `cp GRAPHIFY_PROTOCOL.md → ~/.claude/antigravity/knowledge/Graphify_Protocol.md`.
4. Patcheaza `~/.claude/CLAUDE.md` cu blocul `<!-- GRAPHIFY_PROTOCOL_BEGIN -->` (idempotent).
5. Adauga in `~/.zshrc`:
   - `export GRAPHIFY_PLATFORM=...`
   - `alias graphify-new-project=...`
   - `alias graphify-bridge="python3 .../graphify-obsidian-bridge.py"`
6. Verifica: `graphify --help`, skill present, protocol present.

## 2. Verificare manuala (post-install)
```bash
which graphify              # ~/.local/bin/graphify
graphify --version          # 0.4.23
ls ~/.claude/skills/graphify/SKILL.md
ls ~/.claude/antigravity/knowledge/Graphify_Protocol.md
grep GRAPHIFY_PROTOCOL_BEGIN ~/.claude/CLAUDE.md
type graphify-bridge        # alias
```

## 3. Bootstrap pentru fiecare proiect nou
```bash
cd ~/dev/<noul-proiect>
graphify-new-project
```
Bootstrap-ul:
- copiaza `.graphifyignore` (template cu `.env`, `*.key`, etc.)
- adauga `graphify-out/` + `.graphify/` la `.gitignore`
- adauga sectiune Graphify in `CLAUDE.md` (idempotent)
- symlinkuieste `scripts/graphify-safe` → wrapper-ul cu pre-flight scan secrets
- symlinkuieste `scripts/graphify-bridge` → bridge Obsidian

## 4. Workflow standard per proiect
```bash
# 1. Build initial
./scripts/graphify-safe ./src --mode deep

# 2. Bridge → wiki-links Obsidian functioneaza
./scripts/graphify-bridge ./src/graphify-out

# 3. Deschide Obsidian, indica vault-ul = repo root, exploreaza GRAPH_REPORT.md
```

## 5. Daily updates (incremental)
```bash
./scripts/graphify-safe ./src --update
./scripts/graphify-bridge ./src/graphify-out
```

## 6. Limitari onesti
- `unlink` din bridge poate da "Operation not permitted" in sandbox-uri restrictionate (NU pe Mac local). Write overwrite functioneaza intotdeauna.
- `pipx upgrade` la graphifyy NU e automat → manual dupa CHANGELOG review.
- Skill global nu se sincronizeaza intre Mac-uri → re-rulezi `bash graphify-install-global.sh` pe fiecare.
- Bridge depinde de schema `graph.json` v0.4.23 (`_src`, `_tgt`, `community`). Daca schimbi versiunea de graphifyy, valideaza ca campurile exista.

## 7. Uninstall complet
```bash
# Per-proiect
rm -rf <project>/graphify-out/ <project>/.graphify/
rm <project>/scripts/graphify-safe <project>/scripts/graphify-bridge

# Global
graphify claude uninstall          # daca a fost instalat per-project hook
rm -rf ~/.claude/skills/graphify/
rm ~/.claude/antigravity/knowledge/Graphify_Protocol.md
# Sterge manual blocul <!-- GRAPHIFY_PROTOCOL_BEGIN/END --> din ~/.claude/CLAUDE.md
pipx uninstall graphifyy
# Sterge aliasurile din ~/.zshrc (caut sectiunea "═══ Graphify platform ═══")
```
