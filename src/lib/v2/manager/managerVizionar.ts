import { Gladiator, DualConsensus } from '../../types/gladiator';
import { DualMasterConsciousness } from '../master/dualMaster';
import { AlphaScout } from '../intelligence/alphaScout';
import { SentinelGuard } from '../safety/sentinelGuard';
import { DNAExtractor, IntelligenceDigest } from '../superai/dnaExtractor';
import { executeMexcTrade } from '@/lib/v2/scouts/executionMexc';
import { Signal, DecisionSnapshot } from '../../types/radar';
import { addDecision, addLivePosition, acquireTradeLock, releaseTradeLock, isPositionOpenStrict } from '@/lib/store/db';
import { postActivity } from '@/lib/moltbook/moltbookClient';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('ManagerVizionar');

export class ManagerVizionar {
  private static instance: ManagerVizionar;
  private syndicate: DualMasterConsciousness;
  private scouts: AlphaScout;
  private sentinel: SentinelGuard;
  private dnaExtractor: DNAExtractor;

  private constructor() {
    this.syndicate = new DualMasterConsciousness();
    this.scouts = AlphaScout.getInstance();
    this.sentinel = SentinelGuard.getInstance();
    this.dnaExtractor = DNAExtractor.getInstance();
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
   * NOW WITH REINFORCEMENT LEARNING LOOP.
   */
  public async processSignal(gladiator: Gladiator, payload: Signal) {
    if (!gladiator) return;

    // 1. Extract Gladiator Intelligence (RL Context)
    const intelligence = this.dnaExtractor.extractIntelligence(gladiator.id);

    // 2. Get Live Market Context (Alpha Scouts — CoinGecko + CryptoCompare)
    const context = await this.scouts.analyzeToken(payload.symbol);
    
    // 3. Build enriched payload with both market data AND gladiator DNA
    const enrichPayload = { ...payload, alphaContext: context };
    const dnaContext = {
      digest: intelligence.digest,
      confidenceModifier: intelligence.confidenceModifier,
      overallWinRate: intelligence.overallWinRate,
      recentWinRate: intelligence.recentWinRate,
      currentStreak: intelligence.currentStreak,
      bestSymbol: intelligence.bestSymbol,
      longWinRate: intelligence.longWinRate,
      shortWinRate: intelligence.shortWinRate,
    };

    let consensus: DualConsensus;
    try {
      consensus = await this.syndicate.getConsensus(enrichPayload as Record<string, unknown>, dnaContext);
    } catch (err) {
      console.error('🚨 [MANAGER VIZIONAR] Masters are OFFLINE/FAILING. Triggering emergency halt.');
      await this.sentinel.triggerKillSwitch(`MASTER_DISCONNECTED: ${(err as Error).message}`);
      return;
    }

    // 4. Apply RL Confidence Modifier (learned from past performance)
    consensus = this.applyRLModifier(consensus, intelligence, payload.symbol);

    // 5. The Shield Check (Sentinel Guard)
    const safetyCheck = await this.sentinel.check(payload, consensus);
    
    if (!safetyCheck.safe) {
      console.warn(`[SENTINEL BLOCKED] ${payload.symbol}: ${safetyCheck.reason}`);
      this.broadcastSentinelBlock(payload, safetyCheck.reason || 'Unknown Risk Rule').catch(() => {});
      return;
    }

    // 6. Dispatch Execution
    if (consensus.finalDirection !== 'FLAT') {
      await this.routeSignal(gladiator, payload, consensus);
    } else {
      console.log(`[SYNDICATE VETO] Masters did not approve the move for ${gladiator.id}. Reason: Low Confidence.`);
      this.broadcastSyndicateVeto(payload, consensus).catch(() => {});
    }
  }

  /**
   * Reinforcement Learning modifier:
   * Adjusts the Dual Master's confidence based on historical gladiator performance.
   * Order: 1) Streak circuit-breaker 2) Symbol-specific edge check 3) Apply modifier
   */
  private applyRLModifier(consensus: DualConsensus, intelligence: IntelligenceDigest, symbol?: string): DualConsensus {
    // 1. CIRCUIT BREAKER: 4+ loss streak AND base confidence < 85% → refuse trade
    if (intelligence.currentStreak <= -4 && consensus.weightedConfidence < 0.85) {
      console.warn(`[RL] CIRCUIT BREAKER: ${intelligence.gladiatorId} on ${intelligence.currentStreak} loss streak. Forcing FLAT.`);
      return { ...consensus, weightedConfidence: 0, finalDirection: 'FLAT' };
    }

    // 2. SYMBOL EDGE CHECK: if gladiator has negative expectancy on THIS symbol, dampen extra
    let symbolPenalty = 1.0;
    if (symbol) {
      const cleanSymbol = symbol.replace('USDT', '');
      const edge = intelligence.symbolEdges.find(e => e.symbol === cleanSymbol || e.symbol === symbol);
      if (edge && edge.totalTrades >= 5) {
        if (edge.expectancy < -0.5) {
          symbolPenalty = 0.6; // Heavy dampen — gladiator historically loses on this asset
          console.warn(`[RL] Symbol penalty for ${cleanSymbol}: expectancy ${edge.expectancy.toFixed(2)}% → penalty 0.6x`);
        } else if (edge.expectancy < 0) {
          symbolPenalty = 0.85;
        } else if (edge.expectancy > 0.5) {
          symbolPenalty = 1.1; // Slight boost — gladiator historically profits on this asset
        }
      }
    }

    // 3. Apply modifiers
    const mod = intelligence.confidenceModifier;
    const adjusted = consensus.weightedConfidence * mod * symbolPenalty;
    const final = Math.min(Math.max(adjusted, 0), 1);

    console.log(`[RL] ${intelligence.gladiatorId}: confidence ${(consensus.weightedConfidence * 100).toFixed(1)}% → ${(final * 100).toFixed(1)}% (mod: ${mod}, symbolPenalty: ${symbolPenalty})`);

    return {
      ...consensus,
      weightedConfidence: final,
      finalDirection: final < 0.5 ? 'FLAT' : consensus.finalDirection, // Auto-FLAT if RL drops below 50%
    };
  }

  private async routeSignal(gladiator: Gladiator, payload: Signal, consensus: DualConsensus) {
    if (gladiator.isLive) {
      await this.executeLiveCapital(gladiator.id, payload, consensus);
    } else {
      await this.executeShadowMode(gladiator.id, payload, consensus);
    }
  }

  private async executeLiveCapital(id: string, payload: Signal, consensus: DualConsensus) {
    // 1. STRICT DB VERIFICATION: check Postgres live_positions to prevent Double-Buy across instances
    const isAlreadyOpen = await isPositionOpenStrict(payload.symbol);
    if (isAlreadyOpen) {
      log.warn(`[MULTI-INSTANCE PROTECT] Real-time DB confirmed ${payload.symbol} is already OPEN. Skipping.`);
      return;
    }

    // 2. OMEGA: Distributed Trade Lock — prevent duplicate executions across instances
    const lockAcquired = await acquireTradeLock(payload.symbol);
    if (!lockAcquired) {
      log.warn(`[LOCK BLOCKED] Another instance is already trading ${payload.symbol}. Skipping.`);
      return;
    }

    try {
      await this._executeWithLock(id, payload, consensus);
    } finally {
      await releaseTradeLock(payload.symbol);
    }
  }

  private async _executeWithLock(id: string, payload: Signal, consensus: DualConsensus) {
    log.info(`[LIVE EXECUTION] Gladiator ${id} deployed real funds on ${payload.symbol}.`);
    log.info(`[MASTERS] Confidence: ${(consensus.weightedConfidence * 100).toFixed(2)}% Reasoning summarized in Combat Audit.`);
    
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
        this.broadcastTradeToMoltbook('ENTRY', result.symbol, consensus.finalDirection, result.price, consensus).catch(() => {});

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

