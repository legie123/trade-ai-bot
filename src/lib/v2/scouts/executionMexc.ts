import { getMexcPrice, placeMexcMarketOrder, getMexcBalances } from '@/lib/exchange/mexcClient';
import { sendMessage } from '@/lib/alerts/telegram';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('ExecutionMexc');

export interface MexcTradeResult {
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  usdAmount: number;
  executed: boolean;
  error?: string;
}

function getPositionSize(balance: number, riskPercent: number = 1.5): number {
  const maxPosition = balance * (riskPercent / 100);
  return Math.min(Math.max(maxPosition, 5), 50);
}

export async function executeMexcTrade(
  symbol: string,
  side: 'BUY' | 'SELL',
  usdAmount?: number
): Promise<MexcTradeResult> {
  try {
    const mexcSymbol = symbol.includes('USDT') ? symbol : `${symbol}USDT`;
    const price = await getMexcPrice(mexcSymbol);
    if (!price) throw new Error(`No price for ${mexcSymbol}`);

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

    await placeMexcMarketOrder(mexcSymbol, side, quantity);

    await sendMessage(`[TRADE EXECUTION V2]\nPair: ${mexcSymbol}\nSide: ${side}\nPrice: $${price}\nValue: $${tradeAmount.toFixed(2)}`);

    log.info(`[EXECUTION V2] ${side} ${mexcSymbol}: ${quantity} @ $${price} ($${tradeAmount.toFixed(2)})`);

    return {
      symbol: mexcSymbol,
      side,
      price,
      quantity,
      usdAmount: tradeAmount,
      executed: true,
    };
  } catch (err) {
    log.error('[EXECUTION V2] Trade failed', { error: (err as Error).message });
    return { symbol, side, price: 0, quantity: 0, usdAmount: 0, executed: false, error: (err as Error).message };
  }
}
