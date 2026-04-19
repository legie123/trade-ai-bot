# Snippet to append to global `~/.claude/CLAUDE.md`
#
# Paste between markers below into `~/.claude/CLAUDE.md` (after existing sections).

<!-- GRAPHIFY_PROTOCOL_BEGIN -->
## GRAPHIFY (layer implicit arhitectura/knowledge graph)

**Protocol complet:** `~/.claude/antigravity/knowledge/Graphify_Protocol.md`
**Sursa de adevar:** `TRADE AI/graphify-platform/` (versionat cu platforma)

**Reguli scurte:**
- `/graphify` skill activ global. Invocare din orice proiect.
- NICIODATA `graphify .` in repo cu secrets → foloseste `graphify-safe <subpath>`.
- Default subpath pentru analiza: `./src`, `./v2`, `./lib`. NU repo root.
- `graphify-out/` = gitignored, regenerabil, NU commit.
- `graphify` complementeaza `gitnexus`, nu-l inlocuieste. gitnexus = impact surgical. graphify = exploratory.
- Pinned version: `graphifyy==0.4.23`. Upgrade manual dupa CHANGELOG.

**ON SESSION START (orice repo cu Graphify activ):**
1. Citeste DOAR `<project>/graphify-out/_GRAPHIFY_DIGEST.md` (~150-200 tokeni, ~35× mai ieftin decat raportul full).
2. NU citi `GRAPH_REPORT.md` la session-init. Citeste-l doar la intrebare arhitecturala explicita ("how does X work", "show me god-nodes").
3. Daca digestul lipseste → propune `./scripts/graphify-safe ./src && ./scripts/graphify-bridge ./src/graphify-out && ./scripts/graphify-digest ./src/graphify-out`.
4. Citation contract obligatoriu: `[graphify:digest|report|community-N]`, `[gitnexus:impact]`, `[grep:source]`.
5. NU amesteca concluzii graphify cu raspunsuri gitnexus.

**Proiect nou:**
`bash /path/to/graphify-platform/bin/graphify-new-project.sh`
(bootstrap .graphifyignore + CLAUDE.md hook + .gitignore + symlink wrapper + bridge + digest + post-commit hook)

**Auto-mentenanta:** post-commit hook ruleaza graphify --update + bridge + digest la fiecare commit care atinge scan-target. Cost: 1-3s, 0 tokeni Claude. Disable per-commit: `GRAPHIFY_HOOK_ENABLED=0 git commit ...`.

**Cross-AI:** standardul e in `~/.claude/antigravity/knowledge/AI_INTEROP.md` si `~/.gemini/antigravity/knowledge/AI_INTEROP.md`. Toti AI-agentii (Claude, Gemini, DeepSeek, Llama, Cursor, Continue, Aider) urmeaza aceleasi reguli de detection + citation.
<!-- GRAPHIFY_PROTOCOL_END -->
