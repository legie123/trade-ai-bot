<!-- GRAPHIFY_PROJECT_BEGIN -->
## GRAPHIFY (knowledge graph layer)

- Build graph: `./scripts/graphify-safe ./src` (sau subpath echivalent, NU repo root).
- Query: `graphify query "<intrebare>"` · `graphify path "A" "B"` · `graphify explain "X"`.
- Artifact: `graphify-out/GRAPH_REPORT.md` — citeste pentru god-nodes & community clusters inainte de raspunsuri de arhitectura.
- Raporteaza explicit cand folosesti graphify vs gitnexus. gitnexus = impact surgical; graphify = exploratory.
- Pinned: `graphifyy==0.4.23`. NU upgrade fara CHANGELOG review.
- `graphify-out/` e gitignored. NU commit. Regenerabil.
<!-- GRAPHIFY_PROJECT_END -->
