import { createLogger } from '@/lib/core/logger';
import { getBotConfig, saveBotConfig, getDecisions, getEquityCurve } from '@/lib/store/db';
import { DualConsensus } from '@/lib/types/gladiator';
import { Signal, DecisionSnapshot } from '@/lib/types/radar';
import { sellAllAssetsToUsdt } from '@/lib/exchange/mexcClient';

const log = createLogger('SentinelGuard');

export class SentinelGuard {
  private static instance: SentinelGuard;
  private mddThreshold = 0.15; // 15% Maximum Drawdown Kill-Switch
  private dailyLossLimit = 5;   // Max 5 losses per day

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
    const config = getBotConfig();

    // 1. System Status Check
    if (config.aiStatus === 'NO_CREDIT') {
      return { safe: false, reason: 'AI Credits Exhausted' };
    }

    if (config.mode === 'LIVE' && this.isHalted()) {
      return { safe: false, reason: 'System is HALTED due to previous risk breach' };
    }

    // 2. Consensus Strength Check
    if (consensus.finalDirection === 'FLAT' || consensus.weightedConfidence < 0.70) {
      return { safe: false, reason: `Insufficient Consensus (${(consensus.weightedConfidence * 100).toFixed(2)}%)` };
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
    const equityCurve = getEquityCurve();
    const config = getBotConfig();
    const startBalance = config.paperBalance || 1000;
    
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

  private async emergencyExitAllPositions(): Promise<void> {
    try {
      log.warn('⚠️ [Sentinel] emergencyExitAllPositions: Cancelling all orders and selling to USDT...');
      await sellAllAssetsToUsdt();
      log.info('🛡️ [Sentinel] emergencyExitAllPositions: SUCCESS. All assets are back in USDT.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[Sentinel] emergencyExitAllPositions FAILED: ${message}`);
    }
  }
}
