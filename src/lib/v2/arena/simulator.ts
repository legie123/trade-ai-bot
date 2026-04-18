import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { DNAExtractor } from '../superai/dnaExtractor';
import { createLogger } from '@/lib/core/logger';
import { RoutedSignal } from '@/lib/router/signalRouter';
import { addPhantomTrade, getPhantomTrades, removePhantomTrade, PhantomTrade } from '@/lib/store/db';
import { getOrFetchPrice } from '@/lib/cache/priceCache';

const log = createLogger('ArenaSimulator');

// Delegate to global price cache (MEXC → DexScreener → CoinGecko)
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

    // FIX 2026-04-18 (QW-7): Rebalansare TP/SL — era 0.3/-1.0 (R:R 1:3.33 → gladiatorul
    // avea nevoie de WR >78% doar ca să fie break-even — matematic improbabil sustained).
    // Nou: 0.5/-0.5 (R:R 1:1) → break-even @ WR 50%. PF-ul devine interpretabil.
    // Asumpție care invalidează: volatility crypto > 0.5% în 15min poate lovi ambele praguri
    // în aceeași fereastră — accept acest artifact statistic vs. artifact mai mare al R:R 1:3.33.
    // Istoricul trades NU se recalculează — statisticile vechi rămân poluate, dar noile phantoms
    // vor produce PF realist.
    const WIN_THRESHOLD_TP = 0.5;  // Take Profit 0.5% (simetric)
    const LOSS_THRESHOLD_SL = -0.5; // Stop Loss -0.5% (simetric)
    const MAX_HOLD_SEC = 900;       // Maximum 15min — force-close stale phantoms

    // Batch: get unique symbols and prefetch prices in parallel
    const uniqueSymbols = [...new Set(activePhantoms.map(t => t.symbol))];
    await Promise.all(uniqueSymbols.map(sym => getCachedPrice(sym)));

    let totalClosed = 0;

    for (const trade of activePhantoms) {
      const currentPrice = await getCachedPrice(trade.symbol);
      if (currentPrice <= 0) continue; // Can't evaluate without a real price

      const elapsedSec = (now - new Date(trade.timestamp).getTime()) / 1000;
      
      // Calculate real PnL based on signal direction
      const isLongSignal = trade.signal === 'BUY' || trade.signal === 'LONG';
      const rawPnl = trade.entryPrice > 0 ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100 : 0;
      const pnlPercent = isLongSignal ? rawPnl : -rawPnl;
      
      // Eligibility rules: HIT Take-Profit, HIT Stop-Loss, or EXPIRED (stale)
      const hitTP = pnlPercent >= WIN_THRESHOLD_TP;
      const hitSL = pnlPercent <= LOSS_THRESHOLD_SL;
      const isExpired = elapsedSec >= MAX_HOLD_SEC;
      
      if (!hitTP && !hitSL && !isExpired) {
        continue; // Keep phantom trade open
      }

      // Determine Outcome
      // FIX 2026-04-18 (QW-10): Three-way classification — WIN / LOSS / NEUTRAL.
      // Problem: expired phantom at +0.02% counted as LOSS with pnl=0.02 → _totalLossPnl
      // denominator near-zero → PF exploded to 439. Noise trades polluted statistics.
      // Fix: expired trades with |pnl| below NEUTRAL_ZONE don't update stats at all.
      // Only TP/SL hits and expired trades with meaningful movement count.
      // ASSUMPTION: NEUTRAL_ZONE = SL/2 = 0.25%. If crypto micro-volatility consistently
      // stays below 0.25% in 15min windows, most trades become NEUTRAL → slow stat accumulation.
      // That's acceptable: slow-but-accurate beats fast-but-garbage.
      const NEUTRAL_ZONE = Math.abs(LOSS_THRESHOLD_SL) / 2; // 0.25%
      const isWin = hitTP || (isExpired && pnlPercent >= WIN_THRESHOLD_TP / 2);
      const isNeutral = isExpired && !hitTP && !hitSL && Math.abs(pnlPercent) < NEUTRAL_ZONE;

      // 1. Clean up phantom position (always — even neutrals must be removed)
      removePhantomTrade(trade.id);

      // Skip stats update for NEUTRAL expired trades — they're noise, not signal
      if (isNeutral) {
        totalClosed++;
        continue;
      }

      // 2. DNA Extraction (The Forge) — log WIN/LOSS for learning
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
          source: isExpired ? 'TIME_EXPIRATION' : (hitTP ? 'HIT_TAKE_PROFIT' : 'HIT_STOP_LOSS'),
          holdTimeSec: elapsedSec,
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
      log.info(`[Combat Engine] Evaluated ${totalClosed} phantom trades using LIVE MEXC prices. ${activePhantoms.length - totalClosed} skipped (open or no price).`);
    }
  }
}

