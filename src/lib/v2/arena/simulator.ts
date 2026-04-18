import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { DNAExtractor } from '../superai/dnaExtractor';
import { OmegaEngine } from '../superai/omegaEngine';
import { createLogger } from '@/lib/core/logger';
import { RoutedSignal } from '@/lib/router/signalRouter';
import { addPhantomTrade, getPhantomTrades, removePhantomTrade, PhantomTrade } from '@/lib/store/db';
import { getOrFetchPrice } from '@/lib/cache/priceCache';
import type { Gladiator, GladiatorDNA } from '@/lib/types/gladiator';

const log = createLogger('ArenaSimulator');

// Delegate to global price cache (MEXC → DexScreener → CoinGecko)
async function getCachedPrice(symbol: string): Promise<number> {
  const normalizedSymbol = symbol.includes('USDT') ? symbol : `${symbol}USDT`;
  return getOrFetchPrice(normalizedSymbol);
}

export class ArenaSimulator {
  private static instance: ArenaSimulator;
  private dnaBank: DNAExtractor;

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
   * DNA-based signal acceptance check.
   * Returns true if the gladiator's DNA allows this signal.
   * Gladiators without DNA accept everything (backward compat).
   */
  private shouldAcceptSignal(gladiator: Gladiator, signal: RoutedSignal): boolean {
    const dna = gladiator.dna;
    if (!dna) return true; // No DNA = accept all (legacy gladiators)

    // 1. Symbol filter: signal.symbol (e.g., 'BTCUSDT') must start with any entry in symbolFilter
    //    '*' = wildcard, accepts everything
    if (!dna.symbolFilter.includes('*')) {
      const symUpper = signal.symbol.toUpperCase();
      const matched = dna.symbolFilter.some(f => symUpper.startsWith(f.toUpperCase()));
      if (!matched) return false;
    }

    // 2. Confidence gate
    const signalConf = signal.confidence ?? 0;
    if (signalConf < dna.minConfidence) return false;

    // 3. Direction bias
    if (dna.directionBias !== 'BOTH') {
      const isLong = signal.normalized === 'BUY' || signal.normalized === 'LONG';
      const isShort = signal.normalized === 'SELL' || signal.normalized === 'SHORT';
      if (dna.directionBias === 'LONG_ONLY' && isShort) return false;
      if (dna.directionBias === 'SHORT_ONLY' && isLong) return false;
    }

    // 4. Timeframe filter (if specified)
    if (dna.timeframes && dna.timeframes.length > 0 && signal.timeframe) {
      if (!dna.timeframes.includes(signal.timeframe)) return false;
    }

    return true;
  }

  /**
   * Called when a live signal hits the system. Distributes it to gladiators
   * whose DNA accepts the signal — creates real strategy differentiation.
   *
   * PRE-DNA: all gladiators received all trades → identical PnL streams → Arena
   * selection was noise-driven. POST-DNA: each gladiator specializes → uncorrelated
   * PnL → meaningful Darwinian selection.
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

    let accepted = 0;
    let rejected = 0;

    allGladiators.forEach(g => {
      // DNA FILTER: each gladiator decides independently whether to accept this signal
      if (!this.shouldAcceptSignal(g, routedSignal)) {
        rejected++;
        return;
      }

      const trade: PhantomTrade = {
        id: `phantom_${Date.now()}_${g.id.substring(0, 5)}`,
        gladiatorId: g.id,
        symbol: routedSignal.symbol,
        signal: routedSignal.normalized,
        entryPrice: currentPrice,
        timestamp: new Date().toISOString()
      };

      addPhantomTrade(trade);
      accepted++;
    });

    log.info(`[Combat Engine] Phantom Trades: ${accepted} accepted, ${rejected} filtered by DNA for ${routedSignal.symbol} @ $${currentPrice}`);
  }

  /**
   * Evaluates open phantom trades using REAL market data from MEXC.
   */
  public async evaluatePhantomTrades(): Promise<void> {
    const activePhantoms = getPhantomTrades();
    if (!activePhantoms.length) return;

    const now = Date.now();
    // NOTE: Gladiator refresh removed from here (2026-04-18 perf).
    // Cron route does refreshGladiatorsFromCloud() before calling this method.
    // Daily rotation must do its own refresh before calling evaluatePhantomTrades().

    // FIX 2026-04-18 FAZA 3: Asymmetric TP/SL thresholds.
    // Previous symmetric ±0.5% was hitting both TP and SL in same candle for volatile tokens.
    // New: TP=1.0%, SL=-0.5% (R:R 2:1) → break-even @ WR ~33%. This rewards correct direction
    // while quickly cutting losers. Volatile tokens won't simultaneously trigger both thresholds.
    // Historical trades NOT recalculated — old stats remain, new phantoms produce realistic PF.
    const WIN_THRESHOLD_TP = 1.0;   // Take Profit 1.0% — give winners room to run
    const LOSS_THRESHOLD_SL = -0.5; // Stop Loss -0.5% — cut losers fast
    const MAX_HOLD_SEC = 1800;      // Maximum 30min — doubled from 15min to let asymmetric TP breathe

    // Batch: get unique symbols and prefetch prices in parallel
    const uniqueSymbols = [...new Set(activePhantoms.map(t => t.symbol))];
    await Promise.all(uniqueSymbols.map(sym => getCachedPrice(sym)));

    // FIX 2026-04-18 (FAZA B.1) — bug #3: regime was always NULL in gladiator_battles.
    // Snapshot once per tick (OmegaEngine.getRegime is sync; `hasLiveRegime` tells us
    // whether we have real analysis or the emptyRegime() fallback).
    // ASUMPȚIE: regime-ul e stabil pe durata unui tick (cron la ~1min). Dacă OmegaEngine
    // analyze rulează între getRegime() calls concurent cu simulator, valorile pot differ
    // micro-temporal — acceptabil (telemetry, nu decision input).
    const omega = OmegaEngine.getInstance();
    const regimeSnapshot = omega.getRegime();
    const regimeIsLive = omega.hasLiveRegime();

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

      // FIX 2026-04-18 (QW-11): Clamp overshoot to TP/SL prices.
      // BUG ROOT CAUSE: Cron-tick latency allows price to travel far past TP/SL between ticks.
      // Example: RNDR phantom with entry=$1.86 — price pumps to $7.03 before next evaluator
      // tick → hitTP true, but we record closing at $7.03 (+278%) instead of TP ($1.87, +0.5%).
      // 430 of 5845 trades (7.3%) polluted, cumulative PnL inflated ~1000× (+120,000% vs
      // realistic +440%). Strategy stats became mathematical artifact — PF=192, Sharpe=0.28.
      // FIX: When hitTP/hitSL detected post-hoc, clamp exitPrice and pnlPercent to threshold
      // values. Simulates continuous monitoring (strategy's implicit assumption).
      // ASSUMPTION THAT INVALIDATES FIX:
      //  (a) LIVE execution has real slippage that may be >/< the overshoot we clamp.
      //      → For PAPER mode: fine. For LIVE: slippage must be modeled separately (FAZA D).
      //  (b) True intra-bar high/low data not available; we assume price crossed threshold
      //      at some moment in the cron interval. Acceptable because TP/SL is 0.5% and crypto
      //      paths almost always cross monotonically within a 15min window.
      let exitPrice: number;
      let finalPnl: number;
      let exitSource: 'HIT_TAKE_PROFIT' | 'HIT_STOP_LOSS' | 'TIME_EXPIRATION';

      if (hitTP) {
        const tpMove = WIN_THRESHOLD_TP / 100; // 0.005
        exitPrice = isLongSignal
          ? trade.entryPrice * (1 + tpMove)
          : trade.entryPrice * (1 - tpMove);
        finalPnl = WIN_THRESHOLD_TP; // exactly +0.5%
        exitSource = 'HIT_TAKE_PROFIT';
      } else if (hitSL) {
        const slMove = Math.abs(LOSS_THRESHOLD_SL) / 100; // 0.005
        exitPrice = isLongSignal
          ? trade.entryPrice * (1 - slMove)
          : trade.entryPrice * (1 + slMove);
        finalPnl = LOSS_THRESHOLD_SL; // exactly -0.5%
        exitSource = 'HIT_STOP_LOSS';
      } else {
        // TIME_EXPIRATION: use actual market price — legitimate mark-to-market at window close.
        // Drift here can legitimately exceed TP/SL for slow-moving pairs, that's OK.
        exitPrice = currentPrice;
        finalPnl = pnlPercent;
        exitSource = 'TIME_EXPIRATION';
      }

      // FIX 2026-04-18 (QW-10): Three-way classification — WIN / LOSS / NEUTRAL.
      // Expired phantom with |pnl| < NEUTRAL_ZONE is noise, not signal — skip stats.
      // ASSUMPTION: NEUTRAL_ZONE = SL/2 = 0.25%. If crypto micro-volatility consistently
      // stays below 0.25% in 15min windows, most trades become NEUTRAL → slow stat
      // accumulation. Acceptable: slow-but-accurate beats fast-but-garbage.
      const NEUTRAL_ZONE = Math.abs(LOSS_THRESHOLD_SL) / 2; // 0.25%
      const isWin = hitTP || (isExpired && finalPnl >= WIN_THRESHOLD_TP / 2);
      const isNeutral = isExpired && !hitTP && !hitSL && Math.abs(finalPnl) < NEUTRAL_ZONE;

      // 1. Clean up phantom position (always — even neutrals must be removed)
      removePhantomTrade(trade.id);

      // Skip stats update for NEUTRAL expired trades — they're noise, not signal
      if (isNeutral) {
        totalClosed++;
        continue;
      }

      // 2. DNA Extraction (The Forge) — log WIN/LOSS with CLAMPED values for learning
      await this.dnaBank.logBattle({
        id: trade.id,
        gladiatorId: trade.gladiatorId,
        symbol: trade.symbol,
        decision: isLongSignal ? 'LONG' : 'SHORT',
        entryPrice: trade.entryPrice,
        outcomePrice: exitPrice,                           // CLAMPED (was: currentPrice)
        pnlPercent: parseFloat(finalPnl.toFixed(4)),      // CLAMPED (was: pnlPercent)
        isWin,
        timestamp: Date.now(),
        marketContext: {
          source: exitSource,
          holdTimeSec: elapsedSec,
          entryPrice: trade.entryPrice,
          exitPrice,                                       // CLAMPED (was: currentPrice)
          marketPriceAtClose: currentPrice,                // Reference: actual market price
          overshoot: parseFloat((pnlPercent - finalPnl).toFixed(4)), // Gap clamped away — telemetry
          // FIX 2026-04-18 (FAZA B.1) — log regime for regime-aware stats downstream.
          // regimeIsFallback=true means OmegaEngine had no analysis yet (emptyRegime defaults).
          regime: regimeSnapshot.regime,
          regimeConfidence: parseFloat(regimeSnapshot.confidence.toFixed(4)),
          regimeVolatilityScore: regimeSnapshot.volatilityScore,
          regimeIsFallback: !regimeIsLive,
        }
      });

      // 3. Update Gladiator's lifetime record with CLAMPED values
      gladiatorStore.updateGladiatorStats(trade.gladiatorId, {
         pnlPercent: parseFloat(finalPnl.toFixed(4)),
         isWin
      });

      totalClosed++;
    }

    if (totalClosed > 0) {
      log.info(`[Combat Engine] Evaluated ${totalClosed} phantom trades using LIVE MEXC prices. ${activePhantoms.length - totalClosed} skipped (open or no price).`);
    }
  }
}

