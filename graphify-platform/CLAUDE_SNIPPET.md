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

**Cand Claude vede /graphify sau cere "map", "arhitectura", "relatii intre fisiere":**
1. Citeste `<project>/graphify-out/GRAPH_REPORT.md` daca exista.
2. Daca nu exista → propune `graphify-safe ./src` mai intai.
3. Foloseste god-nodes + community clusters din raport pentru sinteza.
4. NU amesteca concluzii graphify cu raspunsuri gitnexus — cita fiecare sursa.

**Proiect nou:**
`bash /path/to/graphify-platform/bin/graphify-new-project.sh`
(bootstrap .graphifyignore + CLAUDE.md hook + .gitignore + symlink wrapper)
<!-- GRAPHIFY_PROTOCOL_END -->
