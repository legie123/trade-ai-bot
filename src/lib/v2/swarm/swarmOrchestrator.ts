/**
 * SwarmOrchestrator — Faza 8: Multi-Agent Coordination
 *
 * Fan-out to 4 specialized arenas in parallel. Aggregates consensus.
 * Applies Omega modifier to final confidence. Delegates execution if approved.
 *
 * Architecture:
 *   orchestrate(symbol) → Promise.allSettled([
 *     alphaQuant.analyze(symbol),
 *     sentiment.analyze(symbol),
 *     risk.evaluate(symbol),
 *   ]) → consensus → execution (if approved)
 */

import { createLogger } from '@/lib/core/logger';
import { omegaExtractor } from '@/lib/v2/superai/omegaExtractor';
import { omegaEngine } from '@/lib/v2/superai/omegaEngine';
import { logDecision } from '@/lib/v2/audit/decisionLog';
import { DebateEngine } from '@/lib/v2/debate/debateEngine';
import type { DebateVerdict } from '@/lib/v2/audit/decisionLog';
import { emitTradeExecuted } from '@/lib/v2/alerts/eventHub';
import { experienceMemory } from '@/lib/v2/memory/experienceMemory';
import { microML } from '@/lib/v2/ml/microML';

const log = createLogger('SwarmOrchestrator');

export interface SwarmResult {
  symbol: string;
  finalDecision: 'LONG' | 'SHORT' | 'FLAT';
  confidence: number;
  omegaModifier: number;
  arenaConsensus: {
    alphaQuant: ArenaVote | null;
    sentiment: ArenaVote | null;
    risk: RiskVote | null;
    execution: ExecutionVote | null;
  };
  consensusRatio: number;        // % of arenas that agreed
  executionTriggered: boolean;
  reasoning: string;
  timestamp: number;
}

interface ArenaVote {
  direction: 'LONG' | 'SHORT' | 'FLAT';
  confidence: number;
  reasoning?: string;
}

interface RiskVote {
  approved: boolean;
  positionSize: number;
  riskPercent: number;
  stopLossPercent: number;
  denialReasons: string[];
}

interface ExecutionVote {
  orderId: string;
  mode: 'LIVE' | 'PHANTOM';
  status: 'FILLED' | 'PENDING' | 'REJECTED';
}

export class SwarmOrchestrator {
  private static instance: SwarmOrchestrator;

  public static getInstance(): SwarmOrchestrator {
    if (!SwarmOrchestrator.instance) {
      SwarmOrchestrator.instance = new SwarmOrchestrator();
    }
    return SwarmOrchestrator.instance;
  }

  public async orchestrate(
    symbol: string,
    context: {
      indicators?: Record<string, unknown>;
      posts?: Array<{ content: string; timestamp: string; sentiment?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' }>;
      currentEquity?: number;
      openPositions?: number;
      dailyLossCount?: number;
      currentWinRate?: number;
      currentLossStreak?: number;
      executeLive?: boolean;
      gladiatorId?: string;
    },
    request: Request,
  ): Promise<SwarmResult> {
    const origin = this.getOrigin(request);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const token = process.env.SWARM_TOKEN;
    if (token) headers['x-swarm-token'] = token;

    // ── Phase 1: Fan-out to Alpha-Quant + Sentiment (parallel, non-blocking) ──
    const [aqResult, sentResult] = await Promise.allSettled([
      this.callArena<ArenaVote>(`${origin}/api/a2a/alpha-quant`, headers, {
        symbol,
        indicators: context.indicators,
      }),
      this.callArena<ArenaVote & { score: number; direction: string }>(`${origin}/api/a2a/sentiment`, headers, {
        symbol,
        posts: context.posts,
      }),
    ]);

    const alphaQuant: ArenaVote | null = aqResult.status === 'fulfilled' ? {
      direction: aqResult.value.direction,
      confidence: aqResult.value.confidence,
      reasoning: aqResult.value.reasoning,
    } : null;

    const sentimentArena: ArenaVote | null = sentResult.status === 'fulfilled' ? {
      direction: this.sentimentToDirection(sentResult.value.direction as string),
      confidence: (sentResult.value.score ?? 50) / 100,
    } : null;

    // ── Phase 2: Derive candidate direction from Alpha-Quant + Sentiment ──
    const candidateDirection = this.deriveConsensus([alphaQuant, sentimentArena]);
    const candidateConf = this.avgConfidence([alphaQuant, sentimentArena]);

    // ── Phase 3: Risk evaluation (must approve before execution) ──
    const riskResult = await Promise.allSettled([
      this.callArena<RiskVote>(`${origin}/api/a2a/risk`, headers, {
        symbol,
        proposedDirection: candidateDirection,
        confidence: candidateConf,
        currentEquity: context.currentEquity ?? 1000,
        openPositions: context.openPositions ?? 0,
        dailyLossCount: context.dailyLossCount ?? 0,
        currentWinRate: context.currentWinRate,
        currentLossStreak: context.currentLossStreak ?? 0,
      }),
    ]);

    const risk: RiskVote | null = riskResult[0].status === 'fulfilled' ? riskResult[0].value : null;

    const riskApproved = risk?.approved === true;

    // ── Phase 4: Apply Omega modifier ──
    const omegaMod = omegaExtractor.getModifierForSymbol(symbol);
    const finalConfidence = parseFloat(
      Math.min(0.95, candidateConf * omegaMod).toFixed(3)
    );

    // ── Phase 4.3: Experience Memory lookup (Step 3.2) ──
    let experienceInsight: string | null = null;
    try {
      if (candidateDirection !== 'FLAT') {
        const xpInsight = experienceMemory.getSymbolInsight(
          symbol,
          candidateDirection as 'LONG' | 'SHORT',
        );
        if (xpInsight.totalTrades > 0) {
          experienceInsight = xpInsight.summary;
          log.info(`[Swarm] XP Insight: ${xpInsight.summary}`);
        }
      }
    } catch (xpErr) {
      log.warn(`[Swarm] Experience Memory error (fail-open): ${xpErr}`);
    }

    // ── Phase 4.4: Micro-ML prediction (Step 4.1) ──
    let mlBlocked = false;
    try {
      if (riskApproved && candidateDirection !== 'FLAT' && context.gladiatorId) {
        const mlPred = await microML.predict(context.gladiatorId, {
          rsi: (context.indicators?.rsi as number) ?? undefined,
          vwapDeviation: (context.indicators?.vwapDeviation as number) ?? undefined,
          volumeZ: (context.indicators?.volumeZ as number) ?? undefined,
          fundingRate: (context.indicators?.fundingRate as number) ?? undefined,
          sentimentScore: (context.indicators?.sentimentScore as number) ?? undefined,
          momentumScore: (context.indicators?.momentumScore as number) ?? undefined,
          rollingWinRate: context.currentWinRate,
          currentLossStreak: context.currentLossStreak,
        });
        // ML acts as soft gate: if P(profit) < 0.35, block trade
        // Between 0.35-0.55: reduce confidence. Above 0.55: no change.
        if (mlPred.probability < 0.35 && mlPred.method !== 'DISABLED') {
          mlBlocked = true;
          log.warn(`[Swarm] ML VETO: ${symbol} P(profit)=${mlPred.probability} (${mlPred.method})`);
        }
      }
    } catch (mlErr) {
      log.warn(`[Swarm] Micro-ML error (fail-open): ${mlErr}`);
    }

    // ── Phase 4.5: Adversarial Debate (Step 2.1) ──
    let debateVerdict: DebateVerdict | null = null;
    let debateAdjustedConfidence = finalConfidence;

    if (riskApproved && candidateDirection !== 'FLAT') {
      try {
        const debateResult = await DebateEngine.getInstance().debate({
          symbol,
          proposedDirection: candidateDirection as 'LONG' | 'SHORT',
          confidence: finalConfidence,
          regime: omegaEngine.getRegime().regime || null,
          indicators: context.indicators as Record<string, number> || {},
          recentWinRate: context.currentWinRate,
          recentLossStreak: context.currentLossStreak,
        });

        debateVerdict = {
          verdict: debateResult.verdict,
          confidenceModifier: debateResult.confidenceModifier,
          bullScore: debateResult.debateScore > 0 ? Math.abs(debateResult.debateScore) * 100 : 0,
          bearScore: debateResult.debateScore < 0 ? Math.abs(debateResult.debateScore) * 100 : 0,
          winnerSide: debateResult.winnerSide,
        };

        // Apply debate verdict
        if (debateResult.verdict === 'OVERRIDE_FLAT') {
          log.warn(`[Swarm] Debate OVERRIDE: ${symbol} ${candidateDirection} → FLAT (score=${debateResult.debateScore.toFixed(2)})`);
          // Don't change candidateDirection (it's used in logs), but block execution below
        } else {
          debateAdjustedConfidence = parseFloat(
            Math.min(0.95, finalConfidence * debateResult.confidenceModifier).toFixed(3)
          );
        }
      } catch (debateErr) {
        log.warn(`[Swarm] Debate error (fail-open): ${debateErr}`);
      }
    }

    // ── Phase 5: Execute if approved (debate not overridden) ──
    const debateBlocked = debateVerdict?.verdict === 'OVERRIDE_FLAT';
    let execution: ExecutionVote | null = null;
    let executionTriggered = false;

    if (riskApproved && candidateDirection !== 'FLAT' && !debateBlocked && !mlBlocked) {
      const execResult = await Promise.allSettled([
        this.callArena<ExecutionVote>(`${origin}/api/a2a/execution`, headers, {
          symbol,
          direction: candidateDirection,
          positionSize: risk?.positionSize ?? 10,
          confidence: debateAdjustedConfidence,
          stopLoss: risk?.stopLossPercent,
          mode: context.executeLive ? 'LIVE' : 'PHANTOM',
          gladiatorId: context.gladiatorId ?? 'swarm-orchestrator',
        }),
      ]);

      if (execResult[0].status === 'fulfilled') {
        execution = execResult[0].value;
        executionTriggered = execution.status === 'FILLED';
      }
    }

    // ── Consensus metrics ──
    const votes = [alphaQuant, sentimentArena].filter(Boolean);
    const agreeing = votes.filter(v => v!.direction === candidateDirection).length;
    const consensusRatio = votes.length > 0 ? agreeing / votes.length : 0;

    // ── Reasoning ──
    const reasons: string[] = [];
    if (alphaQuant) reasons.push(`AlphaQuant: ${alphaQuant.direction} (${(alphaQuant.confidence * 100).toFixed(0)}%)`);
    if (sentimentArena) reasons.push(`Sentiment: ${sentimentArena.direction} (${(sentimentArena.confidence * 100).toFixed(0)}%)`);
    if (risk && !risk.approved) reasons.push(`Risk DENIED: ${risk.denialReasons.join(', ')}`);
    reasons.push(`Omega modifier: ${omegaMod}x`);
    if (debateVerdict) reasons.push(`Debate: ${debateVerdict.verdict} (${debateVerdict.winnerSide})`);
    if (mlBlocked) reasons.push('ML VETO: P(profit) < 0.35');
    if (experienceInsight) reasons.push(`XP: ${experienceInsight}`);

    const result: SwarmResult = {
      symbol,
      finalDecision: (riskApproved && !debateBlocked && !mlBlocked) ? candidateDirection : 'FLAT',
      confidence: debateAdjustedConfidence,
      omegaModifier: omegaMod,
      arenaConsensus: {
        alphaQuant,
        sentiment: sentimentArena,
        risk,
        execution,
      },
      consensusRatio,
      executionTriggered,
      reasoning: reasons.join(' | '),
      timestamp: Date.now(),
    };

    log.info(
      `[Swarm] ${symbol}: ${result.finalDecision} conf=${result.confidence} ` +
      `omega=${omegaMod}x consensus=${(consensusRatio * 100).toFixed(0)}% ` +
      `exec=${executionTriggered}`
    );

    // ── Decision Audit Trail (Step 1.1) ──
    const action = executionTriggered
      ? (candidateDirection === 'LONG' ? 'EXECUTE_LONG' : 'EXECUTE_SHORT')
      : 'SKIP';

    logDecision({
      timestamp: Date.now(),
      symbol,
      gladiatorId: context.gladiatorId ?? null,
      mode: context.executeLive ? 'LIVE' : 'PAPER',
      alphaQuantVote: alphaQuant,
      sentimentVote: sentimentArena,
      riskVote: risk ? {
        approved: risk.approved,
        positionSize: risk.positionSize,
        riskPercent: risk.riskPercent,
        stopLossPercent: risk.stopLossPercent,
        denialReasons: risk.denialReasons,
      } : null,
      regime: null,              // will be enriched when regime agent is wired
      omegaModifier: omegaMod,
      consensusRatio,
      debateVerdict,
      sentinelSafe: riskApproved,
      sentinelReason: (risk && !risk.approved) ? risk.denialReasons.join(', ') : null,
      action: action as 'EXECUTE_LONG' | 'EXECUTE_SHORT' | 'SKIP',
      skipReason: !executionTriggered
        ? (mlBlocked ? 'ML VETO: P(profit) < 0.35'
          : debateBlocked ? 'Debate OVERRIDE_FLAT'
          : risk && !risk.approved ? risk.denialReasons.join(', ')
          : 'No execution triggered')
        : null,
      slippage: null,
      fillPrice: null,
      latencyMs: null,
      experienceInsight: experienceInsight ? { summary: experienceInsight } as Record<string, unknown> : null,
    });

    // EventHub emit (fire-and-forget)
    if (executionTriggered) {
      emitTradeExecuted(
        symbol,
        candidateDirection || 'UNKNOWN',
        context.executeLive ? 'LIVE' : 'PAPER',
        { consensusRatio, omegaMod, gladiatorId: context.gladiatorId ?? 'unknown' },
      ).catch(() => {/* non-blocking */});
    }

    return result;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async callArena<T>(url: string, headers: Record<string, string>, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Arena ${url} failed: ${txt}`);
    }
    return res.json() as Promise<T>;
  }

  private deriveConsensus(votes: (ArenaVote | null)[]): 'LONG' | 'SHORT' | 'FLAT' {
    const valid = votes.filter(Boolean) as ArenaVote[];
    if (valid.length === 0) return 'FLAT';

    const longVotes = valid.filter(v => v.direction === 'LONG').length;
    const shortVotes = valid.filter(v => v.direction === 'SHORT').length;

    if (longVotes > shortVotes) return 'LONG';
    if (shortVotes > longVotes) return 'SHORT';
    return 'FLAT'; // Tie → stay flat
  }

  private avgConfidence(votes: (ArenaVote | null)[]): number {
    const valid = votes.filter(Boolean) as ArenaVote[];
    if (valid.length === 0) return 0.5;
    return parseFloat(
      (valid.reduce((s, v) => s + v.confidence, 0) / valid.length).toFixed(3)
    );
  }

  private sentimentToDirection(dir: string): 'LONG' | 'SHORT' | 'FLAT' {
    if (dir === 'BULLISH') return 'LONG';
    if (dir === 'BEARISH') return 'SHORT';
    return 'FLAT';
  }

  private getOrigin(request: Request): string {
    if (process.env.SERVICE_URL) return process.env.SERVICE_URL;
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  }
}

export const swarmOrchestrator = SwarmOrchestrator.getInstance();
