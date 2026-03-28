import { TradingStrategy } from '@/lib/types/strategy';
import { fetchDeepHistory, HistoricCandle } from '@/lib/engine/historicalFetcher';
import { evaluateStrategy, MarketContext } from '@/lib/engine/dynamicInterpreter';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('CloudBacktester');

export interface BacktestReport {
  strategyId: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnlPercent: number;
  netProfit: number;
  profitFactor: number;
  stabilityScore: number;
  maxDrawdown: number;
  daysTested: number;
  asset: string;
}

export async function runCloudBacktest(
  strategy: TradingStrategy,
  symbol: string,
  days: number = 240
): Promise<BacktestReport> {
  log.info(`Starting cloud backtest for ${strategy.name} on ${symbol} over ${days} days...`);

  // Pull baseline 1h history. We will derive 4h and 1d from this.
  const candles1h = await fetchDeepHistory(symbol.replace('USDT', ''), '1h', days);
  
  if (candles1h.length < 500) {
    throw new Error('Insufficient historical data fetched');
  }

  let wins = 0;
  let losses = 0;
  let pnl = 0;
  let peakPnl = 0;
  let maxDrawdown = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  const oosStartIndex = Math.floor(candles1h.length * 0.75);
  let inSampleWins = 0, inSampleLosses = 0;
  let oosWins = 0, oosLosses = 0;

  interface Position {
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
  }
  let activePosition: Position | null = null;

  const closes1h = candles1h.map(c => c.c);
  
  for (let i = 200; i < candles1h.length; i++) {
    const currentPrice = closes1h[i];
    
    // Manage active position
    if (activePosition) {
       // Check SL / TP
       const high = candles1h[i].h;
       const low = candles1h[i].l;

       let closed = false;
       let tradePnl = 0;

       if (low <= activePosition.stopLoss) {
         closed = true;
         tradePnl = ((activePosition.stopLoss - activePosition.entryPrice) / activePosition.entryPrice) * 100;
       } else if (high >= activePosition.takeProfit) {
         closed = true;
         tradePnl = ((activePosition.takeProfit - activePosition.entryPrice) / activePosition.entryPrice) * 100;
       }

       if (closed) {
         // Apply absolute Transaction Costs & Slippage Reality (0.1% entry + 0.1% exit + 0.05% slippage = 0.25%)
         tradePnl -= 0.25;

         // Re-evaluate win/loss after fees!
         if (tradePnl > 0) {
            wins++;
            grossProfit += tradePnl;
            if (i >= oosStartIndex) oosWins++; else inSampleWins++;
         } else {
            losses++;
            grossLoss += Math.abs(tradePnl);
            if (i >= oosStartIndex) oosLosses++; else inSampleLosses++;
         }

         pnl += tradePnl;
         activePosition = null;
         
         if (pnl > peakPnl) peakPnl = pnl;
         const drawdown = peakPnl - pnl;
         if (drawdown > maxDrawdown) maxDrawdown = drawdown;
       }
       continue; // Only 1 position per strategy
    }

    // Evaluate Entry
    const slice1h = closes1h.slice(0, i + 1);
    
    // 4h = every 4th candle
    const slice4h = slice1h.filter((_, idx) => (slice1h.length - 1 - idx) % 4 === 0);

    const context: MarketContext = {
      symbol,
      price: currentPrice,
      closes15m: slice1h, // Mock 15m as 1h to avoid rewriting strategies that expect 15m
      closes1h: slice1h,
      closes4h: slice4h,
      vwap: currentPrice, // Mock VWAP for speed if not passed
      volumeMA: 1
    };

    if (evaluateStrategy(strategy, context)) {
      // Calculate Adaptive Volatility (ATR 14) dynamically at the exact point of execution
      let atr = 0;
      if (i >= 14 && strategy.risk.useAtrMultipliers) {
         let trSum = 0;
         for (let j = i - 13; j <= i; j++) {
            const currentH = candles1h[j].h;
            const currentL = candles1h[j].l;
            const prevC = candles1h[j - 1].c;
            const tr = Math.max(currentH - currentL, Math.abs(currentH - prevC), Math.abs(currentL - prevC));
            trSum += tr;
         }
         atr = trSum / 14;
      }

      // If ATR is active and valid, map the distances dynamically, else fallback to hard fixed %
      const slPercent = (strategy.risk.useAtrMultipliers && atr > 0 && strategy.risk.atrStopLossMultiplier) 
         ? ((atr * strategy.risk.atrStopLossMultiplier) / currentPrice) * 100 
         : Math.abs(strategy.risk.stopLossPercent);
         
      const tpPercent = (strategy.risk.useAtrMultipliers && atr > 0 && strategy.risk.atrTakeProfitMultiplier) 
         ? ((atr * strategy.risk.atrTakeProfitMultiplier) / currentPrice) * 100 
         : Math.abs(strategy.risk.takeProfitPercent);

      // ENTER POSITION
       activePosition = {
         entryPrice: currentPrice,
         stopLoss: currentPrice * (1 - slPercent / 100),
         takeProfit: currentPrice * (1 + tpPercent / 100)
       };
    }
  }

  const totalTrades = wins + losses;
  let winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0);
  
  // WALK-FORWARD OOS PENALTY (Blind unseen data test)
  const inSampleWinRate = (inSampleWins + inSampleLosses) > 0 ? (inSampleWins / (inSampleWins + inSampleLosses)) * 100 : winRate;
  const oosWinRate = (oosWins + oosLosses) > 0 ? (oosWins / (oosWins + oosLosses)) * 100 : winRate;
  
  // If the OOS degradation is massive (drops more than 20% from IS) or OOS WinRate is catastrophic (< 50%)
  if (((inSampleWinRate - oosWinRate) > 20 || oosWinRate < 50) && (oosWins + oosLosses) >= 3) {
      log.warn(`Walk-Forward failed for ${strategy.name}: IS=${inSampleWinRate.toFixed(1)}% -> OOS=${oosWinRate.toFixed(1)}%. Triggering Purge by crashing WR.`);
      winRate = Math.min(winRate, 40); // Mathematically guarantee execution by Rank Engine
  }

  // Stability Score Formula: Max 100
  // Up to 50 pts for DB Win Rate, 30 pts for Profit Factor, 20 pts from surviving drawdown
  let stabilityScore = (Math.min(winRate, 100) * 0.5) 
                     + (Math.min(profitFactor, 3) / 3 * 30) 
                     + (Math.max(0, 20 - maxDrawdown));
  stabilityScore = Math.max(0, Math.min(100, Math.round(stabilityScore)));
  
  return {
    strategyId: strategy.id,
    totalTrades,
    wins,
    losses,
    winRate: Math.round(winRate * 100) / 100,
    pnlPercent: Math.round(pnl * 100) / 100,
    netProfit: Math.round(pnl * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    stabilityScore,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    daysTested: days,
    asset: symbol
  };
}
