// ============================================================
// Trade Executor — Production-grade order execution pipeline
// PAPER TRADING ONLY — ALL LIVE BINANCE ORDERS DISABLED
// Signal → ML Filter → Risk Check → Local Paper Fill → Telegram
// ============================================================
import { DecisionSnapshot } from '@/lib/types/radar';
import { scoreSignal } from '@/lib/engine/mlFilter';
import { calculateRisk, RiskOutput } from '@/lib/engine/riskManager';
import { getAutoTradeConfig } from '@/lib/engine/autoTrader';
import { isKillSwitchEngaged } from '@/lib/core/killSwitch';
import { createLogger } from '@/lib/core/logger';
import { sendAlert } from '@/lib/alerts/telegram';
import { getDecisions } from '@/lib/store/db';

const log = createLogger('Executor');

// ─── Symbol mapping: internal → Binance format ────
const SYMBOL_MAP: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  BONK: '1000BONKUSDT', // Note: Binance often uses 1000x for memes
  WIF: 'WIFUSDT',
  JUP: 'JUPUSDT',
  RAY: 'RAYUSDT',
  JTO: 'JTOUSDT',
  PYTH: 'PYTHUSDT',
  RNDR: 'RNDRUSDT',
};

// ─── Precision params (used for paper simulation) ──
const QTY_PRECISION: Record<string, number> = {
  BTCUSDT: 5, ETHUSDT: 4, SOLUSDT: 2, '1000BONKUSDT': 0,
  WIFUSDT: 1, JUPUSDT: 1, RAYUSDT: 1, JTOUSDT: 1,
  PYTHUSDT: 1, RNDRUSDT: 1,
};

export interface ExecutionResult {
  executed: boolean;
  symbol: string;
  binanceSymbol: string;
  side: string;
  price: number;
  quantity: number;
  orderValue: number;
  orderId?: string; // string for paper IDs
  stopLoss: number;
  takeProfit: number;
  mlScore: number;
  mlVerdict: string;
  riskPercent: number;
  reason: string;
  telegramSent: boolean;
  timestamp: string;
  error?: string;
}

export interface ExecutionLog {
  results: ExecutionResult[];
  timestamp: string;
  totalExecuted: number;
  totalSkipped: number;
  errors: string[];
}

// In-memory execution log (persisted by stateRecovery later)
const gExec = globalThis as unknown as { __execLog?: ExecutionResult[] };
if (!gExec.__execLog) gExec.__execLog = [];

export function getExecutionLog(): ExecutionResult[] {
  return gExec.__execLog || [];
}

export function restoreExecutionLog(logData: ExecutionResult[]): void {
  gExec.__execLog = [...logData];
}

// ─── Paper Fill Simulator (Exponential Backoff support) ──
async function simulatePaperFill(
  symbol: string,
  side: string,
  quantity: number,
  price: number
): Promise<{ orderId: string; status: string; fillPrice: number }> {
  // Simulate network latency & slip
  const slipPercent = (Math.random() * 0.1) / 100; // 0 to 0.1% slip
  const fillPrice = side === 'BUY'
    ? price * (1 + slipPercent)
    : price * (1 - slipPercent);

  // Artificial delay (200ms - 800ms) to mimic exchange
  await new Promise(r => setTimeout(r, 200 + Math.random() * 600));

  return {
    orderId: `paper_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    status: 'FILLED',
    fillPrice: Math.round(fillPrice * 10000) / 10000,
  };
}

// ─── Execute a single paper trade ──────────────────────
async function executeTrade(
  decision: DecisionSnapshot,
  risk: RiskOutput,
  mlScore: number,
  mlVerdict: string,
): Promise<ExecutionResult> {
  const binanceSymbol = SYMBOL_MAP[decision.symbol] || `${decision.symbol}USDT`;
  const side = (decision.signal === 'BUY' || decision.signal === 'LONG') ? 'BUY' as const : 'SELL' as const;
  const price = decision.price; // Use decision price for paper fill baseline

  // Calculate quantity
  const precision = QTY_PRECISION[binanceSymbol] ?? 2;
  const rawQty = risk.positionSize / price;
  const quantity = parseFloat(rawQty.toFixed(precision));
  const orderValue = quantity * price;

  log.info(`Attempting paper fill`, { symbol: decision.symbol, side, quantity, price });

  try {
    // 🛑 PAPER ONLY — Live API call removed completely
    const fill = await simulatePaperFill(binanceSymbol, side, quantity, price);

    // Send Telegram alert
    let telegramSent = false;
    try {
      telegramSent = await sendAlert({
        symbol: decision.symbol,
        signal: decision.signal,
        price: fill.fillPrice,
        confidence: decision.confidence,
        mlScore,
        mlVerdict,
        stopLoss: risk.stopLoss,
        takeProfit: risk.takeProfit,
        source: `${decision.source} (PAPER)`,
      });
    } catch { /* telegram is optional */ }

    const result: ExecutionResult = {
      executed: true, symbol: decision.symbol, binanceSymbol, side,
      price: fill.fillPrice, quantity, orderValue,
      orderId: fill.orderId, stopLoss: risk.stopLoss, takeProfit: risk.takeProfit,
      mlScore, mlVerdict, riskPercent: risk.positionSizePercent,
      reason: `📝 PAPER FILL #${fill.orderId} | ${side} ${quantity} ${binanceSymbol} @ $${fill.fillPrice.toFixed(4)}`,
      telegramSent,
      timestamp: new Date().toISOString(),
    };

    gExec.__execLog!.push(result);
    log.info(`Paper fill success`, { orderId: fill.orderId, fillPrice: fill.fillPrice });
    return result;

  } catch (err) {
    const errorMsg = (err as Error).message;
    const result: ExecutionResult = {
      executed: false, symbol: decision.symbol, binanceSymbol, side, price, quantity, orderValue,
      stopLoss: risk.stopLoss, takeProfit: risk.takeProfit, mlScore, mlVerdict,
      riskPercent: risk.positionSizePercent,
      reason: `❌ Simulation error: ${errorMsg}`,
      telegramSent: false,
      timestamp: new Date().toISOString(),
      error: errorMsg,
    };
    gExec.__execLog!.push(result);
    log.error(`Paper fill failed`, { error: errorMsg });
    return result;
  }
}

// ─── Helper: build skipped result ─────────────────
function buildSkipped(
  d: DecisionSnapshot,
  ml: { score: number; verdict: string },
  reason: string
): ExecutionResult {
  return {
    executed: false, symbol: d.symbol, binanceSymbol: SYMBOL_MAP[d.symbol] || '',
    side: d.signal, price: d.price, quantity: 0, orderValue: 0,
    stopLoss: 0, takeProfit: 0, mlScore: ml.score, mlVerdict: ml.verdict,
    riskPercent: 0, reason, telegramSent: false, timestamp: d.timestamp,
  };
}

// ─── Full execution pipeline ──────────────────────
export async function runExecutionPipeline(accountBalance = 1000): Promise<ExecutionLog> {
  const config = getAutoTradeConfig();

  // STRICTURED GATES FOR PRODUCTION
  const minML = parseInt(process.env.MIN_ML_SCORE || '85'); // Raised ML baseline
  const minConf = 99; // 🔥 HARD GATE: 99% CONFIDENCE REQUIRED (Strict Assured Trades Only)
  const maxPositions = parseInt(process.env.MAX_OPEN_POSITIONS || '3');
  const cooldown = parseInt(process.env.COOLDOWN_MINUTES || '15');

  // 🧠 Kelly Criterion: Dynamic risk sizing from trade history
  const { calculateKellyRisk } = await import('@/lib/engine/kellySizer');
  const tradeHistory = getExecutionLog()
    .filter(r => r.executed)
    .map(r => ({
      pnlPercent: ((r.price - r.stopLoss) / r.price) * 100 * (r.side === 'BUY' ? 1 : -1),
      outcome: (r.price > r.stopLoss ? 'WIN' : 'LOSS') as 'WIN' | 'LOSS',
    }));
  const kelly = calculateKellyRisk(tradeHistory);
  const dynamicRiskPercent = kelly.suggestedRisk;

  log.info(`Starting execution pipeline`, {
    pendingCount: getDecisions().filter(d => d.outcome === 'PENDING').length,
    kellyRisk: `${dynamicRiskPercent}%`,
    kellyConfident: kelly.confident,
  });

  // 1. Global Kill Switch Check (Ultimate Guard)
  if (isKillSwitchEngaged()) {
    log.warn(`Pipeline aborted — Kill Switch is active`);
    return {
      results: [],
      timestamp: new Date().toISOString(),
      totalExecuted: 0,
      totalSkipped: getDecisions().filter(d => d.outcome === 'PENDING').length,
      errors: ['Pipeline aborted: Kill Switch active'],
    };
  }

  // 2. Fetch pending decisions
  const decisions = getDecisions()
    .filter(d => d.outcome === 'PENDING')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10);

  const results: ExecutionResult[] = [];
  const errors: string[] = [];
  let executed = 0;

  // 3. Count open positions (last 24h)
  const recent = getExecutionLog().filter(
    r => r.executed && r.timestamp && (Date.now() - new Date(r.timestamp).getTime() < 86400_000)
  );
  let openPositions = recent.length;

  for (const decision of decisions) {
    const ml = scoreSignal(decision);

    // De-duplicate: skip if already executed this symbol recently
    const alreadyExecuted = getExecutionLog().some(
      r => r.symbol === decision.symbol && r.side === ((decision.signal === 'BUY' || decision.signal === 'LONG') ? 'BUY' : 'SELL')
        && r.timestamp && (Date.now() - new Date(r.timestamp).getTime() < cooldown * 60_000)
    );
    if (alreadyExecuted) {
      log.debug(`Skipped duplicate trade`, { symbol: decision.symbol });
      continue;
    }

    // GATES — Sequential rejection with detailed tracking
    if (ml.score < minML) {
      results.push(buildSkipped(decision, ml, `⏸️ ML score ${ml.score}% < ${minML}% min`));
      continue;
    }

    if (decision.confidence < minConf) {
      results.push(buildSkipped(decision, ml, `⏸️ Confidence ${decision.confidence}% < ${minConf}% (HARD GATE)`));
      continue;
    }

    if (openPositions >= maxPositions) {
      results.push(buildSkipped(decision, ml, `⏸️ Max ${maxPositions} positions reached`));
      continue;
    }

    if (!config.enabled) {
      results.push(buildSkipped(decision, ml, `⏸️ Auto-trade disabled in config`));
      continue;
    }

    // Risk Check (includes its own duplicate, stale, latency, and kill-switch guards)
    const risk = calculateRisk({
      entryPrice: decision.price,
      signal: decision.signal,
      confidence: decision.confidence,
      symbol: decision.symbol,
      accountBalance,
      decisionTimestamp: decision.timestamp,
      apiLatencyMs: 50, // simulated low latency for paper mode
      kellyResult: kelly,
    });

    if (!risk.canTrade) {
      results.push({
        ...buildSkipped(decision, ml, `⏸️ Risk denied: ${risk.reason}`),
        stopLoss: risk.stopLoss, takeProfit: risk.takeProfit, riskPercent: risk.positionSizePercent
      });
      continue;
    }

    // EXECUTE (Paper simulation only)
    try {
      const result = await executeTrade(decision, risk, ml.score, ml.verdict);
      results.push(result);
      if (result.executed) {
        executed++;
        openPositions++;
      }
    } catch (err) {
      log.error(`Execution thrown logic error`, { error: (err as Error).message, symbol: decision.symbol });
      errors.push(`${decision.symbol}: ${(err as Error).message}`);
    }
  }

  return {
    results,
    timestamp: new Date().toISOString(),
    totalExecuted: executed,
    totalSkipped: results.length - executed,
    errors,
  };
}
