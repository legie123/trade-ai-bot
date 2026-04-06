import { Gladiator, SyndicateConsensus } from '../../types/gladiator';
import { MasterSyndicate } from '../master/syndicate';
import { AlphaScout } from '../intelligence/alphaScout';
import { SentinelGuard } from '../safety/sentinelGuard';
import { executeMexcTrade } from '@/lib/v2/scouts/executionMexc';
import { Signal } from '../../types/radar';

export class ManagerVizionar {
  private syndicate: MasterSyndicate;
  private scouts: AlphaScout;
  private sentinel: SentinelGuard;

  constructor() {
    this.syndicate = new MasterSyndicate();
    this.scouts = AlphaScout.getInstance();
    this.sentinel = SentinelGuard.getInstance();
  }

  /**
   * The Vizionar routes the signal only after the Syndicate of Masters
   * has reached a consensus on the market direction.
   */
  public async processSignal(gladiator: Gladiator, payload: Signal) {
    if (!gladiator) return;

    // 1. Get Public Context (Alpha Scouts)
    const context = await this.scouts.analyzeToken(payload.symbol);
    
    // 2. The Ritual of Consensus (Master Syndicate)
    // We pass the scout context in the payload for the Masters to consider
    const enrichPayload = { ...payload, alphaContext: context };
    const consensus: SyndicateConsensus = await this.syndicate.getConsensus(enrichPayload as any, gladiator.arena);

    // 3. The Shield Check (Sentinel Guard)
    const safetyCheck = await this.sentinel.check(payload, consensus);
    
    if (!safetyCheck.safe) {
      console.warn(`[SENTINEL BLOCKED] ${payload.symbol}: ${safetyCheck.reason}`);
      return;
    }

    // 4. Dispatch Execution
    if (consensus.finalDirection !== 'FLAT') {
      await this.routeSignal(gladiator, payload, consensus);
    } else {
      console.log(`[SYNDICATE VETO] Masters did not approve the move for ${gladiator.id}. Reason: Low Confidence.`);
    }
  }

  private async routeSignal(gladiator: Gladiator, payload: Signal, consensus: SyndicateConsensus) {
    if (gladiator.isLive) {
      await this.executeLiveCapital(gladiator.id, payload, consensus);
    } else {
      await this.executeShadowMode(gladiator.id, payload, consensus);
    }
  }

  private async executeLiveCapital(id: string, payload: Signal, consensus: SyndicateConsensus) {
    console.log(`[LIVE EXECUTION] Gladiator ${id} deployed real funds on ${payload.symbol}.`);
    console.log(`[MASTERS] Confidence: ${(consensus.weightedConfidence * 100).toFixed(2)}% Reasoning summarized in Combat Audit.`);
    
    // Real Execution on MEXC
    try {
      const side = consensus.finalDirection === 'LONG' ? 'BUY' : 'SELL';
      const result = await executeMexcTrade(payload.symbol, side);
      if (result.executed) {
        console.log(`[EXECUTION SUCCESS] Trade placed on MEXC for ${payload.symbol} @ ${result.price}`);
      } else {
        console.error(`[EXECUTION FAILED] ${result.error}`);
      }
    } catch (err) {
      console.error('[CRITICAL] Live Execution logic crashed:', err);
    }
  }

  private async executeShadowMode(id: string, payload: Signal, consensus: SyndicateConsensus) {
    console.log(`[PAPER TRADING] Gladiator ${id} is in shadow mode. Tracking virtual performance for ${payload.symbol}.`);
    // Logs fake execution for leaderboard updates
  }
}

