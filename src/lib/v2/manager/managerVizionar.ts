import { Gladiator, DualConsensus } from '../../types/gladiator';
import { DualMasterConsciousness } from '../master/dualMaster';
import { AlphaScout } from '../intelligence/alphaScout';
import { SentinelGuard } from '../safety/sentinelGuard';
import { executeMexcTrade } from '@/lib/v2/scouts/executionMexc';
import { Signal, DecisionSnapshot } from '../../types/radar';
import { addDecision, addLivePosition } from '@/lib/store/db';

export class ManagerVizionar {
  private static instance: ManagerVizionar;
  private syndicate: DualMasterConsciousness;
  private scouts: AlphaScout;
  private sentinel: SentinelGuard;

  private constructor() {
    this.syndicate = new DualMasterConsciousness();
    this.scouts = AlphaScout.getInstance();
    this.sentinel = SentinelGuard.getInstance();
  }

  public static getInstance(): ManagerVizionar {
    if (!ManagerVizionar.instance) {
      ManagerVizionar.instance = new ManagerVizionar();
    }
    return ManagerVizionar.instance;
  }

  /**
   * The Vizionar routes the signal only after the Syndicate of Masters
   * has reached a consensus on the market direction.
   */
  public async processSignal(gladiator: Gladiator, payload: Signal) {
    if (!gladiator) return;

    // 1. Get Public Context (Alpha Scouts)
    const context = await this.scouts.analyzeToken(payload.symbol);
    
    const enrichPayload = { ...payload, alphaContext: context };
    const dnaContext = {};
    // DualMaster.getConsensus() already writes the syndicate audit
    const consensus = await this.syndicate.getConsensus(enrichPayload as Record<string, unknown>, dnaContext);

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

  private async routeSignal(gladiator: Gladiator, payload: Signal, consensus: DualConsensus) {
    if (gladiator.isLive) {
      await this.executeLiveCapital(gladiator.id, payload, consensus);
    } else {
      await this.executeShadowMode(gladiator.id, payload, consensus);
    }
  }

  private async executeLiveCapital(id: string, payload: Signal, consensus: DualConsensus) {
    console.log(`[LIVE EXECUTION] Gladiator ${id} deployed real funds on ${payload.symbol}.`);
    console.log(`[MASTERS] Confidence: ${(consensus.weightedConfidence * 100).toFixed(2)}% Reasoning summarized in Combat Audit.`);
    
    // Log in database
    const snapshot: DecisionSnapshot = {
      id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      signalId: payload.id,
      symbol: payload.symbol,
      signal: payload.signal,
      direction: consensus.finalDirection,
      action: consensus.finalDirection,
      confidence: Math.round(consensus.weightedConfidence * 100),
      price: payload.price,
      timestamp: new Date().toISOString(),
      source: `V2 Live Execution`,
      ema50: 0, ema200: 0, ema800: 0, psychHigh: 0, psychLow: 0, dailyOpen: 0,
      priceAfter5m: null, priceAfter15m: null, priceAfter1h: null, priceAfter4h: null,
      outcome: 'PENDING',
      pnlPercent: null,
      evaluatedAt: null
    };

    // Real Execution on MEXC
    try {
      const side = consensus.finalDirection === 'LONG' ? 'BUY' : 'SELL';
      const result = await executeMexcTrade(payload.symbol, side);
      if (result.executed) {
        console.log(`[EXECUTION SUCCESS] Trade placed on MEXC for ${payload.symbol} @ ${result.price}`);
        
        // Register LivePosition for Asymmetric Trailing TP/SL Engine
        addLivePosition({
          id: `pos_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          symbol: result.symbol,
          side: consensus.finalDirection === 'LONG' ? 'LONG' : 'SHORT',
          entryPrice: result.price,
          quantity: result.quantity,
          partialTPHit: false,
          highestPriceObserved: result.price,
          lowestPriceObserved: result.price,
          status: 'OPEN',
          openedAt: new Date().toISOString(),
        });
        console.log(`[POSITION MANAGER] LivePosition registered for ${result.symbol} — Trailing Engine armed.`);
      } else {
        console.error(`[EXECUTION FAILED] ${result.error}`);
        snapshot.outcome = 'NEUTRAL'; // Treat execution fail as neutral skip
      }
    } catch (err) {
      console.error('[CRITICAL] Live Execution logic crashed:', err);
      snapshot.outcome = 'NEUTRAL';
    }

    addDecision(snapshot);
  }

  private async executeShadowMode(id: string, payload: Signal, consensus: DualConsensus) {
    console.log(`[PAPER TRADING] Gladiator ${id} is in shadow mode. Tracking virtual performance for ${payload.symbol}.`);
    console.log(`[PAPER TRADING CONSENSUS] ${consensus.finalDirection} with ${consensus.weightedConfidence}`);
    
    // Logs fake execution for leaderboard updates
    const snapshot: DecisionSnapshot = {
      id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      signalId: payload.id,
      symbol: payload.symbol,
      signal: payload.signal,
      direction: consensus.finalDirection,
      action: consensus.finalDirection,
      confidence: Math.round(consensus.weightedConfidence * 100),
      price: payload.price,
      timestamp: new Date().toISOString(),
      source: `V2 Shadow (${id})`,
      ema50: 0, ema200: 0, ema800: 0, psychHigh: 0, psychLow: 0, dailyOpen: 0,
      priceAfter5m: null, priceAfter15m: null, priceAfter1h: null, priceAfter4h: null,
      outcome: 'PENDING',
      pnlPercent: null,
      evaluatedAt: null
    };
    
    addDecision(snapshot);
  }
}

