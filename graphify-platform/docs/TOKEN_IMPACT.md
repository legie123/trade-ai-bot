# GRAPHIFY + OBSIDIAN — Token Impact (calibrated)

> Status: PROBABIL pentru reducere, NEVERIFICAT prin Anthropic console (sandbox-ul nu poate accesa console.anthropic.com sau billing API).

## 1. Masuratori reale (verificat in sandbox)

### Codebase TRADE AI/src
- **214 fisiere TypeScript**, total **1,443,300 bytes ≈ ~360,825 tokens**.
- Median fisier: 4,781 bytes ≈ 1,195 tokens.
- p75: 8,878 bytes ≈ 2,219 tokens.
- p95: 17,626 bytes ≈ 4,406 tokens.
- Codebase intreg NU INCAPE intr-o fereastra de 200k tokeni (1.8x peste limita).

### Artifact Graphify + Obsidian (verificat)
- `GRAPH_REPORT.md`: 22,269 bytes ≈ **5,567 tokens** (intreaga harta arhitecturala).
- `_GRAPHIFY_INDEX.md`: 4,276 bytes ≈ **1,069 tokens** (TOC navigabil).
- Median community stub: 1,805 bytes ≈ **451 tokens** per cluster.
- Toate 80 stubs cumulate: 90,301 bytes ≈ **22,575 tokens**.

## 2. Scenarii reale (cu masuratori, fara estimari speculative)

### Scenariul A — "How does X work?" (arhitectural)
| | Tokens | Sursa |
|---|---|---|
| BEFORE: grep + read 6 fisiere la p75 | **~13,314** | 6 × 2,219 |
| AFTER: GRAPH_REPORT + 1-2 community stubs | **~6,467** | 5,567 + 2 × 451 |
| **Reducere reala** | **~51%** | masurat din artifact sizes |

### Scenariul B — "Map god-nodes / show me architecture"
| | Tokens | Sursa |
|---|---|---|
| BEFORE: read 10-15 fisiere la p75 | **~25,000-33,000** | 10-15 × 2,219 |
| AFTER: read doar GRAPH_REPORT.md | **~5,567** | masurat |
| **Reducere reala** | **~78-83%** | masurat |

### Scenariul C — Session start (priming initial)
| | Tokens | Sursa |
|---|---|---|
| BEFORE: niciun priming, grep on-demand pentru fiecare intrebare | variabil; ~10k pentru primele 5 intrebari | extrapolare |
| AFTER: lazy-load GRAPH_REPORT doar la prima intrebare arhitecturala | ~5,567 amortizat | masurat |
| **Reducere** | depinde de # intrebari; **nu e consistent** | calibrat |

## 3. Limitari oneste (HARD MODE)

1. **NU am acces la Anthropic console API din sandbox.** Numarul exact de input/output tokens per session necesita ca utilizatorul sa verifice console.anthropic.com → Usage → filter by API key.
2. **session_info MCP** returneaza transcript-uri text, NU contoare de tokeni. Pot estima dimensiune (chars/4) dar e aproximativ.
3. Estimarea "1 token ≈ 4 chars" e medie pentru engleza; cod TS si Romanian comments pot devia ±20%.
4. Reducerea reala depinde MASIV de ce face Claude in session — daca grep-uieste agresiv chiar si cu graphify, beneficiul scade.

## 4. Ce poate utilizatorul sa masoare singur (real, nu estimat)

```bash
# 1. Inainte de o sesiune complexa
TS_BEFORE=$(date +%s)

# 2. Lucreaza cu Claude (o sesiune lunga, ~30 min)

# 3. La final
echo "Sesiunea: $(date +%s) - $TS_BEFORE secunde"
```

Apoi pe Anthropic Console:
1. Login pe console.anthropic.com
2. Sectiunea **Usage** → filter by date range = sesiunea ta
3. Compara: **input tokens** + **output tokens** per task type
4. Pastreaza in spreadsheet: data, task type, tokens, am folosit graphify? Y/N

Dupa 5-10 sesiuni, ai date reale de comparat.

## 5. Verdict calibrat

- **VALIDAT:** GRAPH_REPORT.md (5,567 tokens) este 65x mai mic decat codebase-ul (360,825 tokens). Inlocuirea unei explorari "grep + read" cu un read de raport e dovedit mai eficient ca volumul de date.
- **PROBABIL:** Reducere de **50-80%** pe intrebari arhitecturale (scenariu A si B), dependent de cat de des grep-uieste Claude in plus dupa raport.
- **NEVERIFICAT:** Reducere globala per session in productie reala. Necesita masuratoare pe console.anthropic.com de catre utilizator.
- **PERICULOS:** Daca Claude ignora GRAPH_REPORT si grep-uieste oricum, beneficiul = 0. Trebuie respectata regula "ON SESSION START → citeste GRAPH_REPORT inainte de orice raspuns arhitectural" (deja codificat in `CLAUDE.md`).
