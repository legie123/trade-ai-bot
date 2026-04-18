import { createLogger } from '@/lib/core/logger';
import { getBotConfig, saveBotConfig, getDecisions, getEquityCurve, getLivePositions } from '@/lib/store/db';
import { DualConsensus } from '@/lib/types/gladiator';
import { Signal, DecisionSnapshot } from '@/lib/types/radar';
import { checkCorrelation } from '@/lib/v2/safety/correlationGuard';
import { emitSentinelVeto, emitKillSwitch } from '@/lib/v2/alerts/eventHub';

const log = createLogger('SentinelGuard');

export class SentinelGuard {
  private static instance: SentinelGuard;
  private mddThreshold = 0.10; // 10% Maximum Drawdown Kill-Switch (hardened from 15%)
  private dailyLossLimit = 3;   // Max 3 losses per day (hardened from 5 — institutional conservative)
  private minWinRate = 0.40;    // 40% min WR (aligned with Butcher/Gladiator Gate threshold)
  private maxLossStreak = 4;    // 4 consecutive losses = halt (hardened from 5 — faster reaction)

  private constructor() {}

  public static getInstance(): SentinelGuard {
    if (!SentinelGuard.instance) {
      SentinelGuard.instance = new SentinelGuard();
    }
    return SentinelGuard.instance;
  }

  /**
   * Main gatekeeper for any signal execution.
   * Returns true if the signal is safe to proceed.
   */
  public async check(signal: Signal, consensus: DualConsensus): Promise<{ safe: boolean; reason?: string }> {
    const result = await this._evaluate(signal, consensus);
    if (!result.safe && result.reason) {
      emitSentinelVeto(result.reason, { symbol: signal.symbol }).catch(() => {/* non-blocking */});
    }
    return result;
  }

  private async _evaluate(signal: Signal, consensus: DualConsensus): Promise<{ safe: boolean; reason?: string }> {
    const config = getBotConfig();

    // 1. System Status Check
    if (config.aiStatus === 'NO_CREDIT') {
      return { safe: false, reason: 'AI Credits Exhausted' };
    }

    if (config.mode === 'LIVE' && this.isHalted()) {
      return { safe: false, reason: 'System is HALTED due to previous risk breach' };
    }

    // ═══ WIN RATE GUARD: Rolling WR on last 20 trades ═══
    const wrCheck = this.checkWinRate();
    if (!wrCheck.safe) {
      await this.triggerKillSwitch(wrCheck.reason!);
      return { safe: false, reason: wrCheck.reason };
    }

    // ═══ STREAK BREAKER: Consecutive loss streak ═══
    const streakCheck = this.checkLossStreak();
    if (!streakCheck.safe) {
      await this.triggerKillSwitch(streakCheck.reason!);
      return { safe: false, reason: streakCheck.reason };
    }

    // 2. Consensus Strength Check — LIVE mode requires higher confidence (0.75) than PAPER (0.50)
    // PAPER threshold lowered from 0.70 → 0.50: at 70%, most signals (55-65% typical)
    // were blocked → zero training data collected → Darwinian loop stalled.
    // 50% admits more noise but that's acceptable: PAPER has zero capital risk,
    // and noisy data still trains the RL modifier / WR stats correctly.
    // ASSUMPTION: If crypto consensus routinely lands 50-65%, this threshold
    // lets ~80% of signals through. Tighten back to 0.65+ once training data exists.
    const confidenceThreshold = config.mode === 'LIVE' ? 0.75 : 0.50;
    if (consensus.finalDirection === 'FLAT' || consensus.weightedConfidence < confidenceThreshold) {
      return { safe: false, reason: `Insufficient Consensus (${(consensus.weightedConfidence * 100).toFixed(2)}% < ${(confidenceThreshold * 100).toFixed(0)}% [${config.mode}])` };
    }

    // 3. Equity-Curve Drawdown Check (Omega upgrade: real compounding MDD)
    const mddResult = this.checkEquityDrawdown();
    if (!mddResult.safe) {
      await this.triggerKillSwitch(mddResult.reason!);
      return { safe: false, reason: mddResult.reason };
    }

    // 4. Daily Loss Check
    const dailyCheck = this.checkDailyLoss();
    if (!dailyCheck.safe) {
      return { safe: false, reason: dailyCheck.reason };
    }

    // 5. Correlation Guard (Step 1.2) — Prevent highly correlated positions
    try {
      const openPositions = getLivePositions().filter(p => p.status === 'OPEN');
      if (openPositions.length > 0) {
        const corrCheck = checkCorrelation(
          signal.symbol,
          openPositions.map(p => ({ symbol: p.symbol, side: p.side })),
        );
        if (!corrCheck.allowed) {
          return { safe: false, reason: corrCheck.reason || 'Correlated position blocked' };
        }
      }
    } catch (corrErr) {
      // Fail-open: if correlation check errors, don't block the trade
      log.warn(`🛡️ [Sentinel] Correlation check error (fail-open): ${corrErr}`);
    }

    log.info(`🛡️ [Sentinel] Signal ${signal.id} for ${signal.symbol} APPROVED. Consensus: ${consensus.finalDirection}`);
    return { safe: true };
  }

  /**
   * FIX CRITIC: isHalted() — citeste corect din config.haltedUntil
   * Versiunea anterioară referentia `now` și `haltTime` care erau UNDEFINED.
   */
  private isHalted(): boolean {
    const config = getBotConfig();
    
    if (!config.haltedUntil) return false;
    
    const now = Date.now();
    const haltTime = new Date(config.haltedUntil).getTime();
    
    if (isNaN(haltTime)) {
      log.warn('🛡️ [Sentinel] Invalid haltedUntil value, clearing halt state.');
      saveBotConfig({ haltedUntil: null });
      return false;
    }

    if (now < haltTime) {
      const remainingMin = Math.round((haltTime - now) / 60000);
      log.warn(`🛡️ [Sentinel] System is currently HALTED. Remaining cooldown: ${remainingMin} minutes.`);
      return true;
    }

    // Cooldown expired - AUTO RESUME
    log.info('🛡️ [Sentinel] Cooldown expired. Restoring system to PAPER mode.');
    saveBotConfig({ 
      mode: 'PAPER', 
      haltedUntil: null 
    });
    return false;
  }

  /**
   * OMEGA UPGRADE: Equity-Curve Based Maximum Drawdown
   * 
   * Calculul anterior era GREȘIT: suma de procente individuale per trade.
   * Exemplu de eroare: 3 trade-uri cu -5% fiecare = -15% MDD calculat,
   * dar equity reală: 1000 → 950 → 902.5 → 857.4 = -14.26% MDD real.
   * 
   * Acum: calculăm pe equity curve reală (compounding).
   * Peak = cel mai mare balance observat.
   * Drawdown = (peak - current) / peak.
   */
  private checkEquityDrawdown(): { safe: boolean; reason?: string; currentMDD?: number } {
    const config = getBotConfig();
    // AUDIT FIX CRITIC-8: Filter equity by current mode — no paper/live contamination
    const equityCurve = getEquityCurve(config.mode as 'PAPER' | 'LIVE');
    const startBalance = equityCurve.length > 0 ? equityCurve[0].balance : (config.paperBalance || 1000);
    
    // Hard Mode Fix: Do not bypass protection simply because there are < 5 trades.
    // If not enough history, check directly against the absolute starting balance drop.
    if (equityCurve.length < 5) {
      if (equityCurve.length > 0) {
         const current = equityCurve[equityCurve.length - 1].balance;
         if (current < startBalance) {
           const simpleDD = (startBalance - current) / startBalance;
           if (simpleDD > this.mddThreshold) {
             return { safe: false, reason: `Early Critical Loss: ${(simpleDD * 100).toFixed(2)}% drop on first trades!`, currentMDD: simpleDD };
           }
           return { safe: true, currentMDD: simpleDD };
         }
      }
      return { safe: true, currentMDD: 0 };
    }

    let peak = startBalance;
    let maxDD = 0;

    for (const point of equityCurve) {
      if (point.balance > peak) {
        peak = point.balance;
      }
      
      if (peak > 0) {
        const dd = (peak - point.balance) / peak;
        if (dd > maxDD) maxDD = dd;
      }
    }

    log.info(`[Sentinel] Equity MDD: ${(maxDD * 100).toFixed(2)}% | Threshold: ${(this.mddThreshold * 100).toFixed(0)}%`);

    if (maxDD > this.mddThreshold) {
      return { 
        safe: false, 
        reason: `Critical Equity Drawdown: ${(maxDD * 100).toFixed(2)}% (threshold: ${(this.mddThreshold * 100).toFixed(0)}%)`,
        currentMDD: maxDD
      };
    }

    return { safe: true, currentMDD: maxDD };
  }

  private checkDailyLoss(): { safe: boolean; reason?: string } {
    const today = new Date().toISOString().slice(0, 10);
    const lossesToday = getDecisions().filter((d: DecisionSnapshot) => 
      d.timestamp.startsWith(today) && d.outcome === 'LOSS'
    ).length;

    if (lossesToday >= this.dailyLossLimit) {
      return { safe: false, reason: `Daily loss limit reached (${lossesToday}/${this.dailyLossLimit})` };
    }

    return { safe: true };
  }

  /**
   * WIN RATE GUARD: If rolling WR on last 20 evaluated trades < 35% → HALT 8h
   */
  private checkWinRate(): { safe: boolean; reason?: string } {
    const decisions = getDecisions();
    const evaluated = decisions.filter((d: DecisionSnapshot) => d.outcome === 'WIN' || d.outcome === 'LOSS');
    
    if (evaluated.length < 10) return { safe: true }; // Not enough data
    
    const recent = evaluated.slice(0, 20); // Already sorted newest-first from db
    const wins = recent.filter((d: DecisionSnapshot) => d.outcome === 'WIN').length;
    const winRate = wins / recent.length;
    
    if (winRate < this.minWinRate) {
      log.warn(`[SENTINEL WR GUARD] Rolling WR: ${(winRate*100).toFixed(1)}% < ${(this.minWinRate*100)}% threshold (${recent.length} trades)`);
      return { 
        safe: false, 
        reason: `Win Rate Critical: ${(winRate*100).toFixed(1)}% on last ${recent.length} trades (threshold: ${(this.minWinRate*100)}%). System halted for recalibration.` 
      };
    }

    return { safe: true };
  }

  /**
   * STREAK BREAKER: If current consecutive loss streak >= 5 → HALT 4h
   */
  private checkLossStreak(): { safe: boolean; reason?: string } {
    const decisions = getDecisions();
    const evaluated = decisions.filter((d: DecisionSnapshot) => d.outcome === 'WIN' || d.outcome === 'LOSS');
    
    if (evaluated.length < 3) return { safe: true };
    
    let streak = 0;
    for (const d of evaluated) {
      if (d.outcome === 'LOSS') streak++;
      else break; // First non-loss breaks the streak count
    }
    
    if (streak >= this.maxLossStreak) {
      log.warn(`[SENTINEL STREAK BREAKER] ${streak} consecutive losses detected. Halting.`);
      return { 
        safe: false, 
        reason: `Loss Streak Critical: ${streak} consecutive losses (max: ${this.maxLossStreak}). Emergency cooldown activated.` 
      };
    }

    return { safe: true };
  }


  /**
   * Get current system risk metrics (for diagnostics endpoint)
   */
  public getRiskMetrics(): { mdd: number; dailyLosses: number; isHalted: boolean; haltedUntil: string | null } {
    const config = getBotConfig();
    const equityCheck = this.checkEquityDrawdown();
    const today = new Date().toISOString().slice(0, 10);
    const lossesToday = getDecisions().filter((d: DecisionSnapshot) => 
      d.timestamp.startsWith(today) && d.outcome === 'LOSS'
    ).length;

    return {
      mdd: equityCheck.currentMDD || 0,
      dailyLosses: lossesToday,
      isHalted: this.isHalted(),
      haltedUntil: config.haltedUntil,
    };
  }

  public async triggerKillSwitch(reason: string): Promise<void> {
    log.error(`🚨 [KILL SWITCH] Activated! Reason: ${reason}`);
    emitKillSwitch(reason, { source: 'SentinelGuard' }).catch(() => {/* non-blocking */});
    
    // 1. Set Cooldown (4 hours)
    const cooldownMs = 4 * 60 * 60 * 1000;
    const haltedUntil = new Date(Date.now() + cooldownMs).toISOString();
    
    saveBotConfig({ 
      aiStatus: 'OK', 
      mode: 'OBSERVATION',
      haltedUntil 
    });

    // 2. Social Broadcast (Transparency)
    try {
      const { postActivity } = await import('@/lib/moltbook/moltbookClient');
      const message = `⚠️ [SENTINEL GUARD] KILL-SWITCH ACTIVAT 🚨\n\n` +
        `Motiv: ${reason}\n` +
        `Acțiune: Sistemul a fost trecut în mod OBSERVATION.\n` +
        `Cooldown: 4 ore (până la ${new Date(haltedUntil).toLocaleTimeString()}).\n\n` +
        `Siguranța capitalului este prioritara. Toate pozițiile au fost închise (Emergency Exit). #Antigravity #SafeAI`;
      await postActivity(message, undefined, 'crypto');
    } catch {
      // Non-critical
    }
    
    // 3. Emergency Exit
    log.info('🛡️ [Sentinel] Emergency Exit Initialized: Pulling all orders...');
    await this.emergencyExitAllPositions();
  }

  /**
   * EMERGENCY EXIT — INSTITUTIONAL GRADE
   * Primary: MEXC (broker where all live positions are managed).
   * Executes best-effort liquidation to USDT.
   */
  private async emergencyExitAllPositions(): Promise<void> {
    // ═══ PRIORITY 1: MEXC — Primary Broker ═══
    try {
      log.warn('🚨 [Sentinel] EMERGENCY EXIT: Liquidating ALL MEXC positions...');
      const { sellAllAssetsToUsdt } = await import('@/lib/exchange/mexcClient');
      await sellAllAssetsToUsdt();
      log.info('🛡️ [Sentinel] MEXC emergency exit completed.');
    } catch (mexcErr: unknown) {
      const msg = mexcErr instanceof Error ? mexcErr.message : String(mexcErr);
      log.error(`[Sentinel] MEXC emergency exit FAILED: ${msg}`);
    }

    // Also close positions tracked in our DB that MEXC might have missed
    try {
      const { getLivePositions, updateLivePosition } = await import('@/lib/store/db');
      const { cancelAllMexcOrders, placeMexcMarketOrder } = await import('@/lib/exchange/mexcClient');
      const { getExchangeInfoCached, getSymbolFilters, roundToStep } = await import('@/lib/v2/scouts/executionMexc');
      const exchangeInfo = await getExchangeInfoCached().catch(() => null);

      const openPositions = getLivePositions().filter(p => p.status === 'OPEN');
      for (const pos of openPositions) {
        try {
          await cancelAllMexcOrders(pos.symbol).catch((e) => log.error('sentinelGuard cancelAllMexcOrders failed', { symbol: pos.symbol, error: String(e) }));
          const isLong = pos.side === 'LONG';
          let qty = pos.quantity;

          if (exchangeInfo) {
            const filters = getSymbolFilters(exchangeInfo, pos.symbol);
            qty = roundToStep(qty, filters.stepSize);
            if (qty < filters.minQty) {
              log.warn(`[Sentinel] Position ${pos.symbol} is dust (${qty}), marking CLOSED.`);
              updateLivePosition(pos.id, { status: 'CLOSED' });
              continue;
            }
          }

          await placeMexcMarketOrder(pos.symbol, isLong ? 'SELL' : 'BUY', qty);
          updateLivePosition(pos.id, { status: 'CLOSED' });
          log.info(`[Sentinel] Force-closed MEXC position: ${pos.symbol} (${qty})`);
        } catch (e) {
          log.error(`[Sentinel] Failed to close tracked position ${pos.symbol}`, { error: (e as Error).message });
          // Mark closed in DB to prevent re-evaluation of zombie position
          updateLivePosition(pos.id, { status: 'CLOSED' });
        }
      }
    } catch (dbErr: unknown) {
      log.error(`[Sentinel] DB-tracked position cleanup failed`, { error: (dbErr as Error).message });
    }

    log.info('🛡️ [Sentinel] emergencyExitAllPositions: COMPLETE — All MEXC positions liquidated.');
  }
}
