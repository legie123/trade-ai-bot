import { getPrice, getBalances, getExchangeInfo } from '@/lib/exchange/binanceClient';
import { createLogger } from '@/lib/core/logger';
import { sendMessage } from '@/lib/alerts/telegram';
import { getBotConfig } from '@/lib/store/db';

const log = createLogger('ExecutionBinance');

let cachedExchangeInfo: Record<string, unknown> | null = null;
let exchangeInfoExpires = 0;

export async function getBinanceExchangeInfoCached() {
  if (cachedExchangeInfo && Date.now() < exchangeInfoExpires) {
    return cachedExchangeInfo;
  }
  cachedExchangeInfo = await getExchangeInfo();
  exchangeInfoExpires = Date.now() + 1000 * 60 * 60; // 1 hr cache
  return cachedExchangeInfo;
}

export function getBinanceSymbolFilters(exchangeInfo: { symbols?: Array<{ symbol: string; filters?: Array<{filterType: string; stepSize?: string; minQty?: string; minNotional?: string; tickSize?: string}> }> }, symbol: string) {
  let stepSize = 0.00001;
  let minQty = 0.00001;
  let minNotional = 5;
  let tickSize = 0.00001;

  if (exchangeInfo?.symbols) {
    const found = exchangeInfo.symbols.find(s => s.symbol === symbol);
    if (found?.filters) {
      for (const f of found.filters) {
        if (f.filterType === 'LOT_SIZE') {
          stepSize = parseFloat(f.stepSize || '0.00001');
          minQty = parseFloat(f.minQty || '0.00001');
        }
        if (f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL') {
          minNotional = parseFloat(f.minNotional || '5');
        }
        if (f.filterType === 'PRICE_FILTER') {
          tickSize = parseFloat(f.tickSize || '0.00001');
        }
      }
    }
  }
  return { stepSize, minQty, minNotional, tickSize };
}

export function roundToStepBinance(value: number, stepSize: number): number {
  if (!stepSize) return value;
  const precision = Math.max(0, Math.ceil(-Math.log10(stepSize + Number.EPSILON)));
  return parseFloat((Math.floor((value + Number.EPSILON * 10) / stepSize) * stepSize).toFixed(precision));
}

export async function executeBinanceTrade(symbol: string, side: 'BUY' | 'SELL') {
  try {
    const config = getBotConfig();
    const tradeAmount = config.tradeAmount || 20;

    const balances = await getBalances();
    const usdtBalance = balances.find((b: { asset: string; free: number }) => b.asset === 'USDT')?.free || 0;

    const price = await getPrice(symbol);
    if (!price) {
      return { symbol, side, price: 0, quantity: 0, usdAmount: 0, executed: false, error: 'Binance price offline' };
    }

    if (side === 'BUY' && tradeAmount > usdtBalance) {
      return { symbol, side, price, quantity: 0, usdAmount: tradeAmount, executed: false, error: `Insufficient USDT: $${usdtBalance.toFixed(2)}` };
    }

    const exchangeInfo = await getBinanceExchangeInfoCached();
    const filters = getBinanceSymbolFilters(exchangeInfo, symbol);
    let quantity = tradeAmount / price;
    quantity = roundToStepBinance(quantity, filters.stepSize);

    if (quantity < filters.minQty) {
      return { symbol, side, price, quantity, usdAmount: tradeAmount, executed: false, error: `Qty ${quantity} below min ${filters.minQty}` };
    }

    const notional = quantity * price;
    if (notional < filters.minNotional) {
      return { symbol, side, price, quantity, usdAmount: tradeAmount, executed: false, error: `Notional $${notional.toFixed(2)} below min $${filters.minNotional}` };
    }

    // DRY RUN LOGIC ALWAYS - BYPASSING ANY REAL POST CALLS
    log.info(`[BINANCE SIMULATION] Would execute ${side} ${symbol}: ${quantity} @ $${price} ($${tradeAmount.toFixed(2)}) | Balance: $${usdtBalance.toFixed(2)}`);

    const telegramMsg = `[DRY RUN BINANCE]\nPair: ${symbol}\nSide: ${side}\nPrice: $${price}\nQty: ${quantity}\nValue: $${tradeAmount.toFixed(2)}`;
    sendMessage(telegramMsg).catch(() => {});

    return {
      symbol,
      side,
      price,
      quantity,
      usdAmount: tradeAmount,
      executed: true,
      mocked: true
    };
  } catch (err) {
    log.error('[BINANCE EXECUTION FAILED]', { error: (err as Error).message });
    return { symbol, side, price: 0, quantity: 0, usdAmount: 0, executed: false, error: (err as Error).message };
  }
}
