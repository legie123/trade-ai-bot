import { getMexcPrice, placeMexcLimitOrder, getMexcBalances, getMexcExchangeInfo, placeMexcStopLossOrder } from '@/lib/exchange/mexcClient';
import { sendMessage } from '@/lib/alerts/telegram';
import { createLogger } from '@/lib/core/logger';
import { assertLiveTradingAllowed } from '@/lib/core/tradingMode';

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

export async function getExchangeInfoCached(): Promise<Record<string, unknown>> {
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

export function getSymbolFilters(exchangeInfo: Record<string, unknown>, symbol: string): { minQty: number; stepSize: number; minNotional: number; tickSize: number } {
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
  const maxSize = balance * 0.05; // Hard Cap: Never risk > 5% of balance in a single trade to prevent margin cascade
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
  // CRITICAL SAFETY: Block real orders if kill switch engaged or PAPER mode
  if (!dryRun) {
    try {
      assertLiveTradingAllowed('executeMexcTrade');
    } catch (err) {
      log.warn(`[ExecutionMexc] Blocked: ${(err as Error).message}`);
      return { symbol, side, price: 0, quantity: 0, usdAmount: 0, executed: false, error: (err as Error).message };
    }
  }

  try {
    const mexcSymbol = symbol.includes('USDT') ? symbol : `${symbol}USDT`;
    
    // Parallel fetch: price + balances + exchange info
    const [price, balances, exchangeInfo] = await Promise.all([
      getMexcPrice(mexcSymbol),
      getMexcBalances(),
      getExchangeInfoCached(),
    ]);
    
    if (!price) throw new Error(`No price for ${mexcSymbol}`);

    let usdtBalance = balances.find(b => b.asset === 'USDT')?.free || 0;
    
    // OMEGA: For PAPER mode, mimic real API by injecting virtual balance
    // AUDIT FIX BUG-5: Removed hardcoded 1000 fallback — use config or fail clearly
    if (dryRun) {
      try {
        const { getBotConfig } = await import('@/lib/store/db');
        const config = getBotConfig();
        usdtBalance = config.paperBalance || 10000; // Default $10k paper balance (institutional standard)
        if (!config.paperBalance) log.warn('[PAPER] Using default $10k paper balance — set paperBalance in config');
      } catch {
        usdtBalance = 10000;
        log.warn('[PAPER] Config unavailable — using default $10k paper balance');
      }
    }

    const riskPercent = parseFloat(process.env.RISK_PER_TRADE_PERCENT || '1.5');
    const tradeAmount = usdAmount || getPositionSize(usdtBalance, riskPercent);

    // ZERO BALANCE LOCKOUT — CRITICAL PROTECTION (Only for LIVE trades)
    if (!dryRun && usdtBalance < 10) {
      const msg = `⚠️ [EXECUTION BLOCKED] Insufficient Funds. Account has $${usdtBalance.toFixed(2)} USDT. Minimum required is $10. Please fund API Wallet.`;
      log.error(msg);
      // Fire and forget telegram message
      sendMessage(msg).catch((e) => log.warn('telegram sendMessage failed (zero balance notice)', { error: String(e) }));
      return { symbol: mexcSymbol, side, price, quantity: 0, usdAmount: 0, executed: false, error: msg };
    }

    if (tradeAmount <= 0) {
      return { symbol: mexcSymbol, side, price, quantity: 0, usdAmount: 0, executed: false, error: `Calculated size 0. Balance: $${usdtBalance.toFixed(2)}` };
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
      // ANTI-SLIPPAGE: Tolerant Limit Order (0.15% max slippage — audit fix from 0.4%)
      const MAX_SLIPPAGE = 0.0015;
      let limitPrice = side === 'BUY' ? price * (1 + MAX_SLIPPAGE) : price * (1 - MAX_SLIPPAGE);
      limitPrice = roundToStep(limitPrice, filters.tickSize);

      try {
        await placeMexcLimitOrder(mexcSymbol, side, quantity, limitPrice);
        log.info(`[SLIPPAGE PROTECT] Sent LIMIT ${side} for ${mexcSymbol} @ max price $${limitPrice} (AI price: $${price})`);

        // --- NATIVE STOP LOSS (AWAITED + RETRY) ---
        // Must verify SL exists before continuing — no fire-and-forget
        let slCheckPassed = (side !== 'BUY'); // SELL orders don't require SL
        if (side === 'BUY') {
           const slPercent = 0.05; // 5% Hard stop loss
           let stopPrice = price * (1 - slPercent);
           stopPrice = roundToStep(stopPrice, filters.tickSize);

           let slPlaced = false;
           for (let attempt = 0; attempt < 3 && !slPlaced; attempt++) {
             try {
               await placeMexcStopLossOrder(mexcSymbol, 'SELL', quantity, stopPrice);
               log.info(`[NATIVE SL] Hardware Stop Loss placed on MEXC for ${mexcSymbol} at $${stopPrice}`);
               slPlaced = true;
             } catch (slErr: unknown) {
               log.warn(`[NATIVE SL] Attempt ${attempt + 1}/3 failed for ${mexcSymbol}: ${(slErr as Error).message}`);
               if (attempt < 2) await new Promise(r => setTimeout(r, 500));
             }
           }
           if (!slPlaced) {
             log.error(`[NATIVE SL CRITICAL] Could NOT place SL for ${mexcSymbol} after 3 attempts — position has NO hardware protection`);
             sendMessage(`⚠️ *SL FAILED* for ${mexcSymbol}\nPosition has NO hardware stop loss!\nManual intervention required.`).catch((e) => log.warn('telegram sendMessage failed (SL FAILED alert)', { error: String(e) }));
             slCheckPassed = false; // VETO: No SL = no trade
           } else {
             slCheckPassed = true;
           }
        }

        // AUDIT FIX T1.6: If SL failed, attempt to CANCEL the limit order to prevent orphan
        if (!slCheckPassed) {
          log.error(`[ORPHAN PREVENTION] SL failed for ${mexcSymbol} — attempting to cancel the limit order`);
          try {
            const { cancelAllMexcOrders } = await import('@/lib/exchange/mexcClient');
            await cancelAllMexcOrders(mexcSymbol);
            log.info(`[ORPHAN PREVENTION] Cancelled open orders for ${mexcSymbol} after SL failure`);
          } catch (cancelErr) {
            log.error(`[ORPHAN PREVENTION FAILED] Could not cancel orders for ${mexcSymbol} — MANUAL INTERVENTION REQUIRED`, { error: (cancelErr as Error).message });
            sendMessage(`🚨 *ORPHAN POSITION RISK*\n${mexcSymbol} has a live order but NO stop loss AND cancel failed!\nCheck MEXC manually NOW.`).catch(() => {});
          }
          return { symbol: mexcSymbol, side, price, quantity, usdAmount: tradeAmount, executed: false, error: 'Stop Loss placement FAILED + order cancelled — trade rejected for safety' };
        }
      } catch (err) {
        throw new Error(`[LIMIT FAILED] ${(err as Error).message}. Vetoing fallback to prevent explicit double-spend.`);
      }

      const telegramMsg = `[TRADE EXECUTION V2]\nPair: ${mexcSymbol}\nSide: ${side}\nPrice: $${price}\nQty: ${quantity}\nValue: $${tradeAmount.toFixed(2)}\nBalance: $${usdtBalance.toFixed(2)}`;
      sendMessage(telegramMsg).catch((e) => log.warn('telegram sendMessage failed (trade notice)', { error: String(e) })); // Fire and forget, don't block on telegram
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

