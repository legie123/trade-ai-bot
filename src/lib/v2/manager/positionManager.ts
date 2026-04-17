import { getLivePositions, updateLivePosition, LivePosition } from '@/lib/store/db';
import { placeMexcMarketOrder, placeMexcLimitOrder, cancelAllMexcOrders } from '@/lib/exchange/mexcClient';
import { getOrFetchPrice } from '@/lib/cache/priceCache';
import { getExchangeInfoCached, getSymbolFilters, roundToStep } from '@/lib/v2/scouts/executionMexc';
import { createLogger } from '@/lib/core/logger';
import { postActivity } from '@/lib/moltbook/moltbookClient';
import { DNAExtractor } from '../superai/dnaExtractor';
import { isLiveTradingEnabled } from '@/lib/core/tradingMode';
import { isKillSwitchEngaged } from '@/lib/core/killSwitch';
import { experienceMemory } from '@/lib/v2/memory/experienceMemory';

const log = createLogger('PositionManager');

/**
 * Step 3.2 wiring: Record trade outcome to Experience Memory.
 * Called after every position close (TP, trailing exit, SL).
 * Fire-and-forget — never blocks position management.
 */
function recordExperience(pos: LivePosition, exitPrice: number, pnlPercent: number): void {
  try {
    const isWin = pnlPercent > 0;
    const direction = (pos.side === 'LONG' ? 'LONG' : 'SHORT') as 'LONG' | 'SHORT';
    experienceMemory.record({
      timestamp: Date.now(),
      symbol: pos.symbol,
      direction,
      outcome: isWin ? 'WIN' : 'LOSS',
      pnlPercent,
      regime: null,        // regime not available in positionManager context
      indicators: {},      // indicators not stored on LivePosition
      confidence: 0.5,     // confidence not stored on LivePosition
      debateVerdict: null,
      gladiatorId: pos.id.replace('pos_', ''),
      slippageBps: null,
      latencyMs: null,
      mode: 'LIVE',
    });
  } catch {
    // Non-blocking — experience memory recording must never affect exits
  }
}

// Asymmetric Trailing TP rules mapping to bot logic
const ASYMMETRIC_RULES = {
  active: true,
  partialTakeProfitPercent: 1.0, // 1% profit target for T1
  partialTakeProfitAmount: 0.3,   // 30% of position sizing
  trailingStopWidePercent: 5.0    // 5% wide trailing after T1
};

export class PositionManager {
  private static instance: PositionManager;

  private constructor() {}

  public static getInstance(): PositionManager {
    if (!PositionManager.instance) {
      PositionManager.instance = new PositionManager();
    }
    return PositionManager.instance;
  }

  public async evaluateLivePositions() {
    if (!isLiveTradingEnabled()) {
      log.info('[PositionManager] Skipped — TRADING_MODE=PAPER. No live position evaluation.');
      return;
    }

    // CRITICAL FIX: Kill switch must block position management orders too
    if (isKillSwitchEngaged()) {
      log.warn('[PositionManager] BLOCKED — Kill switch is engaged. No orders will be placed.');
      return;
    }
    const openPositions = getLivePositions().filter(p => p.status === 'OPEN');
    if (openPositions.length === 0) return;

    log.info(`[PositionManager] Evaluating ${openPositions.length} open positions for Asymmetric TP/SL...`);

    for (const pos of openPositions) {
      try {
        await this.evaluateSinglePosition(pos);
      } catch (err) {
        log.error(`[PositionManager] Error evaluating position ${pos.id}`, { error: String(err) });
      }
    }
  }

  private async evaluateSinglePosition(pos: LivePosition) {
    // INSTITUTIONAL FIX: Use global PriceCache (MEXC → DexScreener → CoinGecko)
    // instead of hitting MEXC directly per position. Prevents IP bans at scale.
    const currentPrice = await getOrFetchPrice(pos.symbol);
    if (!currentPrice || currentPrice <= 0) return;

    const isLong = pos.side === 'LONG';
    const highestPriceObserved = Math.max(pos.highestPriceObserved, currentPrice);
    const lowestPriceObserved = Math.min(pos.lowestPriceObserved, currentPrice);
    let needsUpdate = false;

    if (highestPriceObserved > pos.highestPriceObserved || lowestPriceObserved < pos.lowestPriceObserved) {
       needsUpdate = true;
    }

    if (!ASYMMETRIC_RULES.active) {
       if (needsUpdate) {
         updateLivePosition(pos.id, { highestPriceObserved, lowestPriceObserved });
       }
       return;
    }

    // ─── TIER 1: Partial Take Profit Check ───
    if (!pos.partialTPHit) {
      const tpPrice = isLong 
        ? pos.entryPrice * (1 + ASYMMETRIC_RULES.partialTakeProfitPercent / 100)
        : pos.entryPrice * (1 - ASYMMETRIC_RULES.partialTakeProfitPercent / 100);

      const hitTP = isLong ? currentPrice >= tpPrice : currentPrice <= tpPrice;

      if (hitTP) {
        log.info(`🎯 [PositionManager] Target 1 Hit for ${pos.symbol}! Securing partial profits.`);
        
        // Calculate 30% position exit size
        const rawExitQty = pos.quantity * ASYMMETRIC_RULES.partialTakeProfitAmount;
        
        try {
          const exchangeInfo = await getExchangeInfoCached();
          const filters = getSymbolFilters(exchangeInfo, pos.symbol);
          
          const roundedExitQty = roundToStep(rawExitQty, filters.stepSize);
          const limitPrice = roundToStep(currentPrice, filters.tickSize);

          if (roundedExitQty < filters.minQty) throw new Error("quantity too low for LOT_SIZE");
          if (roundedExitQty * limitPrice < filters.minNotional) throw new Error("notional below Min-Notional limit");

          // Asymmetric T1: Strict Limit Order to prevent Take-Profit slippage (T1 is guaranteed profit, no slippage allowed)
          // Hard Mode: We use MEXC Limit Order with precise price
          await placeMexcLimitOrder(pos.symbol, isLong ? 'SELL' : 'BUY', roundedExitQty, limitPrice);
          log.info(`💸 [PositionManager] Limit T1 Executed: Sold ${roundedExitQty} of ${pos.symbol} at ${limitPrice}`);

          updateLivePosition(pos.id, {
            partialTPHit: true,
            quantity: pos.quantity - roundedExitQty,
            highestPriceObserved,
            lowestPriceObserved
          });

          // DNA LEARNING: Log partial TP as a WIN to the RL loop
          const pnl = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 * (isLong ? 1 : -1);
          await DNAExtractor.getInstance().logBattle({
            id: `live_tp_${pos.id}`,
            gladiatorId: pos.id.replace('pos_', ''),
            symbol: pos.symbol,
            decision: isLong ? 'LONG' : 'SHORT',
            entryPrice: pos.entryPrice,
            outcomePrice: currentPrice,
            pnlPercent: parseFloat(pnl.toFixed(4)),
            isWin: pnl > 0,
            timestamp: Date.now(),
            marketContext: { exitType: 'PARTIAL_TP', holdTimeSec: (Date.now() - new Date(pos.openedAt).getTime()) / 1000 }
          });
          recordExperience(pos, currentPrice, parseFloat(pnl.toFixed(4)));

          // 🔗 [MOLTBOOK BROADCAST] Partial TP
          this.broadcastExitToMoltbook('PARTIAL_TP', pos.symbol, isLong ? 'LONG' : 'SHORT', currentPrice, 30);
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          log.error(`[PositionManager] Failed to execute partial TP order for ${pos.symbol}:`, { error: errorMsg });
          if (errorMsg.includes('Min-Notional') || errorMsg.includes('quantity too low') || errorMsg.includes('insufficient')) {
             log.warn(`🚨 [ZOMBIE PREVENTION] Closing FULL position ${pos.symbol} at T1 because remaining size is untradable dust.`);
             const exchangeInfo = await getExchangeInfoCached();
             const filters = getSymbolFilters(exchangeInfo, pos.symbol);
             const remainingQty = roundToStep(pos.quantity, filters.stepSize);
             if (remainingQty >= filters.minQty) {
                await cancelAllMexcOrders(pos.symbol).catch((e) => log.error('cancelAllMexcOrders failed (zombie prevention)', { symbol: pos.symbol, error: String(e) }));
                await placeMexcMarketOrder(pos.symbol, isLong ? 'SELL' : 'BUY', remainingQty).catch((e) => log.error('placeMexcMarketOrder failed (zombie prevention exit)', { symbol: pos.symbol, error: String(e) }));
             }
             updateLivePosition(pos.id, { status: 'CLOSED' });
          }
        }
        return; // State changed, exit evaluation block
      }
    }

    // ─── TIER 2: Asymmetric Trailing Stop Loss (Post-T1) ───
    if (pos.partialTPHit) {
       const trailingSLPrice = isLong
         ? highestPriceObserved * (1 - ASYMMETRIC_RULES.trailingStopWidePercent / 100)
         : lowestPriceObserved * (1 + ASYMMETRIC_RULES.trailingStopWidePercent / 100);

       const hitSL = isLong ? currentPrice <= trailingSLPrice : currentPrice >= trailingSLPrice;

       if (hitSL) {
          log.warn(`🚨 [PositionManager] Trailing Stop Hit for ${pos.symbol} at ${currentPrice}. Closing remaining 70%.`);
          
          try {
            const exchangeInfo = await getExchangeInfoCached();
            const filters = getSymbolFilters(exchangeInfo, pos.symbol);
            const remainingQty = roundToStep(pos.quantity, filters.stepSize);
            
            if (remainingQty < filters.minQty) {
              log.warn(`🚨 [PositionManager] Remaining qty ${remainingQty} is dust. Marking as CLOSED directly.`);
              updateLivePosition(pos.id, { status: 'CLOSED' });
              return;
            }

            await cancelAllMexcOrders(pos.symbol).catch((e) => log.error('cancelAllMexcOrders failed (trailing exit)', { symbol: pos.symbol, error: String(e) }));
            await placeMexcMarketOrder(pos.symbol, isLong ? 'SELL' : 'BUY', remainingQty);

            updateLivePosition(pos.id, {
               status: 'CLOSED',
               highestPriceObserved,
               lowestPriceObserved
            });

            // DNA LEARNING: Log trailing exit
            const trailPnl = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 * (isLong ? 1 : -1);
            await DNAExtractor.getInstance().logBattle({
              id: `live_trail_${pos.id}`,
              gladiatorId: pos.id.replace('pos_', ''),
              symbol: pos.symbol,
              decision: isLong ? 'LONG' : 'SHORT',
              entryPrice: pos.entryPrice,
              outcomePrice: currentPrice,
              pnlPercent: parseFloat(trailPnl.toFixed(4)),
              isWin: trailPnl > 0,
              timestamp: Date.now(),
              marketContext: { exitType: 'TRAILING_EXIT', holdTimeSec: (Date.now() - new Date(pos.openedAt).getTime()) / 1000 }
            });
            recordExperience(pos, currentPrice, parseFloat(trailPnl.toFixed(4)));
            log.info(`[PositionManager] Trailing exit complete for ${pos.symbol}. Home run secured.`);

            // 🔗 [MOLTBOOK BROADCAST] Full Trailing Exit
            this.broadcastExitToMoltbook('TRAILING_EXIT', pos.symbol, isLong ? 'LONG' : 'SHORT', currentPrice, 70).catch((e) => log.warn('moltbook broadcast failed (trailing)', { error: String(e) }));
          } catch (err: unknown) {
             const errorMsg = err instanceof Error ? err.message : String(err);
             log.error(`[PositionManager] Failed trailing SL order for ${pos.symbol}:`, { error: errorMsg });
             if (errorMsg.includes('Min-Notional') || errorMsg.includes('quantity too low') || errorMsg.includes('insufficient')) {
               log.warn(`🚨 [ZOMBIE PREVENTION] Closing position ${pos.symbol} in DB due to unfillable MEXC state.`);
               updateLivePosition(pos.id, { status: 'CLOSED' });
             }
          }
          return;
       }
    } else {
       // ─── INITIAL SAFETY NET: Fixed SL before T1 ───
       const initialSLPrice = isLong 
         ? pos.entryPrice * (1 - ASYMMETRIC_RULES.trailingStopWidePercent / 100)
         : pos.entryPrice * (1 + ASYMMETRIC_RULES.trailingStopWidePercent / 100);
         
       const hitInitialSL = isLong ? currentPrice <= initialSLPrice : currentPrice >= initialSLPrice;

       if (hitInitialSL) {
          log.error(`🛑 [PositionManager] Initial Fixed SL Hit for ${pos.symbol} at ${currentPrice}. Closing full position.`);
          
          try {
            const exchangeInfo = await getExchangeInfoCached();
            const filters = getSymbolFilters(exchangeInfo, pos.symbol);
            const remainingQty = roundToStep(pos.quantity, filters.stepSize);
            
            if (remainingQty < filters.minQty) {
              log.warn(`🚨 [PositionManager] Remaining qty ${remainingQty} is dust. Marking as CLOSED directly.`);
              updateLivePosition(pos.id, { status: 'CLOSED' });
              return;
            }

            await cancelAllMexcOrders(pos.symbol).catch((e) => log.error('cancelAllMexcOrders failed (initial SL)', { symbol: pos.symbol, error: String(e) }));
            await placeMexcMarketOrder(pos.symbol, isLong ? 'SELL' : 'BUY', remainingQty);

            updateLivePosition(pos.id, {
               status: 'CLOSED',
               highestPriceObserved,
               lowestPriceObserved
            });

            // DNA LEARNING: Log stop loss as LOSS — critical for RL
            const slPnl = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 * (isLong ? 1 : -1);
            await DNAExtractor.getInstance().logBattle({
              id: `live_sl_${pos.id}`,
              gladiatorId: pos.id.replace('pos_', ''),
              symbol: pos.symbol,
              decision: isLong ? 'LONG' : 'SHORT',
              entryPrice: pos.entryPrice,
              outcomePrice: currentPrice,
              pnlPercent: parseFloat(slPnl.toFixed(4)),
              isWin: false,
              timestamp: Date.now(),
              marketContext: { exitType: 'STOP_LOSS', holdTimeSec: (Date.now() - new Date(pos.openedAt).getTime()) / 1000 }
            });
            recordExperience(pos, currentPrice, parseFloat(slPnl.toFixed(4)));

            // 🔗 [MOLTBOOK BROADCAST] Initial SL
            this.broadcastExitToMoltbook('STOP_LOSS', pos.symbol, isLong ? 'LONG' : 'SHORT', currentPrice, 100).catch((e) => log.warn('moltbook broadcast failed (SL)', { error: String(e) }));
          } catch (err: unknown) {
             const errorMsg = err instanceof Error ? err.message : String(err);
             log.error(`[PositionManager] Failed initial SL order for ${pos.symbol}:`, { error: errorMsg });
             if (errorMsg.includes('Min-Notional') || errorMsg.includes('quantity too low') || errorMsg.includes('insufficient')) {
               log.warn(`🚨 [ZOMBIE PREVENTION] Marking ${pos.symbol} STOP LOSS as CLOSED locally to drop phantom size.`);
               updateLivePosition(pos.id, { status: 'CLOSED' });
             }
          }
          return;
       }
    }

    if (needsUpdate) {
       updateLivePosition(pos.id, { highestPriceObserved, lowestPriceObserved });
    }
  }

  private async broadcastExitToMoltbook(type: 'PARTIAL_TP' | 'TRAILING_EXIT' | 'STOP_LOSS', symbol: string, side: string, price: number, percent: number) {
    try {
      const title = type === 'STOP_LOSS' ? '🛑 STOP LOSS ATINS' : (type === 'PARTIAL_TP' ? '🎯 PROFIT SECURE (30%)' : '💸 TRAILING EXIT (70%)');
      const message = `${title} 🚨\n\n` +
        `Asset: $ ${symbol}\n` +
        `Tip Exe: ${type}\n` +
        `Preț Ieșire: $ ${price.toLocaleString()}\n` +
        `Procent Închis: ${percent}%\n\n` +
        `Phoenix V2 gestionează asimetric profitul pentru a maximiza câștigurile protejând intrarea. #Antigravity #ExitStrategy #SafeProfit`;

      await postActivity(message, undefined, 'crypto');
    } catch {
      // Non-critical: Moltbook issue should not fail evaluation
    }
  }
}

export const positionManager = PositionManager.getInstance();
