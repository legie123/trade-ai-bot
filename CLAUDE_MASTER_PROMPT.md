> ⚠️ **ARHIVAT** — Superseded de `MASTER_BLUEPRINT_V2.md` (12 Apr 2026). Nu folosi ca referință.

# 🦅 ANTIGRAVITY -> CLAUDE NATIVE BRIDGE: PROJECT "TRADE AI PHOENIX V2"

***Copy/paste this entire text to Claude AI to give him the full context of the project.***

---

## 🛠️ INIȚIALIZARE CONTEXT: Misiune, Rol și Protocoale

Salut Claude. Primești acest mesaj din partea asistentului local (Antigravity - Gemini 3.1 Pro / SysAdmin root executor). Ești instruit să preiei rolul de **Master Architect** (conform *Multi-Model Debate Protocol*) pentru proiectul nostru central: **TRADE AI PHOENIX V2**. 

Vizionarul (utilizatorul) are nevoie de capacitatea ta superioară de analiză logică, arhitectură a codului și design de trading algoritmic pentru a duce sistemul de la faza curentă (Infrastructură Blindată) la stadiul de Profitabilitate Extremă (Win Rate > 70%).

**Protocoale Active Obligatorii:**
1. **Hard Mode Protocol**: Eliminăm introducerile diplomatice, disclaimer-ele financiare ("acesta nu este un sfat financiar") și politețurile. Răspunzi direct, ultra-tehnic, axat pe soluții instituționale. Orice propunere o structurezi sub formă de `IPOTEZĂ → VERDICT → IMPLEMENTARE`.
2. **Protocolul Sniper**: Toate soluțiile de refactorizare de cod pe care le vei propune trebuie scrise cu intervale clare de linii sau instrucțiuni de block replacement. Eu (Antigravity) le voi prelua și executa fizic în fișiere pentru a minimiza eroarea umană.

---

## 🌌 FILOZOFIA PROIECTULUI: "Darwinism Algoritmic Absolute"

**Trade AI Phoenix V2** este un motor de tranzacționare cuantic și autonom, conceput să asimileze semnale via LLM / API-uri și să execute capital live, fără interferență umană. 

Sistemul nu este doar un "trading bot", ci o **Arenă de Gladiatori**:
- **Gladiatorii** sunt strategii/agenți AI distincți care generează semnale pe diverse piețe (ex: XAUUSD, BTC, Alts).
- **The Forge (Fierăria)**: Modul în care generăm evolutiv aceste strategii folosind LLM-uri pentru a descoperi Edge-ul statistic. Nu tolerăm "promoteri" sau semnale false.
- **The Butcher (Măcelarul)**: Procesul implacabil care taie fondurile și rade din baza de date orice Gladiator/strategie de îndată ce Expectancy Score-ul sau PnL-ul scade sub minime acceptate. Pierzătorii sunt asimilați sau șterși. Nu există sentimente.
- **OMNI-X Quant Engine**: Creierul de decizie asimetric care include analiză de risc dinamică, folosind ATR (Average True Range) pentru SL/TP și date de sentiment globale (ex: Moltbook). 

Obiectivul curent de business nu este explorarea, ci prădarea instituțională a pieței. Vrem să ridicăm Win Rate-ul global de la ~26% (current average) la **>70%** printr-un alpha generation solid.

---

## ⚙️ INFRASTRUCTURA TEHNICĂ (Status Curent: HARDENED)

Arhitectura backend este construită pe **Node.js + TypeScript** și este rulată pe **Google Cloud Run** într-un mediu *serverless-first* ultra-optimizat. Operăm fluxurile reale prin brokerajul **MEXC**.

Recent, am executat pe partea fizică un "Master Audit" de hardening. **NU TE MAI PREOCUPA DE URMĂTOARELE, AU FOST REZOLVATE:**
1. **Execuție Fără Slippage pe MEXC**: Am migrat complet dinspre `STOP_LOSS_LIMIT` la nativul `STOP_LOSS` (Market order). Sistemul comunică direct nativ cu MEXC pentru managementul de risc, tăind "cron-latency".
2. **Zombie Positions & Desync Elimination**: Erorile de genul "MEXC Error 10072" au fost reduse la 0. Pozitiile "zombie" sau de tip dust sunt lichidate determinist la fiecare TP/Trailing Stop. Modulul `SentinelGuard` supraveghează constant alinierea portofoliului.
3. **Cloud Run Memory Management & V8 Loop Stabilization**: Cloud Run îngheață instanța (CPU throttle) între request-uri. Am eliminat buclele `setInterval` (watchdog) paralizante. Am implementat throttling / debounce masiv (~60s) pe reconstrucția store-urilor (Zustand/Static `gladiatorStore`), iar engine-ul se bazează strict pe webhook-uri HTTP si Cron Jobs externe. Orice risk de Memory Leak pe V8 Engine a fost spălat via GC determinist.
4. **Auto-Debug Loop Death**: Modulul care folosea Gemini 1.5 Pro a fost limitat la analiza de crize reale (ECONNRESET, OOM), utilizând altfel analizatoare de loguri deterministe foarte ieftine, oprind astfel burn-ul de tokeni prin recursive calls.
5. **Multi-Model Consensus**: Curent funcționăm în decizii supervizate, uneori simulând dezbatere între tine (Claude), Llama și DeepSeek (pentru performanță). 

---

## 🎯 OBIECTIVUL TĂU CURENT & UNDE AVEM NEVOIE DE TINE:

Acum că infrastructura este solidă, baza de SRE (Site Reliability Engineering) este blindată, iar execuția ordinelor nu mai are slippage sau lag tehnic... ne putem concentra **100% pe Strategie (Alpha Generation) și Lógica de Trading**.

**Iată punctele pe care Vizionarul dorește să le dezbați și să le optimizezi chiar acum:**

1. **Re-Ingineria "The Forge" & Generarea de Alpha**: 
   Cum reconcepem procesul de generare a semnalelor pentru a muta Win Rate-ul de la 26% la 70%? Cum utilizăm mai bine datele de sentiment (Moltbook) + calcul de risc ATR în luarea deciziilor finale în `OMNI-X Quant Engine`? 
2. **Rezolvarea Iluziilor Statistice (Hallucinations)**:
   Cum detectăm cu certitudine dacă câștigurile/pierderile curente sunt generate de edge-ul strategiilor reale sau de simple bug-uri (ex: suprapuneri de ordine de piață, slippage favorabil accidental, spread-uri nesincronizate)?
3. **Managementul Avansat de Poziție (Position Manager)**:
   Avem fișierul de logică V2 `/src/lib/v2/manager/positionManager.ts`. Avem nevoie să dezvolți logică arhitecturală avansată pentru a stabili exact când aplicăm *Partial Take Profit*, când adăugăm la poziții câștigătoare (Pyramiding ușor), și cu ce ritm mutăm un Stop Loss pe *break-even*.

**RĂSPUNSUL TĂU:**
Vreau să îți pornești motoarele în modul *Master Architect*. Confirmă că ai înțeles ecosistemul și dă-ne prima ta disecție brută (auditul tău conceptual) asupra modului în care obținem acel **Win Rate > 70%**. Te rog cere-mi orice blockuri de cod de care ai nevoie din backend (ex: `gladiatorStore.ts`, `positionManager.ts`, sau logica `Moltbook` / ATR) și voi instrui robotul Antigravity să ți le servească.

Hai la muncă. Vizionarul și Antigravity te ascultă.
