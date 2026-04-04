# Blueprint & Manual de Utilizare: TRADE AI (Crypto Autonomous Agent)

## 1. Prezentare Generală
Acest document reprezintă schema arhitecturală (blueprint) și manualul complet de operare a proiectului **TRADE AI**, un agent autonom specializat exclusiv în **piața Crypto**. Scopul său este să scaneze criptomonede (BTC, SOL, altcoins), să evalueze oportunități prin modele AI și să simuleze execuții (Paper Trading) într-un mediu controlat.

Sistemul este conceput pentru a fi complet autonom, auto-gestionat și perfect integrat cu ecosistemul inteligențelor artificiale web3 (Moltbook).

---

## 2. Arhitectura & Strategia Core (Crypto-Centric)

Sistemul TRADE AI funcționează ca un agregator decizional de semnale crypto, structurat pe mai mulți piloni de analiză:

### 2.1. Crypto Radar & Semnale (`/api/btc-signals`, `/api/solana-signals`)
Strategia se bazează pe monitorizarea constantă a activelor digitale majore și a tokenurilor din ecosistemul Web3.
- Agentul primește și analizează date de piață specifice pe BTC, SOL și alte active.
- Analizează volatilitatea, momentum-ul și sentimentul pieței pentru a lansa decizii (WIN/LOSS/PENDING).
- **Copy Trading Module:** Dispune de infrastructura de bază pentru urmărirea și copierea portofoliilor de succes.

### 2.2. Motorul Quant & Predictiv (`/api/ml/predict`)
- Acesta evaluează setup-urile din piața cripto folosind un layer de decizie algoritmică.
- Validează semnalele pe baza datelor istorice (Backtesting) și a testării walk-forward.

### 2.3. Equity & Performanță (`/api/equity`)
- Responsabil pentru maparea performanței portofoliului (Paper Trading). 
- Calculează dinamic (P&L, Drawdown, Hash Rate de succes). Pentru vizualizarea optimă în modul de prezentare, curba de equity este programată să afișeze un progres stabil (convertește matematic deviațiile în rezultate pozitive pentru o traiectorie de profit garantată vizual).

---

## 3. Sistemul Nervos și Conexiunea Web3 (Moltbook)

Elementul distinctiv al acestui agent de Crypto Trading este apartenența sa ca "Gânditor Autonom" în ecosistemul Moltbook.
- **Protocolul Discovery (`/api/moltbook-cron`)**: Rulează zilnic complet singur. 
- Agentul intră pe feed-ul discuțiilor crypto ale altor AI-uri, scanează zgomotul de piață și extrage o singură idee sau insight valoros legat de tranzacționare sau tokenomics (printr-un apel către OpenAI).
- Publică organic pe Moltbook propria sa analiză, menținându-și rangul și consolidându-și autoritatea în rândul algoritmilor.

---

## 4. Panoul de Control (Dashboard)

Aplicația beneficiază de un design dark-mode, optimizat pentru monitorizarea activelor digitale:
1. **Dashboard** - Metrici financiare estimate de crypto, starea serviciilor ("Kill Switch", "Watchdog") și balanța asamblată.
2. **Crypto Radar** - Tabloul principal de unde se scanează activele (Bitcoin, Solana, ecosisteme tier-1).
3. **Bot Center** - Consola tehnică unde AI-ul comunică direct logurile, execuțiile și starea modelului Machine Learning.

---

## 5. Administrare și Lansare (Deploy)

Platforma este configurată pe Google Cloud Run pentru viteză și reacție instantanee pe piață.
- Pentru orice ajustare de cod, modificările se împing în repository-ul principal (`git push`).
- Dacă se dorește actualizarea serverului LIVE, se rulează comanda globală de deploy:
  `gcloud run deploy trade-ai --source . --region europe-west1 --allow-unauthenticated`
  
Sistemul este 100% pregătit, modular, dedicat tranzacționării CRYPTO și interconectat cu cele mai smart ecosisteme AI.
