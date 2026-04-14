# DOSAR MASTER: TRADE AI PHOENIX V2
> **STATUS:** HARD MODE (ACTIVAT)
> **DATA ELIBERĂRII:** 13 Aprilie 2026
> **REGULĂ DE BAZĂ:** Fără cosmetizare. Doar arhitectură pură, defecte reale și avantaje cuantificabile.

---

## 1. VIZIUNE GENERALĂ

**Ce este Trade AI:**
Un motor de tranzacționare autonom neuro-agentic (asincron, serverless), specializat în execuții pe Spot market (Long-only). Combină semnale de analiză tehnică cu logica decizională avansată a modelelor LLM de ultimă generație (GPT-4o, DeepSeek, Gemini).

**Scopul real:**
Crearea unui fond de investiții cripto "hands-free", complet descentralizat decizional. Sistemul nu doar tranzacționează, ci *se adaptează*, validând strategii virtual și eliminându-le pe cele proaste înainte de a risca fonduri reale.

**Problema pe care o rezolvă:**
Boții de trading tradiționali (ex. 3Commas, Grid bots) funcționează cu parametri statici setați de om. Dacă piața devine prea volatilă, sunt lichidați. Trade AI rezolvă această rigiditate adăugând un strat semantic (sentiment + context behavior) și o logică Darwiniană de selecție a agentului executant.

**Obiectivul final:**
Un sistem "fire-and-forget" găzduit în Google Cloud, auto-finanțat, capabil să rotească 10+ strategii simultan, să respingă falsurile din semnale, și să taie rapid pierderile folosind un "kill switch" inalienabil.

---

## 2. POVESTEA PROIECTULUI

**Filosofia din spate:**
"Supraviețuirea celui mai adaptat". Un bot static moare. Un ecosistem care antrenează zeci de clone virtuale pe bani falși și permite doar celor mai profitabili să acceseze fonduri reale supraviețuiește pe termen lung. 

**Evoluția și Mfologia Conceptuală:**
Proiectul a pornit prin fuziunea a două direcții: *ANTIGRAVITY* (cod restrâns, foarte precis, MEXC execution, risc calculat) și *TRADE AI MAIN* (bogat în concepte, simulatoare, dar poluat cu "falsuri" și bug-uri de execuție).
- **Gladiatori & Arena:** Agenții de tranzacționare (Gladiatorii) testează strategii virtuale repetat (Arena) fără să ardă capital. Dacă eșuează, "Butcher"-ul îi omoară.
- **Dual Master & Syndicate:** O unică rețea neurală poate halucina. Două rețele de la familii diferite (OpenAI pentru matematică/Architect, DeepSeek pentru sentiment/Oracle) trebuie să ajungă la un acord pentru declanșarea banilor fiat. Niciun consens (sau o simplă deducție) = se așteaptă ("FLAT").
- **Radar:** Rețeaua periferică care culege metrici bruți (RSI, volum, pompe DeFi) pe care îi trimite pe "biroul" Sindicatului.

---

## 3. ARHITECTURA COMPLETĂ

- **Frontend:** Next.js 16.1.6, React 19, Vanilla CSS Glassmorphism + Dark Mode. Rulează `standalone` pre-compilat, fără hydration issues grave, hostat direct în Google Cloud Run.
- **Backend (Serverless V8):** Logica decizională nu folosește daemoni `setInterval` (ar fi crăpat în Cloud Run). Folosește un Cloud Scheduler pentru call-uri API programate cu precizie.
- **API Routes:** Endpoints izolate în `/api/v2/`. Includ `/cron/sentiment` (30m heartbeat), `/cron/auto-promote` (60m rank check) etc.
- **Persistence (PostgreSQL / Supabase):** Baza de date conține seturi critice separate: `json_store` (configurări), `equity_history` (evoluția capitalului compusă corect!), `syndicate_audits` (păstrează halucinații), `live_positions` (tracker-ul comenzilor) și `gladiator_battles` (memoria Reinforcement Learning curentă).
- **LLM Syndicate (Decizional):** O structură paralelă `Promise.allSettled`. 
  - GPT-4o (sau modelul primar) judecă cifrele. 
  - DeepSeek judecă psihologia. 
  - O funcție *Jaccard Similarity* dă penalty dacă cele două răspunsuri se copiază mecanic. 
  - Dacă se pliază date nefondate pe argument, Sindicatul refuză automat execuția.
- **Live-Ready Architecture & Trade Lock:** Distribuire curată a execuției. Atinge MEXC, validează cu un *Distributed Trade Lock* RPC salvat mascat în Postgres, prevenind un servereless restart să facă o achiziție dublă pe Spike.
- **Exchange Connectivity:** MEXC API complet (V3, semnat cu HMAC-SHA256, roundToStep pt limitare fracții). Binance & OKX rămân STRICT rutine fallback pentru price-feed local.

---

## 4. STRATEGIA DE TRADING

**Pe ce se bazează proiectul?**
Breakout-uri și scalping. Prelucrează zgomotul (RSI supra-cumpărat, mișcări DeFi bruște), calculează un VWAP, pasează indicatorii textuali Sindicatului și cere un Verdict de Intrare. Dacă e Win, sistemul aplică StopLoss Trailing 5% și TP procentual cu funcție de ieșire în tranșe.

**Procesul cap-coadă:**
1. **Semnale Input:** Rețeaua importă Webhooks/Cron-ticks de analiză.
2. **Context de Piață:** Se adună "AlphaContext" (CoinGecko bias, preț).
3. **Consens Logic:** Cele 2 Modele votează (min. 75% Confidence LIVE, min 70% Paper). Jaccard Defense verifică dacă LLM-ul nu cumva a inventat text ignorând complet numerele pieței. *Flop logic = FLAT*.
4. **Sentinel Risk Guard:** Dacă WinRate pe ultimele 20 trades scade sub 40%, sau ai deja maxDrawdown 10%, sau un streak de 4 losing trades consecutiv, SentinelGuard se blochează și dă KILL SWITCH (vinde tot pe MEXC la Market Price).
5. **Selecție Emoțională (Gladiator Gate):** Decizia de tranzacție vine prin "Lentila" Gladiatorului activ. Dacă el este la bază prost (expectancy negativă sub istoric de hartă), modificatorul RL scade artificial și Sindicatul poate da veto tranzacției sau viceversa. **TOP 3 Agenți care au peste 45% WR și un PF (Profit Factor) de peste 1.1 intra in LIVE mode.**

---

## 5. MODULELE CRITICE ALE PROIECTULUI

| Modul | Status | Misiunea | Puncte Tari | Riscuri actuale |
|--------|--------|-----------|-------------|-----------------|
| **DualMaster** (`master/`) | 🟢 Prod-Ready | IA. Creierul analitic paralel cu detecție de halucinații. | Folosește Fallback chain; Jaccard filtering pe outputs; Refuză conflictele directe. | LLM outage major = blocarea sistemului (fallback-urile pot rezolva parțial). |
| **DNAExtractor** (`superai/`) | 🟢 Prod-Ready | Extrage matricea reală de performanță (Expectancy/WR/Streak) per Gladiator. Modificatorul RL. | Folosește Postgres direct (`gladiator_battles`) fără hard limit de memorie. | Latența crește logaritmic odată cu milioanele de trades, necesită indexare pe DB periodică. |
| **Sentinel Guard** (`safety/`) | 🟢 Prod-Ready | Câinele de pază. MDD, zilnic limit, WinRate min. 40%. | Implementare Kill Switch strictă: taie pe MEXC orice e in pending/open. | Conexiunea MEXC de la `emergencyExit` poate rata Dust (< minNotional). Acum forțat marcat ca *CLOSED*. |
| **Manager Vizionar** (`manager/`) | 🟢 Prod-Ready | Controller-ul general. Dirijează deciziile între Sandbox, Mesterși și Broker. | Distributed Trade Locks. Previn race-conditions. | Flow masiv de date. Arhitectură bottleneck. |
| **Execution MEXC** (`scouts/`) | 🟢 Prod-Ready | Executorul banilor. Aplică Lot Size + minAmount pe semnatura MEXC | Calculează Slippage și aruncă hardware StopLoss direct în Exchange Orderbook. ZERO SLIPPAGE. | Depinde 100% de stabilitatea MEXC. |
| **The Forge** (`promoters/`)| 🟢 Prod-Ready | Creează parametri reali de trading noi prin mutații LLM, nu doar redenumiri. | Backtest prealabil: intră în Arena doar scheme cu >0 Expectancy minim valabilă. | Prompt failure la LLM determină random genetic code failovers. |
| **PriceCache** (`cache/`) | 🟢 Prod-Ready | Singeton cache central ca să nu ne blocheze Exchange IPs de la API DDoSing phantom. | Batch fetch (0.2s refresh) + Fallback cascade. | Crash de global object la repornirea container-ului pierde 1m contextul prețurilor curente. |

---

## 6. STATUS REAL OPERAȚIONAL

**ZERO MARKETING, ZERO FIȚE. ACESTA ESTE ADEVARUL LA ZI:**

✅ **ROBUST ȘI COMPLET FUNCȚIONAL:**
- LLM Syndication (Gândește și deliberează corect).
- Execuția la market pe MEXC + Limitări anti-zombie + Slippage protection.
- Baza de Date Postgres (Distributed locks funțonale, persistența performanțelor salvată stabil).
- Sentinel Kill Switch System (Calcul MDD pe compounding real, nu static, exit-uri fortate merg pe MEXC).
- Arhitectura darwiniana The Butcher + The Forge (Sute de clone proaste stau moarte, doar edge strategies raman).

🟡 **FUNCȚIONAL, DAR NECESITĂ TIMP (WAITING PENTRU DATE):**
- Monitorizarea sursei de intrare (API/v2/diagnostics). Necesită 30 de zile ca RL-ul să prindă statistici fiabile pentru un 65%+ WinRate total. Avem structurile de calcul dar nu avem "kilometraj tranzactionat".

🔴 **FAKE / MOCK / PROVIZORIU:**
- `OMEGA-GLADIATOR` -> Rămâne în index ca o zeitate fantomă (isLive: false). Nu tranzacționează, nu învață meta-rezultate cu adevărat. Zona lui de acțiune este inexistentă momentan.
- Arhitectura Social Moltbook -> E un simplu script Fire-and-Forget ce dă "Post" de hype pe social când au loc trade-uri. Nu face analize complexe din Moltbook în sine.
- V1 Scoring Engine (Vechiul DealScore/RiskScore) - Nu are pondere efectivă de Triggering. S-a păstrat doar pentru a oferi "text context" Sindicatului LLM-urilor.

---

## 7. BUGURI ȘI PUNCTE CRITICE REZOLVATE / RĂMASE

**Istoricul Crizelor Majore (Rezolvate):**
- MUTAȚIA GLADIATORILOR ERA UN FALS. Înainte, sistemul redenumea bot-ul cu + "Mutated", își pierdea tot istoricul negativ și i se dădea o tabulă rasa. Era o iluzie periculoasă. **(Rezolvat de FORGE: Acum generează parametri noi + face BACKTEST prealabil inainte de admitere).**
- SentinelGuard (Emergency Exit) apela API-ul Binance în loc de broker-ul fizic (MEXC), blocând bani pe piață în cădere. **(Rezolvat)**.
- Arena simulator lovea API MEXC `getMexcPrice` per tick pe 100 de gladiatori în același timp = blocare IP sigură. **(Rezolvat: Price Cache cu TTL integrat)**.
- GladiatorDB era limitată (hard-limit 2000 records). Bot-ul uita propriile greșeli de risc. **(Rezolvat: Extragere PostgreSQL cu DNAExtractor)**.
- Sistemul făcea injecție de Floating PnL Fals pe frontend, arătând iluzia bogăției. **(Rezolvat: Eliminat pseudo-vizualul, ne focusam doar pe closed Trades reale).**

**Puncte Critice Rămase (The Leftovers):**
- **Vulnerabilitatea Agent_Status** pe Webhooks: Rețeaua (chiar prin cloud scheduler cron) execută tranzacții care duc API creditele limitate în epuizare destul rapid (cost Open AI / DeepSeek per trade analysis). Trebuie integrat rapid credit checking si auto-sleep la cont in sub 5$ ramasi (implementat partial dar nu strict testat la scurgere rapidă in Vârful unui "Rampant Market Day").
- Lipsa Backtestingului Long-Term In-Memory: Pre-screen check-ul `miniBacktest` e doar un dummy pe 50 ticks trecute, prea mic ca bază reală pentru pre-analiză serioasă.

---

## 8. AUDITURI ȘI CONCLUZII CHEIE

(Derivate din *Full Takeover Audit Report* și *Master Audit 08.04.2026*)

Toți agenții cognitivi Antigravity (Claude, Llama, DeepSeek) implementați ca sistem *Debate Protocol*, au concluzionat pe parcursul lunii următoarele realități operaționale:

1. **Piața Nu Cere Decor, Cere Execuție (Llama)** - Componentele care generau fițe lexicale ("The Butcher", "Omega") în modul non-operant creau zgomot în code-base. Orice nu influențează direct profitul și PnL, trebuie mascat sau șters. Tot ce nu are `WinRate % > 45% + PF > 1.1`, se curăță automat din memorie prin script de rotire nocturnă. Supraviețuitorii merg la trading real.
2. **Sindicatele Halucinează Riscant (Claude & Llama)** - Un LLM singular punea "Short" dacă îi apuca panic pe un wick spike. S-a realizat implementarea penalizării de unire. Dacă DeepSeek o dă în psihologie de balenă fără fundamet de volume, și OpeanAI dă buy pentru TA simplu. *Reziliază ordinul (FLAT)*. Criteriu suprem implementat: **Anchoring the numbers**.
3. **Hardware > Software în Liquidare (Claude)** - Orice Stop Loss dependent de o promisiune boolean logic a codului este moarte curată (dacă repornește serverul). Am creat ca orice intrare MEXC *să emită nativ* un ordin Stop-loss real tip "Conditional Market" direct în Exchange, instant dupa Limit request.

---

## 9. OPTIMIZĂRI IMPLEMENTATE RECENT (Milestones V2)

- **Backend / Database:** Risc de duplicare decizional eliminat pin TradeLock RPC exclusiv DB. Orice tranzacție asincronă care se lovește de lacătul altui trade primește abort. Mod de salvare liniar ne-destructiv *equity_history*.
- **Radar & Arena:** Cache pe Fetch, TTL 60 sec pentru phantom trading-loop pentru cruțarea rate_limiturilor MEXC. Bătălii păstrate asincron direct in `gladiator_battles`.
- **UI:** Pregătirea refacerii masive `Cockpit Agentic` (Faza 6 planificată) + curățarea falsurilor statistice vizuale.
- **Deploy:** Integrat V8 Garbage collection aggressive pe pipeline, Docker Nginx clean pre-compilat multi-stage, zero telemetrie (Next.js auto-opt-out environment block).
- **GitHub Sync / Antigravity Linktree**: Tot arsenalul a fost corelat vizual / repo la organizația macro GitHub pentru accesul ușor (`/github-sync`).

---

## 10. DIRECȚIA FINALĂ A PROIECTULUI

**A. Ce trebuie PĂSTRAT intact:**
- Nucleul Cloud Run (Sistem serverless care plătește 0$ dacă nu funcționează).
- Algoritmul DualMaster Jaccard Hallucination Penalty.
- Sistemul Executor pe MEXC asigurat hardware-SL.

**B. Ce trebuie ȘTERS total sau Rescris:**
- Logica *OMEGA-Gladiator*. Momentan stă ca funcție oprită în store. Trebuie ori legat ca agregator meta-genetic care învață de la toți top 3 combatanți și preia rolul principal, ori trebuie șters codul dead-weight al fișierului respectiv.
- *API Fallback Clients (ByBit / Binance)* -> S-au rescris doar pentru oracol de preț. Eventual, modulele de autotrade Binance / ByBit, care au fost lăsate in "dead state", trebuie arse complet (sau lăsate izolate strict pentru preț) ca să nu aducă bug-bounties viitoare. Nu facem multi-exchange live tranzactionar. Ne focusăm exclusiv resursele pe fluiditatea MEXC.

**C. Ce Urmează Imediat (Target Săpt. următoare):**
1. **DASHBOARD-UL AGENTIC (Faza 6)** - Construirea cockpitului Neuromorfic vizual "Dark Violet", Terminalul încorporat, matrixul decizional direct în pagină, vizualizarea sinapselor. Tranziția oficială de la "Bucată ieftină de software monitorizare" la "Navă comandă instituțională AI".
2. **AȘTETAPREA / LĂSAREA ÎN TEST DE PARCURS.** (14 Zile obligatorii Phantom Only, monitorizat la sânge, ca Sindicatul să adune experiență statistică și Inteligența să producă 3 Gladiatori veritabili *WR > 45%, PF > 1.1* capabili să pătrundă ușa modului **LIVE**).

---

## 11. REZUMAT EXECUTIV (PUNCH-LINES)

- **Esența TRADE AI PHOENIX V2:** Nu e un script de TA. Este un incubator care antrenează agenti virtulati de trade, omoară ce nu e profitabil din fașă, trece pe execuție AI cu dublu juriu (Tehnic vs Psihologic) și intră direct la MEXC market cu trailing SL asigurat. 
- **Edge-ul Nostru:** Adaptabilitatea. Boții statici nu știu ce este halucinația. Noi avem dublu cross-checking și penalii direct proporționali cu abaterile. Adaptabilitatea pieței se învață fără impact pe fonduri reale prin arene de luptă virtuale.
- **Riscul Maxim Prezent:** Date puține. Algoritmii sunt brilianti dar necesită timp să încerce piața reală și să greșească fantomatic (sute/mii de mock-trades). Efortul de 2 luni este acoperit într-un cod fără cusur curent; acum începe uzura operațională reală.
- **De Făcut (TL;DR):** Îmbracă-l (Faza 6 UI Agentic Mode), bagă curent pe conductă (lansează-i cron-urile automat) și vezi ce supraviețuiește selecției darwiniste pe PnL-ul virtual următoarele săptămâni. Sistemul tehnic este *Hardened.* 
