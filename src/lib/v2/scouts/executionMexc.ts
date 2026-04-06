import { getMexcPrice, placeMexcMarketOrder, getMexcBalances, getMexcExchangeInfo } from '@/lib/exchange/mexcClient';
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

// Cached exchange info to avoid re-fetching every trade
let exchangeInfoCache: { data: Record<string, unknown>; expiresAt: number } | null = null;
const EXCHANGE_INFO_TTL = 300_000; // 5min cache

async function getExchangeInfoCached(): Promise<Record<string, unknown>> {
  if (exchangeInfoCache && Date.now() < exchangeInfoCache.expiresAt) {
    return exchangeInfoCache.data;
  }
  try {
    const info = await getMexcExchangeInfo();
    exchangeInfoCache = { data: info, expiresAt: Date.now() + EXCHANGE_INFO_TTL };
    return info;
  } catch {
    return {};
  }
}

function getSymbolFilters(exchangeInfo: Record<string, unknown>, symbol: string): { minQty: number; stepSize: number; minNotional: number } {
  const symbols = (exchangeInfo as { symbols?: { symbol: string; filters?: { filterType: string; minQty?: string; stepSize?: string; minNotional?: string }[] }[] }).symbols || [];
  const found = symbols.find(s => s.symbol === symbol);
  const defaults = { minQty: 0.00001, stepSize: 0.00001, minNotional: 5 };
  if (!found || !found.filters) return defaults;

  for (const f of found.filters) {
    if (f.filterType === 'LOT_SIZE') {
      defaults.minQty = parseFloat(f.minQty || '0.00001');
      defaults.stepSize = parseFloat(f.stepSize || '0.00001');
    }
    if (f.filterType === 'MIN_NOTIONAL') {
      defaults.minNotional = parseFloat(f.minNotional || '5');
    }
  }
  return defaults;
}

function roundToStep(quantity: number, stepSize: number): number {
  if (stepSize <= 0) return quantity;
  const precision = Math.max(0, Math.ceil(-Math.log10(stepSize)));
  return parseFloat((Math.floor(quantity / stepSize) * stepSize).toFixed(precision));
}

/**
 * Dynamic position sizing: scales with balance.
 * riskPercent of balance, bounded by [$10, 20% of balance] to prevent overleveraging.
 */
function getPositionSize(balance: number, riskPercent: number = 1.5): number {
  const idealSize = balance * (riskPercent / 100);
  const maxSize = balance * 0.20; // Never risk > 20% of balance in a single trade
  const minSize = 10; // MEXC minimum for most pairs

  if (balance < minSize * 2) return 0; // Not enough balance to trade safely
  return Math.min(Math.max(idealSize, minSize), maxSize);
}

export async function executeMexcTrade(
  symbol: string,
  side: 'BUY' | 'SELL',
  usdAmount?: number
): Promise<MexcTradeResult> {
  try {
    const mexcSymbol = symbol.includes('USDT') ? symbol : `${symbol}USDT`;
    
    // Parallel fetch: price + balances + exchange info
    const [price, balances, exchangeInfo] = await Promise.all([
      getMexcPrice(mexcSymbol),
      getMexcBalances(),
      getExchangeInfoCached(),
    ]);
    
    if (!price) throw new Error(`No price for ${mexcSymbol}`);

    const usdtBalance = balances.find(b => b.asset === 'USDT')?.free || 0;
    const riskPercent = parseFloat(process.env.RISK_PER_TRADE_PERCENT || '1.5');
    const tradeAmount = usdAmount || getPositionSize(usdtBalance, riskPercent);

    if (tradeAmount <= 0) {
      return { symbol: mexcSymbol, side, price, quantity: 0, usdAmount: 0, executed: false, error: `Balance too low: $${usdtBalance.toFixed(2)}` };
    }

    if (side === 'BUY' && tradeAmount > usdtBalance) {
      return { symbol: mexcSymbol, side, price, quantity: 0, usdAmount: tradeAmount, executed: false, error: `Insufficient USDT: $${usdtBalance.toFixed(2)}` };
    }

    // Validate against MEXC exchange filters
    const filters = getSymbolFilters(exchangeInfo, mexcSymbol);
    let quantity = tradeAmount / price;
    quantity = roundToStep(quantity, filters.stepSize);

    if (quantity < filters.minQty) {
      return { symbol: mexcSymbol, side, price, quantity, usdAmount: tradeAmount, executed: false, error: `Qty ${quantity} below min ${filters.minQty}` };
    }

    const notional = quantity * price;
    if (notional < filters.minNotional) {
      return { symbol: mexcSymbol, side, price, quantity, usdAmount: tradeAmount, executed: false, error: `Notional $${notional.toFixed(2)} below min $${filters.minNotional}` };
    }

    await placeMexcMarketOrder(mexcSymbol, side, quantity);

    const telegramMsg = `[TRADE EXECUTION V2]\nPair: ${mexcSymbol}\nSide: ${side}\nPrice: $${price}\nQty: ${quantity}\nValue: $${tradeAmount.toFixed(2)}\nBalance: $${usdtBalance.toFixed(2)}`;
    await sendMessage(telegramMsg).catch(() => {}); // Don't block on telegram

    log.info(`[EXECUTION V2] ${side} ${mexcSymbol}: ${quantity} @ $${price} ($${tradeAmount.toFixed(2)}) | Balance: $${usdtBalance.toFixed(2)}`);

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

