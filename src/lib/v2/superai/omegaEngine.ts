import { createLogger } from '@/lib/core/logger';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { BattleRecord } from './dnaExtractor';
import { getGladiatorBattles } from '@/lib/store/db';

const log = createLogger('OmegaEngine');

/**
 * Market regime classification based on recent price action
 */
export type MarketRegime = 'BULL' | 'BEAR' | 'RANGE' | 'HIGH_VOL' | 'TRANSITION';

/**
 * Regime detection uses RSI-like logic on win rates + volatility
 * WITHOUT external dependencies
 */
export interface RegimeAnalysis {
  regime: MarketRegime;
  confidence: number;               // 0-1, how sure we are
  bullSignals: number;
  bearSignals: number;
  volatilityScore: number;          // 0-100, market chop level
  allGladiatorWinRate: number;      // Aggregate across all fighters
  regimeShiftedAt: number;          // Timestamp
}

/**
 * Synthesized patterns from winning trades
 */
export interface DNAPattern {
  patternType: string;              // E.g., "BULL_MOMENTUM", "RANGE_REVERSAL"
  frequency: number;                // How often this pattern appears in wins
  avgWinPnl: number;
  relevantGladiators: string[];     // Gladiator IDs that excel at this
  preferredTimeframe: string;       // E.g., "1m", "5m", "1h"
  marketConditions: string[];       // E.g., ["post_breakout", "high_volume"]
  strength: number;                 // 0-1, how reliable this pattern is
}

/**
 * Override decision from Omega
 */
export interface OverrideDecision {
  shouldOverride: boolean;
  reason: string;
  confidenceMultiplier: number;     // 1.0 = normal, 0.5 = veto half, 1.5 = boost
  regimeAlignment: number;          // How well the signal aligns with current regime
}

/**
 * OmegaEngine: Real meta-learning system that:
 * - Detects market regimes from live gladiator data
 * - Synthesizes actual winning patterns
 * - Weights strategies by regime fit
 * - Makes adaptive override decisions
 */
export class OmegaEngine {
  private static instance: OmegaEngine;
  private lastRegime: RegimeAnalysis | null = null;
  private regimeHistory: RegimeAnalysis[] = [];
  private synthesizedPatterns: DNAPattern[] = [];
  private lastAnalysisTime: number = 0;

  private constructor() {}

  public static getInstance(): OmegaEngine {
    if (!OmegaEngine.instance) {
      OmegaEngine.instance = new OmegaEngine();
    }
    return OmegaEngine.instance;
  }

  /**
   * MAIN: Run full meta-learning analysis on current state
   * Returns regime + patterns + adaptive metrics
   */
  public async analyze(): Promise<{
    regime: RegimeAnalysis;
    patterns: DNAPattern[];
    adaptiveThresholds: {
      promotionThreshold: number;    // Readiness score needed for live capital
      eliminationThreshold: number;  // Below this = liquidate
      signalMultiplier: number;      // Confidence boost/dampen per regime
    };
  }> {
    const startTime = Date.now();

    // Step 1: Detect market regime from all gladiator battle history
    const regime = await this.detectRegime();
    this.lastRegime = regime;
    this.regimeHistory.push(regime);
    if (this.regimeHistory.length > 100) this.regimeHistory.shift();

    // Step 2: Synthesize DNA patterns from top performers
    const patterns = await this.synthesizeDNA(regime);
    this.synthesizedPatterns = patterns;

    // Step 3: Compute adaptive thresholds based on regime confidence
    const thresholds = this.computeAdaptiveThresholds(regime, patterns);

    this.lastAnalysisTime = Date.now() - startTime;
    log.info(`[OmegaEngine] Analysis complete in ${this.lastAnalysisTime}ms. Regime: ${regime.regime} (${(regime.confidence * 100).toFixed(0)}% confidence)`);

    return { regime, patterns, adaptiveThresholds: thresholds };
  }

  /**
   * STEP 1: Regime Detection
   * Classifies market using aggregate gladiator win rates + volatility
   */
  public async detectRegime(): Promise<RegimeAnalysis> {
    if (this.lastRegime && Date.now() - this.lastRegime.regimeShiftedAt < 60_000) {
      return this.lastRegime; // Cache for 60s
    }

    const gladiators = gladiatorStore.getGladiators().filter(g => !g.isOmega);
    if (gladiators.length === 0) {
      return this.emptyRegime();
    }

    // Fetch recent battles (last 100 across all gladiators)
    const allBattles: BattleRecord[] = [];
    for (const glad of gladiators) {
      try {
        const battles = await getGladiatorBattles(glad.id, 50);
        if (battles) allBattles.push(...(battles as unknown as BattleRecord[]));
      } catch {
        // Skip if DB unavailable
      }
    }

    if (allBattles.length === 0) {
      return this.emptyRegime();
    }

    // Sort by timestamp, take recent window (last 2 hours)
    const now = Date.now();
    const recentWindow = 2 * 60 * 60 * 1000;
    const recent = allBattles
      .filter(b => b.timestamp > now - recentWindow)
      .sort((a, b) => a.timestamp - b.timestamp);

    const allWinRate = recent.length > 0
      ? recent.filter(b => b.isWin).length / recent.length
      : 0;

    // ─── Bull/Bear Signal Detection ───
    let bullSignals = 0;
    let bearSignals = 0;
    const longWins = recent.filter(b => b.decision === 'LONG' && b.isWin).length;
    const shortWins = recent.filter(b => b.decision === 'SHORT' && b.isWin).length;
    const longLosses = recent.filter(b => b.decision === 'LONG' && !b.isWin).length;
    const shortLosses = recent.filter(b => b.decision === 'SHORT' && !b.isWin).length;

    if (longWins > shortWins && longWins > longLosses) bullSignals += 2;
    if (shortWins > longWins && shortWins > shortLosses) bearSignals += 2;
    if (allWinRate > 0.55) bullSignals += 1;
    if (allWinRate < 0.45) bearSignals += 1;

    // ─── Volatility Scoring ───
    // High variance in PnL = high volatility
    const pnls = recent.map(b => b.pnlPercent);
    const meanPnl = pnls.reduce((s, p) => s + p, 0) / pnls.length;
    const variance = pnls.reduce((s, p) => s + Math.pow(p - meanPnl, 2), 0) / pnls.length;
    const stdDev = Math.sqrt(variance);
    const volatilityScore = Math.min(100, stdDev * 10); // Scale 0-100

    // ─── Regime Classification ───
    let regime: MarketRegime = 'RANGE';
    let confidence = 0.5;

    if (volatilityScore > 60 && allWinRate > 0.5) {
      regime = 'BULL';
      confidence = Math.min(1, 0.5 + (bullSignals * 0.15) + (allWinRate - 0.5) * 0.5);
    } else if (volatilityScore > 60 && allWinRate < 0.5) {
      regime = 'BEAR';
      confidence = Math.min(1, 0.5 + (bearSignals * 0.15) + (0.5 - allWinRate) * 0.5);
    } else if (volatilityScore > 75) {
      regime = 'HIGH_VOL';
      confidence = Math.min(1, 0.5 + (volatilityScore - 60) / 50);
    } else if (Math.abs(allWinRate - 0.5) < 0.1) {
      regime = 'RANGE';
      confidence = 1.0 - (allWinRate - 0.5) * 10; // Higher confidence near 50%
    } else if (this.lastRegime) {
      regime = 'TRANSITION';
      confidence = 0.3;
    }

    confidence = Math.max(0.1, Math.min(1.0, confidence));

    log.debug(`[Regime] ${regime} (${(confidence * 100).toFixed(0)}%), WR: ${(allWinRate * 100).toFixed(1)}%, Vol: ${volatilityScore.toFixed(0)}`);

    return {
      regime,
      confidence,
      bullSignals,
      bearSignals,
      volatilityScore,
      allGladiatorWinRate: allWinRate,
      regimeShiftedAt: Date.now(),
    };
  }

  /**
   * STEP 2: DNA Synthesis
   * Extract patterns from top gladiators that align with current regime
   */
  public async synthesizeDNA(regime: RegimeAnalysis): Promise<DNAPattern[]> {
    const gladiators = gladiatorStore.getGladiators()
      .filter(g => !g.isOmega && g.stats.totalTrades >= 10)
      .sort((a, b) => b.stats.winRate - a.stats.winRate)
      .slice(0, 5); // Top 5 performers

    if (gladiators.length === 0) return [];

    const patterns: Map<string, DNAPattern> = new Map();

    for (const glad of gladiators) {
      try {
        const battles = await getGladiatorBattles(glad.id, 100);
        if (!battles || battles.length === 0) continue;

        const battles_ = battles as unknown as BattleRecord[];
        const wins = battles_.filter(b => b.isWin);

        // ─── Pattern Recognition ───
        for (const win of wins.slice(-20)) { // Recent 20 wins
          // Pattern: direction alignment with regime
          const direction = win.decision === 'LONG' ? 'LONG' : 'SHORT';
          const regimeAlignment = (regime.regime === 'BULL' && direction === 'LONG')
            || (regime.regime === 'BEAR' && direction === 'SHORT')
            ? 'ALIGNED'
            : 'OPPOSED';

          const patternKey = `${regime.regime}_${direction}_${regimeAlignment}`;
          const existing = patterns.get(patternKey) || {
            patternType: patternKey,
            frequency: 0,
            avgWinPnl: 0,
            relevantGladiators: [],
            preferredTimeframe: '5m',
            marketConditions: [],
            strength: 0,
          };

          existing.frequency += 1;
          existing.avgWinPnl = (existing.avgWinPnl * (existing.frequency - 1) + win.pnlPercent) / existing.frequency;
          if (!existing.relevantGladiators.includes(glad.id)) {
            existing.relevantGladiators.push(glad.id);
          }

          // AUDIT FIX T1.8: Fix operator precedence — was: (val) || 0 < 300 → (val) || true → always truthy
          const holdTime = (win.marketContext?.holdTimeSec as number) || 0;
          if (holdTime < 300) {
            existing.preferredTimeframe = '1m';
          } else if (holdTime < 1800) {
            existing.preferredTimeframe = '5m';
          } else {
            existing.preferredTimeframe = '1h';
          }

          patterns.set(patternKey, existing);
        }
      } catch (err) {
        log.debug(`Failed to fetch battles for ${glad.id}: ${(err as Error).message}`);
      }
    }

    // Convert to array and rank by frequency + avg win
    const result = Array.from(patterns.values())
      .map(p => ({
        ...p,
        strength: Math.min(1, (p.frequency / 20) * (Math.max(0, p.avgWinPnl) / 2)),
      }))
      .sort((a, b) => b.frequency * b.strength - a.frequency * a.strength);

    log.debug(`[DNA] Synthesized ${result.length} patterns from top performers`);
    return result;
  }

  /**
   * STEP 3: Adaptive Thresholds
   * Adjust promotion/elimination bars based on regime confidence
   */
  private computeAdaptiveThresholds(
    regime: RegimeAnalysis,
    patterns: DNAPattern[]
  ): {
    promotionThreshold: number;
    eliminationThreshold: number;
    signalMultiplier: number;
  } {
    // Base thresholds (from gladiatorStore)
    let promotionThreshold = 65; // Base readiness score for live capital
    let eliminationThreshold = 25; // Below this = liquidate
    let signalMultiplier = 1.0;

    // ─── Regime-Based Adjustments ───
    switch (regime.regime) {
      case 'BULL':
        // In bull market, reward momentum players — lower threshold
        promotionThreshold = Math.max(55, 65 - (regime.confidence * 10));
        signalMultiplier = 1.15;
        eliminationThreshold = 20; // More lenient with losers
        break;
      case 'BEAR':
        // In bear market, need more caution — higher threshold
        promotionThreshold = Math.min(75, 65 + (regime.confidence * 10));
        signalMultiplier = 1.0;
        eliminationThreshold = 30;
        break;
      case 'RANGE':
        // In ranging market, mean-reversion players thrive
        promotionThreshold = 60;
        signalMultiplier = 1.1;
        eliminationThreshold = 25;
        break;
      case 'HIGH_VOL':
        // Volatility → need proven edge, stricter gates
        promotionThreshold = 70;
        signalMultiplier = 0.85;
        eliminationThreshold = 35;
        break;
      case 'TRANSITION':
        // Market shifting — trust nobody
        promotionThreshold = 75;
        signalMultiplier = 0.7;
        eliminationThreshold = 40;
        break;
    }

    // ─── Pattern Quality Modulation ───
    const avgPatternStrength = patterns.length > 0
      ? patterns.reduce((s, p) => s + p.strength, 0) / patterns.length
      : 0.5;

    // Strong patterns → we can be more selective
    if (avgPatternStrength > 0.7) {
      promotionThreshold = Math.min(promotionThreshold + 5, 80);
    } else if (avgPatternStrength < 0.3) {
      // Weak patterns → relax standards to get more data
      promotionThreshold = Math.max(promotionThreshold - 5, 50);
    }

    // ─── Clamp ───
    promotionThreshold = Math.max(50, Math.min(80, promotionThreshold));
    eliminationThreshold = Math.max(15, Math.min(40, eliminationThreshold));
    signalMultiplier = Math.max(0.5, Math.min(1.5, signalMultiplier));

    return { promotionThreshold, eliminationThreshold, signalMultiplier };
  }

  /**
   * Get current market regime
   */
  public getRegime(): RegimeAnalysis {
    return this.lastRegime || this.emptyRegime();
  }

  /**
   * True if OmegaEngine has performed at least one regime analysis from live data.
   * Used by simulator.logBattle to mark whether regime in market_context is real
   * vs fallback (emptyRegime returns 'RANGE'/0.3 defaults, indistinguishable otherwise).
   * FIX 2026-04-18 (FAZA B.1) — bug #3: regime was always NULL in gladiator_battles.
   */
  public hasLiveRegime(): boolean {
    return this.lastRegime !== null;
  }

  /**
   * Get synthesized DNA patterns
   */
  public getSynthesizedPatterns(): DNAPattern[] {
    return this.synthesizedPatterns;
  }

  /**
   * Strategy Selection: Weight gladiators by regime fit
   * Returns scoring adjustments for each gladiator based on current regime
   */
  public selectStrategies(regime: RegimeAnalysis): Map<string, number> {
    const scores = new Map<string, number>();
    const gladiators = gladiatorStore.getGladiators().filter(g => !g.isOmega);

    for (const glad of gladiators) {
      let score = glad.stats.winRate;

      // ─── Regime Alignment ───
      // Note: longWinRate/shortWinRate tracked separately when per-direction stats are available
      if (regime.regime === 'BULL') {
        score *= 1.1; // Boost all in bull
      } else if (regime.regime === 'BEAR') {
        score *= 1.0; // Neutral in bear
      } else if (regime.regime === 'RANGE') {
        // Range players: boost those with consistent small wins
        score *= (glad.stats.profitFactor > 1.2 ? 1.2 : 0.9);
      } else if (regime.regime === 'HIGH_VOL') {
        // Vol players: boost those with good Sharpe ratio
        score *= (glad.stats.sharpeRatio > 0.5 ? 1.15 : 0.85);
      }

      // ─── Recent Performance ───
      const minutesSinceUpdate = (Date.now() - glad.lastUpdated) / 60000;
      if (minutesSinceUpdate < 30) {
        score *= 1.1; // Recent activity bonus
      } else if (minutesSinceUpdate > 1440) {
        score *= 0.7; // Stale data penalty
      }

      scores.set(glad.id, Math.max(0, score));
    }

    return scores;
  }

  /**
   * Consensus Override: Veto or boost a signal based on regime + patterns
   */
  public shouldOverride(
    gladiatorId: string,
    decision: 'LONG' | 'SHORT',
    currentPrice: number,
    confidence: number
  ): OverrideDecision {
    const regime = this.lastRegime || this.emptyRegime();
    const patterns = this.synthesizedPatterns;

    let reason = '';
    let shouldOverride = false;
    let confidenceMultiplier = 1.0;
    let regimeAlignment = 0.5;

    // ─── Regime Veto ───
    if (regime.regime === 'TRANSITION' && regime.confidence < 0.4) {
      shouldOverride = true;
      reason = 'Market in transition, confidence too low';
      confidenceMultiplier = 0.3;
      regimeAlignment = 0;
    }

    // ─── Pattern Boost ───
    for (const pattern of patterns) {
      if (pattern.relevantGladiators.includes(gladiatorId)) {
        const isAligned = (regime.regime === 'BULL' && decision === 'LONG')
          || (regime.regime === 'BEAR' && decision === 'SHORT');

        if (isAligned && pattern.strength > 0.6) {
          confidenceMultiplier = 1.2;
          reason = `Pattern ${pattern.patternType} matches current regime`;
          regimeAlignment = pattern.strength;
          shouldOverride = false; // Boost, not veto
        } else if (!isAligned && pattern.strength > 0.7) {
          shouldOverride = true;
          confidenceMultiplier = 0.5;
          reason = `Signal opposes strong pattern ${pattern.patternType}`;
          regimeAlignment = 0.2;
        }
      }
    }

    // ─── Confidence Gate ───
    if (confidence < 0.3 && regime.confidence > 0.8) {
      // Low confidence signal in high-confidence regime = veto
      shouldOverride = true;
      confidenceMultiplier = 0.2;
      reason = 'Signal confidence too low for current regime certainty';
    }

    if (confidence > 0.8 && regime.confidence > 0.8) {
      // High confidence both ways = boost
      confidenceMultiplier = Math.min(1.5, 1.0 + (regime.confidence * 0.3));
      reason = 'High confidence alignment with regime';
      regimeAlignment = regime.confidence;
    }

    return {
      shouldOverride,
      reason,
      confidenceMultiplier: parseFloat(confidenceMultiplier.toFixed(2)),
      regimeAlignment: parseFloat(regimeAlignment.toFixed(2)),
    };
  }

  private emptyRegime(): RegimeAnalysis {
    return {
      regime: 'RANGE',
      confidence: 0.3,
      bullSignals: 0,
      bearSignals: 0,
      volatilityScore: 50,
      allGladiatorWinRate: 0.5,
      regimeShiftedAt: Date.now(),
    };
  }
}

export const omegaEngine = OmegaEngine.getInstance();
