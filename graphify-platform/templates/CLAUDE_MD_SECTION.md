<!-- GRAPHIFY_PROJECT_BEGIN -->
## GRAPHIFY (knowledge graph layer)

### ON SESSION START (mandatory)
1. **Digest fallback chain (citeste primul care exista):**
   a. PRIMARY: `<scan-target>/graphify-out/_GRAPHIFY_DIGEST.md` (local, fresh ≤7d). ~150-200 tokeni.
   b. FALLBACK: `graphify-platform/snapshots/LATEST_DIGEST.md` — versionat in repo, auto-refreshed de `.github/workflows/graphify-snapshot.yml` la fiecare push pe `src/**`. Garanteaza ca orice sesiune Claude (chiar fara build local) are digest curent.
2. Raport full fallback chain (doar la intrebare arhitecturala explicita):
   a. PRIMARY: `<scan-target>/graphify-out/GRAPH_REPORT.md`
   b. FALLBACK: `graphify-platform/snapshots/LATEST_REPORT.md`
3. Daca AMBELE lipsesc → `./scripts/graphify-safe <subpath> --update && ./scripts/graphify-bridge <subpath>/graphify-out && ./scripts/graphify-digest <subpath>/graphify-out`. Sau lasa hook-ul post-commit / GitHub Action sa o faca automat.
4. Citation contract: `[graphify:digest|report|community-N|snapshot]`, `[gitnexus:impact]`, `[grep:source]`.

### Build / Update
- Initial: `./scripts/graphify-safe ./src` (sau subpath echivalent, NU repo root).
- Bridge Obsidian (auto via post-commit hook): `./scripts/graphify-bridge ./src/graphify-out`.
- Digest TL;DR (auto via post-commit hook): `./scripts/graphify-digest ./src/graphify-out`.
- Query: `graphify query "<intrebare>"` · `graphify path "A" "B"` · `graphify explain "X"`.

### Reguli
- Raporteaza explicit cand folosesti graphify vs gitnexus. gitnexus = impact surgical; graphify = exploratory.
- Pinned: `graphifyy==0.4.23`. NU upgrade fara CHANGELOG review.
- `graphify-out/` e gitignored. NU commit. Regenerabil.
- Post-commit hook activ (auto-rebuild ~1-3s, 0 tokeni Claude). Disable per-commit: `GRAPHIFY_HOOK_ENABLED=0 git commit ...`.
<!-- GRAPHIFY_PROJECT_END -->
