// ============================================================
// Trade Evaluator — checks if signals were profitable
// Runs periodically; updates DecisionSnapshots with outcomes
// ============================================================
import { getPendingDecisions, updateDecision, recalculatePerformance } from '@/lib/store/db';
import { fetchWithRetry } from '@/lib/providers/base';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('TradeEvaluator');

// ─── Fetch current BTC price ───────────────────────
async function getCurrentPrice(symbol: string): Promise<number> {
  if (symbol.toUpperCase() === 'BTC' || symbol.toUpperCase() === 'BTCUSDT') {
    try {
      const res = await fetchWithRetry(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
        { retries: 2, timeoutMs: 5000 }
      );
      const data = await res.json();
      return data?.bitcoin?.usd || 0;
    } catch {
      return 0;
    }
  }
  // For altcoins, use DEX Screener
  try {
    const res = await fetchWithRetry(
      `https://api.dexscreener.com/dex/search?q=${symbol}`,
      { retries: 1, timeoutMs: 5000 }
    );
    const data = await res.json();
    return data?.pairs?.[0] ? parseFloat(data.pairs[0].priceUsd) : 0;
  } catch {
    return 0;
  }
}

// ─── Determine WIN/LOSS ────────────────────────────
function evaluateOutcome(
  signal: string,
  entryPrice: number,
  currentPrice: number,
  threshold = 0.3 // 0.3% threshold for win/loss
): { outcome: 'WIN' | 'LOSS' | 'NEUTRAL'; pnlPercent: number } {
  if (entryPrice === 0) return { outcome: 'NEUTRAL', pnlPercent: 0 };

  const changePercent = ((currentPrice - entryPrice) / entryPrice) * 100;

  // BUY/LONG = win if price went up
  if (signal === 'BUY' || signal === 'LONG') {
    if (changePercent > threshold) return { outcome: 'WIN', pnlPercent: Math.round(changePercent * 100) / 100 };
    if (changePercent < -threshold) return { outcome: 'LOSS', pnlPercent: Math.round(changePercent * 100) / 100 };
    return { outcome: 'NEUTRAL', pnlPercent: Math.round(changePercent * 100) / 100 };
  }

  // SELL/SHORT = win if price went down
  if (signal === 'SELL' || signal === 'SHORT') {
    if (changePercent < -threshold) return { outcome: 'WIN', pnlPercent: Math.round(-changePercent * 100) / 100 };
    if (changePercent > threshold) return { outcome: 'LOSS', pnlPercent: Math.round(-changePercent * 100) / 100 };
    return { outcome: 'NEUTRAL', pnlPercent: Math.round(-changePercent * 100) / 100 };
  }

  return { outcome: 'NEUTRAL', pnlPercent: 0 };
}

// ─── Main evaluation runner ────────────────────────
export async function evaluatePendingDecisions(): Promise<{
  evaluated: number;
  wins: number;
  losses: number;
}> {
  const pending = getPendingDecisions();
  if (pending.length === 0) return { evaluated: 0, wins: 0, losses: 0 };

  let evaluated = 0;
  let wins = 0;
  let losses = 0;
  const now = Date.now();

  for (const decision of pending) {
    const ageMinutes = (now - new Date(decision.timestamp).getTime()) / 60000;

    const currentPrice = await getCurrentPrice(decision.symbol);
    if (currentPrice === 0) continue;

    // Calculate live PnL %
    const changePercent = ((currentPrice - decision.price) / decision.price) * 100;
    
    // Trailing TP/SL levels (Dynamic Asset Segregation / Golden Configs from Grid Sweep)
    let TAKE_PROFIT = 3.0; // Default
    let STOP_LOSS = 0.5;   // Default (Sniper cut loss)

    const symbol = decision.symbol.toUpperCase();
    const volatileMemes = ['BONK', 'WIF', 'MEW', 'BOME', 'POPCAT', 'PEPE', 'SHIB', 'DOGE', 'FLOKI'];
    const stableMajors = ['BTC', 'ETH', 'SOL'];

    if (volatileMemes.includes(symbol)) {
      TAKE_PROFIT = 5.0; // High Reward for memes
      STOP_LOSS = 2.0;   // Wide Room for volatility
    } else if (stableMajors.includes(symbol)) {
      TAKE_PROFIT = 3.5; // Adjusted TP for majors
      STOP_LOSS = 2.0;   // Widened from 1.4% → 2.0% to avoid noise exits in chop
    } else {
      // Mid-caps (JTO, JUP, RAY, RNDR, PYTH etc)
      TAKE_PROFIT = 4.0; 
      STOP_LOSS = 1.5;   // Widened from 1.0% → 1.5%
    }

    let forcedOutcome: 'WIN' | 'LOSS' | null = null;
    let forcedPnL = changePercent;

    if (decision.signal === 'BUY' || decision.signal === 'LONG') {
      // TP hit
      if (changePercent >= TAKE_PROFIT) { forcedOutcome = 'WIN'; forcedPnL = TAKE_PROFIT; }
      // SL hit
      else if (changePercent <= -STOP_LOSS) { forcedOutcome = 'LOSS'; forcedPnL = -STOP_LOSS; }
      // ATR-based Trailing Stop: activates at 1.0%+ profit after 30min
      // Uses volatility-adaptive trail distance instead of fixed 50%
      else if (changePercent >= 1.0 && ageMinutes >= 30) {
        // ATR proxy: use absolute change as volatility measure
        // More volatile → wider trail (less likely premature exit)
        const atrProxy = Math.max(0.5, Math.abs(changePercent) * 0.3); // 30% of swing as ATR
        const trailDistance = atrProxy * 1.5; // 1.5x ATR trailing distance
        const trailLevel = changePercent - trailDistance;

        // If price has retraced past the trail level, close with profit
        if (trailLevel > 0 && changePercent < (changePercent * 0.7)) {
          forcedOutcome = 'WIN';
          forcedPnL = Math.max(trailLevel, changePercent * 0.5); // Min 50% of peak gains
        }
        // If holding strong above trail, check for extended target
        else if (changePercent >= TAKE_PROFIT * 0.8 && ageMinutes >= 45) {
          // Near TP after 45min — lock 70% of gains
          forcedOutcome = 'WIN';
          forcedPnL = changePercent * 0.7;
        }
      }
    } else if (decision.signal === 'SELL' || decision.signal === 'SHORT') {
      if (changePercent <= -TAKE_PROFIT) { forcedOutcome = 'WIN'; forcedPnL = TAKE_PROFIT; }
      else if (changePercent >= STOP_LOSS) { forcedOutcome = 'LOSS'; forcedPnL = -STOP_LOSS; }
    }

    const updates: Partial<typeof decision> = {};

    // If early TP/SL hit, OR 60 mins expired
    if (forcedOutcome || ageMinutes >= 60) {
      if (forcedOutcome) {
        updates.outcome = forcedOutcome;
        updates.pnlPercent = Math.round(forcedPnL * 100) / 100;
      } else {
        const { outcome, pnlPercent } = evaluateOutcome(decision.signal, decision.price, currentPrice);
        updates.outcome = outcome;
        updates.pnlPercent = pnlPercent;
      }
      updates.evaluatedAt = new Date().toISOString();

      evaluated++;
      if (updates.outcome === 'WIN') wins++;
      if (updates.outcome === 'LOSS') losses++;

      log.info(`${decision.signal} ${decision.symbol}: ${updates.outcome} (${updates.pnlPercent > 0 ? '+' : ''}${updates.pnlPercent}%)`);
    } else {
      // Record interim journey
      if (ageMinutes >= 5 && decision.priceAfter5m === null) updates.priceAfter5m = currentPrice;
      if (ageMinutes >= 15 && decision.priceAfter15m === null) updates.priceAfter15m = currentPrice;
    }

    if (Object.keys(updates).length > 0) {
      updateDecision(decision.id, updates);
    }
  }

  // Recalculate performance stats
  if (evaluated > 0) {
    recalculatePerformance();
  }

  return { evaluated, wins, losses };
}
