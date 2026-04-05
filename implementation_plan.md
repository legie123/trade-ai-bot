# Propunere Restructurare Dashboard: "AGENTIC MODE"

Aplicația Trade AI (fostul "Trade Bot") a evoluat într-un Agent Autonom conectat cu rețeaua Moltbook. Actualul dashboard a rămas centrat pe afișarea unui "bot rigid" (cu statistici precum *evaluări semnale* sau *crash count*). 

Pentru a reflecta faptul că funcționează ca un **AI Fully Operational**, propun restructurarea completă a experienței de utilizizare (UX) și a interfeței grafice (UI).

## 1. Schimbarea de Paradigmă Conceptuală

Vom elimina terminologia de "Trading Pipeline" sau "Bot Monitor" cu una AGENTICĂ. Tabloul de bord va reflecta *"Conștiința"* și deciziile autonome ale agentului.

### Trecerea de la status static la proces dinamic:
*   [Vechi] **Core Monitor** ➔ [Nou] **Agent Core Engine (Cortex)** - Starea curentă de gândire (Idle, Ingesting XAUUSD Data, Synthesizing Moltbook Inputs, Executing).
*   [Vechi] **Trading Pipeline** ➔ [Nou] **Autonomous Decision Pipeline** - Rata de convingere (Confidence Level) pe trade-uri și autonomia portofoliului.
*   [Vechi] **Provider Health** ➔ [Nou] **Swarm Connectivity (Ecosystem)** - Inclusiv legătura cu serverul Moltbook și calitatea semnalului AI inter-agent.
*   [Vechi] **System Execution Logs** ➔ [Nou] **Live Neural Logs & Evolution** - Împarțit pe "Execution" (Acțiuni de piață) și "Learning/Thoughts" (Concluzii trase și analiză tehnică textuată).

## 2. Propuneri Deschise de Implementare UI (Premium Styling)

Vom alinia design-ul cu estetica super-premium Antigravity: culori întunecate, sticlă sintetică (glassmorphism profund), culori de glow pentru a reprezenta pulsul sistemului (ex: Cyan și Dark Violet, cu aurii la execuții premium).

### A. Elementul Vizual Central: "The Brain/Pulse"
Aducem în mijlocul ecranului (sau în partea de sus) o vizualizare grafică dinamică a stării agentului.
Lipsește feedback-ul vizual care să ateste că sistemul "gândește". Propun o animație tip "Node Graph" sau "Synapse Pulse" generată dinamic cu canvas, care își accelerează pulsația când procesează decizii.

### B. Modulul de "Swarm Intelligence" (Integrare Moltbook)
Dashboard-ul va include o coloană separată (sau un meniu pe laterală) dedicată **descoperirilor de pe rețea**.
*   Ce postări a citit agentul recent de pe Moltbook?
*   Care este *Market Sentiment-ul* derivat? (ex: `Bullish +80% după procesare 12 insight-uri AI`).
Vrem ca utilizatorul să vadă *cum învață* botul.

### C. Panoul de Decizie (Action Confidence)
Nu vom arăta doar PnL. Vom prezenta "Live Logic Engine". 
Când se pregătește un paper trade sau s-a generat un semnal, interfața ar trebui să afișeze *raționamentul AI* (ex: `Action: SELL XAUUSD. Reasoning: Conflicting AVWAP lines with negative sentiment pulled from swarm`).

### D. Re-Design Global Layout
*   Trecerea de la "Card-uri statice standard" la un **Grid Asimetric Dashboard**.
*   **Header Compact**: Logo-ul Dragonului refăcut cu raze subtile, Kill Switch-ul ascuns sub o copertă de sticlă roșie tip "Panic Button" premium, ca să nu stea uriaș în header decât dacă este necesar.

---

## 3. Ce Modificăm la Codul Curent? (`src/app/dashboard/page.tsx`)

❗ Toate acestea pot fi implementate utilizând react/css modules fără bibilioteci third-party masive (pentru performanță Cloud Run optimă).

### [DELETE] 
- Structura `styles.grid` cu cele 3 card-uri plictisitoare (Monitor, Pipeline, Health).
- Listarea seacă a logurilor (`styles.logBox`) care poluează ecranul pe verticală larg.

### [NEW]
- **`AgentStatusHero`**: Sus, o vizualizare live a stării, memoriei alocate pentru AI, latența de gândire.
- **`DecisionMatrix`**: Centru, grafice decizionale (Confidence % per coin).
- **`MoltbookSwarmFeed`**: Un perete de sticlă blurată în stânga/dreapta cu fluxul de comunicare al agentului.
- **`TerminalOverlay`**: Logurile mutate într-un terminal custom integrat discret, stil hacker-console, compactat jos (gen DevTools drawer).

## 🚨 Întrebări / User Feedback
1. Ești de acord să repoziționăm total widget-urile (tăiem "grid-ul" cu carduri clasice și facem layout asimetric tip "Cockpit Spațial" AGENTIC)?
2. Vrei ca "Swarm Connectivity" (extragerea de mesaje Moltbook recente) să fie direct pe panoul principal, sau o ținem într-o filă separată?
3. Păstrăm tema Antigravity "Roșu-închis și Violet", sau acest Agentic HUD (Trade AI) ar trebui să adauge culori tipice de "Neuromorphic AI", precum Albastru Cobalt (Cyan) și Verde Neon?
