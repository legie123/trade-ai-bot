import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { DNAExtractor } from '../superai/dnaExtractor';
import { createLogger } from '@/lib/core/logger';
import { RoutedSignal } from '@/lib/router/signalRouter';
import { addPhantomTrade, getPhantomTrades, removePhantomTrade, PhantomTrade } from '@/lib/store/db';
import { getOrFetchPrice } from '@/lib/cache/priceCache';

const log = createLogger('ArenaSimulator');

// Delegate to global price cache (MEXC → Binance → OKX → DexScreener → CoinGecko)
async function getCachedPrice(symbol: string): Promise<number> {
  const normalizedSymbol = symbol.includes('USDT') ? symbol : `${symbol}USDT`;
  return getOrFetchPrice(normalizedSymbol);
}

export class ArenaSimulator {
  private static instance: ArenaSimulator;
  private dnaBank: DNAExtractor;
  private lastGladiatorRefresh: number = 0;
  private static readonly REFRESH_TTL_MS = 60_000; // 60 seconds between cloud refreshes

  private constructor() {
    this.dnaBank = DNAExtractor.getInstance();
  }

  public static getInstance(): ArenaSimulator {
    if (!ArenaSimulator.instance) {
      ArenaSimulator.instance = new ArenaSimulator();
    }
    return ArenaSimulator.instance;
  }

  /**
   * Called when a live signal hits the system. Distributes it to all gladiators
   * to enter Phantom Trades for real-time testing.
   */
  public distributeSignalToGladiators(routedSignal: RoutedSignal) {
    const allGladiators = gladiatorStore.getLeaderboard();
    if (!allGladiators.length) return;

    // Only accept signals with a real price — refuse to track against random noise
    const currentPrice = routedSignal.price;
    if (!currentPrice || currentPrice <= 0) {
      log.warn(`[Combat Engine] Skipping phantom distribution for ${routedSignal.symbol} — no valid price`);
      return;
    }

    allGladiators.forEach(g => {
      const trade: PhantomTrade = {
        id: `phantom_${Date.now()}_${g.id.substring(0, 5)}`,
        gladiatorId: g.id,
        symbol: routedSignal.symbol,
        signal: routedSignal.normalized,
        entryPrice: currentPrice,
        timestamp: new Date().toISOString()
      };
      
      addPhantomTrade(trade);
    });
    
    log.info(`[Combat Engine] Deployed Phantom Trades for ${allGladiators.length} Gladiators on ${routedSignal.symbol} @ $${currentPrice}`);
  }

  /**
   * Evaluates open phantom trades using REAL market data from MEXC.
   */
  public async evaluatePhantomTrades(): Promise<void> {
    const activePhantoms = getPhantomTrades();
    if (!activePhantoms.length) return;

    // Refresh Memory from True Source — but with TTL to prevent unnecessary Supabase reads
    const now = Date.now();
    if (now - this.lastGladiatorRefresh > ArenaSimulator.REFRESH_TTL_MS) {
      const { refreshGladiatorsFromCloud, getGladiatorsFromDb } = await import('@/lib/store/db');
      await refreshGladiatorsFromCloud();
      gladiatorStore.hydrate(getGladiatorsFromDb());
      this.lastGladiatorRefresh = now;
    }

    const MIN_HOLD_SEC = 60;     // Minimum 60s for price to move
    const MAX_HOLD_SEC = 900;    // Maximum 15min — force-close stale phantoms

    // Separate: eligible (60s-15min) + expired (>15min)
    const eligible: PhantomTrade[] = [];
    const expired: PhantomTrade[] = [];

    for (const t of activePhantoms) {
      const elapsedSec = (now - new Date(t.timestamp).getTime()) / 1000;
      if (elapsedSec >= MAX_HOLD_SEC) expired.push(t);
      else if (elapsedSec >= MIN_HOLD_SEC) eligible.push(t);
    }

    // Force-close expired phantoms as NEUTRAL (prevents infinite accumulation)
    for (const trade of expired) {
      removePhantomTrade(trade.id);
      log.warn(`[Combat Engine] Force-closed stale phantom ${trade.id} (${trade.symbol}) — held > ${MAX_HOLD_SEC}s`);
    }

    if (!eligible.length) return;

    // Batch: get unique symbols and prefetch prices in parallel
    const uniqueSymbols = [...new Set(eligible.map(t => t.symbol))];
    await Promise.all(uniqueSymbols.map(sym => getCachedPrice(sym)));

    let totalClosed = 0;

    for (const trade of eligible) {
      const currentPrice = await getCachedPrice(trade.symbol);
      if (currentPrice <= 0) continue; // Can't evaluate without a real price

      // Calculate real PnL based on signal direction
      const isLongSignal = trade.signal === 'BUY' || trade.signal === 'LONG';
      const rawPnl = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
      const pnlPercent = isLongSignal ? rawPnl : -rawPnl;
      const isWin = pnlPercent > 0;

      // 1. Clean up phantom position
      removePhantomTrade(trade.id);
      
      // 2. DNA Extraction (The Forge) — log regardless of win/loss for learning
      await this.dnaBank.logBattle({
        id: trade.id,
        gladiatorId: trade.gladiatorId,
        symbol: trade.symbol,
        decision: isLongSignal ? 'LONG' : 'SHORT',
        entryPrice: trade.entryPrice,
        outcomePrice: currentPrice,
        pnlPercent: parseFloat(pnlPercent.toFixed(4)),
        isWin,
        timestamp: Date.now(),
        marketContext: {
          source: 'Phantom Engine — REAL MEXC Price',
          holdTimeSec: (now - new Date(trade.timestamp).getTime()) / 1000,
          entryPrice: trade.entryPrice,
          exitPrice: currentPrice,
        }
      });

      // 3. Update Gladiator's lifetime record with real data
      gladiatorStore.updateGladiatorStats(trade.gladiatorId, {
         pnlPercent: parseFloat(pnlPercent.toFixed(4)),
         isWin
      });

      totalClosed++;
    }

    if (totalClosed > 0) {
      log.info(`[Combat Engine] Evaluated ${totalClosed} phantom trades using LIVE MEXC prices. ${eligible.length - totalClosed} skipped (no price).`);
    }
  }
}

