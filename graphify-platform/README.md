# graphify-platform/

**Source of truth pentru integrarea Graphify in toate proiectele.**

Acest folder traieste versionat cu TRADE AI dar e **tool-agnostic** — e platforma reusable. Pentru orice proiect nou, rulezi `bin/graphify-new-project.sh` si mosteneste tot setup-ul.

## Layout
```
graphify-platform/
├── GRAPHIFY_PROTOCOL.md     # Protocol canonical. Copy to ~/.claude/antigravity/knowledge/
├── CLAUDE_SNIPPET.md         # Append to ~/.claude/CLAUDE.md (between markers).
├── README.md                 # Acest fisier.
├── templates/
│   ├── .graphifyignore       # Default deny-list pentru secrets + noise.
│   └── CLAUDE_MD_SECTION.md  # Sectiunea auto-appended in CLAUDE.md-ul proiectului.
├── bin/
│   ├── graphify-safe         # Wrapper: pre-flight secret scan + subpath target + invoke.
│   ├── graphify-new-project.sh  # Bootstrap pentru proiect nou.
│   └── graphify-install-global.sh  # Install one-time pe Mac nou.
└── docs/
    └── INTEGRATION_REPORT.md # Raport executat pe TRADE AI.
```

## Quick start

### Pe o masina noua (one-time)
```bash
cd "TRADE AI/graphify-platform"
bash bin/graphify-install-global.sh
```

### Intr-un proiect nou
```bash
cd <my-new-project>
bash ~/path/to/TRADE\ AI/graphify-platform/bin/graphify-new-project.sh
```

### In TRADE AI
```bash
cd "TRADE AI"
./scripts/graphify-rebuild.sh    # safe wrapper, target v2/
```

## De ce ca folder in TRADE AI?
Pentru ca TRADE AI e deja proiectul canonical cu cel mai bun setup (gitnexus, Ruflo, deploy pipeline). Promoveaza platforma in timp:
- Faza 1 (acum): traieste in `TRADE AI/graphify-platform/`.
- Faza 2 (cand apare al doilea proiect critic): extras ca submodul git sau repo propriu (`antigravity-platform`).
- Faza 3: symlink global `~/.claude/platform/` catre el.

## Validare integrare
Ruleaza:
```bash
bash graphify-platform/bin/graphify-safe --check
```
Trebuie sa vada: `.graphifyignore` present, `graphify-out/` in `.gitignore`, CLAUDE.md contine marker `<!-- GRAPHIFY_PROTOCOL_BEGIN -->`.
