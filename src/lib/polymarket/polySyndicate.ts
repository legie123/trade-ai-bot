// ============================================================
// Polymarket LLM Syndicate — Dual consensus on predictions
// Architect: Fundamentals & probability theory
// Oracle: Sentiment & crowd psychology
// ============================================================

import { PolyMarket, PolyDivision } from './polyTypes';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolySyndicate');

// API keys from environment
const DEEPSEEK_KEY = () => process.env.DEEPSEEK_API_KEY || '';
const OPENAI_KEY = () => process.env.OPENAI_API_KEY || '';
const GEMINI_KEY = () => process.env.GEMINI_API_KEY || '';

export interface MarketAnalysis {
  direction: 'YES' | 'NO' | 'SKIP';
  confidence: number; // 0-100
  reasoning: string;
  architectView: string;
  oracleView: string;
  consensusScore: number; // 0-100, agreement strength
}

export interface ArchitectOpinion {
  direction: 'YES' | 'NO' | 'SKIP';
  confidence: number;
  reasoning: string;
  baseRate?: number;
  historicalAnalogy?: string;
}

export interface OracleOpinion {
  direction: 'YES' | 'NO' | 'SKIP';
  confidence: number;
  reasoning: string;
  sentimentSignals: string[];
  momentumIndicator: string;
}

// ─── Analyze single market ────────────────────────────
export async function analyzeMarket(
  market: PolyMarket,
  division: PolyDivision,
): Promise<MarketAnalysis> {
  if (!market.active) {
    return {
      direction: 'SKIP',
      confidence: 0,
      reasoning: 'Market inactive',
      architectView: 'N/A',
      oracleView: 'N/A',
      consensusScore: 0,
    };
  }

  // Run both LLMs in parallel
  const [architectOpinion, oracleOpinion] = await Promise.all([
    getArchitectView(market, division),
    getOracleView(market, division),
  ]);

  // Compute consensus
  const consensusDirection = aggregateDirection(
    architectOpinion.direction,
    oracleOpinion.direction,
  );
  const consensusConfidence = Math.round(
    (architectOpinion.confidence * 0.6 + oracleOpinion.confidence * 0.4) / 100,
  );
  const agreementScore = computeAgreement(
    architectOpinion.confidence,
    oracleOpinion.confidence,
    architectOpinion.direction === oracleOpinion.direction ? 100 : 0,
  );

  return {
    direction: consensusDirection,
    confidence: Math.round(consensusConfidence * 100),
    reasoning: `Architect (${architectOpinion.confidence}%) + Oracle (${oracleOpinion.confidence}%) consensus`,
    architectView: architectOpinion.reasoning,
    oracleView: oracleOpinion.reasoning,
    consensusScore: agreementScore,
  };
}

// ─── Batch analyze multiple markets ────────────────────
export async function batchAnalyze(
  markets: PolyMarket[],
  division: PolyDivision,
): Promise<MarketAnalysis[]> {
  const results = await Promise.allSettled(
    markets.map(m => analyzeMarket(m, division)),
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    log.warn('Market analysis failed', {
      market: markets[i]?.id,
      error: r.reason,
    });
    return {
      direction: 'SKIP',
      confidence: 0,
      reasoning: 'Analysis error',
      architectView: '',
      oracleView: '',
      consensusScore: 0,
    };
  });
}

// ─── Get consensus for division ────────────────────────
export async function getConsensusForDivision(
  markets: PolyMarket[],
  division: PolyDivision,
  topN = 5,
): Promise<MarketAnalysis[]> {
  const analyses = await batchAnalyze(markets, division);

  // Rank by confidence and consensus
  const ranked = analyses
    .filter(a => a.direction !== 'SKIP')
    .sort((a, b) => {
      const scoreA = a.confidence * 0.7 + a.consensusScore * 0.3;
      const scoreB = b.confidence * 0.7 + b.consensusScore * 0.3;
      return scoreB - scoreA;
    });

  return ranked.slice(0, topN);
}

// ─── Architect LLM: Fundamental analysis ──────────────
async function getArchitectView(
  market: PolyMarket,
  division: PolyDivision,
): Promise<ArchitectOpinion> {
  const prompt = buildArchitectPrompt(market, division);

  const response = await callLLM(prompt, 'architect');
  if (!response) {
    return fallbackArchitectOpinion(market);
  }

  try {
    const parsed = JSON.parse(response);
    return {
      direction: validateDirection(parsed.direction),
      confidence: Math.max(0, Math.min(100, parsed.confidence || 50)),
      reasoning: parsed.reasoning || 'Fundamental analysis',
      baseRate: parsed.baseRate,
      historicalAnalogy: parsed.historicalAnalogy,
    };
  } catch {
    log.warn('Failed to parse architect response', { response });
    return fallbackArchitectOpinion(market);
  }
}

// ─── Oracle LLM: Sentiment & momentum ──────────────────
async function getOracleView(
  market: PolyMarket,
  division: PolyDivision,
): Promise<OracleOpinion> {
  const prompt = buildOraclePrompt(market, division);

  const response = await callLLM(prompt, 'oracle');
  if (!response) {
    return fallbackOracleOpinion(market);
  }

  try {
    const parsed = JSON.parse(response);
    return {
      direction: validateDirection(parsed.direction),
      confidence: Math.max(0, Math.min(100, parsed.confidence || 50)),
      reasoning: parsed.reasoning || 'Sentiment analysis',
      sentimentSignals: parsed.sentimentSignals || [],
      momentumIndicator: parsed.momentumIndicator || 'neutral',
    };
  } catch {
    log.warn('Failed to parse oracle response', { response });
    return fallbackOracleOpinion(market);
  }
}

// ─── Build architect prompt ────────────────────────────
function buildArchitectPrompt(market: PolyMarket, division: PolyDivision): string {
  const outcomes = market.outcomes?.map(o => `${o.name}: $${o.price.toFixed(3)}`).join(', ') || 'N/A';
  const timeToExpiry = Math.round(
    (new Date(market.endDate).getTime() - Date.now()) / (1000 * 60 * 60),
  );

  return `
You are a prediction market fundamental analyst.

Market: ${market.title}
Category: ${division}
Outcomes: ${outcomes}
Volume 24h: $${market.volume24h || 0}
Liquidity: $${market.liquidityUSD || 0}
Time to expiry: ${timeToExpiry}h

Analyze probability using:
1. Base rates from similar historical events
2. Fundamental factors (economic, political, technical)
3. Time decay effects
4. Market structure (liquidity, volume patterns)

Respond with valid JSON:
{
  "direction": "YES" | "NO" | "SKIP",
  "confidence": 0-100,
  "reasoning": "probability assessment",
  "baseRate": estimated base rate %,
  "historicalAnalogy": "similar past event if applicable"
}`;
}

// ─── Build oracle prompt ───────────────────────────────
function buildOraclePrompt(market: PolyMarket, division: PolyDivision): string {
  const outcomes = market.outcomes?.map(o => o.name).join(', ') || 'N/A';

  return `
You are a prediction market sentiment and momentum analyst.

Market: ${market.title}
Category: ${division}
Outcomes: ${outcomes}
Recent volume: ${market.volume24h ? 'Strong' : 'Weak'}

Analyze crowd psychology:
1. Sentiment signals (media buzz, social mood, whale activity)
2. Momentum indicators (price velocity, volume spikes)
3. Risk appetite (market-wide risk on/off)
4. Recency bias and herding behavior

Respond with valid JSON:
{
  "direction": "YES" | "NO" | "SKIP",
  "confidence": 0-100,
  "reasoning": "sentiment & momentum assessment",
  "sentimentSignals": ["signal1", "signal2"],
  "momentumIndicator": "bullish" | "bearish" | "neutral"
}`;
}

// ─── Call LLM with fallback cascade ───────────────────
async function callLLM(prompt: string, role: string): Promise<string | null> {
  // Try DeepSeek first
  if (DEEPSEEK_KEY()) {
    const res = await callDeepSeek(prompt, role);
    if (res) return res;
  }

  // Fall back to OpenAI
  if (OPENAI_KEY()) {
    const res = await callOpenAI(prompt, role);
    if (res) return res;
  }

  // Last resort: Gemini (if configured)
  if (GEMINI_KEY()) {
    const res = await callGemini(prompt, role);
    if (res) return res;
  }

  log.warn('No LLM available, using fallback', { role });
  return null;
}

// ─── DeepSeek API call ────────────────────────────────
async function callDeepSeek(prompt: string, role: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_KEY()}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `You are a ${role === 'architect' ? 'fundamental analyst' : 'sentiment analyst'} for prediction markets. Respond with ONLY valid JSON.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      log.warn('DeepSeek API error', { status: res.status });
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    log.debug('DeepSeek call failed', { error: String(err) });
    return null;
  }
}

// ─── OpenAI API call ──────────────────────────────────
async function callOpenAI(prompt: string, role: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY()}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a ${role === 'architect' ? 'fundamental analyst' : 'sentiment analyst'} for prediction markets. Respond with ONLY valid JSON.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      log.warn('OpenAI API error', { status: res.status });
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    log.debug('OpenAI call failed', { error: String(err) });
    return null;
  }
}

// ─── Gemini API call ──────────────────────────────────
async function callGemini(prompt: string, role: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `${role === 'architect' ? 'Fundamental analyst' : 'Sentiment analyst'} for prediction markets.\n${prompt}\nRespond with ONLY valid JSON.`,
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(8000),
      },
    );

    if (!res.ok) {
      log.warn('Gemini API error', { status: res.status });
      return null;
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    log.debug('Gemini call failed', { error: String(err) });
    return null;
  }
}

// ─── Fallback opinions (no LLM) ────────────────────────
function fallbackArchitectOpinion(market: PolyMarket): ArchitectOpinion {
  const outcomes = market.outcomes || [];
  const yesPrice = outcomes[0]?.price || 0.5;

  // Simple heuristic: if YES is <0.4, buy YES; if >0.6, buy NO
  const direction = yesPrice < 0.4 ? 'YES' : yesPrice > 0.6 ? 'NO' : 'SKIP';

  return {
    direction,
    confidence: 35,
    reasoning: 'Fallback: Simple price heuristic. LLM unavailable.',
    baseRate: 50,
  };
}

function fallbackOracleOpinion(market: PolyMarket): OracleOpinion {
  const hasVolume = (market.volume24h || 0) > 500;
  const hasLiquidity = (market.liquidityUSD || 0) > 1000;

  return {
    direction: hasVolume && hasLiquidity ? 'YES' : 'SKIP',
    confidence: 25,
    reasoning: 'Fallback: Liquidity check only. LLM unavailable.',
    sentimentSignals: [],
    momentumIndicator: 'neutral',
  };
}

// ─── Validate direction ────────────────────────────────
function validateDirection(value: unknown): 'YES' | 'NO' | 'SKIP' {
  if (typeof value === 'string') {
    const upper = value.toUpperCase();
    if (upper === 'YES' || upper === 'NO' || upper === 'SKIP') return upper as any;
  }
  return 'SKIP';
}

// ─── Aggregate direction from both LLMs ────────────────
function aggregateDirection(
  architectDir: 'YES' | 'NO' | 'SKIP',
  oracleDir: 'YES' | 'NO' | 'SKIP',
): 'YES' | 'NO' | 'SKIP' {
  // Both agree: strong signal
  if (architectDir === oracleDir) return architectDir;

  // One says SKIP: defer to other
  if (architectDir === 'SKIP') return oracleDir;
  if (oracleDir === 'SKIP') return architectDir;

  // Disagreement (YES vs NO): default to SKIP
  return 'SKIP';
}

// ─── Compute consensus strength ────────────────────────
function computeAgreement(
  confA: number,
  confO: number,
  directionMatch: number,
): number {
  // High confidence from both + direction agreement = high consensus
  const avgConf = (confA + confO) / 2;
  return Math.round((avgConf * 0.7 + directionMatch * 0.3) / 100);
}
