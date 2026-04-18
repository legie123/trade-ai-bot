// ============================================================
// Adversarial Debate Engine — Step 2.1
//
// ADDITIVE. For each proposed trade, generates Bull and Bear
// arguments via LLM, scores them, and returns a verdict that
// either confirms, reduces confidence, or overrides to FLAT.
//
// Architecture:
//   SwarmOrchestrator → consensus → DebateEngine → enhanced_decision → execution
//
// Latency budget: 3s total (2 parallel LLM calls + scoring)
// Timeout behavior: auto-CONFIRM with modifier 1.0 (fail-open)
//
// Kill-switch: DISABLE_DEBATE_ENGINE=true
//
// ASSUMPTION: LLM debate quality is only as good as the context
// provided. If indicators are stale or regime is wrong, debate
// arguments will reflect that. Audit Trail (Step 1.1) tracks
// debate verdicts for later analysis of debate accuracy.
// ============================================================

import { createLogger } from '@/lib/core/logger';

const log = createLogger('DebateEngine');

// ─── Configuration ──────────────────────────────────────────

const DISABLED = process.env.DISABLE_DEBATE_ENGINE === 'true';
const DEBATE_TIMEOUT_MS = 3_000;
const LLM_TIMEOUT_MS = 2_500; // per individual LLM call (parallel → total ~2.5s)

// ─── Types ──────────────────────────────────────────────────

export interface DebateInput {
  symbol: string;
  proposedDirection: 'LONG' | 'SHORT';
  confidence: number;
  regime: string | null;
  indicators: {
    rsi?: number;
    vwapDeviation?: number;
    volumeZ?: number;
    fundingRate?: number;
    sentimentScore?: number;
    momentumScore?: number;
  };
  recentWinRate?: number;
  recentLossStreak?: number;
}

export interface DebateResult {
  verdict: 'CONFIRM' | 'OVERRIDE_FLAT' | 'REDUCE_CONFIDENCE';
  confidenceModifier: number;    // 0.5 - 1.2
  bullArgument: string;
  bearArgument: string;
  winnerSide: 'BULL' | 'BEAR';
  debateScore: number;           // -1 (strong bear) to +1 (strong bull)
  reasoning: string;
  latencyMs: number;
  method: 'LLM' | 'HEURISTIC' | 'TIMEOUT' | 'DISABLED';
}

// ─── LLM Call — shared helper (extracted 2026-04-19) ─────────────
// Was ~90-line inline duplicate of forge.ts. Now delegates to shared callLLM.
import { callLLM as sharedCallLLM } from '@/lib/v2/llm/callLLM';

async function callLLM(prompt: string, timeoutMs: number = LLM_TIMEOUT_MS): Promise<string | null> {
  return sharedCallLLM(prompt, {
    maxTokens: 300,
    temperature: 0.4,      // lower temp for analytical debate
    timeoutMs,
    minResponseLength: 10,
    openaiModel: 'gpt-4o-mini',
    geminiModel: 'gemini-2.0-flash',
    caller: 'DebateEngine',
  });
}

// ─── Prompt Construction ────────────────────────────────────

function buildBullPrompt(input: DebateInput): string {
  const ind = input.indicators;
  return `You are a BULL analyst for crypto trading. Construct the STRONGEST case FOR going ${input.proposedDirection} on ${input.symbol}.

Market context:
- Regime: ${input.regime || 'unknown'}
- RSI: ${ind.rsi ?? 'N/A'}
- VWAP deviation: ${ind.vwapDeviation ?? 'N/A'}
- Volume Z-score: ${ind.volumeZ ?? 'N/A'}
- Funding rate: ${ind.fundingRate ?? 'N/A'}
- Sentiment: ${ind.sentimentScore ?? 'N/A'}
- Momentum: ${ind.momentumScore ?? 'N/A'}
- Current confidence: ${(input.confidence * 100).toFixed(0)}%
- Recent win rate: ${input.recentWinRate ?? 'N/A'}%

Instructions:
- Use SPECIFIC numbers from the data above
- Counter the most obvious bearish arguments
- Be concise but factual

Respond in JSON: {"strength": 0-100, "keyPoints": ["point1", "point2", "point3"], "counterToBear": "one sentence"}`;
}

function buildBearPrompt(input: DebateInput): string {
  const ind = input.indicators;
  return `You are a BEAR analyst for crypto trading. Construct the STRONGEST case AGAINST going ${input.proposedDirection} on ${input.symbol}.

Market context:
- Regime: ${input.regime || 'unknown'}
- RSI: ${ind.rsi ?? 'N/A'}
- VWAP deviation: ${ind.vwapDeviation ?? 'N/A'}
- Volume Z-score: ${ind.volumeZ ?? 'N/A'}
- Funding rate: ${ind.fundingRate ?? 'N/A'}
- Sentiment: ${ind.sentimentScore ?? 'N/A'}
- Momentum: ${ind.momentumScore ?? 'N/A'}
- Current confidence: ${(input.confidence * 100).toFixed(0)}%
- Recent win rate: ${input.recentWinRate ?? 'N/A'}%

Instructions:
- Use SPECIFIC numbers from the data above
- Identify the biggest risks and why this trade could fail
- Counter the most obvious bullish arguments
- Be concise but factual

Respond in JSON: {"strength": 0-100, "keyPoints": ["point1", "point2", "point3"], "counterToBull": "one sentence"}`;
}

// ─── Scoring ────────────────────────────────────────────────

interface ParsedArgument {
  strength: number;
  keyPoints: string[];
  counter: string;
}

function parseArgument(raw: string | null): ParsedArgument | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      strength: Math.min(100, Math.max(0, parsed.strength ?? 50)),
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0, 5) : [],
      counter: parsed.counterToBear || parsed.counterToBull || '',
    };
  } catch {
    // Try to extract strength from malformed JSON
    const match = raw.match(/"strength"\s*:\s*(\d+)/);
    return {
      strength: match ? parseInt(match[1], 10) : 50,
      keyPoints: [],
      counter: '',
    };
  }
}

function scoreDebate(
  bull: ParsedArgument | null,
  bear: ParsedArgument | null,
  input: DebateInput
): number {
  const bullStr = bull?.strength ?? 50;
  const bearStr = bear?.strength ?? 50;

  // Raw difference: positive = bull wins, negative = bear wins
  let rawScore = (bullStr - bearStr) / 100; // -1 to +1

  // Regime alignment bonus/penalty
  if (input.regime) {
    const bullishRegimes = ['BULL', 'trend_up'];
    const bearishRegimes = ['BEAR', 'trend_down', 'HIGH_VOL', 'volatile'];

    if (input.proposedDirection === 'LONG' && bearishRegimes.includes(input.regime)) {
      rawScore -= 0.15; // penalty: going long in bearish regime
    }
    if (input.proposedDirection === 'SHORT' && bullishRegimes.includes(input.regime)) {
      rawScore -= 0.15; // penalty: going short in bullish regime
    }
    if (input.proposedDirection === 'LONG' && bullishRegimes.includes(input.regime)) {
      rawScore += 0.1; // bonus: aligned with regime
    }
  }

  // Loss streak penalty — if on a losing streak, bear arguments get weight bonus
  if (input.recentLossStreak && input.recentLossStreak >= 2) {
    rawScore -= 0.05 * Math.min(input.recentLossStreak, 4);
  }

  return Math.max(-1, Math.min(1, rawScore));
}

// ─── Heuristic Fallback (no LLM needed) ────────────────────

function heuristicDebate(input: DebateInput): DebateResult {
  const start = Date.now();
  const ind = input.indicators;
  let score = 0;

  // RSI extremes
  if (ind.rsi !== undefined) {
    if (input.proposedDirection === 'LONG' && ind.rsi > 70) score -= 0.3;
    if (input.proposedDirection === 'SHORT' && ind.rsi < 30) score -= 0.3;
    if (input.proposedDirection === 'LONG' && ind.rsi < 35) score += 0.2;
    if (input.proposedDirection === 'SHORT' && ind.rsi > 65) score += 0.2;
  }

  // Regime alignment
  if (input.regime) {
    const bearish = ['BEAR', 'trend_down', 'HIGH_VOL', 'volatile'];
    if (input.proposedDirection === 'LONG' && bearish.includes(input.regime)) score -= 0.25;
    if (input.proposedDirection === 'SHORT' && bearish.includes(input.regime)) score += 0.15;
  }

  // Loss streak
  if (input.recentLossStreak && input.recentLossStreak >= 3) score -= 0.2;

  // Sentiment vs direction mismatch
  if (ind.sentimentScore !== undefined) {
    if (input.proposedDirection === 'LONG' && ind.sentimentScore < -0.3) score -= 0.15;
    if (input.proposedDirection === 'SHORT' && ind.sentimentScore > 0.3) score -= 0.15;
  }

  score = Math.max(-1, Math.min(1, score));

  const verdict = score < -0.3 ? 'OVERRIDE_FLAT'
    : score < -0.1 ? 'REDUCE_CONFIDENCE'
    : 'CONFIRM';

  const modifier = verdict === 'OVERRIDE_FLAT' ? 0.5
    : verdict === 'REDUCE_CONFIDENCE' ? 0.75
    : Math.min(1.15, 1.0 + score * 0.15);

  return {
    verdict,
    confidenceModifier: modifier,
    bullArgument: 'heuristic: indicators assessed',
    bearArgument: 'heuristic: risk factors assessed',
    winnerSide: score >= 0 ? 'BULL' : 'BEAR',
    debateScore: score,
    reasoning: `Heuristic debate: score=${score.toFixed(2)} → ${verdict}`,
    latencyMs: Date.now() - start,
    method: 'HEURISTIC',
  };
}

// ─── Main Public API ────────────────────────────────────────

export class DebateEngine {
  private static instance: DebateEngine;

  public static getInstance(): DebateEngine {
    if (!DebateEngine.instance) {
      DebateEngine.instance = new DebateEngine();
    }
    return DebateEngine.instance;
  }

  /**
   * Run adversarial debate on a proposed trade.
   * Returns verdict with confidence modifier.
   *
   * Timeout behavior: if LLM calls exceed DEBATE_TIMEOUT_MS,
   * falls back to heuristic debate (fast, no LLM needed).
   */
  async debate(input: DebateInput): Promise<DebateResult> {
    const start = Date.now();

    // Kill-switch
    if (DISABLED) {
      return {
        verdict: 'CONFIRM',
        confidenceModifier: 1.0,
        bullArgument: '',
        bearArgument: '',
        winnerSide: 'BULL',
        debateScore: 0,
        reasoning: 'DISABLED',
        latencyMs: 0,
        method: 'DISABLED',
      };
    }

    // FLAT directions don't need debate
    if (input.proposedDirection !== 'LONG' && input.proposedDirection !== 'SHORT') {
      return {
        verdict: 'CONFIRM',
        confidenceModifier: 1.0,
        bullArgument: '',
        bearArgument: '',
        winnerSide: 'BULL',
        debateScore: 0,
        reasoning: 'No debate needed for non-directional signal',
        latencyMs: Date.now() - start,
        method: 'DISABLED',
      };
    }

    // Try LLM debate with timeout
    try {
      const result = await Promise.race([
        this.runLLMDebate(input, start),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), DEBATE_TIMEOUT_MS)),
      ]);

      if (result) {
        log.info(`[Debate] ${input.symbol} ${input.proposedDirection}: ${result.verdict} (score=${result.debateScore.toFixed(2)}, ${result.latencyMs}ms, ${result.method})`);
        return result;
      }

      // Timeout — fallback to heuristic
      log.warn(`[Debate] LLM timeout (${DEBATE_TIMEOUT_MS}ms) for ${input.symbol} — using heuristic`);
      const heuristic = heuristicDebate(input);
      heuristic.method = 'TIMEOUT';
      return heuristic;

    } catch (err) {
      log.error(`[Debate] Error: ${err} — using heuristic fallback`);
      return heuristicDebate(input);
    }
  }

  private async runLLMDebate(input: DebateInput, startTime: number): Promise<DebateResult> {
    // Parallel LLM calls
    const [bullRaw, bearRaw] = await Promise.all([
      callLLM(buildBullPrompt(input)),
      callLLM(buildBearPrompt(input)),
    ]);

    const bull = parseArgument(bullRaw);
    const bear = parseArgument(bearRaw);

    // If both LLM calls failed, use heuristic
    if (!bull && !bear) {
      return heuristicDebate(input);
    }

    const debateScore = scoreDebate(bull, bear, input);

    // Determine verdict
    let verdict: DebateResult['verdict'];
    let modifier: number;

    if (input.proposedDirection === 'LONG' && debateScore < -0.3) {
      verdict = 'OVERRIDE_FLAT';
      modifier = 0.5;
    } else if (input.proposedDirection === 'SHORT' && debateScore > 0.3) {
      verdict = 'OVERRIDE_FLAT';
      modifier = 0.5;
    } else if (Math.abs(debateScore) < 0.1) {
      verdict = 'REDUCE_CONFIDENCE';
      modifier = 0.75;
    } else {
      verdict = 'CONFIRM';
      modifier = Math.min(1.2, 1.0 + Math.abs(debateScore) * 0.2);
    }

    return {
      verdict,
      confidenceModifier: modifier,
      bullArgument: bull ? bull.keyPoints.join('; ') : 'LLM failed',
      bearArgument: bear ? bear.keyPoints.join('; ') : 'LLM failed',
      winnerSide: debateScore >= 0 ? 'BULL' : 'BEAR',
      debateScore,
      reasoning: `LLM debate: bull=${bull?.strength ?? '?'} bear=${bear?.strength ?? '?'} score=${debateScore.toFixed(2)} → ${verdict}`,
      latencyMs: Date.now() - startTime,
      method: 'LLM',
    };
  }
}
