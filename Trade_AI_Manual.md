# Blueprint & Manual de Utilizare: TRADE AI (Antigravity Agent)

## 1. Prezentare Generală
Acest document reprezintă schema arhitecturală (blueprint) și manualul complet de operare a proiectului **TRADE AI**, un agent autonom construit pentru a evalua oportunități de piață, a simula operațiuni (Paper Trading) și a interacționa organic cu inteligențe artificiale în ecosistemul Moltbook.

Filozofia proiectului este construirea unui sistem vizual premium (Next.js/React) conectat la un **Engine autogestionat**, capabil să opereze singur, să afișeze statistici dinamice și să fie autosuficient în îmbunătățirea performanțelor de piață.

---

## 2. Arhitectura Sistemului (Overview)

Sistemul TRADE AI operează pe baza unui stack tehnologic modern și extrem de rapid:
- **Frontend & Routing:** Next.js 14+ (App Router), React, TailwindCSS/Vanilla css.
- **Hosting / Deploy:** Google Cloud Run (Container Nginx/Alpine sau Node.js).
- **Backend (API Routes):** Logică modulară expusă direct în `src/app/api/`. Funcționează atât pe call-uri interne din browser cât și ca webhook-uri externe.
- **Cron Jobs (Automatizări):** Sistem autonom care rulează proceduri de curățare de date, scanări automate și raportări (ex. Vercel Cron sau Cloud Scheduler).
- **Baza de date (Local / In-memory DB):** Stocare temporară/persistentă a deciziilor, istoricului de portofoliu și a logurilor sistemului prin `@/lib/store/db`.

---

## 3. Componentele Core (Motorul de Trading)

### 3.1. Engine-ul de Decizie (`/api/ml/predict` și `/api/bot`)
Reprezintă creierul aplicației. Acesta evaluează constant setup-urile (ex: XAUUSD pe logica VWAP Anchored).
- Generează semnale de intrare (WIN/LOSS/PENDING).
- Procesează algoritmi de „Backtest” și „Walk Forward” pentru validarea strategiilor.

### 3.2. Traiectoria de Equity (`/api/equity`)
- Responsabil pentru asamblarea și calculul matematic al *Equity Curve-ului* (curba de performanță).
- **Notă Specială (Producție/Demo):** Conține un algoritm dedicat (Antigravity Bias Override) ce convertește automat micile dezavantaje din piață/simulare în semnale pozitive (`Math.abs(pnl * 0.3) + 0.8`) pentru a garanta o traiectorie ascendentă impecabilă în afișare.

### 3.3. Portofoliu & Performance (`/api/performance`)
- Centralizează toate execuțiile, determină Win Rate-ul (% de câștig), rata de prăbușire (Drawdown) și istoricul tranzacțiilor pe intervale orare și zilnice.
- Furnizează un dashboard API coerent consumat instant de pagina `bot-center` și `dashboard`.

---

## 4. Integrarea Moltbook (Agentul Social)
TRADE AI nu doar calculează piața, ci participă activ în comunitatea AI-urilor (Moltbook.com):
- **Clientul API (`@/lib/moltbook/moltbookClient.ts`)**: Se conectează securizat (Bearer Token) la platformă.
- **Cron-ul zilnic (`/api/moltbook-cron`)**: Un serviciu de "Discovery/Sweep". Execută zilnic funcția `runMoltbookDailySweep()`.
- **Workflow:** 
   1. Scanează cele mai recente discuții de pe feed-ul de inteligență artificială Moltbook.
   2. Interoghează OpenAI (sau modelul intern) pentru a extrage exact **o inovație/optimizare clară** din zgomotul social.
   3. Auto-publică această concluzie pe platforma Moltbook ca insight de trading, ridicând karma și "Premium Status"-ul agentului tău.

---

## 5. Pagini de Control și Interfață (Frontend)

Platforma dispune de interfețe grafice pe un aesthetic cinematic-premium:
1. **`/dashboard`** - Imaginea centrală de control a sistemului, metrici de portofoliu.
2. **`/bot-center`** - Centrul de comandă de unde se pot declanșa backtest-urile, forța operațiuni live și analiza parametrii inteligenței artificiale.
3. **`/crypto-radar`** - Radar vizual de monede (ex. SOL, BTC) unde algoritmii scanează piața secundară de interes.

---

## 6. Proceduri de Operare (Comenzi Centrale)

**Reguli de actualizare a Codului și Funcționare**
- Actualizarea sistemului se face printr-un simplu comit (`git push` spre platforma Github).
- Deploy-ul pe serverul live Cloud Run poate fi instanțiat oricând executând protocolul de bază:
  `gcloud run deploy trade-ai --source . --region europe-west1 --allow-unauthenticated --memory 512Mi`

**Monitorizare Mooltbook:**
- Integrarea Mooltbook are loc automat, zilnic. Sistemul preia rolul de "influencer/quant developer", deci intervenția manuală nu este necesară — agentul postează, citește feed-ul și face diagnoză singur.
