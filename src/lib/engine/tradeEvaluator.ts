// ============================================================
// Trade Evaluator — checks if signals were profitable
// Runs periodically; updates DecisionSnapshots with outcomes
// ============================================================
import { getPendingDecisions, updateDecision, recalculatePerformance } from '@/lib/store/db';
import { fetchWithRetry } from '@/lib/providers/base';

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

    // Only evaluate decisions older than 60 minutes
    if (ageMinutes < 60) continue;

    const currentPrice = await getCurrentPrice(decision.symbol);
    if (currentPrice === 0) continue;

    // Fill in price-after fields based on age
    const updates: Partial<typeof decision> = {};

    if (ageMinutes >= 5 && decision.priceAfter5m === null) {
      updates.priceAfter5m = currentPrice;
    }
    if (ageMinutes >= 15 && decision.priceAfter15m === null) {
      updates.priceAfter15m = currentPrice;
    }
    if (ageMinutes >= 60 && decision.priceAfter1h === null) {
      updates.priceAfter1h = currentPrice;
    }
    if (ageMinutes >= 240 && decision.priceAfter4h === null) {
      updates.priceAfter4h = currentPrice;
    }

    // Evaluate after 1 hour
    if (ageMinutes >= 60) {
      const { outcome, pnlPercent } = evaluateOutcome(
        decision.signal,
        decision.price,
        currentPrice
      );

      updates.outcome = outcome;
      updates.pnlPercent = pnlPercent;
      updates.evaluatedAt = new Date().toISOString();

      evaluated++;
      if (outcome === 'WIN') wins++;
      if (outcome === 'LOSS') losses++;

      console.log(
        `[Evaluator] ${decision.signal} ${decision.symbol}: ${outcome} (${pnlPercent > 0 ? '+' : ''}${pnlPercent}%)`
      );
    }

    updateDecision(decision.id, updates);
  }

  // Recalculate performance stats
  if (evaluated > 0) {
    recalculatePerformance();
  }

  return { evaluated, wins, losses };
}
