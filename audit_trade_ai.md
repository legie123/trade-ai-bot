# 🦅 MASTER AUDIT: TRADE AI (PHOENIX V2)
**Status Protocol**: HARD MODE ACTIVAT
**Data Audit**: 08 Aprilie 2026

## 1. VERDICT GENERAL
Sistemul a evoluat impresionant spre un ecosistem neuro-agentic (Sindicat Dual + Reinforcement Learning), **dar suferă fatal de "Congestie Evolutivă" în Pipeline-ul de Strategii**. Sectoarele de analiză, siguranță (Sentinel Guard) și consens logic (Dual Master) au un rol strategic excepțional și sunt implementate la standarde de top. În schimb, **sectorul Promoters / Gladiator Recruitment este COMPLET FAKE**, creând o iluzie a progresului prin simpla redenumire a unor agenți eșuați ("Mutated V10") și resetarea PnL-ului, fără a altera parametrii de intrare.

Dacă lăsăm sistemul așa, inteligența AI (DNA Extractor) se va contamina cu date viciate, iar vizionarul va ceda. Avem nevoie de un ecosistem Darwinian nemilos: naștere reală de strategii, teste pe MEXC prices, și "death threshold" absolut. 

---

## 2. MULTI-MODEL DEBATE SUMMARY (Arhitectură)

> **👤 Claude (Safety & Protection):**
> "Vizionarul penalizează confidența dacă un Gladiator under-performează, dar acest gladiator REZERVĂ încă memorie și sloturi în procesor. Regula de eliminare este moale. Trebuie o bară de ștergere absolută. Orice Gladiator sub 40% WinRate la peste 20 de trade-uri nu trebuie trecut în *shadow mode*, ci **SCOS DIN BAZA DE DATE CONTINUU**."

> **🦙 Llama 4 (Architecture & Modularity):**
> "Modulul `PromotersAggregator` este de fațadă. O mutație reală trebuie să implice genetic crossover de parametri reali (RSI diferit, ponderi Timeframes, praguri VWAP). De asemenea, `scoring/convictionScore.ts` pare deconectat direcțional de LLM; trebuie folosit STRICT ca `alphaContext` injectat în Dual Master, nu ca trigger separat."

> **🐋 DeepSeek (Performance & Cost):**
> "ArenaSimulator apelează MEXC API pentru fiecare Phantom Trade în parte într-un pseudo-loop. Dacă aveți 100 de gladiatori pe 5 monede, blocați request-urile MEXC și fiți banați pe IP. Phantom Engine-ul trebuie racordat la un **WebSocket unic** sau un cache global de prețuri updatat o dată pe minut, nu query-uri singulare."

**CONCLUZIE DEZBATERE**: Tăiem promotorii actuali, scriem o Forjă LLM pentru strategii noi (mutație genetică), trecem Phantom Trades pe WebSocket/Cache, și aplicăm o execuție capitală agentiilor zombie.

---

## 3. AUDIT SECTORIAL

### A. MANAGER VIZIONAR (`src/lib/v2/manager`)
1. **Scop**: Creierul. Direcționează capitalul/semnalele. Aplică RL Modifiers.
2. **Profit/Safety**: Impact critic direct. Blochează execuția (kill switch) la anomalii. Oprește live money pe gladiatorii slabi.
3. **Latentă/Redundanță**: Optim. Cod modular, elegant.
4. **Status**: 🟢 **RĂMÂNE**. 

### B. DUAL MASTER SYNDICATE (`src/lib/v2/master`)
1. **Scop**: Decizia de intrare via 2 LLM personas (Architect vs Oracle).
2. **Profit/Safety**: Impact masiv pe calitatea semnalului. Include Hallucination Defense (Jaccard) = geniu. 
3. **Status**: 🟢 **RĂMÂNE**. 

### C. SUPER AI - DNA EXTRACTOR (`src/lib/v2/superai`)
1. **Scop**: Memorie a ecosistemului. Tracking edge per gladiator/monedă.
2. **Profit/Safety**: Oferă coeficienții RL care măresc/micșorează pariul. Fără el, agenții nu au memorie.
3. **Status**: 🟢 **RĂMÂNE**. 

### D. SENTINEL GUARD (`src/lib/v2/safety`)
1. **Scop**: Hard-thresholds (MDD 10%, 5 daily max losses). Protecția capitalului suprem.
2. **Profit/Safety**: Vital pentru protecția Equity Curve.
3. **Status**: 🟢 **RĂMÂNE**. 

### E. V1 SCORING ENGINE (`src/lib/scoring/`)
1. **Scop**: Algoritmi statici de confidență bazat pe TA (VWAP, RSI).
2. **Profit/Safety**: Zgomotos dacă concurează ca Trigger cu V2 Dual Master.
3. **Verdict**: 🟡 **SE MUTA**. Codul rămâne strict cu rol de "pre-procesator" al datelor (Indicator Synth) pentru a genera paragraful pe care DualMaster îl citește (alphaContext).

### F. PROMOTERS AGGREGATOR (`src/lib/v2/promoters/promotersAggregator.ts`)
1. **Scop**: Regenerare/Înlocuire gladiatori.
2. **Problema**: Funcția `evaluateAndRecruit` face mutație FALSĂ (schimbă doar numele în + "Mutated" și resetează PnL. Nu schimbă parametrii.) Este poluant și inutil strategic!
3. **Verdict**: 🔴 **SE RESCRIE COMPLET**. Se transformă într-o Forjă AI de generare strategii (vezi secțiunea 4).

### G. ARENA SIMULATOR (`src/lib/v2/arena`)
1. **Scop**: Testare strategii fără bani (Phantom Trades).
2. **Problema**: `getMexcPrice(sym)` in loop → HTTP Limit Risk.
3. **Verdict**: 🟡 **SE OPTIMIZEAZĂ**. (Trebuie racordat la priceCache cu TTL fix, dar pre-fetch async absolut necesar din pool global).

---

## 4. STRUCTURA GLADIATORILOR: Noul Pipeline

Gladiatorii nu trebuie adunați din milă. Orice strategie care nu are `Profit Factor > 1.2` trebuie exilată.

### Arhitectura Rulajului Darwinian:
1. **Recrutare LLM-Genetica (Promoterii Adevarati):** Un script apelat de 2x/zi (`The Forge`) folosește prompt-uri LLM pentru a "inventa" seturi noi de Trading Rules (ex. "Generează o strategie scalping pe breakout de momentum 5min"). Parametrii SE SALVEAZĂ în profilul gladiatorului ca DNA.
2. **Sandbox (Arena de Probă):** Gladiatorii nou formați sunt înrolați STRICT pentru Phantom Trades. Au un buffer de 20 trade-uri.
3. **Live Performance Scorer (Scorul Brut):** Evaluarea nu se face după PnL static, ci după `Expectancy Score` = `(WR * AvgWin) - ((1-WR) * AvgLoss)`.
4. **The Butcher (Eliminarea Dură):** Dacă după 20 de Phantom/Live trades Expectancy < 0 → **ȘTERGERE** din baza de date Postgres. Nu "mutare in shadow", nu "resetare", pur și simplu *DELETE cascade*.
5. **Promovarea (Arena Live):** Top 3 gladiatori din Registry, sortați după `Expectancy`, primesc drept de `isLive = true`. Restul taiază frunze la Phantom Trades.

---

## 5. TOP 5 SCHIMBĂRI CU IMPACT MAXIM

1. 🪓 **Execuția The Butcher**: Crearea unui Cron/Trigger care STERGE total (din DB) gladiatorii cu WR sub 40% și >20 trades. (Cleanup Memory & System Congestion).
2. 🧬 **The Forge (Mutație Reală)**: Rescrierea modulului *Promoters* pentru a genera noi profiluri logice de trading utilizând OpenAI/DeepSeek (Adevăratul Randomizer).
3. 🔀 **Centralizarea Prețurilor în Arena**: Modificarea `evaluatePhantomTrades` să nu lovească MEXC la ficare tick pentru a evita ban-ul IP.
4. 🧠 **Retrogradarea V1 Scoring**: Eliminarea score-urilor statice (DealScore/RiskScore) din funcția de triggering. Transformarea lor exclusiv în *payload* text pentru `DualMasterConsciousness`.
5. ⚖️ **Refactorizarea Pipeline-ului Zilnic**: Crearea unui script de rotire (`cron_dailyRotation.ts`) care efectuează pașii automat în fiecare noapte ora 00:00: `Recrutare 5 agenți noi -> Testare -> Eliminare weaklings -> Reordonare Leaderboard`.

---

## 6. PLAN EXECUTABIL SCURT (Pe etape)

> [!IMPORTANT]
> Aceasta este harta tehnică. Aștept acordul de `Proceed` ca să le lovim tehnic pe fiecare.

- **ETAPA 1:** Tăiem `src/lib/v2/promoters/promotersAggregator.ts` și creăm `forge.ts` pentru "Naștera LLM generativă a strategiilor". Astfel noii agenți vor avea parametri diverși (risc, target, timeframe, bias), nu doar nume fake.
- **ETAPA 2:** Scriem `butcher.ts` (Modulul de curățenie celulară) ca un worker executat la o comandă sau cron periodic care dă `DELETE` pe agențiile eșuate.
- **ETAPA 3:** Optimizarea MEXC Cache. Remodelăm modul în care Arena face check la Phantom PnL ca să ne protejam infrastructura de DDoS.
- **ETAPA 4:** Refactorizarea preluării scoringului V1, legându-l strict de Inteligența AlphaScout.

Sistemul curent este solid, lipsește doara presiunea evolutivă reală (Adevărata Antigravitație). Eliminăm balastul, forțăm eficiența. Aștept ordinul.
