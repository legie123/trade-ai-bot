// ============================================================
// Trade Evaluator — checks if signals were profitable
// Runs periodically; updates DecisionSnapshots with outcomes
// ============================================================
import { getPendingDecisions, updateDecision, recalculatePerformance } from '@/lib/store/db';
import { fetchWithRetry } from '@/lib/providers/base';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('TradeEvaluator');

// ─── CoinGecko ID map for all traded coins ────────
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', BTCUSDT: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BONK: 'bonk',
  WIF: 'dogwifcoin',
  JUP: 'jupiter-exchange-solana',
  JTO: 'jito-governance-token',
  PYTH: 'pyth-network',
  RNDR: 'render-token',
  RAY: 'raydium',
};

// ─── Fetch current price (CoinGecko first, DexScreener fallback) ───
async function getCurrentPrice(symbol: string): Promise<number> {
  const sym = symbol.toUpperCase();
  const geckoId = COINGECKO_IDS[sym];

  // Strategy 1: CoinGecko (reliable, rate-limited)
  if (geckoId) {
    try {
      const res = await fetchWithRetry(
        `https://api.coingecko.com/api/v3/simple/price?ids=${geckoId}&vs_currencies=usd`,
        { retries: 2, timeoutMs: 5000 }
      );
      const data = await res.json();
      const price = data?.[geckoId]?.usd;
      if (price && price > 0) return price;
    } catch {
      log.debug(`CoinGecko failed for ${sym}, trying DexScreener`);
    }
  }

  // Strategy 2: DexScreener (for unlisted / new tokens)
  try {
    const res = await fetchWithRetry(
      `https://api.dexscreener.com/dex/search?q=${sym}`,
      { retries: 1, timeoutMs: 5000 }
    );
    const data = await res.json();
    const price = data?.pairs?.[0] ? parseFloat(data.pairs[0].priceUsd) : 0;
    if (price > 0) return price;
  } catch {
    log.debug(`DexScreener also failed for ${sym}`);
  }

  log.warn(`Cannot get price for ${sym} — decision will be skipped this cycle`);
  return 0;
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
      TAKE_PROFIT = 2.5; // Calibration #8: reduced from 3.5% — realistic for 2h window
      STOP_LOSS = 2.0;   // Widened from 1.4% → 2.0% to avoid noise exits in chop
    } else {
      // Mid-caps (JTO, JUP, RAY, RNDR, PYTH etc)
      TAKE_PROFIT = 3.0;  // Calibration #8: reduced from 4.0%
      STOP_LOSS = 1.5;    // Widened from 1.0% → 1.5%
    }

    let forcedOutcome: 'WIN' | 'LOSS' | null = null;
    let forcedPnL = changePercent;

    // ── Effective PnL for directional trades ──
    const effectivePnl = (decision.signal === 'SELL' || decision.signal === 'SHORT')
      ? -changePercent  // SELL profits when price drops
      : changePercent;  // BUY profits when price rises

    if (decision.signal === 'BUY' || decision.signal === 'LONG') {
      // TP hit
      if (changePercent >= TAKE_PROFIT) { forcedOutcome = 'WIN'; forcedPnL = TAKE_PROFIT; }
      // SL hit
      else if (changePercent <= -STOP_LOSS) { forcedOutcome = 'LOSS'; forcedPnL = -STOP_LOSS; }
      // Graduated Profit Lock (Calibration #8):
      // Level 1: +0.8% after 30min → lock 0.5%
      // Level 2: +1.5% after 45min → lock 1.0%
      // Level 3: +2.0% after 60min → lock 1.5%
      else if (changePercent >= 2.0 && ageMinutes >= 60) {
        forcedOutcome = 'WIN';
        forcedPnL = Math.max(changePercent * 0.75, 1.5);
        log.info(`BUY ${symbol}: Profit Lock L3 at ${changePercent.toFixed(2)}% → ${forcedPnL.toFixed(2)}%`);
      } else if (changePercent >= 1.5 && ageMinutes >= 45) {
        forcedOutcome = 'WIN';
        forcedPnL = Math.max(changePercent * 0.65, 1.0);
        log.info(`BUY ${symbol}: Profit Lock L2 at ${changePercent.toFixed(2)}% → ${forcedPnL.toFixed(2)}%`);
      } else if (changePercent >= 0.8 && ageMinutes >= 30) {
        forcedOutcome = 'WIN';
        forcedPnL = Math.max(changePercent * 0.6, 0.5);
        log.info(`BUY ${symbol}: Profit Lock L1 at ${changePercent.toFixed(2)}% → ${forcedPnL.toFixed(2)}%`);
      }
    } else if (decision.signal === 'SELL' || decision.signal === 'SHORT') {
      if (changePercent <= -TAKE_PROFIT) { forcedOutcome = 'WIN'; forcedPnL = TAKE_PROFIT; }
      else if (changePercent >= STOP_LOSS) { forcedOutcome = 'LOSS'; forcedPnL = -STOP_LOSS; }
      // SELL graduated profit lock (mirror of BUY)
      else if (changePercent <= -2.0 && ageMinutes >= 60) {
        forcedOutcome = 'WIN';
        forcedPnL = Math.max(Math.abs(changePercent) * 0.75, 1.5);
        log.info(`SELL ${symbol}: Profit Lock L3 at ${changePercent.toFixed(2)}% → +${forcedPnL.toFixed(2)}%`);
      } else if (changePercent <= -1.5 && ageMinutes >= 45) {
        forcedOutcome = 'WIN';
        forcedPnL = Math.max(Math.abs(changePercent) * 0.65, 1.0);
        log.info(`SELL ${symbol}: Profit Lock L2 at ${changePercent.toFixed(2)}% → +${forcedPnL.toFixed(2)}%`);
      } else if (changePercent <= -0.8 && ageMinutes >= 30) {
        forcedOutcome = 'WIN';
        forcedPnL = Math.max(Math.abs(changePercent) * 0.6, 0.5);
        log.info(`SELL ${symbol}: Profit Lock L1 at ${changePercent.toFixed(2)}% → +${forcedPnL.toFixed(2)}%`);
      }
    }

    // ── STALE DECISION EXPIRY: 4 hours max ──
    const MAX_AGE_MINUTES = 240; // 4 hours hard limit
    const SOFT_EXPIRY_MINUTES = 120; // Calibration #8: extended from 60min to 120min

    const updates: Partial<typeof decision> = {};

    // If early TP/SL/ProfitLock hit, 2h soft expiry, or 4h hard expiry
    if (forcedOutcome || ageMinutes >= SOFT_EXPIRY_MINUTES || ageMinutes >= MAX_AGE_MINUTES) {
      if (forcedOutcome) {
        updates.outcome = forcedOutcome;
        updates.pnlPercent = Math.round(forcedPnL * 100) / 100;
      } else if (ageMinutes >= MAX_AGE_MINUTES) {
        // Hard expiry: force close with current P&L
        updates.outcome = effectivePnl > 0.3 ? 'WIN' : effectivePnl < -0.3 ? 'LOSS' : 'NEUTRAL';
        updates.pnlPercent = Math.round(effectivePnl * 100) / 100;
        log.info(`${decision.signal} ${symbol}: EXPIRED after ${Math.round(ageMinutes)}min → ${updates.outcome} (${updates.pnlPercent}%)`);
      } else {
        // Soft expiry at 2h: evaluate current position
        const { outcome, pnlPercent } = evaluateOutcome(decision.signal, decision.price, currentPrice);
        updates.outcome = outcome;
        updates.pnlPercent = pnlPercent;
      }
      updates.evaluatedAt = new Date().toISOString();

      evaluated++;
      if (updates.outcome === 'WIN') wins++;
      if (updates.outcome === 'LOSS') losses++;

      log.info(`${decision.signal} ${decision.symbol}: ${updates.outcome} (${updates.pnlPercent! > 0 ? '+' : ''}${updates.pnlPercent}%)`);
    } else {
      // Record interim journey
      if (ageMinutes >= 5 && decision.priceAfter5m === null) updates.priceAfter5m = currentPrice;
      if (ageMinutes >= 15 && decision.priceAfter15m === null) updates.priceAfter15m = currentPrice;
      if (ageMinutes >= 60 && decision.priceAfter1h === null) updates.priceAfter1h = currentPrice;
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
