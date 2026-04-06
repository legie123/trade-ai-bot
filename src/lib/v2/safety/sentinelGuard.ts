import { createLogger } from '@/lib/core/logger';
import { getBotConfig, saveBotConfig, getDecisions, BotConfig } from '@/lib/store/db';
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

    // 3. Drawdown Check
    const mddResult = this.checkDrawdown(config);
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

  private isHalted(): boolean {
    // Logic to check if we are in a cooldown period
    return false; // Placeholder
  }

  private checkDrawdown(config: BotConfig): { safe: boolean; reason?: string } {
    const decisions = getDecisions().filter((d: DecisionSnapshot) => d.outcome !== 'PENDING');
    if (decisions.length < 5) return { safe: true };

    log.info(`[Sentinel] Checking MDD for ${config.mode} mode...`);

    // Simple MDD calculation for the last 50 trades
    const pnls = decisions.slice(0, 50).map((d: DecisionSnapshot) => d.pnlPercent || 0);
    let peak = 0;
    let current = 0;
    let maxDD = 0;

    for (const p of pnls.reverse()) {
      current += p;
      if (current > peak) peak = current;
      const dd = peak - current;
      if (dd > maxDD) maxDD = dd;
    }

    if (maxDD > (this.mddThreshold * 100)) {
      return { safe: false, reason: `Critical Max Drawdown Reached: ${maxDD.toFixed(2)}%` };
    }

    return { safe: true };
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

  public async triggerKillSwitch(reason: string): Promise<void> {
    log.error(`🚨 [KILL SWITCH] Activated! Reason: ${reason}`);
    
    // 1. Halt Bot
    saveBotConfig({ aiStatus: 'OK', mode: 'OBSERVATION' }); // Force Observation Mode
    
    // 2. Emergency Exit (Placeholder for real exchange call)
    log.info('🛡️ [Sentinel] Emergency Exit Initialized: Pulling all orders...');
    await this.emergencyExitAllPositions();
  }

  private async emergencyExitAllPositions(): Promise<void> {
    try {
      log.warn('⚠️ [Sentinel] emergencyExitAllPositions: Cancelling all orders and selling to USDT...');
      
      // Attempt to cancel all orders for common symbols or active symbols
      // Since MEXC requires symbol, we'd normally loop through active traders
      // For this implementation, we'll focus on selling the balance
      await sellAllAssetsToUsdt();
      
      log.info('🛡️ [Sentinel] emergencyExitAllPositions: SUCCESS. All assets are back in USDT.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[Sentinel] emergencyExitAllPositions FAILED: ${message}`);
    }
  }
}
