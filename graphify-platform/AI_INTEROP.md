# GRAPHIFY + OBSIDIAN — Cross-AI Standard

> Versionat in `TRADE AI/graphify-platform/`. Copiat la install pe orice masina in `~/.claude/antigravity/knowledge/AI_INTEROP.md` si `~/.gemini/antigravity/knowledge/AI_INTEROP.md`.
>
> Acest document e citit de **toti AI-agentii** care colaboreaza pe acelasi workspace (Claude, Gemini, DeepSeek-V3, Llama-3, Cursor, Continue, Aider, etc.).

## 1. PRINCIPIUL DE BAZA

Graphify + Obsidian = **knowledge layer permanent** pentru orice proiect cu cod >10k linii. Inlocuieste explorarea brute-force (grep, read 10 files) cu un map structurat care se actualizeaza automat la fiecare commit.

**Beneficiu masurat:** ~96% reducere tokeni pe session-init prin lazy-load digest (157 tokeni vs 5,567 full report).

## 2. DETECTAREA PE ORICE SESIUNE NOUA

Orice agent AI care intra intr-un repo trebuie sa execute aceasta secventa la session start:

```bash
# 1. Detectez prezenta Graphify in repo
[ -d "<scan-target>/graphify-out" ] && GRAPHIFY_PRESENT=1

# 2. Daca e prezent, citesc digest-ul (nu raportul full!)
[ -f "<scan-target>/graphify-out/_GRAPHIFY_DIGEST.md" ] && \
  cat <scan-target>/graphify-out/_GRAPHIFY_DIGEST.md
```

**Reguli:**
- DA, citesc `_GRAPHIFY_DIGEST.md` la fiecare session start (157 tokeni, neglijabil).
- NU citesc `GRAPH_REPORT.md` decat la o intrebare arhitecturala explicita ("how does X work", "what's the structure", "show me god-nodes").
- NU citesc community stubs (`_COMMUNITY_Community N.md`) decat dupa ce am decis ca un cluster specific e relevant pentru intrebare.
- NU grep blind pentru intrebari arhitecturale daca digest sau raport sunt disponibile.

## 3. CONTRACTUL DE OUTPUT (toti agentii)

Orice raspuns arhitectural trebuie sa cite SURSA:
- `[graphify:digest]` — am folosit doar TL;DR
- `[graphify:report]` — am citit GRAPH_REPORT.md
- `[graphify:community-N]` — am citit un community stub specific
- `[gitnexus:impact]` — pentru intrebari de impact (NU graphify)
- `[grep:source]` — am facut grep direct (motiv: graphify nu acopera fisierul)

Acest contract previne raspunsuri fantomatice si permite review.

## 4. MENTENANTA AUTONOMA

Per repo cu Graphify activ:
- **Post-commit hook** auto-ruleaza `graphify --update` + bridge + digest la fiecare commit care atinge `<scan-target>`. Cost: 1-3s, zero tokeni.
- **Saptamanal** (cron Mac sau CI): full rebuild `graphify-safe ./src --mode deep` pentru a captura schimbari semantice.
- **Pe demand**: orice agent poate cere user-ului `bash scripts/graphify-safe ./src --update` daca digest-ul e >7 zile vechi.

## 5. RESPONSABILITATILE PER AI

| AI | Rol | Cu Graphify |
|---|---|---|
| Claude (Opus) | Edge cases, safety, leak detection | Citeste digest + raport pentru audit; cere community-N pentru deep-dive |
| Claude (Sonnet) | Implementare bulk, refactor | Digest + gitnexus impact inainte de orice edit |
| Claude (Haiku) | Tool-routing, status checks | DOAR digest (nu intra in raport) |
| Gemini | Arhitectura, decuplare, scalabilitate | Raport complet; foloseste community map pentru a propune split-uri |
| DeepSeek-V3 | Performanta, latenta, V8/I-O | Digest + community pe hot-paths (C0/C1/C2 in TRADE AI) |
| Llama-3 / local | Brainstorm cheap | Doar digest |
| Cursor / Continue / Aider | Edit asistat | Citesc CLAUDE.md / GEMINI.md sectiunea Graphify, urmeaza protocolul de mai sus |

## 6. SEMNALIZARE INTRE AGENTI

Cand un agent rebuild-uieste graficul (commit + post-commit hook ruleaza), urmatorul agent gaseste un digest fresh. Nu trebuie comunicare explicita intre agenti — repo-ul e single source of truth.

Daca doi agenti lucreaza simultan, fiecare citeste digest-ul la inceput. Conflictele de directie se rezolva conform `Multi_Agent_Sync_Protocol` (in `~/.claude/antigravity/knowledge/`).

## 7. INTERZIS

- Sa rulezi `graphify .` din repo root (poate slurp `.env`, `*.key`, etc.). Foloseste `graphify-safe` wrapper.
- Sa commit-uiezi `graphify-out/`. E gitignored. Regenerabil oricand.
- Sa interpretezi god-nodes ca "bug" automat. GET()=185 in TRADE AI nu e bug, e arhitectura cron+route asumata.
- Sa folosesti graphify pentru impact analysis. Pentru asta exista gitnexus.

## 8. KILL-SWITCH PER AGENT

Daca digest-ul sugereaza directie diferita de cea a userului:
- Raporteaza divergenta explicit
- NU urmezi automat digestul daca contrazice instructia umana
- User > digest > raport > community stub > grep

## 9. CHECKLIST INSTALARE PE OUR MASINA NOUA

```bash
# Pentru Claude
bash <repo>/graphify-platform/bin/graphify-install-global.sh

# Pentru Gemini (sync manual al protocolului)
mkdir -p ~/.gemini/antigravity/knowledge/
cp <repo>/graphify-platform/AI_INTEROP.md ~/.gemini/antigravity/knowledge/

# Pentru orice tool care citeste CLAUDE.md (Cursor, Continue, Aider)
# Nu necesita actiune — hook-ul de project CLAUDE.md e citit automat
```

## 10. METRICI DE SUCCES

Considera Graphify+Obsidian standardul **functional** cand:
- Toate sesiunile noi citesc digest-ul automat (verifica cu sesion_info / log review).
- Reducere medie >50% tokeni session-init pe consola (verifica console.anthropic.com).
- Post-commit hook ruleaza fara erori 30 zile consecutive.
- Toti agentii citeaza sursa graphify in raspunsurile arhitecturale.
- Zero scurgeri de secrete via `graphify-out/` (verifica cu git log + `git ls-files`).
