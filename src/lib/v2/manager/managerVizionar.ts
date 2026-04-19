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
import { autoDebugEngine } from '@/lib/v2/safety/autoDebugEngine';
// AUDIT FIX C1 (2026-04-18): Wire decorative killSwitch limits into execution path
import { runPreTradeGates, onTradeExecuted } from '@/lib/core/safetyGates';
// AUDIT FIX C5 (2026-04-18): Capture per-position context for RL learning
import { storePositionContext, computeSlippageBps } from '@/lib/v2/memory/positionContextStore';

const log = createLogger('ManagerVizionar');
// Auto-initialize the debug engine
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _autoInit = autoDebugEngine;

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

    // ═══ ZERO-DATA BAN: Reject any signal with invalid/missing price ═══
    if (!payload.price || payload.price <= 0) {
      log.warn(`[ZERO-DATA BAN] Signal rejected for ${payload.symbol}: price=${payload.price}. No phantom data allowed.`);
      return;
    }

    // 1. Extract Gladiator Intelligence (RL Context) — async for Postgres-backed reads
    const intelligence = await this.dnaExtractor.extractIntelligenceAsync(gladiator.id);

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

    // 4b. R2 — TOXIC SYMBOL+DIRECTION BLACKLIST (2026-04-18, edge-root-cause fix)
    // Data: gladiator_battles post-QW-11, 5000 rows, C14 analysis showed
    // per-symbol directional memorization WR<10% on losing direction:
    //   BTCUSDT  LONG  → n=1771, WR 4.5%
    //   JUPUSDT  LONG  → n>=50,  WR 0%
    //   JTOUSDT  LONG  → n>=50,  WR 7.6%
    //   WIFUSDT  LONG  → n>=50,  WR 6.5%
    //   RNDRUSDT SHORT → n>=50,  WR 0%
    // Assumption (may invalidate R2 if broken): regime stable — if BTC flips bull
    // sustained, LONG blacklist becomes wrong. Mitigated by R4 (Butcher rolling
    // retrain, separate commit) which will surface updated symbol-direction WR
    // and we can remove entries. Hard-coded snapshot, NOT dynamic.
    // Kill-switch: env R2_BLACKLIST_OFF=1 reverts to pre-R2 behavior.
    consensus = this.applyToxicPairBlacklist(consensus, payload.symbol);

    // 5. The Shield Check (Sentinel Guard)
    const safetyCheck = await this.sentinel.check(payload, consensus);
    
    if (!safetyCheck.safe) {
      console.warn(`[SENTINEL BLOCKED] ${payload.symbol}: ${safetyCheck.reason}`);
      this.broadcastSentinelBlock(payload, safetyCheck.reason || 'Unknown Risk Rule').catch((e) => log.warn('broadcastSentinelBlock failed', { error: String(e) }));
      return;
    }

    // 6. Dispatch Execution
    if (consensus.finalDirection !== 'FLAT') {
      await this.routeSignal(gladiator, payload, consensus);
    } else {
      log.info(`[SYNDICATE VETO] Masters did not approve the move for ${gladiator.id}. Reason: Low Confidence.`);
      this.broadcastSyndicateVeto(payload, consensus).catch((e) => log.warn('broadcastSyndicateVeto failed', { error: String(e) }));
    }
  }

  /**
   * Reinforcement Learning modifier:
   * Adjusts the Dual Master's confidence based on historical gladiator performance.
   * Order: 1) Streak circuit-breaker 2) Symbol-specific edge check 3) Apply modifier
   */
  private applyRLModifier(consensus: DualConsensus, intelligence: IntelligenceDigest, symbol?: string): DualConsensus {
    // 1. CIRCUIT BREAKER: 4+ loss streak AND base confidence < 85% → refuse trade
    // PAPER UNLOCK (2026-04-18): Shadow trades have zero capital risk. CB in PAPER mode
    // was forcing FLAT on ~all signals (current WR=44%, streak≤-4 statistically dominant),
    // leaving json_store.decisions empty and blocking FAZA B.1c validation.
    // In PAPER, log-only so the pipeline accumulates training data.
    // ASSUMPTION CRITIQUE: LIVE mode preserves hard CB. If TRADING_MODE !== 'PAPER',
    // CB still forces FLAT to protect real capital.
    const isPaperCB = (process.env.TRADING_MODE || 'PAPER').toUpperCase() === 'PAPER';
    if (intelligence.currentStreak <= -4 && consensus.weightedConfidence < 0.85) {
      if (!isPaperCB) {
        log.warn(`[RL] CIRCUIT BREAKER: ${intelligence.gladiatorId} on ${intelligence.currentStreak} loss streak. Forcing FLAT.`);
        return { ...consensus, weightedConfidence: 0, finalDirection: 'FLAT' };
      }
      log.warn(`[RL CB-LOG] PAPER: ${intelligence.gladiatorId} streak=${intelligence.currentStreak} conf=${consensus.weightedConfidence.toFixed(2)} — LIVE would block, PAPER continues for training data.`);
    }

    // ═══ CONFIDENCE CAP: Limit max confidence based on rolling win rate ═══
    const wr = intelligence.overallWinRate || 0;
    const totalBattles = intelligence.totalBattles ?? 0;
    let confidenceCap = 1.0;

    // BOOTSTRAP PERIOD: New gladiators (< 20 trades) get full confidence to collect training data
    if (totalBattles < 20) {
      confidenceCap = 1.0;
      log.info(`[RL BOOTSTRAP] ${intelligence.gladiatorId} in warm-up (${totalBattles}/20 trades) → no confidence cap`);
    } else if (wr < 0.30) {
      confidenceCap = 0.40; // WR < 30% → hard cap at 40% confidence
      log.warn(`[RL CAP] ${intelligence.gladiatorId} WR=${(wr*100).toFixed(0)}% → confidence capped at 40%`);
    } else if (wr < 0.50) {
      confidenceCap = 0.65; // WR 30-50% → cap at 65%
      log.info(`[RL CAP] ${intelligence.gladiatorId} WR=${(wr*100).toFixed(0)}% → confidence capped at 65%`);
    }

    // 2. SYMBOL EDGE CHECK: if gladiator has negative expectancy on THIS symbol, dampen extra
    let symbolPenalty = 1.0;
    if (symbol) {
      const cleanSymbol = symbol.replace('USDT', '');
      const edge = intelligence.symbolEdges.find(e => e.symbol === cleanSymbol || e.symbol === symbol);
      if (edge && edge.totalTrades >= 5) {
        if (edge.expectancy < -0.5) {
          symbolPenalty = 0.6;
          log.warn(`[RL] Symbol penalty for ${cleanSymbol}: expectancy ${edge.expectancy.toFixed(2)}% → penalty 0.6x`);
        } else if (edge.expectancy < 0) {
          symbolPenalty = 0.85;
        } else if (edge.expectancy > 0.5) {
          symbolPenalty = 1.1;
        }
      }
    }

    // 3. Apply modifiers + cap
    const mod = intelligence.confidenceModifier;
    // RUFLO FAZA 3 / BATCH 7 / F8 fix (P1) — weak-signal extra penalty.
    //
    // BUG (pre-fix): confidenceModifier `mod` already scales confidence
    // proportionally, but a gladiator with mod=0.5 still gets a LINEAR
    // reduction. Empirically, signals at the lower band of mod degrade
    // FASTER than linear (noise-to-signal blows up). Without extra penalty,
    // a "weak but positive" signal still crosses FLAT_THRESHOLD too often.
    //
    // FIX: When mod < 0.8, multiply by (mod/0.8). So mod=0.5 becomes
    // 0.5 * (0.5/0.8) = 0.3125, pushing weak signals toward FLAT.
    //
    // ASUMPȚIE invalidatoare: breakpoint 0.8 empiric — if calibration shows
    // mod distribution shifted (e.g., median drops below 0.8), this
    // penalty becomes too aggressive and should be re-tuned.
    //
    // Env rollback: CONFIDENCE_WEAK_PENALTY_OFF=1 → legacy linear behavior.
    const weakPenaltyOff = process.env.CONFIDENCE_WEAK_PENALTY_OFF === '1';
    const weakPenalty = (!weakPenaltyOff && mod < 0.8) ? (mod / 0.8) : 1.0;
    const adjusted = consensus.weightedConfidence * mod * symbolPenalty * weakPenalty;
    const capped = Math.min(adjusted, confidenceCap);
    const final = Math.min(Math.max(capped, 0), 1);

    log.info(`[RL] ${intelligence.gladiatorId}: confidence ${(consensus.weightedConfidence * 100).toFixed(1)}% → ${(final * 100).toFixed(1)}% (mod: ${mod}, symPen: ${symbolPenalty}, weakPen: ${weakPenalty.toFixed(2)}, cap: ${confidenceCap})`);

    // PAPER MODE: Lower FLAT threshold to generate training data (0.25 vs 0.5 for LIVE)
    const isPaper = (process.env.TRADING_MODE || 'PAPER').toUpperCase() === 'PAPER';
    const FLAT_THRESHOLD = isPaper ? 0.25 : 0.5;

    return {
      ...consensus,
      weightedConfidence: final,
      finalDirection: final < FLAT_THRESHOLD ? 'FLAT' : consensus.finalDirection,
    };
  }

  /**
   * R2 — Toxic symbol+direction blacklist.
   *
   * Hard gate that forces FLAT on symbol+direction combos with historical
   * WR < 10% and n >= 50 (from gladiator_battles C14 stratification).
   *
   * Rationale: the forge memorized per-symbol direction during training; e.g.
   * BTC LONG fires on 1771/1771 BTC signals with WR 4.5% — literally never
   * profitable, yet still emitted by current gladiators. R2 is a band-aid
   * until R4 (rolling 7d retrain) makes this obsolete.
   *
   * Why not a soft penalty: confidence cap was already applied upstream and
   * these combos still slip through because some gladiators carry high base
   * confidence on memorized pairs. Hard FLAT is the only reliable block.
   *
   * Why keep decision logged (not early return): PENDING + outcome evaluation
   * still happens, so we preserve FLAT training rows for horizonStats and the
   * R4 retrain ingestion.
   */
  private applyToxicPairBlacklist(consensus: DualConsensus, symbol: string): DualConsensus {
    if (process.env.R2_BLACKLIST_OFF === '1') return consensus;
    if (consensus.finalDirection === 'FLAT') return consensus;

    // Hardcoded snapshot — reason + evidence inline for audit
    // High-evidence (n>=50, WR<10%): BTC, JUP, JTO, WIF, RNDR
    // Lower-evidence (WR<35% but smaller N): PYTH, RAY — included per user approval
    const BLACKLIST: Record<string, 'LONG' | 'SHORT'> = {
      BTCUSDT: 'LONG',   // n=1771, WR 4.5%  [high evidence]
      JUPUSDT: 'LONG',   // n>=50,  WR 0%    [high evidence]
      JTOUSDT: 'LONG',   // n>=50,  WR 7.6%  [high evidence]
      WIFUSDT: 'LONG',   // n>=50,  WR 6.5%  [high evidence]
      RNDRUSDT: 'SHORT', // n>=50,  WR 0%    [high evidence]
      PYTHUSDT: 'LONG',  // WR<35%           [medium evidence — smaller N]
      RAYUSDT: 'LONG',   // WR<35%           [medium evidence — smaller N]
    };

    const blockedDirection = BLACKLIST[symbol];
    if (!blockedDirection) return consensus;
    if (consensus.finalDirection !== blockedDirection) return consensus;

    log.warn(`[R2 BLACKLIST] ${symbol} ${consensus.finalDirection} blocked → FLAT (historical WR<10% on this direction, see C14)`);
    return {
      ...consensus,
      finalDirection: 'FLAT',
      weightedConfidence: 0,
    };
  }

  private async routeSignal(gladiator: Gladiator, payload: Signal, consensus: DualConsensus) {
    // PAPER MODE: All gladiators execute via shadow mode (no MEXC, no position locks)
    const isPaperMode = (process.env.TRADING_MODE || 'PAPER').toUpperCase() === 'PAPER';
    if (isPaperMode) {
      log.info(`[PAPER ROUTE] ${gladiator.id} → shadow execution for ${payload.symbol} (paper mode active)`);
      await this.executeShadowMode(gladiator.id, payload, consensus);
      return;
    }

    // ═══ GLADIATOR MIN WR GATE: Block underperforming gladiators from live execution ═══
    if (gladiator.isLive) {
      const dna = this.dnaExtractor.extractIntelligence(gladiator.id);
      const totalTrades = dna.totalBattles || 0;
      const winRate = dna.overallWinRate || 0;
      if (totalTrades >= 10 && winRate < 0.40) {
        log.warn(`[GLADIATOR GATE] ${gladiator.id} blocked from LIVE: WR=${(winRate*100).toFixed(0)}% < 40% (${totalTrades} trades). Demoting to shadow.`);
        await this.executeShadowMode(gladiator.id, payload, consensus);
        return;
      }
      await this.executeLiveCapital(gladiator.id, payload, consensus);
    } else {
      await this.executeShadowMode(gladiator.id, payload, consensus);
    }
  }

  private async executeLiveCapital(id: string, payload: Signal, consensus: DualConsensus) {
    if (consensus.finalDirection !== 'LONG') {
      log.warn(`[MULTI-INSTANCE PROTECT] MEXC Spot execution exclusively supports LONG (Buy-Hold-Sell). Vetoing ${consensus.finalDirection} intent.`);
      return;
    }

    // AUDIT FIX C1 (2026-04-18): PRE-TRADE SAFETY GATES
    // Checks daily-loss limit, exposure limit, and kill-switch state BEFORE
    // acquiring the trade lock or touching MEXC. If any gate blocks, we abort
    // cleanly with no lock held and no API calls made.
    // Asumpție: runPreTradeGates calls ensureDailyReset internally → safe per tick.
    try {
      const gate = await runPreTradeGates(/* newNotional */ null);
      if (!gate.allowed) {
        log.warn(`[SAFETY GATE BLOCK] ${payload.symbol}: ${gate.reason}`);
        return;
      }
    } catch (err) {
      log.error('[SAFETY GATE ERROR] pre-trade gate threw — treating as BLOCK', { error: String(err) });
      return;
    }

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
      gladiatorId: id,
      marketId: (payload as unknown as Record<string, unknown>).marketId as string | undefined,
      ema50: 0, ema200: 0, ema800: 0, psychHigh: 0, psychLow: 0, dailyOpen: 0,
      priceAfter5m: null, priceAfter15m: null, priceAfter1h: null, priceAfter4h: null,
      outcome: 'PENDING',
      pnlPercent: null,
      evaluatedAt: null
    };

    // Execution on MEXC (Currently DRY RUN / Paper Trading per user request)
    const signalPrice = payload.price; // captured BEFORE execution for slippage calc
    const executionStartMs = Date.now();
    try {
      const side = consensus.finalDirection === 'LONG' ? 'BUY' : 'SELL';
      // Mapped to MEXC - ACTIVATED FOR LIVE CAPITAL
      const result = await executeMexcTrade(payload.symbol, side, undefined, false);
      if (result.executed) {
        log.info(`[EXECUTION SUCCESS] Trade placed on MEXC for ${payload.symbol} @ ${result.price}`);
        const latencyMs = Date.now() - executionStartMs;

        // Register LivePosition for Asymmetric Trailing TP/SL Engine
        const positionId = `pos_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const positionSide = consensus.finalDirection === 'LONG' ? 'LONG' : 'SHORT';
        addLivePosition({
          id: positionId,
          symbol: result.symbol,
          side: positionSide,
          entryPrice: result.price,
          quantity: result.quantity,
          partialTPHit: false,
          highestPriceObserved: result.price,
          lowestPriceObserved: result.price,
          status: 'OPEN',
          openedAt: new Date().toISOString(),
          isPaperTrade: false,
        });

        // AUDIT FIX C5 (2026-04-18): Capture context snapshot for RL learning
        // when this position closes. Previously recordExperience() hardcoded all
        // features to zero/null → experienceMemory was decorative.
        //
        // ASUMPȚIE: payload.alphaContext carries indicators from AlphaScout.
        // If absent, we store empty indicators — not fatal, just reduces signal.
        try {
          const alpha = (payload as unknown as Record<string, unknown>).alphaContext as Record<string, unknown> | undefined;
          storePositionContext(positionId, {
            regime: (alpha?.regime as string | undefined) || null,
            indicators: {
              rsi: alpha?.rsi as number | undefined,
              vwapDeviation: alpha?.vwapDeviation as number | undefined,
              volumeZ: alpha?.volumeZ as number | undefined,
              fundingRate: alpha?.fundingRate as number | undefined,
              sentimentScore: alpha?.sentimentScore as number | undefined,
            },
            confidence: consensus.weightedConfidence,
            debateVerdict: (consensus as unknown as Record<string, unknown>).debateVerdict as string | null || null,
            signalPrice,
            latencyMs,
          });
          // Slippage observable immediately — log for audit
          const slippageBps = computeSlippageBps(signalPrice, result.price, positionSide);
          log.info(`[C5] Position ${positionId} context stored. slippage=${slippageBps}bps, latency=${latencyMs}ms`);
        } catch (e) {
          log.warn('[C5] Failed to store position context — experience will degrade', { error: String(e) });
        }

        // 🔗 [MOLTBOOK BROADCAST] Phoenix V2 Live Positioning
        this.broadcastTradeToMoltbook('ENTRY', result.symbol, consensus.finalDirection, result.price, consensus).catch((e) => log.warn('broadcastTradeToMoltbook failed', { error: String(e) }));

        // AUDIT FIX C1 (2026-04-18): Post-trade velocity track. Feeds killSwitch's
        // rapid-fire detector (max 8 trades in 15min, max 5% cumulative spend).
        // Fire-and-forget — must NOT block the execution path.
        const notional = (result.price || 0) * (result.quantity || 0);
        onTradeExecuted(notional).catch(e => log.warn('onTradeExecuted failed', { error: String(e) }));

        log.info(`[POSITION MANAGER] LivePosition registered for ${result.symbol} — Trailing Engine armed.`);
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
      log.info(`[SOCIAL] Broadcast finalizat pe Moltbook: $${symbol} ${side}`);
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
    log.info(`[PAPER TRADING] Gladiator ${id} is in shadow mode. Tracking virtual performance for ${payload.symbol}.`);
    log.info(`[PAPER TRADING CONSENSUS] ${consensus.finalDirection} with ${consensus.weightedConfidence}`);
    
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
      gladiatorId: id,
      marketId: (payload as unknown as Record<string, unknown>).marketId as string | undefined,
      ema50: 0, ema200: 0, ema800: 0, psychHigh: 0, psychLow: 0, dailyOpen: 0,
      priceAfter5m: null, priceAfter15m: null, priceAfter1h: null, priceAfter4h: null,
      outcome: 'PENDING',
      pnlPercent: null,
      evaluatedAt: null
    };
    
    addDecision(snapshot);

    // Telegram notification for paper trades (so we know the system is alive)
    try {
      const { sendMessage } = await import('@/lib/alerts/telegram');
      const msg = `📝 *PAPER TRADE*\n\n` +
        `Gladiator: \`${id}\`\n` +
        `${payload.symbol} → *${consensus.finalDirection}*\n` +
        `Price: $${payload.price.toLocaleString()}\n` +
        `Confidence: ${(consensus.weightedConfidence * 100).toFixed(1)}%\n` +
        `Signal: ${payload.source}`;
      sendMessage(msg).catch(() => {}); // Fire and forget
    } catch {
      // Non-critical
    }
  }
}

