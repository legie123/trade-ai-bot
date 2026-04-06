import { Gladiator, DualConsensus } from '../../types/gladiator';
import { DualMasterConsciousness } from '../master/dualMaster';
import { AlphaScout } from '../intelligence/alphaScout';
import { SentinelGuard } from '../safety/sentinelGuard';
import { executeMexcTrade } from '@/lib/v2/scouts/executionMexc';
import { Signal, DecisionSnapshot } from '../../types/radar';
import { addDecision, addLivePosition } from '@/lib/store/db';
import { postActivity } from '@/lib/moltbook/moltbookClient';

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
      this.broadcastSentinelBlock(payload, safetyCheck.reason || 'Unknown Risk Rule');
      return;
    }

    // 4. Dispatch Execution
    if (consensus.finalDirection !== 'FLAT') {
      await this.routeSignal(gladiator, payload, consensus);
    } else {
      console.log(`[SYNDICATE VETO] Masters did not approve the move for ${gladiator.id}. Reason: Low Confidence.`);
      this.broadcastSyndicateVeto(payload, consensus);
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

        // 🔗 [MOLTBOOK BROADCAST] Phoenix V2 Live Positioning
        this.broadcastTradeToMoltbook('ENTRY', result.symbol, consensus.finalDirection, result.price, consensus);

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

  private async broadcastTradeToMoltbook(type: 'ENTRY' | 'EXIT', symbol: string, side: string, price: number, consensus: DualConsensus) {
    try {
      const architect = consensus.opinions.find(o => o.identity === 'ARCHITECT');
      const oracle = consensus.opinions.find(o => o.identity === 'ORACLE');
      
      const message = `🚨 [PHOENIX V2] ${type === 'ENTRY' ? 'NOUĂ INTRARE' : 'IEȘIRE'} ACTIVATĂ 🚨\n\n` +
        `Asset: $ ${symbol}\n` +
        `Direcție: ${side}\n` +
        `Preț: $ ${price.toLocaleString()}\n` +
        `Confidence: ${(consensus.weightedConfidence * 100).toFixed(2)}%\n\n` +
        `🧠 [CONSENS DEZBATERE]\n` +
        `🏛️ ARCHITECT: "${architect?.reasoning.substring(0, 100)}..."\n` +
        `🔮 ORACLE: "${oracle?.reasoning.substring(0, 100)}..."\n\n` +
        `#Antigravity #TradingAI #AlgorithmicTrading`;

      await postActivity(message, undefined, 'crypto');
      console.log(`[SOCIAL] Broadcast finalizat pe Moltbook: $${symbol} ${side}`);
    } catch {
      // Non-critical
    }
  }

  private async broadcastSyndicateVeto(payload: Signal, consensus: DualConsensus) {
    try {
      const architect = consensus.opinions.find(o => o.identity === 'ARCHITECT');
      const oracle = consensus.opinions.find(o => o.identity === 'ORACLE');

      const message = `⚖️ [SYNDICATE VETO] DECIZIE RELEVATĂ ⚖️\n\n` +
        `Asset: $ ${payload.symbol}\n` +
        `Verdict: SKIP (Niciun consens clar)\n` +
        `Confidence: ${(consensus.weightedConfidence * 100).toFixed(2)}%\n\n` +
        `Divergență Masters:\n` +
        `• ARCHITECT: ${architect?.direction} (${architect?.confidence})\n` +
        `• ORACLE: ${oracle?.direction} (${oracle?.confidence})\n\n` +
        `Sindicatul Phoenix preferă siguranța capitalului în fața speculației ambigue. #Antigravity #TradingPsychology`;

      await postActivity(message, undefined, 'crypto');
    } catch {
      // Non-critical
    }
  }

  private async broadcastSentinelBlock(payload: Signal, reason: string) {
    try {
      const message = `🛡️ [SENTINEL GUARD] SEMNAL BLOCAT 🛡️\n\n` +
        `Asset: $ ${payload.symbol}\n` +
        `Motiv Securitate: ${reason}\n\n` +
        `Scutul Sentinel a detectat riscuri care depășesc parametrii de siguranță Phoenix V2. Oportunitate ignorată pentru protecția portofoliului. #SafetyFirst #RiskManagement`;
      await postActivity(message, undefined, 'crypto');
    } catch {
      // Non-critical
    }
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

