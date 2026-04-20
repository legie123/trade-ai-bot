import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { DNAExtractor } from '../superai/dnaExtractor';
import { OmegaEngine } from '../superai/omegaEngine';
import { createLogger } from '@/lib/core/logger';
import { RoutedSignal } from '@/lib/router/signalRouter';
import { addPhantomTrade, getPhantomTrades, removePhantomTrade, PhantomTrade } from '@/lib/store/db';
import { getOrFetchPrice, getCachedPrice as syncCachedPrice } from '@/lib/cache/priceCache';
import type { Gladiator, GladiatorDNA } from '@/lib/types/gladiator';

const log = createLogger('ArenaSimulator');

// FAZA B.2 — fee model extracted to shared module (src/lib/v2/fees/feeModel.ts)
// so cron shadow-DNA path (src/app/api/cron/route.ts) uses identical values.
import { netPnlFromGross } from '@/lib/v2/fees/feeModel';

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

    // AUDIT-R2 FAZA B — pool-wide direction gate applied at PAPER/arena layer.
    // Previously dualMaster.ts converted LONG→FLAT only for live-execution routing;
    // phantomTrades still distributed LONG signals and polluted gladiator stats
    // (empirical: 577 LONG PAPER trades dragged arena WR to 26.8%, EV_net=-0.16%).
    // Gating here stops forward sampling on a direction we know is EV-negative.
    //
    // Kill-switches (mirror dualMaster.ts):
    //   DIRECTION_GATE_ENABLED=0   → bypass entirely (restore pre-gate distribution)
    //   DIRECTION_LONG_DISABLED=1  → drop LONG signals before phantom creation
    //   DIRECTION_SHORT_DISABLED=1 → drop SHORT signals before phantom creation
    // Both disables default permissive (unset → no effect).
    if (process.env.DIRECTION_GATE_ENABLED !== '0') {
      const norm = routedSignal.normalized;
      const isLong = norm === 'BUY' || norm === 'LONG';
      const isShort = norm === 'SELL' || norm === 'SHORT';
      if (isLong && process.env.DIRECTION_LONG_DISABLED === '1') {
        log.warn(`[Combat Engine] AUDIT-R2 arena gate: dropping LONG ${routedSignal.symbol} (DIRECTION_LONG_DISABLED=1) — no phantom distribution`);
        return;
      }
      if (isShort && process.env.DIRECTION_SHORT_DISABLED === '1') {
        log.warn(`[Combat Engine] AUDIT-R2 arena gate: dropping SHORT ${routedSignal.symbol} (DIRECTION_SHORT_DISABLED=1) — no phantom distribution`);
        return;
      }
    }

    let accepted = 0;
    let rejected = 0;
    let dedupSkipped = 0;

    // C5 Batch 2: Build open-phantom index for O(1) dedup lookup.
    // Key = "gladiatorId|symbol|signal" → skip if gladiator already tracking same direction.
    // WHY: 1 signal × N gladiators is correct, but the SAME gladiator receiving the SAME
    // symbol+direction while a phantom is still open wastes eval cycles and inflates sample
    // count (same thesis, overlapping hold windows → correlated outcomes ≠ independent samples).
    const activePhantoms = getPhantomTrades();
    const openPhantomKeys = new Set<string>();
    for (const pt of activePhantoms) {
      openPhantomKeys.add(`${pt.gladiatorId}|${pt.symbol}|${pt.signal}`);
    }

    allGladiators.forEach(g => {
      // DNA FILTER: each gladiator decides independently whether to accept this signal
      if (!this.shouldAcceptSignal(g, routedSignal)) {
        rejected++;
        return;
      }

      // C5 Batch 2: Dedup — skip if gladiator already has open phantom for same symbol+direction
      const dedupKey = `${g.id}|${routedSignal.symbol}|${routedSignal.normalized}`;
      if (openPhantomKeys.has(dedupKey)) {
        dedupSkipped++;
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
      openPhantomKeys.add(dedupKey); // prevent intra-batch duplicates
      accepted++;
    });

    log.info(`[Combat Engine] Phantom Trades: ${accepted} accepted, ${rejected} DNA-filtered, ${dedupSkipped} dedup-skipped for ${routedSignal.symbol} @ $${currentPrice}`);
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
    // F2 (2026-04-19) — Timescale alignment fix. Scouts emit signals with timeframe:'4h'
    // (btcEngine.ts:439, solanaEngine.ts:327). Previous MAX_HOLD=1800s (30min) forced
    // premature closures — 46% SL / 0% TP empirical on 2000-battle sample because 4h
    // directional thesis couldn't play out in 30min. New 3600s (1h) = compromise between
    // signal timeframe (4h) and learning velocity (need ≥60 samples per gladiator).
    // ASUMPȚIE: 1h e suficient pentru TP=1% să se realizeze într-un regim cu volatilitate
    // medie (BTC 1h ATR ~ 0.6-1.2% în 2026). Dacă volatilitatea cade sub 0.5% pe 1h,
    // NEUTRAL_ZONE va crește proporțional și stats vor evolua lent.
    const MAX_HOLD_SEC = 3600;      // Maximum 60min — aligned with 1h EMA trend filter in btcEngine.ts

    // Batch: get unique symbols and prefetch prices in parallel
    const uniqueSymbols = [...new Set(activePhantoms.map(t => t.symbol))];
    await Promise.all(uniqueSymbols.map(sym => getCachedPrice(sym)));

    // FIX 2026-04-19: Build sync price map from cache after prefetch.
    // Was: getCachedPrice(trade.symbol) per trade = 1386 async calls.
    // Now: sync Map lookup = O(1) per trade, zero event loop yields.
    const priceMap = new Map<string, number>();
    for (const sym of uniqueSymbols) {
      const normalized = sym.includes('USDT') ? sym : `${sym}USDT`;
      const p = syncCachedPrice(normalized);
      if (p && p > 0) priceMap.set(sym, p);
    }

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
    // C10 (2026-04-19) — Collect battle records for batch DNA insert.
    // PRIOR: each closed trade did `await this.dnaBank.logBattle()` (individual Supabase insert
    // per trade, ~130ms each). With ~100 closes per tick → 13s spent on sequential I/O.
    // NOW: collect records in-memory, batch-insert after loop = 1 round-trip ≈ 200ms.
    // In-memory cache (gladiatorDna) + stats updates remain per-trade (sync, needed by mid-tick readers).
    // ASSUMPTION: batch size < 1000 rows per tick. PostgREST default max-rows is typically higher
    // for inserts, but if it fails, addGladiatorDnaBatch has per-record fallback.
    const useNet = process.env.FEE_NET_V2 !== '0';
    const pendingBattleRecords: import('../superai/dnaExtractor').BattleRecord[] = [];

    for (const trade of activePhantoms) {
      // FIX 2026-04-19: sync map lookup (was: await getCachedPrice per trade)
      const currentPrice = priceMap.get(trade.symbol) ?? 0;
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
      let exitPrice: number;
      let finalPnl: number;
      let exitSource: 'HIT_TAKE_PROFIT' | 'HIT_STOP_LOSS' | 'TIME_EXPIRATION';

      if (hitTP) {
        const tpMove = WIN_THRESHOLD_TP / 100;
        exitPrice = isLongSignal
          ? trade.entryPrice * (1 + tpMove)
          : trade.entryPrice * (1 - tpMove);
        finalPnl = WIN_THRESHOLD_TP;
        exitSource = 'HIT_TAKE_PROFIT';
      } else if (hitSL) {
        const slMove = Math.abs(LOSS_THRESHOLD_SL) / 100;
        exitPrice = isLongSignal
          ? trade.entryPrice * (1 - slMove)
          : trade.entryPrice * (1 + slMove);
        finalPnl = LOSS_THRESHOLD_SL;
        exitSource = 'HIT_STOP_LOSS';
      } else {
        exitPrice = currentPrice;
        finalPnl = pnlPercent;
        exitSource = 'TIME_EXPIRATION';
      }

      // Three-way classification — WIN / LOSS / NEUTRAL
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

      // FAZA B.2 — Fees Net Model
      const { feeRoundTrip, marketType, pnlPercentNet, isWinNet } = netPnlFromGross(finalPnl);

      // 2. Collect battle record for batch DNA write (C10: deferred to after loop)
      pendingBattleRecords.push({
        id: trade.id,
        gladiatorId: trade.gladiatorId,
        symbol: trade.symbol,
        decision: isLongSignal ? 'LONG' : 'SHORT',
        entryPrice: trade.entryPrice,
        outcomePrice: exitPrice,
        pnlPercent: parseFloat(finalPnl.toFixed(4)),
        isWin,
        timestamp: Date.now(),
        marketContext: {
          source: exitSource,
          holdTimeSec: elapsedSec,
          entryPrice: trade.entryPrice,
          exitPrice,
          marketPriceAtClose: currentPrice,
          overshoot: parseFloat((pnlPercent - finalPnl).toFixed(4)),
          regime: regimeSnapshot.regime,
          regimeConfidence: parseFloat(regimeSnapshot.confidence.toFixed(4)),
          regimeVolatilityScore: regimeSnapshot.volatilityScore,
          regimeIsFallback: !regimeIsLive,
          feeRoundTrip,
          marketType,
          pnlPercentGross: parseFloat(finalPnl.toFixed(4)),
          pnlPercentNet,
          isWinNet,
        }
      });

      // 3. Update Gladiator's lifetime record (sync, in-memory — stays per-trade)
      const statsPnl = useNet ? pnlPercentNet : parseFloat(finalPnl.toFixed(4));
      const statsWin = useNet ? isWinNet : isWin;
      gladiatorStore.updateGladiatorStats(trade.gladiatorId, {
         pnlPercent: statsPnl,
         isWin: statsWin
      });

      totalClosed++;
    }

    // C10: Batch DNA write — single Supabase insert replaces N sequential awaits.
    // In-memory cache is updated inside addGladiatorDnaBatch synchronously, so
    // any downstream reader in the same tick sees fresh data.
    if (pendingBattleRecords.length > 0) {
      await this.dnaBank.logBattleBatch(pendingBattleRecords);
    }

    if (totalClosed > 0) {
      log.info(`[Combat Engine] Evaluated ${totalClosed} phantom trades (${pendingBattleRecords.length} DNA-logged) using LIVE MEXC prices. ${activePhantoms.length - totalClosed} skipped (open or no price).`);
    }
  }
}

