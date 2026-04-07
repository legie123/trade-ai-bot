import { getMexcPrice, placeMexcLimitOrder, placeMexcMarketOrder, getMexcBalances, getMexcExchangeInfo } from '@/lib/exchange/mexcClient';
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

function getSymbolFilters(exchangeInfo: Record<string, unknown>, symbol: string): { minQty: number; stepSize: number; minNotional: number; tickSize: number } {
  const symbols = (exchangeInfo as { symbols?: { symbol: string; filters?: { filterType: string; minQty?: string; stepSize?: string; minNotional?: string; tickSize?: string }[] }[] }).symbols || [];
  const found = symbols.find(s => s.symbol === symbol);
  const defaults = { minQty: 0.00001, stepSize: 0.00001, minNotional: 5, tickSize: 0.00001 };
  if (!found || !found.filters) return defaults;

  for (const f of found.filters) {
    if (f.filterType === 'LOT_SIZE') {
      defaults.minQty = parseFloat(f.minQty || '0.00001');
      defaults.stepSize = parseFloat(f.stepSize || '0.00001');
    }
    if (f.filterType === 'MIN_NOTIONAL') {
      defaults.minNotional = parseFloat(f.minNotional || '5');
    }
    if (f.filterType === 'PRICE_FILTER') {
      defaults.tickSize = parseFloat(f.tickSize || '0.00001');
    }
  }
  return defaults;
}

export function roundToStep(quantity: number, stepSize: number): number {
  if (stepSize <= 0) return quantity;
  const precision = Math.max(0, Math.ceil(-Math.log10(stepSize + Number.EPSILON)));
  // Use EPSILON to avoid floating-point floor errors (e.g., 0.9999999 → 0 instead of 1)
  const stepped = Math.floor((quantity + Number.EPSILON * 10) / stepSize) * stepSize;
  return parseFloat(stepped.toFixed(precision));
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
  usdAmount?: number,
  dryRun: boolean = false
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

    // OMEGA: Dry Run support — validate everything but skip actual order
    if (dryRun) {
      log.info(`[DRY RUN] Would execute ${side} ${mexcSymbol}: ${quantity} @ $${price} ($${tradeAmount.toFixed(2)}) | Balance: $${usdtBalance.toFixed(2)}`);
    } else {
      // ANTI-SLIPPAGE BOMB: Replace vulnerable Market Order with a Tolerant Limit Order
      // Max Slippage allowed is 0.5% from the AI analysed price.
      const MAX_SLIPPAGE = 0.005;
      let limitPrice = side === 'BUY' ? price * (1 + MAX_SLIPPAGE) : price * (1 - MAX_SLIPPAGE);
      limitPrice = roundToStep(limitPrice, filters.tickSize);

      try {
        await placeMexcLimitOrder(mexcSymbol, side, quantity, limitPrice);
        log.info(`[SLIPPAGE PROTECT] Sent LIMIT ${side} for ${mexcSymbol} @ max price $${limitPrice} (AI price: $${price})`);
      } catch (err) {
        log.warn(`[LIMIT FAILED] ${(err as Error).message}. Falling back to Market Order with extreme caution.`);
        await placeMexcMarketOrder(mexcSymbol, side, quantity);
      }

      const telegramMsg = `[TRADE EXECUTION V2]\nPair: ${mexcSymbol}\nSide: ${side}\nPrice: $${price}\nQty: ${quantity}\nValue: $${tradeAmount.toFixed(2)}\nBalance: $${usdtBalance.toFixed(2)}`;
      sendMessage(telegramMsg).catch(() => {}); // Fire and forget, don't block on telegram
    }

    log.info(`[EXECUTION V2${dryRun ? ' DRY' : ''}] ${side} ${mexcSymbol}: ${quantity} @ $${price} ($${tradeAmount.toFixed(2)}) | Balance: $${usdtBalance.toFixed(2)}`);


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

