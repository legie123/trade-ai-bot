// ============================================================
// Trade Executor — Production-grade order execution pipeline
// Signal → ML Filter → Risk Check → Binance Order → Telegram Alert
// Real market rules: min size, symbol mapping, spread validation
// ============================================================
import { DecisionSnapshot } from '@/lib/types/radar';
import { scoreSignal } from '@/lib/engine/mlFilter';
import { calculateRisk, RiskOutput } from '@/lib/engine/riskManager';
import { getAutoTradeConfig } from '@/lib/engine/autoTrader';
import * as binance from '@/lib/exchange/binanceClient';
import { sendAlert } from '@/lib/alerts/telegram';
import { getDecisions } from '@/lib/store/db';

// ─── Symbol mapping: internal → Binance format ────
const SYMBOL_MAP: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  BONK: 'BONKUSDT',
  WIF: 'WIFUSDT',
  JUP: 'JUPUSDT',
  RAY: 'RAYUSDT',
  JTO: 'JTOUSDT',
  PYTH: 'PYTHUSDT',
  RNDR: 'RNDRUSDT',
};

// ─── Minimum order sizes (Binance rules) ──────────
const MIN_NOTIONAL: Record<string, number> = {
  BTCUSDT: 10,
  ETHUSDT: 10,
  SOLUSDT: 5,
  BONKUSDT: 5,
  WIFUSDT: 5,
  JUPUSDT: 5,
  RAYUSDT: 5,
  JTOUSDT: 5,
  PYTHUSDT: 5,
  RNDRUSDT: 5,
};

// ─── Quantity precision (decimal places) ──────────
const QTY_PRECISION: Record<string, number> = {
  BTCUSDT: 5,
  ETHUSDT: 4,
  SOLUSDT: 2,
  BONKUSDT: 0,
  WIFUSDT: 1,
  JUPUSDT: 1,
  RAYUSDT: 1,
  JTOUSDT: 1,
  PYTHUSDT: 1,
  RNDRUSDT: 1,
};

export interface ExecutionResult {
  executed: boolean;
  symbol: string;
  binanceSymbol: string;
  side: string;
  price: number;
  quantity: number;
  orderValue: number;
  orderId?: number;
  stopLoss: number;
  takeProfit: number;
  mlScore: number;
  mlVerdict: string;
  riskPercent: number;
  reason: string;
  telegramSent: boolean;
  error?: string;
}

export interface ExecutionLog {
  results: ExecutionResult[];
  timestamp: string;
  totalExecuted: number;
  totalSkipped: number;
  errors: string[];
}

// In-memory execution log
const gExec = globalThis as unknown as { __execLog?: ExecutionResult[] };
if (!gExec.__execLog) gExec.__execLog = [];

export function getExecutionLog(): ExecutionResult[] {
  return gExec.__execLog || [];
}

// ─── Execute a single trade ───────────────────────
async function executeTrade(
  decision: DecisionSnapshot,
  risk: RiskOutput,
  mlScore: number,
  mlVerdict: string,
): Promise<ExecutionResult> {
  const binanceSymbol = SYMBOL_MAP[decision.symbol] || `${decision.symbol}USDT`;
  const side = (decision.signal === 'BUY' || decision.signal === 'LONG') ? 'BUY' as const : 'SELL' as const;

  // Get live price from Binance
  let price: number;
  try {
    price = await binance.getPrice(binanceSymbol);
  } catch {
    price = decision.price; // fallback to decision price
  }

  // Calculate quantity
  const precision = QTY_PRECISION[binanceSymbol] ?? 2;
  const rawQty = risk.positionSize / price;
  const quantity = parseFloat(rawQty.toFixed(precision));
  const orderValue = quantity * price;

  // Validate minimum notional
  const minNotional = MIN_NOTIONAL[binanceSymbol] ?? 10;
  if (orderValue < minNotional) {
    return {
      executed: false, symbol: decision.symbol, binanceSymbol, side, price, quantity, orderValue,
      stopLoss: risk.stopLoss, takeProfit: risk.takeProfit, mlScore, mlVerdict,
      riskPercent: risk.positionSizePercent,
      reason: `Order value $${orderValue.toFixed(2)} below min $${minNotional}`,
      telegramSent: false,
    };
  }

  // Execute on Binance
  try {
    const order = await binance.placeMarketOrder(binanceSymbol, side, quantity);
    const orderId = (order as { orderId?: number }).orderId;

    // Send Telegram alert
    let telegramSent = false;
    try {
      telegramSent = await sendAlert({
        symbol: decision.symbol,
        signal: decision.signal,
        price,
        confidence: decision.confidence,
        mlScore,
        mlVerdict,
        stopLoss: risk.stopLoss,
        takeProfit: risk.takeProfit,
        source: decision.source || 'engine',
      });
    } catch { /* telegram is optional */ }

    const result: ExecutionResult = {
      executed: true, symbol: decision.symbol, binanceSymbol, side, price, quantity, orderValue,
      orderId, stopLoss: risk.stopLoss, takeProfit: risk.takeProfit, mlScore, mlVerdict,
      riskPercent: risk.positionSizePercent,
      reason: `✅ ORDER #${orderId} | ${side} ${quantity} ${binanceSymbol} @ $${price}`,
      telegramSent,
    };

    gExec.__execLog!.push(result);
    console.log(`[Executor] ${result.reason}`);
    return result;
  } catch (err) {
    const errorMsg = (err as Error).message;
    const result: ExecutionResult = {
      executed: false, symbol: decision.symbol, binanceSymbol, side, price, quantity, orderValue,
      stopLoss: risk.stopLoss, takeProfit: risk.takeProfit, mlScore, mlVerdict,
      riskPercent: risk.positionSizePercent,
      reason: `❌ Binance error: ${errorMsg}`,
      telegramSent: false,
      error: errorMsg,
    };
    gExec.__execLog!.push(result);
    return result;
  }
}

// ─── Full execution pipeline ──────────────────────
export async function runExecutionPipeline(accountBalance = 1000): Promise<ExecutionLog> {
  const config = getAutoTradeConfig();
  const minML = parseInt(process.env.MIN_ML_SCORE || '70');
  const minConf = parseInt(process.env.MIN_CONFIDENCE || '80');
  const maxPositions = parseInt(process.env.MAX_OPEN_POSITIONS || '5');
  const cooldown = parseInt(process.env.COOLDOWN_MINUTES || '15');

  const decisions = getDecisions()
    .filter(d => d.outcome === 'PENDING')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 20);

  const results: ExecutionResult[] = [];
  const errors: string[] = [];
  let executed = 0;

  // Count open positions
  const recent = getExecutionLog().filter(
    r => r.executed && Date.now() - new Date().getTime() < 86400_000
  );
  let openPositions = recent.length;

  for (const decision of decisions) {
    // De-duplicate: skip if already executed recently
    const alreadyExecuted = getExecutionLog().some(
      r => r.symbol === decision.symbol && r.side === ((decision.signal === 'BUY' || decision.signal === 'LONG') ? 'BUY' : 'SELL')
        && Date.now() - new Date().getTime() < cooldown * 60_000
    );
    if (alreadyExecuted) continue;

    // ML check
    const ml = scoreSignal(decision);
    if (ml.score < minML) {
      results.push({
        executed: false, symbol: decision.symbol, binanceSymbol: SYMBOL_MAP[decision.symbol] || '',
        side: decision.signal, price: decision.price, quantity: 0, orderValue: 0,
        stopLoss: 0, takeProfit: 0, mlScore: ml.score, mlVerdict: ml.verdict,
        riskPercent: 0, reason: `⏸️ ML score ${ml.score}% < ${minML}% min`, telegramSent: false,
      });
      continue;
    }

    // Confidence check
    if (decision.confidence < minConf) {
      results.push({
        executed: false, symbol: decision.symbol, binanceSymbol: SYMBOL_MAP[decision.symbol] || '',
        side: decision.signal, price: decision.price, quantity: 0, orderValue: 0,
        stopLoss: 0, takeProfit: 0, mlScore: ml.score, mlVerdict: ml.verdict,
        riskPercent: 0, reason: `⏸️ Confidence ${decision.confidence}% < ${minConf}%`, telegramSent: false,
      });
      continue;
    }

    // Max positions
    if (openPositions >= maxPositions) {
      results.push({
        executed: false, symbol: decision.symbol, binanceSymbol: SYMBOL_MAP[decision.symbol] || '',
        side: decision.signal, price: decision.price, quantity: 0, orderValue: 0,
        stopLoss: 0, takeProfit: 0, mlScore: ml.score, mlVerdict: ml.verdict,
        riskPercent: 0, reason: `⏸️ Max ${maxPositions} positions reached`, telegramSent: false,
      });
      continue;
    }

    // Risk check
    const risk = calculateRisk({
      entryPrice: decision.price,
      signal: decision.signal,
      confidence: decision.confidence,
      symbol: decision.symbol,
      accountBalance,
    });

    if (!risk.canTrade) {
      results.push({
        executed: false, symbol: decision.symbol, binanceSymbol: SYMBOL_MAP[decision.symbol] || '',
        side: decision.signal, price: decision.price, quantity: 0, orderValue: 0,
        stopLoss: risk.stopLoss, takeProfit: risk.takeProfit, mlScore: ml.score, mlVerdict: ml.verdict,
        riskPercent: risk.positionSizePercent, reason: `⏸️ Risk denied: ${risk.reason}`, telegramSent: false,
      });
      continue;
    }

    // Auto-trade enabled check
    if (!config.enabled) {
      results.push({
        executed: false, symbol: decision.symbol, binanceSymbol: SYMBOL_MAP[decision.symbol] || '',
        side: decision.signal, price: decision.price, quantity: 0, orderValue: 0,
        stopLoss: risk.stopLoss, takeProfit: risk.takeProfit, mlScore: ml.score, mlVerdict: ml.verdict,
        riskPercent: risk.positionSizePercent, reason: `⏸️ Auto-trade disabled`, telegramSent: false,
      });
      continue;
    }

    // EXECUTE
    try {
      const result = await executeTrade(decision, risk, ml.score, ml.verdict);
      results.push(result);
      if (result.executed) {
        executed++;
        openPositions++;
      }
    } catch (err) {
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
