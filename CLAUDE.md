# TRADE AI — Claude Instructions

## 0. RUFLO PROTOCOL (coordinator layer — permanent)
Standard operational global. Orchestreaza toate protocoalele de mai jos.
**Layers:** Discovery → Execution → Validation → Memory → Cloud → Control
**Regula:** Orice task: cuantifica → structureaza in faze → executa controlat → valideaza → raporteaza (DONE/BLOCKED/NEXT) → continua doar in logica Ruflo.
**Format raportare (task multi-faza):** OBIECTIV → FAZA CURENTA → CE EXECUT → CE AM TERMINAT → CE E BLOCAT → NEXT
**NEXT gating:** Nu sari faze. Nu presupui. Nu improvizezi fara date. Workflow manual = astepti NEXT.
**Interdictii:** bulk fara structurare, refactor total fara faze, directie schimbata fara motiv, livrare fara status.
**Merge cooperativ:** Nu inlocuieste Hard Mode/Sniper/Anti-Loop/Debate/Maieutic — le coordoneaza.

## 1. HARD MODE (permanent)
**Interdictii:** marketing, limbaj diplomatic decorativ, storytelling, romantizare, propuneri speculative ca valoare, output lung fara valoare.
**Verdicte:** VALIDAT · NEVALIDAT · NU MERITA ACUM · COSMETICA · PERICULOS
**Status claims:** VERIFICAT (dovada clara) · PROBABIL (indicii) · NEVERIFICAT (fara dovada)

## 2. SNIPER PROTOCOL
Fisiere >100 linii → Edit chirurgical, NU rescriere. Max 2-3 fisiere per batch. Dupa batch: validare.

## 3. ANTI-LOOP
Max 2 retry pe aceeasi abordare. Aceeasi eroare x2 → BLOCKED + escaladare umana.

## 4. TRADE AI — REGULA SUPREMA
Zero feature-uri noi. Doar optimizare / testare / deploy. Exceptie: bug blocant critic.
NU modific v2/master/, v2/scouts/, v2/manager/ fara context complet.
NU schimb endpoint-uri API/Supabase fara aprobare.
NU force-deploy / force-push peste pipeline existent.

## 5. DEPLOYMENT HARD-LOCK
`TRADE AI/` → GCP project `evident-trees-453923-f9`, Cloud Run service `trade-ai`, region `europe-west1`. Safe-check `pwd` inainte de deploy. Mismatch → BLOCKED.

## 6. FORMAT RASPUNS
**Implementare:** STATUS → FINDINGS → ACTION → VALIDATION → NEXT
**Audit:** ISSUE → EVIDENCE → IMPACT → SAFE FIX → PRIORITY

---

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **TRADE AI** (1356 symbols, 3607 relationships, 107 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/TRADE AI/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/TRADE AI/context` | Codebase overview, check index freshness |
| `gitnexus://repo/TRADE AI/clusters` | All functional areas |
| `gitnexus://repo/TRADE AI/processes` | All execution flows |
| `gitnexus://repo/TRADE AI/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

## Project Environment & Credentials

- **Source of Truth**: All API keys (MEXC, Supabase, AI, Telegram) are stored in the root `.env` file.
- **Usage**: Before running tests or specialized agents, ensure you parse `.env`.
- **Cloud Sync**: The script `./push-secrets.sh` is used to sync local `.env` values to GCP Secret Manager for Cloud Run deployments. Always run this script after modifying critical credentials in `.env`.
- **Security**: Never commit `.env` or `.claude-creds` to the repository.

<!-- gitnexus:end -->

<!-- GRAPHIFY_PROJECT_BEGIN -->
# Graphify — Knowledge Graph Layer

## ON SESSION START (mandatory pentru orice sesiune Claude pe TRADE AI)
1. **Citeste DOAR** `src/graphify-out/_GRAPHIFY_DIGEST.md` — TL;DR ~160 tokeni (vs ~5,567 raportul full). Confirmat 34.6× reducere.
2. **NU citi `GRAPH_REPORT.md` la session-init.** Citeste-l doar la intrebare arhitecturala explicita ("how does X work", "what's the structure", "show me god-nodes"). Comunitatile (`_COMMUNITY_*.md`) doar pe demand specific.
3. **Daca digestul lipseste sau e >7 zile vechi**, executa `./scripts/graphify-safe ./src --update` apoi `./scripts/graphify-bridge ./src/graphify-out` apoi `./scripts/graphify-digest ./src/graphify-out`. Sau lasa hook-ul post-commit sa o faca automat (auto-instalat de `graphify-new-project.sh`).
4. **Cand utilizatorul intreaba "cum functioneaza X"**, foloseste `graphify query "X"` SAU citeste sectiunea relevanta din `GRAPH_REPORT.md`. NU grep blind pe codebase pentru intrebari arhitecturale.
5. **Cand utilizatorul cere refactor major**, ruleaza graphify update inainte de raportul final (verifica daca god-nodes s-au mutat).
6. **Citation contract:** marcheaza sursa in raspuns: `[graphify:digest]` (am citit doar TL;DR), `[graphify:report]` (am citit raport full), `[graphify:community-N]` (am citit community stub), `[gitnexus:impact]` (impact surgical), `[grep:source]` (grep direct, motiv: graphify nu acopera).

Graphify completeaza gitnexus: **gitnexus = impact surgical, graphify = exploratory / god-nodes / community clusters**. Nu inlocuiesc unul pe celalalt.

## Reguli pentru TRADE AI (strict)
- **NICIODATA `graphify .` din repo root** — contine `.env`, `.gcp-sa-key.json`, `.claude-creds`. Graphify v0.4.23 NU are config de excludere built-in.
- **Foloseste wrapper-ul** `./scripts/graphify-safe <subpath>` — face pre-flight scan pentru secrete + interzice repo root fara `--force-root`.
- **Subpath-uri permise:** `./src/`, `./app/`, `./lib/`, `./components/`, `./scripts/`. NU `.`, NU `./`, NU root-ul.
- `graphify-out/` e gitignored (regenerabil). NU commit.
- Pinned `graphifyy==0.4.23`. Upgrade manual dupa CHANGELOG.

## Cand folosesti
| Intrebare | Tool |
|---|---|
| "Ce se strica daca editez `findBestGladiator`?" | gitnexus_impact |
| "Cine apeleaza `executeTrade`?" | gitnexus_context |
| "Da-mi harta arhitecturii TRADE AI" | graphify query |
| "Care sunt god-nodes in src/?" | `./scripts/graphify-safe ./src` + citeste `graphify-out/GRAPH_REPORT.md` |
| "Explica pipeline-ul OMNI-X" | `graphify explain "OMNI-X"` (dupa build) |
| "Ce cluster-uri de sens are codul?" | `graphify-out/GRAPH_REPORT.md` |

## Workflow standard
```bash
# Build initial (1x / major refactor)
./scripts/graphify-safe ./src --mode deep

# Update incremental (dupa commits)
./scripts/graphify-safe ./src --update

# Query
graphify query "how does Moltbook karma gate work"
graphify path "findBestGladiator" "executeTrade"
```

## Integrare cu Ruflo Protocol
- Faza Discovery: graphify pentru "ce e necunoscut in codebase"
- Faza Execution: gitnexus pentru impact + implementare
- Faza Validation: ambele (gitnexus_detect_changes + graphify rebuild daca s-a schimbat structura majora)

## Platform bundle
Source of truth: `graphify-platform/` (in acest repo). Contine wrapper, templates, protocol global, bootstrap pentru proiecte noi.
Protocol complet: `graphify-platform/GRAPHIFY_PROTOCOL.md`.
<!-- GRAPHIFY_PROJECT_END -->
