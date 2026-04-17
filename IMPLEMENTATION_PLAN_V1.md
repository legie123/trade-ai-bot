# PLAN MASTER DE IMPLEMENTARE — 10 INTEGRĂRI AUDIT EXTERN
**Data:** 17 Aprilie 2026 | **Status:** PLAN — NECESITĂ APROBARE ÎNAINTE DE EXECUȚIE

---

## PRINCIPII

1. **ADDITIVE ONLY** — nimic din arhitectura existentă nu se înlocuiește sau șterge
2. **FIECARE MODUL** are propriul fișier, propriul test, propriul kill-switch
3. **ORDINEA** respectă dependențele: safety first → intelligence → ML
4. **ROLLBACK** — fiecare pas poate fi dezactivat cu un flag fără a afecta restul
5. **ML STACK** — TypeScript ONNX Runtime (train offline Python, inference TS)

---

## FAZA 1 — OBSERVABILITATE + SAFETY (zero risk, fundament pentru tot restul)

### STEP 1.1 — Decision Audit Trail
**Fișier nou:** `src/lib/v2/audit/decisionLog.ts`
**Supabase table:** `decision_audit`

**Ce face:**
- La fiecare decizie (trade SAU skip), loghează un JSON structurat
- Include: timestamp, symbol, gladiatorId, all_agent_votes (alphaQuant, sentiment, risk), regime, sentinel_check_result, omega_modifier, final_action (EXECUTE/SKIP), slippage_observed, latency_ms

**Pseudo-cod:**
```
interface DecisionAuditEntry {
  id: string;                    // uuid
  timestamp: number;
  symbol: string;
  gladiatorId: string;
  mode: 'PAPER' | 'LIVE';

  // Agent votes
  alphaQuantVote: { direction, confidence } | null;
  sentimentVote: { direction, confidence } | null;
  riskVote: { approved, positionSize, denialReasons } | null;

  // Enrichment
  regime: MarketRegime;
  omegaModifier: number;
  consensusRatio: number;

  // Sentinel
  sentinelResult: { safe: boolean, reason?: string };

  // Outcome
  action: 'EXECUTE_LONG' | 'EXECUTE_SHORT' | 'SKIP';
  skipReason?: string;

  // Post-trade (filled async)
  slippage?: number;
  fillPrice?: number;
  latencyMs?: number;
}

export function logDecision(entry: DecisionAuditEntry): void
export function getRecentDecisions(limit: number): DecisionAuditEntry[]
export function getDecisionsBySymbol(symbol: string): DecisionAuditEntry[]
```

**Puncte de integrare:**
1. `SwarmOrchestrator.orchestrate()` — call `logDecision()` la final, înainte de return
2. `SentinelGuard.check()` — pass sentinel result la audit
3. Post-fill callback — update slippage + fillPrice async

**Supabase schema:**
```sql
CREATE TABLE decision_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp BIGINT NOT NULL,
  symbol TEXT NOT NULL,
  gladiator_id TEXT,
  mode TEXT NOT NULL,
  alpha_quant_vote JSONB,
  sentiment_vote JSONB,
  risk_vote JSONB,
  regime TEXT,
  omega_modifier REAL,
  consensus_ratio REAL,
  sentinel_safe BOOLEAN,
  sentinel_reason TEXT,
  action TEXT NOT NULL,
  skip_reason TEXT,
  slippage REAL,
  fill_price REAL,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_decision_audit_symbol ON decision_audit(symbol);
CREATE INDEX idx_decision_audit_ts ON decision_audit(timestamp DESC);
```

**Validare:** Query ultimele 10 decizii → verifică câmpuri non-null
**Kill-switch:** `DISABLE_AUDIT_LOG=true` în .env → funcția devine no-op

---

### STEP 1.2 — Correlation Guard
**Fișier nou:** `src/lib/v2/safety/correlationGuard.ts`

**Ce face:**
- Înainte de a deschide o nouă poziție, calculează corelația Pearson între noul simbol și toate pozițiile deschise
- Dacă correlation > threshold (default 0.80) → reject + log reason
- Folosește ultimele 100 close prices din cache/WS

**Pseudo-cod:**
```
const CORRELATION_THRESHOLD = 0.80;
const LOOKBACK_CLOSES = 100;

interface CorrelationCheck {
  allowed: boolean;
  reason?: string;
  correlations: Array<{ existingSymbol: string; correlation: number }>;
  maxCorrelation: number;
}

export function checkCorrelation(
  newSymbol: string,
  openPositions: LivePosition[],
  priceHistory: Map<string, number[]>
): CorrelationCheck

// Pearson correlation helper
function pearsonCorrelation(x: number[], y: number[]): number
```

**Punct de integrare:**
- `SentinelGuard.check()` — adaugă check DUPĂ equity drawdown, ÎNAINTE de approval final
- Preia `openPositions` din `getOpenPositions()` existent din db.ts
- Preia price history din `priceCache.ts`

**Validare:** Test cu 2 poziții BTC + ETH → corelație ~0.85 → reject. BTC + DOGE → corelație ~0.4 → allow.
**Kill-switch:** `DISABLE_CORRELATION_GUARD=true`

---

### STEP 1.3 — Regime-Adaptive Position Sizing
**Fișier nou:** `src/lib/v2/safety/adaptiveSizing.ts`

**Ce face:**
- Înlocuiește position size fix cu: `size = baseFraction × regimeMultiplier × drawdownMultiplier`
- `regimeMultiplier`: BULL=1.0, RANGE=0.7, BEAR=0.5, HIGH_VOL=0.4, TRANSITION=0.6
- `drawdownMultiplier`: dacă MDD current > 5% → reduce exponențial

**Pseudo-cod:**
```
interface SizingInput {
  baseRiskFraction: number;     // din SentinelGuard / RiskVote (e.g. 0.02)
  regime: MarketRegime;
  currentMDD: number;           // 0.0 - 1.0
  volatilityScore: number;      // 0-100 din OmegaEngine
  consecutiveLosses: number;
}

interface SizingOutput {
  adjustedFraction: number;
  regimeMultiplier: number;
  drawdownMultiplier: number;
  volatilityPenalty: number;
  reasoning: string;
}

const REGIME_MULTIPLIERS: Record<MarketRegime, number> = {
  BULL: 1.0,
  BEAR: 0.5,
  RANGE: 0.7,
  HIGH_VOL: 0.4,
  TRANSITION: 0.6,
};

export function calculateAdaptiveSize(input: SizingInput): SizingOutput {
  const regimeMul = REGIME_MULTIPLIERS[input.regime] ?? 0.6;

  // Exponential drawdown reduction: after 5% MDD, cut harder
  let ddMul = 1.0;
  if (input.currentMDD > 0.05) {
    ddMul = Math.max(0.2, 1.0 - (input.currentMDD - 0.05) * 5);
  }

  // Volatility penalty: reduce if vol > 70
  const volPenalty = input.volatilityScore > 70
    ? Math.max(0.3, 1.0 - (input.volatilityScore - 70) / 100)
    : 1.0;

  // Streak penalty: after 2 consecutive losses, reduce 20% per loss
  const streakMul = input.consecutiveLosses >= 2
    ? Math.max(0.3, 1.0 - (input.consecutiveLosses - 1) * 0.2)
    : 1.0;

  const adjusted = input.baseRiskFraction * regimeMul * ddMul * volPenalty * streakMul;

  return {
    adjustedFraction: Math.max(0.005, Math.min(input.baseRiskFraction, adjusted)),
    regimeMultiplier: regimeMul,
    drawdownMultiplier: ddMul,
    volatilityPenalty: volPenalty,
    reasoning: `regime=${input.regime}(${regimeMul}) × dd=${ddMul.toFixed(2)} × vol=${volPenalty.toFixed(2)} × streak=${streakMul.toFixed(2)}`,
  };
}
```

**Punct de integrare:**
- `/api/a2a/risk/route.ts` — unde se calculează positionSize → wrap cu `calculateAdaptiveSize()`
- Input regime vine din `classifyRegime()` existent
- Input MDD vine din `SentinelGuard.checkEquityDrawdown()`

**Validare:** Test: BULL + 0% MDD → size neschimbat. HIGH_VOL + 8% MDD → size redus ~60%.
**Kill-switch:** `DISABLE_ADAPTIVE_SIZING=true` → return baseFraction direct

---

## FAZA 2 — INTELLIGENCE UPGRADE

### STEP 2.1 — Adversarial Debate Engine
**Fișier nou:** `src/lib/v2/debate/debateEngine.ts`

**Ce face:**
- Primește un SwarmResult (decizia curentă) + market context
- Generează 2 argumente via LLM: BULL case + BEAR case
- Evaluează care argument e mai puternic (scoring pe factual basis)
- Returnează debate verdict + confidence modifier

**Pseudo-cod:**
```
interface DebateInput {
  symbol: string;
  proposedDirection: 'LONG' | 'SHORT';
  confidence: number;
  swarmVotes: SwarmResult['arenaConsensus'];
  regime: MarketRegime;
  indicators: Record<string, unknown>;
  recentAuditHistory?: DecisionAuditEntry[];  // din Step 1.1
}

interface DebateResult {
  verdict: 'CONFIRM' | 'OVERRIDE_FLAT' | 'REDUCE_CONFIDENCE';
  confidenceModifier: number;    // 0.5 - 1.2
  bullArgument: string;
  bearArgument: string;
  winnerSide: 'BULL' | 'BEAR';
  debateScore: number;           // -1 (strong bear) to +1 (strong bull)
  reasoning: string;
  latencyMs: number;
}

export class DebateEngine {
  private static instance: DebateEngine;

  async debate(input: DebateInput): Promise<DebateResult> {
    // 1. Construct prompts
    const bullPrompt = buildBullCase(input);
    const bearPrompt = buildBearCase(input);

    // 2. Call LLM (parallel) — same chain as Forge: DeepSeek → OpenAI → Gemini
    const [bullCase, bearCase] = await Promise.all([
      callLLM(bullPrompt),
      callLLM(bearPrompt),
    ]);

    // 3. Score arguments (heuristic + optional LLM judge)
    const score = scoreDebate(bullCase, bearCase, input);

    // 4. Determine verdict
    if (input.proposedDirection === 'LONG' && score < -0.3) {
      return { verdict: 'OVERRIDE_FLAT', confidenceModifier: 0.5, ... };
    }
    if (input.proposedDirection === 'SHORT' && score > 0.3) {
      return { verdict: 'OVERRIDE_FLAT', confidenceModifier: 0.5, ... };
    }
    if (Math.abs(score) < 0.15) {
      return { verdict: 'REDUCE_CONFIDENCE', confidenceModifier: 0.7, ... };
    }
    return { verdict: 'CONFIRM', confidenceModifier: 1.0 + Math.abs(score) * 0.2, ... };
  }
}
```

**LLM Prompt strategy:**
- Bull prompt: "Given [indicators, regime, sentiment], construct the STRONGEST case for going LONG on [symbol]. Use specific numbers. Counter the obvious bear arguments."
- Bear prompt: "Given [indicators, regime, sentiment], construct the STRONGEST case for NOT going LONG (or going SHORT) on [symbol]. Use specific numbers. Counter the obvious bull arguments."
- Scoring: count factual claims, check for contradictions with data, penalize vague reasoning

**Punct de integrare:**
- `SwarmOrchestrator.orchestrate()` — inserare ÎNTRE Phase 4 (omega modifier) și Phase 5 (execution)
- Dacă `verdict === 'OVERRIDE_FLAT'` → skip execution
- Dacă `verdict === 'REDUCE_CONFIDENCE'` → multiply finalConfidence × modifier

**Latency budget:** Max 3 secunde total (2 LLM calls parallel + scoring). Dacă timeout → auto-CONFIRM cu modifier 1.0 (fail-open, nu fail-close — altfel debate-ul blochează tot)

**Validare:** Replay ultimi 20 trades din decision_audit → compară debate verdict cu outcome real
**Kill-switch:** `DISABLE_DEBATE_ENGINE=true`

---

### STEP 2.2 — Monte Carlo Extension (Sharpe CI + Ruin Probability)
**Fișier modificat:** `src/lib/v2/superai/monteCarloEngine.ts`

**Ce adăugăm:**
- Sharpe Ratio distribution (mean, p5, p95)
- Sortino Ratio distribution
- Kelly Fraction optimal
- Probability of hitting target (e.g., +20% in 100 trades)
- Confidence Interval pe equity finală

**Pseudo-cod adăugat la MonteCarloResult:**
```
// Adăugat la interfața existentă MonteCarloResult:
sharpeDistribution: {
  mean: number;
  p5: number;
  p95: number;
};
sortinoDistribution: {
  mean: number;
  p5: number;
};
kellyFraction: number;           // optimal fraction to risk
probabilityOfTarget: number;     // P(equity > target)
confidenceInterval95: [number, number]; // 95% CI pe equity finală
```

**Punct de integrare:** Extinde funcția `runMonteCarlo()` existentă — NU o înlocuiește
**Validare:** Rulează cu gladiator existent → verifică Sharpe > 0 dacă WR > 50% și vice versa
**Kill-switch:** Nu e nevoie — e read-only analysis

---

### STEP 2.3 — Walk-Forward Validation
**Fișier nou:** `src/lib/v2/arena/walkForward.ts`

**Ce face:**
- Împarte date istorice în N ferestre (train window + test window)
- Antrenează/evaluează strategie pe train, testează pe test (unseen)
- Calculează out-of-sample performance vs in-sample
- Degradation ratio: dacă OOS performance < 50% of IS → red flag overfitting

**Pseudo-cod:**
```
interface WalkForwardConfig {
  totalTrades: TradeOutcome[];   // din gladiator battles
  trainRatio: number;            // 0.7 = 70% train, 30% test
  windows: number;               // 5 = 5 anchored walk-forward steps
  metric: 'winRate' | 'profitFactor' | 'sharpe';
}

interface WalkForwardResult {
  windows: Array<{
    windowIndex: number;
    trainStart: number;
    trainEnd: number;
    testStart: number;
    testEnd: number;
    inSampleMetric: number;
    outOfSampleMetric: number;
    degradation: number;          // OOS/IS ratio
  }>;
  avgInSample: number;
  avgOutOfSample: number;
  avgDegradation: number;         // < 0.5 = likely overfitting
  isOverfit: boolean;             // avgDegradation < 0.5
  recommendation: 'SAFE' | 'CAUTION' | 'OVERFIT';
}

export function runWalkForward(config: WalkForwardConfig): WalkForwardResult
```

**Punct de integrare:**
- `/api/v2/backtest` route — opțiune `?walkForward=true`
- Butcher — înainte de eliminare, verifică WF result (dacă OOS > threshold, salvează gladiatorul)
- Forge — după generare DNA, validează cu WF înainte de deploy

**Validare:** Rulează WF pe gladiator cu WR 60% → verifică că OOS WR nu cade sub 40%
**Kill-switch:** Nu e nevoie — offline validation tool

---

## FAZA 3 — ML FOUNDATION

### STEP 3.1 — Hyperopt DNA Optimization
**Fișier nou:** `src/scripts/hyperoptDNA.ts`

**Ce face:**
- Bayesian optimization (Tree-Parzen Estimator) pe parametrii GladiatorDNA
- Space de căutare: rsiOversold [20-40], rsiOverbought [60-80], vwapDeviation [0.1-0.8], stopLossRisk [0.005-0.06], takeProfitTarget [0.01-0.15], momentumWeight [0-1], contraryBias [0-1]
- Objective: maximize profitFactor pe Walk-Forward OOS (din Step 2.3)
- Output: top 10 DNA configs → opțional seed în Forge

**Pseudo-cod:**
```
interface HyperoptConfig {
  space: Record<keyof GladiatorDNA, { min: number; max: number; step?: number }>;
  iterations: number;             // 500-2000
  objective: 'profitFactor' | 'sharpe' | 'winRate_x_PF';
  walkForwardWindows: number;     // 5
  historicalTrades: TradeOutcome[];
}

interface HyperoptResult {
  bestDNA: GladiatorDNA;
  bestScore: number;
  top10: Array<{ dna: GladiatorDNA; score: number; oosScore: number }>;
  convergenceCurve: number[];     // score per iteration
  searchSpaceCoverage: number;    // % of space explored
}

// TPE sampler (Tree-Parzen Estimator) — simplified TS implementation
class TPESampler {
  private good: GladiatorDNA[] = [];
  private bad: GladiatorDNA[] = [];
  private gamma = 0.25;  // top 25% = "good"

  suggest(): GladiatorDNA  // sample from good distribution
  update(dna: GladiatorDNA, score: number): void
}

export async function runHyperopt(config: HyperoptConfig): Promise<HyperoptResult>
```

**IMPORTANT:** Hyperopt rulează Walk-Forward pe fiecare trial → overfitting protection built-in.

**Punct de integrare:**
- Script offline: `npx tsx src/scripts/hyperoptDNA.ts`
- Output salvat în `seedStrategies.ts` ca noi gladiatori
- Opțional: cron zilnic care rulează hyperopt pe noapte

**Validare:** Rulează 100 iterații → verifică că best DNA OOS PF > 1.2
**Kill-switch:** Offline tool, nu afectează live

---

### STEP 3.2 — Experience Memory Store
**Fișier nou:** `src/lib/v2/memory/experienceStore.ts`
**Supabase table:** `trade_experiences`

**Ce face:**
- La fiecare trade completat, salvează snapshot structurat
- Înainte de trade nou, face retrieval pe condiții similare
- Query: "Am mai tranzacționat [symbol] în regim [regime] cu RSI [range]? Ce win rate am avut?"

**Pseudo-cod:**
```
interface TradeExperience {
  id: string;
  symbol: string;
  regime: MarketRegime;
  rsi: number;
  vwap_deviation: number;
  volume_z: number;
  sentiment_score: number;
  gladiator_id: string;
  direction: 'LONG' | 'SHORT';
  outcome: 'WIN' | 'LOSS';
  pnl_percent: number;
  slippage: number;
  duration_ms: number;
  timestamp: number;
}

interface ExperienceQuery {
  symbol?: string;
  regime: MarketRegime;
  rsiRange: [number, number];     // e.g., [25, 35]
  direction: 'LONG' | 'SHORT';
  limit?: number;
}

interface ExperienceInsight {
  matchingTrades: number;
  winRate: number;
  avgPnl: number;
  avgSlippage: number;
  bestGladiator: string;
  worstGladiator: string;
  recommendation: 'FAVORABLE' | 'NEUTRAL' | 'UNFAVORABLE';
  confidence: number;             // based on sample size
}

export function saveExperience(exp: TradeExperience): Promise<void>
export function queryExperience(q: ExperienceQuery): Promise<ExperienceInsight>
```

**Supabase schema:**
```sql
CREATE TABLE trade_experiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  regime TEXT NOT NULL,
  rsi REAL,
  vwap_deviation REAL,
  volume_z REAL,
  sentiment_score REAL,
  gladiator_id TEXT,
  direction TEXT NOT NULL,
  outcome TEXT NOT NULL,
  pnl_percent REAL NOT NULL,
  slippage REAL,
  duration_ms INTEGER,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_experiences_regime ON trade_experiences(regime, direction);
CREATE INDEX idx_experiences_symbol ON trade_experiences(symbol);
```

**Punct de integrare:**
- POST-trade: `ArenaSimulator.evaluatePhantomTrades()` → `saveExperience()`
- PRE-trade: `SwarmOrchestrator` sau `SentinelGuard` → `queryExperience()` → log in audit
- Nu blochează decizia (doar informativ) PÂNĂ când avem 200+ experiences

**Validare:** Salvează 10 trade experiences → query cu regim similar → verifică retrieval corect
**Kill-switch:** `DISABLE_EXPERIENCE_MEMORY=true`

---

### STEP 3.3 — Abstract Exchange Connector
**Fișier nou:** `src/lib/exchange/connector.ts`
**Fișiere modificate:** `mexcClient.ts`, `binanceClient.ts`, `bybitClient.ts`, `okxClient.ts`

**Ce face:**
- Definește `IExchangeConnector` interface
- Fiecare client implementează interfața
- `ConnectorFactory.get('MEXC')` returnează clientul corect
- Simplest possible refactor: interfață PESTE clienții existenți, nu îi rescrie

**Pseudo-cod:**
```
export interface IExchangeConnector {
  name: string;
  // Market data
  getPrice(symbol: string): Promise<number>;
  getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]>;
  getOrderBook(symbol: string, limit?: number): Promise<OrderBook>;

  // Trading
  placeOrder(order: OrderRequest): Promise<OrderResponse>;
  cancelOrder(orderId: string, symbol: string): Promise<void>;
  getOpenOrders(symbol?: string): Promise<Order[]>;

  // Account
  getBalance(): Promise<Balance[]>;
  getPositions(): Promise<Position[]>;

  // Health
  ping(): Promise<boolean>;
  getStatus(): ConnectorStatus;
}

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number; }
interface OrderBook { bids: [number, number][]; asks: [number, number][]; }
interface OrderRequest { symbol: string; side: 'BUY' | 'SELL'; type: 'MARKET' | 'LIMIT'; quantity: number; price?: number; }

export class ConnectorFactory {
  private static connectors: Map<string, IExchangeConnector> = new Map();

  static get(exchange: string): IExchangeConnector {
    // lazy init + cache
  }

  static getDefault(): IExchangeConnector {
    return this.get(process.env.DEFAULT_EXCHANGE || 'MEXC');
  }
}
```

**Strategie de refactor:**
1. Creez interfața și factory-ul
2. Creez `MexcConnector` wrapper PESTE `mexcClient.ts` funcțiile existente (nu le modific)
3. Treptat, alte module care import direct `mexcClient` pot migra la `ConnectorFactory`
4. NU forțez migrarea tuturor la o dată

**Validare:** `ConnectorFactory.get('MEXC').getPrice('BTCUSDT')` returnează preț valid
**Kill-switch:** Dacă connector-ul nou dă erori → fallback direct pe mexcClient vechi

---

## FAZA 4 — ML INTEGRATION

### STEP 4.1 — Micro-ML per Gladiator
**Fișiere noi:**
- `src/lib/v2/gladiators/gladiatorML.ts` — inference engine TS
- `scripts/train_gladiator_ml.py` — Python training script (offline)
- `models/` directory — ONNX model files per gladiator

**Ce face:**
- Python script: antrenează XGBoost pe features din trade_experiences (Step 3.2)
- Exportă model ca ONNX
- TypeScript: load ONNX via `onnxruntime-node`, inference per gladiator
- Re-train trigger: la fiecare 100 trades noi sau la fiecare 24h

**Pseudo-cod (TypeScript inference):**
```
import * as ort from 'onnxruntime-node';

interface MLPrediction {
  direction: 'LONG' | 'SHORT' | 'FLAT';
  confidence: number;
  features: Record<string, number>;
  modelVersion: string;
  gladiatorId: string;
}

export class GladiatorML {
  private sessions: Map<string, ort.InferenceSession> = new Map();

  async loadModel(gladiatorId: string): Promise<void> {
    const modelPath = `models/gladiator_${gladiatorId}.onnx`;
    // fallback to default model if no per-gladiator model
    const session = await ort.InferenceSession.create(modelPath);
    this.sessions.set(gladiatorId, session);
  }

  async predict(gladiatorId: string, features: Record<string, number>): Promise<MLPrediction> {
    const session = this.sessions.get(gladiatorId);
    if (!session) return fallbackHeuristic(features);

    const tensor = new ort.Tensor('float32', Object.values(features), [1, Object.keys(features).length]);
    const results = await session.run({ input: tensor });
    // parse results → MLPrediction
  }
}
```

**Pseudo-cod (Python training):**
```python
# scripts/train_gladiator_ml.py
import xgboost as xgb
import onnxmltools
from supabase import create_client

def train_gladiator(gladiator_id: str):
    # 1. Fetch trade_experiences from Supabase
    # 2. Feature engineer: regime_encoded, rsi, vwap_dev, vol_z, sentiment, hour, dow
    # 3. Label: outcome (WIN=1, LOSS=0)
    # 4. Train XGBoost with walk-forward CV (from Step 2.3 logic)
    # 5. Export ONNX: onnxmltools.convert_xgboost(model)
    # 6. Save to models/gladiator_{id}.onnx
```

**Punct de integrare:**
- `SwarmOrchestrator` Phase 1 — ML prediction adăugat ca al 4-lea "arena vote" (lângă alphaQuant, sentiment, risk)
- NU înlocuiește niciun vot existent — e aditiv
- Weight inițial: 0.15 (mic, crește pe măsură ce ML dovedește acuratețe)

**Condiții de activare:**
- Min 200 trade_experiences per gladiator
- Walk-forward OOS accuracy > 55%
- Altfel fallback pe heuristic din predictor.ts existent

**Validare:**
1. Train pe 200+ trades → ONNX export reușit
2. TypeScript load + inference < 10ms
3. Accuracy pe test set > random (> 52%)

**Kill-switch:** `DISABLE_GLADIATOR_ML=true` → skip ML vote, restul SwarmOrchestrator funcționează normal

---

## ORDINEA DE EXECUȚIE

```
STEP 1.1  Decision Audit Trail        ← FUNDAMENT, zero deps
   ↓
STEP 1.2  Correlation Guard            ← independent, parallel cu 1.1
   ↓
STEP 1.3  Regime-Adaptive Sizing       ← independent, parallel cu 1.1/1.2
   ↓
STEP 2.1  Adversarial Debate Engine    ← depinde de 1.1 (logare audit)
   ↓
STEP 2.2  Monte Carlo Extension        ← independent
   ↓
STEP 2.3  Walk-Forward Validation      ← independent
   ↓
STEP 3.1  Hyperopt DNA                 ← depinde de 2.3 (WF validation)
   ↓
STEP 3.2  Experience Memory Store      ← depinde de 1.1 (audit data)
   ↓
STEP 3.3  Abstract Exchange Connector  ← independent, parallel cu 3.1/3.2
   ↓
STEP 4.1  Micro-ML per Gladiator      ← depinde de 3.2 (experience data) + 2.3 (WF validation)
```

**Paralelism posibil:**
- Batch 1 (simultane): 1.1 + 1.2 + 1.3
- Batch 2 (simultane): 2.1 + 2.2 + 2.3
- Batch 3 (simultane): 3.1 + 3.2 + 3.3
- Batch 4: 4.1 (toate dependențele gata)

---

## RISCURI ȘI MITIGĂRI

| Risc | Probabilitate | Impact | Mitigare |
|------|--------------|--------|----------|
| Debate Engine adaugă latency > 3s | MEDIE | Trade-uri întârziate | Timeout 3s → auto-CONFIRM |
| ML overfit pe date puține | MARE | False confidence | Min 200 trades + WF obligatoriu |
| Correlation Guard prea agresiv | MICĂ | Miss opportunities | Threshold adjustable, log-only mode first |
| ONNX runtime issues în Next.js | MEDIE | ML nu funcționează | Fallback pe predictor.ts existent |
| Supabase rate limits pe audit logging | MICĂ | Pierdere logs | Batch inserts, local buffer |
| Hyperopt convergence lentă | MEDIE | Parametri suboptimali | Min 500 iterații, early stopping |

---

## METRICI DE SUCCES POST-IMPLEMENTARE

| Metric | Baseline (acum) | Target post-integrare |
|--------|-----------------|----------------------|
| Decision observability | 0 (no audit trail) | 100% decizii logate |
| False signal rate | Unknown | -20% (debate filter) |
| Position size accuracy | Fixed | Regime-adaptive |
| Overfitting detection | Manual | Automated (WF < 0.5 = flag) |
| Correlated exposure | Unchecked | Max 0.80 correlation |
| ML vote accuracy | N/A | > 55% OOS |
| Gladiator DNA quality | LLM-generated | Statistically optimized |
| Experience retrieval | None | Context per trade |
| Exchange portability | MEXC-only code | Interface-based |

---

## READY TO EXECUTE?

Planul e gata. Fiecare step are:
- ✅ Fișier exact + locație
- ✅ Pseudo-cod complet
- ✅ Punct de integrare precis
- ✅ Supabase schema (unde e cazul)
- ✅ Validare
- ✅ Kill-switch
- ✅ Dependențe explicite
- ✅ Risc identificat

**Confirmă și încep implementarea pas cu pas, începând cu Step 1.1.**
