// ============================================================
// MEXC Auto-Trader — Execute real trades on MEXC
// ============================================================
import { getDecisions } from '@/lib/store/db';
import { getMexcPrice, placeMexcMarketOrder, getMexcBalances } from '@/lib/exchange/mexcClient';
import { sendTradeAlert } from '@/lib/alerts/pnlAlerts';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('MexcAutoTrader');

interface MexcTradeResult {
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  usdAmount: number;
  executed: boolean;
  error?: string;
}

// Check if we can trade based on risk rules
function canTrade(): { allowed: boolean; reason?: string } {
  const decisions = getDecisions();
  const today = new Date().toISOString().slice(0, 10);
  const todayDecisions = decisions.filter(d => d.timestamp.startsWith(today));
  const maxPositions = parseInt(process.env.MAX_OPEN_POSITIONS || '5');
  const pendingCount = decisions.filter(d => d.outcome === 'PENDING').length;

  if (pendingCount >= maxPositions) {
    return { allowed: false, reason: `Max positions reached (${pendingCount}/${maxPositions})` };
  }

  // Daily loss check
  const losses = todayDecisions.filter(d => d.outcome === 'LOSS').length;
  if (losses >= 5) {
    return { allowed: false, reason: 'Daily loss limit (5 losses today)' };
  }

  return { allowed: true };
}

// Calculate position size based on risk
function getPositionSize(balance: number, riskPercent: number = 1.5): number {
  const maxPosition = balance * (riskPercent / 100);
  // Min $5 (MEXC minimum), max $50 for safety
  return Math.min(Math.max(maxPosition, 5), 50);
}

// Execute a trade on MEXC
export async function executeMexcTrade(
  symbol: string,
  side: 'BUY' | 'SELL',
  usdAmount?: number
): Promise<MexcTradeResult> {
  try {
    // Check risk rules
    const riskCheck = canTrade();
    if (!riskCheck.allowed) {
      return { symbol, side, price: 0, quantity: 0, usdAmount: 0, executed: false, error: riskCheck.reason };
    }

    // Get current price
    const mexcSymbol = symbol.includes('USDT') ? symbol : `${symbol}USDT`;
    const price = await getMexcPrice(mexcSymbol);
    if (!price) throw new Error(`No price for ${mexcSymbol}`);

    // Get balance for position sizing
    const balances = await getMexcBalances();
    const usdtBalance = balances.find(b => b.asset === 'USDT')?.free || 0;

    const riskPercent = parseFloat(process.env.RISK_PER_TRADE_PERCENT || '1.5');
    const tradeAmount = usdAmount || getPositionSize(usdtBalance, riskPercent);

    if (side === 'BUY' && tradeAmount > usdtBalance) {
      return { symbol: mexcSymbol, side, price, quantity: 0, usdAmount: tradeAmount, executed: false, error: `Insufficient USDT: $${usdtBalance.toFixed(2)}` };
    }

    const quantity = parseFloat((tradeAmount / price).toFixed(8));
    if (quantity <= 0) {
      return { symbol: mexcSymbol, side, price, quantity: 0, usdAmount: tradeAmount, executed: false, error: 'Quantity too small' };
    }

    // Execute
    await placeMexcMarketOrder(mexcSymbol, side, quantity);

    // Send Telegram alert
    await sendTradeAlert(side, mexcSymbol, price, tradeAmount, 'MEXC');

    log.info(`${side} ${mexcSymbol}: ${quantity} @ $${price} ($${tradeAmount.toFixed(2)})`);

    return {
      symbol: mexcSymbol,
      side,
      price,
      quantity,
      usdAmount: tradeAmount,
      executed: true,
    };
  } catch (err) {
    return { symbol, side: side, price: 0, quantity: 0, usdAmount: 0, executed: false, error: (err as Error).message };
  }
}

// Scan decisions and execute approved signals on MEXC
export async function runMexcAutoTrader(): Promise<MexcTradeResult[]> {
  if (process.env.ACTIVE_EXCHANGE !== 'mexc') {
    return [{ symbol: '-', side: 'BUY', price: 0, quantity: 0, usdAmount: 0, executed: false, error: 'MEXC not active. Set ACTIVE_EXCHANGE=mexc' }];
  }

  const decisions = getDecisions()
    .filter(d => d.outcome === 'PENDING')
    .filter(d => d.confidence >= parseInt(process.env.MIN_CONFIDENCE || '80'))
    .slice(0, 3); // Max 3 trades per cycle

  const results: MexcTradeResult[] = [];

  for (const d of decisions) {
    const result = await executeMexcTrade(d.symbol, d.signal as 'BUY' | 'SELL');
    results.push(result);
    // Cooldown between trades
    await new Promise(r => setTimeout(r, 2000));
  }

  return results;
}
