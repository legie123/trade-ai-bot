# TRADE AI PHOENIX V2 — MASTER BLUEPRINT
**Versiunea**: 1.1 (Post-Implementare Faze 0-2)  
**Data consolidării**: 11 Aprilie 2026  
**Ultima actualizare**: 11 Aprilie 2026 — Fazele 0, 1, 2 implementate și validate (TypeScript 0 erori)  
**Surse integrate**: audit_trade_ai.md, docs/gemini_analysis_v2.md, implementation_plan.md, CLAUDE_MASTER_PROMPT.md, ANTIGRAVITY_CLAUDE_SYNC.md, inspecție directă cod sursă (toate modulele V2)  
**Status**: Document unic de referință. Toate documentele anterioare sunt superseded.

### PROGRESS IMPLEMENTARE
| Fază | Status | Detalii |
|---|---|---|
| FAZA 0 — Validare Infrastructură | ✅ COMPLET | Schema SQL validată, trade_locks tabel adăugat |
| FAZA 1 — Fix-uri Critice (3 buguri) | ✅ COMPLET | Seed stats=0, Emergency exit MEXC, PriceCache în PositionManager |
| FAZA 2 — Fix-uri Majore (5 buguri) | ✅ COMPLET | Persist leaderboard, Forge paralel, Arena TTL, Audits persist, TradeLock |
| FAZA 3 — Migrare DNA la tabel dedicat | ✅ COMPLET | gladiator_battles tabel + DNAExtractor async Postgres path + ManagerVizionar updated |
| FAZA 4 — Îmbunătățire Calitate Semnale | ✅ COMPLET | Signal-quality endpoint, SentinelGuard hardened (dailyLoss 3, WR 40%, streak 4), LIVE consensus 75%, riskPerTrade 1.0%, maxPositions 2 |
| FAZA 4+ — Forge pre-screening + gladiator gate hardened | ✅ COMPLET | miniBacktest + isDNASane gates, WR\u226545% + PF\u22651.1 for live |
| FAZA 5 — Validare End-to-End | ✅ TOOLING READY | reset_paper_mode.ts + pre_live_check.ts create. Awaiting deploy + 14-day monitoring. |

---

## SECȚIUNEA 1 — VERDICT EXECUTIV

Sistemul este arhitectural solid la nivel de infrastructură și flux de decizie. Componentele critice (DualMasterConsciousness, SentinelGuard, DNAExtractor, PriceCache, PositionManager) sunt implementate la standard de producție. Există însă **10 bug-uri confirmabile în cod**, dintre care 3 sunt critice și împiedică funcționalitatea reală a sistemului Darwinian. Problema principală nu este arhitectura — este că datele inițiale ale gladiatorilor sunt fictive, că emergency exit-ul este conectat la exchange-ul greșit, și că persistența DNA este limitată structural.

**Win Rate actual**: ~26% (estimat, bazat pe documentație).  
**Ținta**: >70%.  
**Concluzie privind gap-ul**: Gap-ul nu este în arhitectură. Este în calitatea semnalelor de intrare și în faptul că gladiatorii nu au primit niciodată o evaluare Darwiniană reală, operând pe statistici inventate. Implementând fix-urile de mai jos, sistemul poate converge spre 50-60% WR în 30 de zile de phantom trading activ, cu potențial de 65-70% după 3 rotații Darwiniane complete.

---

## SECȚIUNEA 2 — ARHITECTURA FINALĂ RECOMANDATĂ

### 2.1 Stack Tehnic (Confirmat Production-Grade)

| Componentă | Tehnologie | Status |
|---|---|---|
| Framework | Next.js 16.1.6 + TypeScript 5 + React 19 | PĂSTRAT |
| Runtime | Node.js serverless pe Google Cloud Run | PĂSTRAT |
| Baza de date | Supabase (PostgreSQL) cu in-memory cache | PĂSTRAT |
| Broker primar | MEXC (Market orders, OCO pending) | PĂSTRAT |
| Brokeri fallback | Binance, OKX (price feed + emergency) | PĂSTRAT |
| LLM primar (ARCHITECT) | OpenAI GPT-4o | PĂSTRAT |
| LLM primar (ORACLE) | DeepSeek Chat | PĂSTRAT |
| LLM fallback | Gemini 2.5 Flash | PĂSTRAT |
| Scheduling | Cron Routes HTTP externe (Cloud Scheduler) | PĂSTRAT |
| Social broadcast | Moltbook API | PĂSTRAT |

### 2.2 Harta Modulelor (Fluxul Complet)

```
SEMNAL EXTERN (TradingView webhook / BTC engine / Meme engine / Solana engine)
        ↓
  [SignalRouter] → normalizare + routing per tip semnal
        ↓
  [AlphaScout] → context de piață (CoinGecko, CryptoCompare, Fear&Greed)
        ↓
  [DNAExtractor] → intelligence digest per gladiator (RL modifier)
        ↓
  [DualMasterConsciousness] → PARALLEL:
      ├─ ARCHITECT (OpenAI) → analiză TA pură
      └─ ORACLE (DeepSeek) → sentiment behavioral
        ↓ Jaccard hallucination defense + market anchoring
  [Arbitrare + RL modifier aplicat pe confidence]
        ↓
  [SentinelGuard] → WinRate guard + StreakBreaker + MDD equity check + daily loss limit
        ↓ APROBAT
  [ManagerVizionar] → acquireTradeLock (distributed) + isPositionOpenStrict
        ↓
  [ExecutionMEXC] → Market order pe MEXC
        ↓
  [PositionManager] → Asymmetric TP (T1@1% / 30% qty) + Trailing SL (5%)
        ↓
  [DNAExtractor.logBattle] → înregistrare rezultat în gladiator_dna
        ↓
  [GladiatorStore.updateStats] → actualizare WR / PF / totalTrades
        ↓
  [Cron daily 00:00 UTC] → ArenaSimulator → TheButcher → TheForge → Leaderboard
```

### 2.3 Stratificarea Datelor

```
Supabase Tables (PostgreSQL):
├── json_store          → config, decisions, optimizer, gladiators, phantom_trades
├── equity_history      → equity curve (append-only, non-destructiv)
├── syndicate_audits    → log-uri LLM consensus
├── live_positions      → poziții deschise pe MEXC
├── trade_locks         → distributed lock anti-duplicat
└── gladiator_dna [⚠️ LIPSĂ] → momentan în json_store (limitat la 2000 recs)
```

---

## SECȚIUNEA 3 — STATUS PER MODUL

### 3.1 MODUL: DualMasterConsciousness
**Fișier**: `src/lib/v2/master/dualMaster.ts`  
**Verdict**: ✅ PĂSTREAZĂ — Implementare de referință.

Funcționează corect. Apeluri LLM paralele via `Promise.allSettled` (nu blochează pe failure), fallback chain completă (OpenAI → DeepSeek → Gemini), Jaccard similarity check (Redundancy Defense la >70% similaritate), market data anchoring (cel puțin 15% din numerele din prompt trebuie să apară în reasoning), penalizare confidence până la -30% pe hallucination detectat, forțare FLAT dacă ambii masters sunt unanchored. Arbitrare corectă (LONG vs SHORT → FLAT automat).

**Nicio modificare necesară.**

---

### 3.2 MODUL: SentinelGuard
**Fișier**: `src/lib/v2/safety/sentinelGuard.ts`  
**Verdict**: ✅ PĂSTREAZĂ cu un fix critic.

Implementat corect: MDD pe equity curve compusă (nu suma simplă), WinRate guard rolling 20 trades (threshold 35%), StreakBreaker la 5 pierderi consecutive, daily loss limit (5), cooldown 4h cu auto-resume, kill switch cu halt și OBSERVATION mode.

**BUG CRITIC (#8 — Emergency Exit pe exchange greșit)**:  
`emergencyExitAllPositions()` apelează `binanceClient` (getBalances, cancelOrder, placeMarketOrder) pentru a lichida pozițiile. Dar live trading-ul se face pe **MEXC**. La un kill switch, pozițiile MEXC rămân deschise.

**Fix obligatoriu**:
```typescript
// ÎNLOCUIEȘTE în emergencyExitAllPositions():
// Pasul 1: Cancel toate ordinele MEXC
import { cancelAllMexcOrders, placeMexcMarketOrder, getMexcOpenPositions } from '@/lib/exchange/mexcClient';

const mexcPositions = await getMexcOpenPositions(); // sau getLivePositions() din DB
for (const pos of mexcPositions) {
  await cancelAllMexcOrders(pos.symbol).catch(() => {});
  await placeMexcMarketOrder(pos.symbol, pos.side === 'LONG' ? 'SELL' : 'BUY', pos.quantity).catch(() => {});
}
// Pasul 2 (OPȚIONAL): Binance rămâne ca fallback NUMAI pentru active care au ajuns acolo accidental
```

---

### 3.3 MODUL: DNAExtractor
**Fișier**: `src/lib/v2/superai/dnaExtractor.ts`  
**Verdict**: ✅ PĂSTREAZĂ — Implementare corectă a RL loop.

Calculează corect: winRate, recentWinRate (last 20), streak detection, direction bias (LONG vs SHORT WR), expectancy per simbol, avgHoldTime, confidenceModifier (0.5–1.5x pe baza recent performance). Digest human-readable pentru LLM context. Acoperire completă a circuitului RL.

**Problemă de scalabilitate** (nu este bug critic, dar devine problematic la >2000 batalii):  
DNA-ul este stocat în `json_store` (tabel generic, limitat la 2000 înregistrări). La scalare, cele mai vechi date de antrenament sunt șterse, degradând memory-ul RL.

**Fix recomandat (prioritate medie)**:  
Creează tabel Supabase dedicat `gladiator_battles` cu coloane indexate (`gladiator_id`, `timestamp`, `symbol`, `is_win`) și migrează `addGladiatorDna` / `getGladiatorDna` să opereze pe el direct, eliminând limita de 2000.

Schema SQL:
```sql
CREATE TABLE gladiator_battles (
  id TEXT PRIMARY KEY,
  gladiator_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decision TEXT NOT NULL,
  entry_price NUMERIC,
  outcome_price NUMERIC,
  pnl_percent NUMERIC,
  is_win BOOLEAN,
  timestamp BIGINT,
  market_context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_battles_gladiator ON gladiator_battles(gladiator_id);
CREATE INDEX idx_battles_symbol ON gladiator_battles(symbol);
```

---

### 3.4 MODUL: TheForge
**Fișier**: `src/lib/v2/promoters/forge.ts`  
**Verdict**: ✅ PĂSTREAZĂ cu optimizare de performanță.

Implementare reală și corectă: LLM genetic mutation cu fallback chain (DeepSeek → OpenAI → Gemini → deterministic crossover → randomDNA), GladiatorDNA schema completă (11 parametri), naming descriptiv bazat pe DNA traits, salvare în store + DB.

**BUG #6 — Spawning secvențial în loc de paralel**:  
`evaluateAndRecruit(weakLinkIds)` iterează secvențial prin `for` loop, apelând LLM o dată per gladiator eliminat. La 5 eliminări = 5 apeluri LLM în serie (~75 secunde total cu timeout 15s).

**Fix**:
```typescript
// ÎNLOCUIEȘTE bucla for din evaluateAndRecruit():
const spawnPromises = weakLinkIds.map(() => this.spawnNewGladiator());
const results = await Promise.allSettled(spawnPromises);
const newGladiators = results
  .filter(r => r.status === 'fulfilled' && r.value !== null)
  .map(r => (r as PromiseFulfilledResult<Gladiator>).value);
```

---

### 3.5 MODUL: TheButcher
**Fișier**: `src/lib/v2/gladiators/butcher.ts`  
**Verdict**: ✅ PĂSTREAZĂ — Implementare corectă.

Hard delete din DB + hydrate store. Criterii corecte: totalTrades >= 20, WinRate >= 40% SAU PF >= 0.9. Omega Gladiator imun. Fără shadow mode, fără resetare PnL.

**Nicio modificare necesară.**

---

### 3.6 MODUL: ArenaSimulator
**Fișier**: `src/lib/v2/arena/simulator.ts`  
**Verdict**: ✅ PĂSTREAZĂ — Fixul de cache a fost aplicat.

`getCachedPrice` deleghează corect la `getOrFetchPrice` (PriceCache global). Batch prefetch al prețurilor unice înainte de evaluare (nu per-trade). Expired phantoms force-close după 15 minute. Min hold 60 secunde pentru a evita evaluare prematură.

**BUG #7 — refreshGladiatorsFromCloud la fiecare cycle**:  
La fiecare `evaluatePhantomTrades()`, se face un `await refreshGladiatorsFromCloud()` care este un Supabase read. La volume mari, aceasta adaugă latență redundantă.

**Fix**:
```typescript
// Adaugă în ArenaSimulator:
private lastGladiatorRefresh = 0;
private REFRESH_TTL = 60_000; // 60 secunde

// În evaluatePhantomTrades(), înlocuiește refresh necondiționat cu:
const now = Date.now();
if (now - this.lastGladiatorRefresh > this.REFRESH_TTL) {
  await refreshGladiatorsFromCloud();
  gladiatorStore.hydrate(getGladiatorsFromDb());
  this.lastGladiatorRefresh = now;
}
```

---

### 3.7 MODUL: PositionManager
**Fișier**: `src/lib/v2/manager/positionManager.ts`  
**Verdict**: ✅ PĂSTREAZĂ cu fix de caching.

Asymmetric TP (T1@1%, 30% qty, Limit Order), Trailing SL post-T1 (5% de la peak), Initial Fixed SL pre-T1 (5%), Zombie prevention (min qty check → CLOSED dacă sub LOT_SIZE), DNA logging per exit tip, Moltbook broadcast.

**BUG #2 — getMexcPrice direct, bypass PriceCache**:  
Linia 46: `const currentPrice = await getMexcPrice(pos.symbol);` apelează MEXC direct, ignorând cache-ul global. La multiple poziții deschise simultan, generează N apeluri MEXC simultane.

**Fix**:
```typescript
// ÎNLOCUIEȘTE linia 46:
import { getOrFetchPrice } from '@/lib/cache/priceCache';
const currentPrice = await getOrFetchPrice(pos.symbol);
```

---

### 3.8 MODUL: PriceCache
**Fișier**: `src/lib/cache/priceCache.ts`  
**Verdict**: ✅ PĂSTREAZĂ — Implementare de referință.

Singleton via `globalThis` (supraviețuiește Next.js hot reload), dedup lock per simbol (nu paralelizează fetch-uri identice), TTL 30s normal / 120s fallback, fallback chain MEXC → Binance → OKX → DexScreener → CoinGecko, batch cu chunk de 10 + 200ms delay inter-chunk. Nu necesită modificări.

---

### 3.9 MODUL: GladiatorStore (seed)
**Fișier**: `src/lib/store/gladiatorStore.ts`  
**Verdict**: ⚠️ FIX CRITIC — Datele inițiale sunt fictive.

**BUG CRITIC #1 — Seed cu statistici inventate**:  
`seedGladiators()` inițializează gladiatorii cu `totalTrades: 50–250`, `winRate: 65–75%`, `profitFactor: 1.5–2.5` — valori generate cu `Math.random()`. Acestea sunt **complet fictive** și nu reflectă niciun trade real. Consecințe:

1. The Butcher nu va elimina niciodată gladiatorii inițiali (WR 65% > 40%, totalTrades > 20 → trec filtrul).
2. The Forge folosește acești gladiatori fictivi ca "parents" și generează DNA pe baza unor performanțe inexistente.
3. DNAExtractor raportează statistici false în LLM context, corupând deciziile DualMaster.
4. Leaderboard-ul inițial este fals, deci `isLive: rank <= 3` trimite bani reali pe gladiatori fără niciun track record.

**Fix obligatoriu** — Înlocuiește în `seedGladiators()`:
```typescript
stats: {
  winRate: 0,
  profitFactor: 1.0,
  maxDrawdown: 0,
  sharpeRatio: 0,
  totalTrades: 0,
},
isLive: false,         // NIMENI nu este live până nu câștigă dreptul
status: 'IN_TRAINING',
trainingProgress: 0,
```
Gladiatorii devin live **exclusiv** prin rotația Darwiniană (`cron_dailyRotation` → top 3 după 20+ trades cu WR ≥ 40%).

---

### 3.10 MODUL: Database (db.ts)
**Fișier**: `src/lib/store/db.ts`  
**Verdict**: ✅ PĂSTREAZĂ cu două fix-uri de schema.

Implementare solidă: task queue cu debounce per ID (nu duplicatele sync), distributed trade lock cu Supabase RPC + fallback INSERT + local Map, equity curve compusă (corect, non-destructivă), merge multi-instance pe gladiatori (totalTrades mai mare câștigă), dedup decisions pe signalId.

**BUG #9 — RPC `acquire_trade_lock` necreat în Supabase**:  
Codul apelează `supabase.rpc('acquire_trade_lock', ...)` și detectează eroarea cu `error.message?.includes('function')` ca să facă fallback. Aceasta înseamnă că **la fiecare achiziție de lock**, se face un call RPC care eșuează, apoi un INSERT. Dublează latența și poluează logs.

**Fix (opțiunea A — recomandată)**: Creează RPC în Supabase:
```sql
CREATE OR REPLACE FUNCTION acquire_trade_lock(
  p_symbol TEXT, p_instance_id TEXT, p_expires_at TIMESTAMPTZ
) RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM trade_locks WHERE expires_at < NOW();
  INSERT INTO trade_locks (symbol, instance_id, expires_at)
  VALUES (p_symbol, p_instance_id, p_expires_at)
  ON CONFLICT (symbol) DO NOTHING;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;
```

**Fix (opțiunea B)**: Elimină apelul RPC complet, standardizează pe INSERT cu conflict detection (deja există ca fallback).

**BUG #4 — syndicate_audits schema incompletă**:  
`addSyndicateAudit()` șterge explicit câmpurile `finalDirection` și `hallucinationReport` înainte de INSERT, deoarece nu există în tabelul Supabase. Asta înseamnă că **datele de hallucination defense nu sunt niciodată persistate** — sunt pierdute la restart.

**Fix**: Adaugă coloane în Supabase:
```sql
ALTER TABLE syndicate_audits 
ADD COLUMN IF NOT EXISTS final_direction TEXT,
ADD COLUMN IF NOT EXISTS hallucination_report JSONB;
```
Și ajustează maparea în `addSyndicateAudit()` să populeze aceste câmpuri.

---

### 3.11 MODUL: CronDailyRotation
**Fișier**: `src/scripts/cron_dailyRotation.ts`  
**Verdict**: ✅ PĂSTREAZĂ cu un fix minor.

Fluxul este corect: evaluate phantoms → Butcher → Forge → leaderboard update → Moltbook broadcast.

**BUG #10 — Leaderboard update nu se persistă**:  
După `gladiators.forEach((g, idx) => { g.rank = idx + 1; g.isLive = ... })`, nu există niciun `saveGladiatorsToDb(gladiators)`. Modificările rămân doar în memorie și se pierd la următorul cold start.

**Fix** — adaugă după forEach:
```typescript
const { saveGladiatorsToDb } = await import('@/lib/store/db');
saveGladiatorsToDb(gladiators);
log.info('🛡️ Leaderboard persisted to DB.');
```

---

### 3.12 MODUL: V1 Scoring Engine
**Fișiere**: `src/lib/scoring/` (convictionScore, dealScore, riskScore, scoringConfig)  
**Verdict**: 🟡 ROLUL SCHIMBAT — Nu se elimină, dar nu mai triggerează execuții.

V1 scoring (VWAP, RSI, volume-based) trebuie să opereze **exclusiv** ca pre-procesor de date pentru `alphaContext`, nu ca trigger de semnal independent. Verificare necesară: dacă există endpoint-uri sau rute care apelează aceste scoruri direct pentru a declanșa trade-uri, acestea trebuie redirecționate prin `ManagerVizionar`.

**Acțiune**: Auditează toate rutele API care importă din `src/lib/scoring/` și verifică că outputul lor intră în `AlphaScout.analyzeToken()` sau direct în payload-ul pentru `DualMasterConsciousness`, nu ca decizie finală.

---

### 3.13 MODUL: PromotersAggregator
**Fișier**: `src/lib/v2/promoters/promotersAggregator.ts`  
**Verdict**: ✅ PĂSTREAZĂ — Refactorizarea anterioară este corectă.

Acum apelează corect `TheButcher → TheForge`. Funcția `evaluateAndRecruit` fake (care renumea gladiatorii cu "Mutated") a fost eliminată. Broadcast Moltbook pentru Top 3 este funcțional.

---

## SECȚIUNEA 4 — BUGS CRITICE CONFIRMATE ÎN COD (Lista Completă)

| # | Severitate | Fișier | Descriere | Impact |
|---|---|---|---|---|
| 1 | **CRITIC** | `gladiatorStore.ts` | Seed cu stats fictive (WR 65-75%, trades 50-250) | Darwinian loop nefuncțional; bani reali pe gladiatori fără track record |
| 2 | **CRITIC** | `positionManager.ts:46` | `getMexcPrice()` direct, bypass PriceCache | Flood MEXC API la poziții multiple; risc ban IP |
| 3 | **CRITIC** | `sentinelGuard.ts` | Emergency exit apelează Binance, nu MEXC | Pozițiile MEXC rămân deschise la kill switch |
| 4 | **MAJOR** | `db.ts` | `syndicate_audits` schema lipsă coloane | Hallucination defense data nu e persistată |
| 5 | **MAJOR** | `cron_dailyRotation.ts` | Lipsă `saveGladiatorsToDb` după leaderboard update | Rankings și isLive pierdute la restart |
| 6 | **MAJOR** | `forge.ts` | Spawn LLM secvențial (5 gladiatori = 5 calls în serie) | Latență >75s la rotație cu eliminări multiple |
| 7 | **MEDIU** | `simulator.ts` | `refreshGladiatorsFromCloud` la fiecare evaluation cycle | Latență Supabase adăugată la fiecare cron |
| 8 | **MEDIU** | `db.ts` | RPC `acquire_trade_lock` absent → warning la fiecare lock | Log pollution + latență dublată per trade |
| 9 | **MEDIU** | `db.ts` | `gladiator_dna` în `json_store` (cap 2000 records) | RL memory se trunchiază; gladiatorii "uită" |
| 10 | **MINOR** | `gladiatorStore.ts` seed | Omega Gladiator seeded cu `isLive: false`, stats 0 | Corect, dar `isOmega: true` trebuie păstrat permanent |

---

## SECȚIUNEA 5 — ZONE INCOMPLETE / INCERTE (Explicit Marcate)

### ⚠️ ZONA 1: Backtesting pre-screening (LIPSĂ COMPLET)
The Forge generează gladiatori cu DNA aleatoriu/mutată, dar nu există niciun mecanism de **backtesting pe date istorice** înainte ca un gladiator nou să intre în phantom trading. Un gladiator cu DNA complet greșit va trebui să parcurgă 20 phantom trades (minim câteva zile) înainte să fie eliminat de Butcher, consumând slot-uri productive.

**Fix recomandat**: Implementează un mini-backtester în `TheForge.spawnNewGladiator()` care testează DNA-ul nou pe ultimele 50 de ticks istorice din cache sau Supabase înainte de înrolare. Dacă expectancy pe backtest < 0, regenerează DNA fără înrolare. Aceasta nu există în codebase și trebuie scrisă de la zero.

**⚠️ STATUS**: Neimplementat. Prioritate medie-mare pentru WR improvement.

---

### ⚠️ ZONA 2: Signal Quality (sursa gap-ului WR 26%)
Semnalele de intrare provin din multiple surse (btcEngine, memeEngine, solanaEngine, TradingView webhooks, btc-signals API). Nu există un audit al calității individuale per sursă. DualMaster filtrează semnalele slabe, dar dacă volumul de semnale slabe este mare, filtrul se saturează.

**Acțiuni necesare (niciuna implementată)**:
1. Loghează per sursă de semnal WR-ul istorică (câte semnale din btcEngine au dus la WIN vs LOSS).
2. Dezactivează sursele cu WR < 35% pe ultimele 30 de zile.
3. Crește pragul `weightedConfidence` în SentinelGuard de la 0.70 la 0.75 pentru modul LIVE.

**⚠️ STATUS**: Neimplementat. Aceasta este probabil cauza principală a WR-ului scăzut.

---

### ⚠️ ZONA 3: Omega Gladiator (Incomplet)
`OMEGA-GLADIATOR` există în store cu `isOmega: true`, `isLive: false`, `stats: { totalTrades: 0 }`. Nu există nicio logică implementată care să îl activeze sau să îl populeze diferit. Este un placeholder fără funcționalitate.

**Recomandare**: Fie implementezi logica Omega (agregare DNA din toți gladiatorii top 3, model meta-learning), fie șterge placeholder-ul pentru a nu crea confuzie. Nu lăsa un gladiator special fără implementare în production.

**⚠️ STATUS**: Incomplet. Nu blochează funcționalitatea curentă, dar este dead code.

---

### ⚠️ ZONA 4: Moltbook Integration (Parțial)
`postActivity()` este apelat în mai multe locuri (SentinelGuard kill switch, PositionManager exit, DailyRotation broadcast, PromotersAggregator). Dar `moltbookClient.ts` și integrarea cu API-ul Moltbook nu a fost auditată în această sesiune.

**Risc**: Dacă Moltbook API este down sau răspunde lent, apelurile non-await sau cu `.catch(() => {})` pot masca erori silențios. Verifică că toate call-urile Moltbook sunt fire-and-forget cu timeout explicit.

**⚠️ STATUS**: Neauditat. Verificare recomandată.

---

### ⚠️ ZONA 5: Schema SQL completă (Nevalidată)
`src/lib/store/schema.sql` există în codebase dar nu a fost citit în această sesiune. Nu se poate confirma dacă schema Supabase actuală include tabelele `trade_locks`, `live_positions`, `equity_history`, `syndicate_audits`, `gladiator_battles` (propus) și dacă RPC `acquire_trade_lock` există.

**Acțiune obligatorie**: Citește `schema.sql`, compară cu tabelele folosite în `db.ts`, și sincronizează orice discrepanță.

**⚠️ STATUS**: Nevalidat. Risc de runtime errors la prima rulare pe un Supabase fresh.

---

## SECȚIUNEA 6 — CE SE ELIMINĂ

| Modul | Acțiune | Motiv |
|---|---|---|
| `CLAUDE_MASTER_PROMPT.md` | Arhivează / nu mai referenția | Superseded de acest document |
| `ANTIGRAVITY_CLAUDE_SYNC.md` | Arhivează | Document de coordonare, nu blueprint tehnic |
| `audit_trade_ai.md` | Arhivează | Superseded |
| `docs/gemini_analysis_v2.md` | Arhivează | Superseded |
| `implementation_plan.md` | Arhivează | Superseded |
| Stats fictive în `seedGladiators()` | **Șterge** | Corup sistemul Darwinian |
| Chaining V1 scoring ca trigger | **Decuplează** | Creează semnale paralele necontrolate |
| `autoDebugEngine.ts` (modul Gemini recursive) | **Limitează la critice** | Burn tokens. Conform ANTIGRAVITY_SYNC, fixul a fost aplicat — verifică că `analyzeDeterministically` este calea principală |

---

## SECȚIUNEA 7 — PLAN DE IMPLEMENTARE (Ordine Corectă)

### FAZA 0: Pregătire și Validare Infrastructură (Zi 1)
**Obiectiv**: Asigurarea că baza de date și schema sunt corecte înainte de orice cod.

1. Citește și validează `src/lib/store/schema.sql` față de tabelele din `db.ts`.
2. Creează tabelele lipsă în Supabase (dacă nu există): `trade_locks`, `live_positions`, `equity_history`, `syndicate_audits`.
3. Adaugă coloanele lipsă în `syndicate_audits`: `final_direction TEXT`, `hallucination_report JSONB`.
4. Creează RPC `acquire_trade_lock` în Supabase (SQL din Secțiunea 3.10).
5. Verifică că `NEXT_PUBLIC_SUPABASE_URL` și `SUPABASE_SERVICE_ROLE_KEY` sunt setate în `.env.local` și în Cloud Run environment variables.
6. Verifică că `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY` sunt valide și au credit.

**Gate de ieșire**: `GET /api/diagnostics/master` returnează `200 OK` cu toate componentele verzi.

---

### FAZA 1: Fix-uri Critice (Zi 1-2)
**Obiectiv**: Eliminarea bug-urilor care fac sistemul să opereze pe date false sau să eșueze la kill switch.

**TASK 1.1 — Fix Seed Stats** (`gladiatorStore.ts`):
Setează toate stats la zero în `seedGladiators()`. Setează `isLive: false` pentru toți. Rulează `initDB()` și verifică că gladiatorii sunt resetați în Supabase (șterge manual înregistrările din `json_store` unde `id = 'gladiators'` dacă există date fictive anterioare).

**TASK 1.2 — Fix Emergency Exit** (`sentinelGuard.ts`):
Refactorizează `emergencyExitAllPositions()` să apeleze MEXC (via `getLivePositions()` + `cancelAllMexcOrders` + `placeMexcMarketOrder`). Binance rămâne secundar.

**TASK 1.3 — Fix PositionManager PriceCache** (`positionManager.ts`):
Înlocuiește `getMexcPrice(pos.symbol)` cu `getOrFetchPrice(pos.symbol)` din `@/lib/cache/priceCache`.

---

### FAZA 2: Fix-uri Majore (Zi 2-3)
**Obiectiv**: Stabilitate operațională și integritate a datelor.

**TASK 2.1 — Fix CronDailyRotation persist** (`cron_dailyRotation.ts`):
Adaugă `saveGladiatorsToDb(gladiators)` după leaderboard update.

**TASK 2.2 — Paralelizare Forge** (`forge.ts`):
Înlocuiește loop secvențial cu `Promise.allSettled` în `evaluateAndRecruit`.

**TASK 2.3 — Cache refresh TTL în ArenaSimulator** (`simulator.ts`):
Adaugă `lastGladiatorRefresh` timestamp cu TTL 60s.

**TASK 2.4 — Standardizare TradeLock** (`db.ts`):
Alege între opțiunea A (creează RPC) sau B (elimină apelul RPC, standardizează pe INSERT). Implementează și testează.

---

### FAZA 3: Migrare DNA la tabel dedicat (Zi 3-5)
**Obiectiv**: Eliminarea limitei de 2000 records pentru RL memory.

**TASK 3.1**: Creează tabel `gladiator_battles` în Supabase (SQL din Secțiunea 3.3).

**TASK 3.2**: Migrează `addGladiatorDna()` și `getGladiatorDna()` în `db.ts` să folosească tabelul nou direct (INSERT + SELECT), fără json_store. Adaugă paginare pe `extractIntelligence` (limitează la ultimele 500 batalii per gladiator pentru performanță).

**TASK 3.3**: Migrează datele existente din `json_store['gladiator_dna']` în noul tabel.

---

### FAZA 4: Îmbunătățire Calitate Semnale (Zi 5-10)
**Obiectiv**: Adresarea cauzei principale a WR-ului scăzut.

**TASK 4.1**: Adaugă câmp `source` indexat la fiecare `DecisionSnapshot`. Verifică că toate sursele de semnal populează corect `source`.

**TASK 4.2**: Implementează endpoint `/api/diagnostics/signal-quality` care returnează WR per sursă (btcEngine, memeEngine, solanaEngine, tradingview, etc.) pe ultimele 30 de zile.

**TASK 4.3**: Pe baza datelor, dezactivează sursele cu WR < 35%. Crește confidence threshold în SentinelGuard la 0.75 pentru LIVE mode.

**TASK 4.4 (opțional, impact mare)**: Implementează mini-backtester în TheForge pentru pre-screening DNA nou înainte de înrolare în Arena.

---

### FAZA 5: Validare End-to-End (Zi 10-14)
**Obiectiv**: Confirmare funcționalitate completă în PAPER mode.

1. Resetează toate datele din Supabase (fresh start cu stats zero).
2. Activează sistemul în PAPER mode.
3. Verifică că phantom trades se creează și se evaluează corect.
4. Așteaptă primul cron de rotație (00:00 UTC) și verifică că Butcher + Forge rulează corect.
5. Confirmă că niciun gladiator cu `totalTrades < 20` nu primește `isLive: true`.
6. Verifică că kill switch-ul activează emergency exit pe MEXC (testează cu un cont de test).
7. Dacă după 14 zile WR în PAPER mode este > 45%, activează LIVE cu capital minim (< 5% din total).

---

## SECȚIUNEA 8 — STANDARDE DE PRODUCȚIE

### Configurație Obligatorie `.env.local` / Cloud Run
```
NEXT_PUBLIC_SUPABASE_URL=https://[project].supabase.co
SUPABASE_SERVICE_ROLE_KEY=[service_role_key]           # Obligatoriu pentru bypass RLS
NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon_key]
OPENAI_API_KEY=[key]
DEEPSEEK_API_KEY=[key]
GEMINI_API_KEY=[key]
MEXC_API_KEY=[key]
MEXC_API_SECRET=[key]
BINANCE_API_KEY=[key]
BINANCE_API_SECRET=[key]
TELEGRAM_BOT_TOKEN=[token]                              # Dacă alertele Telegram sunt active
MOLTBOOK_API_KEY=[key]
```

### Parametri Operaționali Recomandați
| Parametru | Valoare curentă | Valoare recomandată | Justificare |
|---|---|---|---|
| `mddThreshold` | 10% | 10% | Corect. Nu schimba. |
| `dailyLossLimit` | 5 | 3 | Mai conservator pentru faza inițială |
| `minWinRate` | 35% | 40% | Aliniament cu criteriul Butcher |
| `maxLossStreak` | 5 | 4 | Reacție mai rapidă |
| `consensus threshold` | 70% | 75% (LIVE) | Filtrare mai strictă în LIVE |
| `riskPerTrade` | 1.5% | 1.0% (primele 30 zile) | Protecție capital în perioada de calibrare |
| `maxOpenPositions` | 3 | 2 (primele 30 zile) | Reducerea corelației |
| Phantom trade TTL | 15 min | 15 min | Corect. |
| Gladiator live threshold | 20 trades + WR ≥ 40% | 20 trades + WR ≥ 45% + PF ≥ 1.1 | Prag mai exigent |

### Reguli Hard (Nenegociabile)
1. **Niciun gladiator nu primește `isLive: true` înainte de 20 phantom trades completate** cu statistici reale.
2. **Kill switch-ul trebuie să lichideze pozițiile MEXC** — nu Binance. Verificat cu un test controlled.
3. **`gladiator_dna` nu se stochează mai mult de 500 records per gladiator** în memorie pentru `extractIntelligence` (paginare).
4. **DualMaster FLAT înseamnă NO TRADE** — niciodată override din exterior.
5. **Seed gladiator stats = ZERO** — orice cod care inițializează stats > 0 fără trade real este interzis.
6. **Emergency exit = MEXC first, Binance second** (pentru assets care au migrat accidental).

---

## SECȚIUNEA 9 — METRICI DE SUCCES (Verificabile)

| Metric | Valoare actuală | Target 30 zile | Target 90 zile |
|---|---|---|---|
| Win Rate (phantom) | ~26% | >45% | >60% |
| Profit Factor | Necunoscut | >1.2 | >1.5 |
| Expectancy per trade | Negativ | >0 | >0.3% |
| Gladiatori activi | N (cu stats fictive) | 5-10 (cu stats reale) | 10-15 (Darwinian) |
| Rotații Darwiniane | 0 (efective) | ≥ 5 | ≥ 20 |
| Kill switch false positives | Necunoscut | 0 (cu fix emergency exit) | 0 |
| Latență evaluare phantom batch | Necunoscută | < 5s per cycle | < 2s |

---

## SECȚIUNEA 10 — SELF-CHECK FINAL ÎNAINTE DE LIVE

Înainte de a activa LIVE mode, confirmă manual:

- [ ] `seedGladiators()` nu conține nicio valoare > 0 pentru stats
- [ ] `emergencyExitAllPositions()` apelează MEXC, nu Binance
- [ ] `positionManager.ts` importă `getOrFetchPrice` din PriceCache
- [ ] `cron_dailyRotation.ts` apelează `saveGladiatorsToDb` după leaderboard update
- [ ] `syndicate_audits` tabel are coloanele `final_direction` și `hallucination_report`
- [ ] Schema SQL este sincronizată cu codul din `db.ts`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` (nu anon key) este activ în Cloud Run
- [ ] Cel puțin un gladiator a completat 20+ phantom trades cu stats reale
- [ ] `GET /api/health` returnează 200
- [ ] `GET /api/diagnostics/master` returnează toate componentele OK
- [ ] Kill switch testat manual în PAPER mode (trigger + emergency exit verificat pe MEXC)
- [ ] `riskPerTrade` este ≤ 1.0% pentru primele 30 zile live

---

*Document generat prin inspecție directă a codului sursă (toate modulele V2) + consolidarea auditurilor existente. Orice contradicție între acest document și documentele anterioare: **acest document are prioritate**.*
