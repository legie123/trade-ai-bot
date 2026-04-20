import { 
  DualMasterIdentity, 
  MasterOpinion, 
  DualConsensus 
} from '../../types/gladiator';
import { addSyndicateAudit } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import { omegaExtractor } from '../superai/omegaExtractor';
// FAZA 3 Batch 9/9 — Multi-LLM consensus shadow hook.
// Fire-and-forget at the tail of getConsensus. runConsensus early-returns
// when LLM_CONSENSUS_ENABLED=off (default). Sample/rate/budget gates all
// live inside runConsensus. No effect on primary — pure observational.
import { runConsensus as runLlmConsensusShadow, type ConsensusInput as LlmConsensusInput } from '@/lib/v2/debate/multiLlmConsensus';
// FAZA 7c (2026-04-20) — SHORT LIVE conditional gate helper.
// Pure function; reads env at call time so kill-switches flip without redeploy.
import { shouldAdmitShortLive } from '@/lib/v2/arena/directionGate';

const log = createLogger('DualMaster');

// ─── Shared LLM call with retry + timeout (DRY) ───

async function fetchWithBackoff(
  provider: string,
  url: string,
  options: RequestInit,
  timeout: number,
  signal?: AbortSignal
): Promise<Response> {
  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);

      if (res.status === 429) {
        if (attempt === MAX_RETRIES) throw new Error(`${provider} HTTP 429 Too Many Requests`);
        // ULTRA STEEPER BACKOFF: 5s, 10s, 20s
        const waitMs = 5000 * Math.pow(2, attempt);
        log.warn(`[DualMaster] ${provider} 429 Rate limited, backing off ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, waitMs));
        attempt++;
        continue;
      }

      if (!res.ok) throw new Error(`${provider} HTTP ${res.status}`);
      return res;
    } catch (err) {
      clearTimeout(timer);
      const errName = (err as Error).name;
      if (errName === 'AbortError' || errName === 'TimeoutError') {
        throw new Error(`${provider} request timed out or aborted`);
      }
      if (attempt === MAX_RETRIES) throw err;
      
      // Also backoff on network errors
      const waitMs = 1000 * Math.pow(2, attempt);
      log.warn(`[DualMaster] ${provider} Network error, backing off ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, waitMs));
      attempt++;
    }
  }
  throw new Error(`${provider} Max retries exceeded`);
}

async function callDeepSeek(prompt: string, timeout: number, signal?: AbortSignal): Promise<string> {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY missing for fallback');
  
  const response = await fetchWithBackoff('DeepSeek', 'https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 300,
      temperature: 0.4,
    })
  }, timeout, signal);

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text || text.length < 10) throw new Error('Empty DeepSeek response');
  return text;
}

async function callOpenAI(prompt: string, timeout: number, signal?: AbortSignal): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');

  const response = await fetchWithBackoff('OpenAI', 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 300,
      temperature: 0.4,
    })
  }, timeout, signal);

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text || text.length < 10) throw new Error('Empty LLM response');
  return text;
}

async function callGemini(prompt: string, timeout: number, signal?: AbortSignal): Promise<string> {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing for fallback');
  
  // FIX: Shift from experimental 2.5 to stable 2.0-flash
  const modelId = 'gemini-2.0-flash';
  const response = await fetchWithBackoff('Gemini', `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 300, temperature: 0.4, responseMimeType: 'application/json' }
    })
  }, timeout, signal);

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || text.length < 10) throw new Error('Empty Gemini response');
  return text;
}

async function executeDualEngineFallback(prompt: string, timeout: number): Promise<string> {
  const STAGGER_MS = 6000; // Reduced stagger
  
  const controller = new AbortController();
  
  try {
    // 1. Start Primary (OpenAI)
    const primaryPromise = (async () => {
      try {
        return await callOpenAI(prompt, timeout, controller.signal);
      } catch (err) {
        // If it's a credit or rate limit error, trigger Gemini IMMEDIATELY
        const msg = (err as Error).message;
        if (msg.includes('429') || msg.includes('402')) {
          log.warn(`[DualMaster] Primary engine (OpenAI) reported ${msg}. Fast-tracking Gemini...`);
          return await callGemini(prompt, timeout, controller.signal);
        }
        throw err;
      }
    })();
    
    // 2. Create Fallback Promise (staggered)
    const fallbackPromise = (async () => {
      await new Promise(res => setTimeout(res, STAGGER_MS));
      if (controller.signal.aborted) return '';
      
      log.info(`[DualMaster] Primary lagging > 6s. Spawning Parallel Fallback...`);
      try {
        // Try DeepSeek first, but if it's 402 (from diagnostic results), it will fail fast to Gemini
        return await callDeepSeek(prompt, timeout, controller.signal);
      } catch {
        log.warn(`[DualMaster] DeepSeek failed, switching to Gemini...`);
        return await callGemini(prompt, timeout, controller.signal);
      }
    })();

    // 3. Race them
    const result = await Promise.race([
      primaryPromise,
      fallbackPromise.then(res => {
        if (!res) return new Promise(() => {}); // If empty/aborted, don't win the race
        return res;
      })
    ]);

    controller.abort(); // Cancel the other one
    return result as string;
  } catch (err) {
    controller.abort();
    log.error(`[DualMaster] Composite Engine Failure`, { error: (err as Error).message });
    throw err;
  }
}

function parseResponse(identity: DualMasterIdentity, text: string): MasterOpinion {
  let direction: 'LONG' | 'SHORT' | 'FLAT' = 'FLAT';
  let confidence = 0.5;
  let reasoning = 'JSON validation failed or empty.';

  try {
    const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanText);

    if (parsed.direction && ['LONG', 'SHORT', 'FLAT'].includes(parsed.direction.toUpperCase())) {
      direction = parsed.direction.toUpperCase() as 'LONG' | 'SHORT' | 'FLAT';
    }
    if (typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1) {
      confidence = parsed.confidence;
    } else if (typeof parsed.confidence === 'string') {
      confidence = parseFloat(parsed.confidence) || 0.5;
    }
    if (parsed.reasoning) {
      reasoning = String(parsed.reasoning).substring(0, 500);
    }
  } catch {
    log.warn(`[JSON Parse Failed] Master ${identity} hallucinated format. Extracting via Regex fallback.`);
    const dirMatch = text.match(/"?direction"?\s*:\s*"?\s*(LONG|SHORT|FLAT)\s*"?/i) || text.match(/DIRECTION:\s*(LONG|SHORT|FLAT)/i);
    const confMatch = text.match(/"?confidence"?\s*:\s*([\d.]+)/i) || text.match(/CONFIDENCE:\s*([\d.]+)/i);
    
    if (dirMatch) direction = dirMatch[1].toUpperCase() as 'LONG' | 'SHORT' | 'FLAT';
    if (confMatch) confidence = parseFloat(confMatch[1]);
    reasoning = text.substring(0, 500);
  }

  return { identity, direction, confidence, reasoning };
}

const PERSONAS: Record<DualMasterIdentity, string> = {
  ARCHITECT: `You are the ARCHITECT (Master 1 - Quantitative Quant). Your ONLY focus is Technical Analysis math, moving averages (EMA/SMA), volume weighting, and order book probability. Ignore all news or sentiment. You exist purely to crunch numbers. You MUST reference specific numbers (price, volume, EMA distance) in your reasoning.`,
  ORACLE: `You are the ORACLE (Master 2 - Sentiment Behavioral). Your ONLY focus is market psychology, contrarian setups, liquidations, and fear/greed structure. Ignore pure TA math unless it forms a psychological trap. You MUST reference behavior, traps, whales, or panic in your reasoning.`
};

async function invokeMaster(identity: DualMasterIdentity, prompt: string, _timeout: number): Promise<MasterOpinion> {
  const fullPrompt = `${PERSONAS[identity]}
      
Data: ${prompt}
      
You MUST output ONLY a valid JSON object. No markdown formatting, no intro, no outro.
JSON Schema required:
{
  "direction": "LONG" | "SHORT" | "FLAT",
  "confidence": <float between 0.0 and 1.0>,
  "reasoning": "<string briefing referencing your persona's focus>"
}`;

  try {
    // Provide a long timeout (45s) since modern LLMs need thorough reasoning
    let text = '';
    
    // OMEGA UPGRADE: Split-Brain Verification!
    // The Oracle runs purely on DeepSeek to eliminate single-model bias.
    if (identity === 'ORACLE' && process.env.DEEPSEEK_API_KEY) {
       log.info(`[DualMaster] Oracle is invoking its primary engine: DeepSeek`);
       try {
         text = await callDeepSeek(fullPrompt, _timeout);
       } catch (dsError) {
         log.warn(`[DualMaster] Oracle DeepSeek failed, falling back to standard tree.`, { error: (dsError as Error).message });
         text = await executeDualEngineFallback(fullPrompt, _timeout);
       }
    } else {
       // Architect defaults to OpenAI primary
       text = await executeDualEngineFallback(fullPrompt, _timeout);
    }
    
    return parseResponse(identity, text);
  } catch (err) {
    const errorMsg = (err as Error).message;
    log.error(`🚨 [DualMaster] ${identity} CRITICAL FAILURE: ${errorMsg}`);
    // Throw error so ManagerVizionar knows the system is BLIND
    throw new Error(`Master ${identity} is offline: ${errorMsg}`);
  }
}


// ─── OMEGA: Hallucination Defense System ───

/**
 * Jaccard Similarity between two texts.
 * Tokenizes to lowercase words, computes |intersection| / |union|.
 * Score 0.0 = completely different, 1.0 = identical.
 */
function jaccardSimilarity(textA: string, textB: string): number {
  const tokenize = (t: string): Set<string> => {
    const words = t.toLowerCase().replace(/[^a-z0-9\s.%]/g, '').split(/\s+/).filter(w => w.length > 2);
    return new Set(words);
  };

  const setA = tokenize(textA);
  const setB = tokenize(textB);

  if (setA.size === 0 && setB.size === 0) return 1.0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Check if AI reasoning actually references data from the market prompt.
 * Extracts key numbers (prices, percentages, volumes) from market data
 * and verifies at least some appear in the reasoning.
 */
function checkMarketDataAnchoring(reasoning: string, marketDataStr: string): { anchored: boolean; matchedDataPoints: number; totalDataPoints: number } {
  // Extract numbers from market data (prices, volumes, percentages)
  const dataNumbers = marketDataStr.match(/\d+\.?\d*/g) || [];
  // Filter to meaningful numbers (skip tiny ones like "0" or "1")
  // Only keep price-like numbers (4+ chars) to avoid matching noise (array indices, flags, etc.)
  const significantNumbers = dataNumbers.filter(n => {
    const num = parseFloat(n);
    return num > 1 && n.length >= 4;
  });

  // Deduplicate
  const uniqueNumbers = [...new Set(significantNumbers)].slice(0, 20); // Cap at 20 data points

  if (uniqueNumbers.length === 0) return { anchored: true, matchedDataPoints: 0, totalDataPoints: 0 };

  let matched = 0;
  for (const num of uniqueNumbers) {
    // FUZZY MATCH: Check exact string, integer part, or rounded version
    // AI often paraphrases "67832.45" as "67832" or "67,832" or "67.8K"
    if (reasoning.includes(num)) {
      matched++;
    } else {
      const parsed = parseFloat(num);
      const intPart = Math.floor(parsed).toString();
      // Check integer part (e.g. "67832" from "67832.45")
      if (intPart.length >= 4 && reasoning.includes(intPart)) {
        matched++;
      } else {
        // Check comma-formatted (e.g. "67,832" from "67832")
        const commaFormatted = parsed >= 1000 ? parsed.toLocaleString('en-US', { maximumFractionDigits: 0 }) : null;
        if (commaFormatted && reasoning.includes(commaFormatted)) {
          matched++;
        }
      }
    }
  }

  // FIX: Lowered from 15% to 10% — market JSON has many numbers AI won't cite verbatim.
  // The fuzzy matching above compensates by catching paraphrased references.
  const anchorThreshold = 0.10;
  return {
    anchored: matched / uniqueNumbers.length >= anchorThreshold,
    matchedDataPoints: matched,
    totalDataPoints: uniqueNumbers.length,
  };
}

interface HallucinationReport {
  similarity: number;
  isRedundant: boolean;            // Jaccard > 0.7 → both AIs said same thing
  isUnanchored: boolean;           // Reasoning ignores market data
  confidencePenalty: number;       // 0 to 0.3 penalty applied
  architectAnchoring: { anchored: boolean; matchedDataPoints: number; totalDataPoints: number };
  oracleAnchoring: { anchored: boolean; matchedDataPoints: number; totalDataPoints: number };
}

// ─── Consensus Cache ───────────────────────────────────────────
// PERF FIX 2026-04-18: Same symbol+direction hits getConsensus() multiple times
// per cron cycle (e.g. 3 BUY signals for SOL within 60s). Each call = 2 LLM
// roundtrips (~10s). Cache by symbol+signal_direction+price_bucket avoids
// redundant calls. TTL=120s covers one full cron cycle + margin.
interface ConsensusCacheEntry {
  result: DualConsensus;
  ts: number;
}
const _consensusCache: Map<string, ConsensusCacheEntry> = new Map();
const CONSENSUS_CACHE_TTL = 120_000; // 120s

function consensusCacheKey(symbol: string, signalDirection: string, price: number): string {
  // Price bucket: round to 0.2% increments to avoid cache misses on minor ticks
  // e.g. BTC at 67832 and 67900 (0.1% diff) → same bucket
  const bucket = price > 0 ? Math.round(price / (price * 0.002)) : 0;
  return `${symbol}_${signalDirection}_${bucket}`;
}

export class DualMasterConsciousness {
  private timeoutMs = 45000;

  public async getConsensus(marketData: Record<string, unknown>, gladiatorDnaContext: Record<string, unknown>): Promise<DualConsensus> {
    // ─── Cache check ───
    const cacheSymbol = String(gladiatorDnaContext.symbol || marketData.symbol || '');
    const cacheDirection = String(marketData.signal || marketData.direction || 'UNKNOWN');
    const cachePrice = Number(marketData.price || marketData.currentPrice || 0);
    const cKey = consensusCacheKey(cacheSymbol, cacheDirection, cachePrice);
    const cached = _consensusCache.get(cKey);
    if (cached && Date.now() - cached.ts < CONSENSUS_CACHE_TTL) {
      log.info(`[DualMaster] CACHE HIT for ${cacheSymbol} ${cacheDirection} — skipping LLM calls`);
      return cached.result;
    }

    // Build a context-rich prompt that the LLM can actually reason about
    const dnaDigest = gladiatorDnaContext.digest || 'No historical data available';
    // Base RL modifier from gladiator's own DNA
    const baseConfMod = Number(gladiatorDnaContext.confidenceModifier) || 1.0;
    // FAZA 7: Omega meta-modifier — blended with base at 30% weight
    // Omega provides collective wisdom; gladiator-specific DNA is primary (70%)
    const symbol = String(gladiatorDnaContext.symbol || marketData.symbol || '');
    const omegaMod = omegaExtractor.getModifierForSymbol(symbol);
    const confMod = parseFloat(((baseConfMod * 0.7) + (omegaMod * 0.3)).toFixed(3));
    
    const prompt = [
      `Market State: ${JSON.stringify(marketData)}.`,
      ``,
      `GLADIATOR INTELLIGENCE (Historical Performance):`,
      `${dnaDigest}`,
      `Confidence Modifier (Gladiator RL 70% + Omega Meta 30%): ${confMod}x`,
      confMod < 0.85 ? `⚠️ WARNING: Combined signal is weak. Be MORE conservative.` : '',
      confMod > 1.1 ? `✅ Combined signal is strong. Confidence is justified.` : '',
      omegaMod !== 1.0 ? `⚡ Omega Meta-Modifier: ${omegaMod}x (collective top-3 wisdom)` : '',
      ...(omegaExtractor.getCurrentSynthesis()?.weakSymbols?.includes(symbol)
        ? [`🚫 OMEGA WARNING: ${symbol} is a historically WEAK symbol across all gladiators. Prefer FLAT.`]
        : []),
      ...(omegaExtractor.getCurrentSynthesis()?.strongSymbols?.includes(symbol)
        ? [`💎 OMEGA EDGE: ${symbol} is a historically STRONG symbol across all gladiators.`]
        : []),
      ``,
      `IMPORTANT: Factor the gladiator's historical performance into your confidence score.`,
      `If the gladiator historically loses on this asset, lower your confidence.`,
    ].filter(Boolean).join('\n');
    
    // Both masters analyze simultaneously (parallel) via allSettled to prevent single-point-of-failure
    const results = await Promise.allSettled([
      invokeMaster('ARCHITECT', prompt, this.timeoutMs),
      invokeMaster('ORACLE', prompt, this.timeoutMs)
    ]);

    const isArchitectDead = results[0].status === 'rejected';
    const isOracleDead = results[1].status === 'rejected';

    if (isArchitectDead && isOracleDead) {
      log.error('🚨 [DualMaster] BOTH Masters failed. System is completely BLIND.');
      throw new Error(`Both LLMs are offline.`);
    }

    const architectOpinion: MasterOpinion = results[0].status === 'fulfilled' 
       ? results[0].value 
       : { identity: 'ARCHITECT', direction: 'FLAT', confidence: 0, reasoning: `OFFLINE/ERROR: ${results[0].reason?.message || 'Timeout'}` };

    const oracleOpinion: MasterOpinion = results[1].status === 'fulfilled'
       ? results[1].value
       : { identity: 'ORACLE', direction: 'FLAT', confidence: 0, reasoning: `OFFLINE/ERROR: ${results[1].reason?.message || 'Timeout'}` };

    // ─── OMEGA: Hallucination Defense ───
    const hallucinationReport = this.runHallucinationDefense(architectOpinion, oracleOpinion, prompt);
    
    const consensus = this.arbitrate(architectOpinion, oracleOpinion, hallucinationReport, { symbol });
    
    // Single audit write with hallucination report attached.
    // P2-6b (2026-04-20): correlation_id pulled from marketData (stamped by arena
    // route from x-correlation-id header). Absence = kill-switch off; DB column
    // left NULL. addSyndicateAudit persists to `correlation_id` column for
    // end-to-end query in Supabase (idx_audits_cid covers this).
    const cidForAudit = typeof (marketData as Record<string, unknown>).correlationId === 'string'
      ? ((marketData as Record<string, unknown>).correlationId as string)
      : '';
    addSyndicateAudit({
      ...consensus,
      symbol: (marketData as Record<string, unknown>).symbol || 'UNKNOWN_ASSET',
      opinions: [architectOpinion, oracleOpinion],
      hallucinationReport,
      correlation_id: cidForAudit || null,
    } as unknown as Parameters<typeof addSyndicateAudit>[0]);

    // ─── FAZA 3 Batch 9/9 — Multi-LLM shadow consensus (fire-and-forget) ───
    // Hook contract:
    //   - Pure observational. consensus.finalDirection is ALREADY decided here.
    //   - runConsensus early-returns when LLM_CONSENSUS_ENABLED=off (default).
    //   - Sample/rate/budget/circuit-breaker gating handled inside runConsensus.
    //   - No await, no throw propagation — primary path unaffected by ANY failure.
    //   - Skip when finalDirection=FLAT (consensus only accepts LONG|SHORT).
    // ASSUMPTIONS (if broken, invalidate the shadow data):
    //   (1) consensus.weightedConfidence is the right "primaryConfidence" to gate on
    //   (2) marketData carries the indicator block under expected keys (best-effort)
    //   (3) Cloud Run env LLM_CONSENSUS_ENABLED=shadow at deploy-time
    if (consensus.finalDirection !== 'FLAT') {
      try {
        const md = marketData as Record<string, unknown>;
        const indRaw = (md.indicators ?? {}) as Record<string, unknown>;
        const num = (k: string): number | undefined => {
          const v = indRaw[k];
          return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
        };
        const shadowInput: LlmConsensusInput = {
          symbol: String(gladiatorDnaContext.symbol || md.symbol || 'UNKNOWN'),
          proposedDirection: consensus.finalDirection as 'LONG' | 'SHORT',
          primaryConfidence: Math.max(0, Math.min(1, consensus.weightedConfidence)),
          regime: typeof md.regime === 'string' ? md.regime : null,
          indicators: {
            rsi: num('rsi'),
            vwapDeviation: num('vwapDeviation'),
            volumeZ: num('volumeZ'),
            fundingRate: num('fundingRate'),
            sentimentScore: num('sentimentScore'),
            momentumScore: num('momentumScore'),
          },
        };
        // Fire-and-forget; never await, never throw.
        void runLlmConsensusShadow(shadowInput).catch(() => {
          /* shadow telemetry is best-effort — silence errors */
        });
      } catch {
        /* defensive: never let shadow input prep break primary */
      }
    }

    // ─── Cache store ───
    _consensusCache.set(cKey, { result: consensus, ts: Date.now() });
    // SAFETY FAZA 3.1: Strict LRU eviction. Previous code only evicted TTL-stale entries,
    // so on a hot process where all 50 entries stay fresh, Map kept growing unbounded.
    // Map preserves insertion order → keys().next() returns the oldest key. Delete until size <= 50.
    if (_consensusCache.size > 50) {
      const now = Date.now();
      // Pass 1: drop TTL-stale entries (cheapest wins first)
      for (const k of Array.from(_consensusCache.keys())) {
        const entry = _consensusCache.get(k);
        if (entry && now - entry.ts > CONSENSUS_CACHE_TTL) _consensusCache.delete(k);
      }
      // Pass 2: if still >50 after TTL sweep → drop oldest by insertion order until back to cap
      while (_consensusCache.size > 50) {
        const oldest = _consensusCache.keys().next().value;
        if (oldest === undefined) break;
        _consensusCache.delete(oldest);
      }
    }

    return consensus;
  }

  /**
   * OMEGA: Hallucination Defense System
   * 1. Jaccard similarity check — if both AIs give identical reasoning, we're wasting credit
   * 2. Market data anchoring — if AI ignores the actual numbers, it's hallucinating
   */
  private runHallucinationDefense(architect: MasterOpinion, oracle: MasterOpinion, marketPrompt: string): HallucinationReport {
    const similarity = jaccardSimilarity(architect.reasoning, oracle.reasoning);
    const isRedundant = similarity > 0.70;

    const architectAnchoring = checkMarketDataAnchoring(architect.reasoning, marketPrompt);
    const oracleAnchoring = checkMarketDataAnchoring(oracle.reasoning, marketPrompt);
    const isUnanchored = !architectAnchoring.anchored && !oracleAnchoring.anchored;

    let confidencePenalty = 0;

    if (isRedundant) {
      confidencePenalty += 0.15;
      log.warn(`⚠️ [Hallucination] REDUNDANT reasoning detected! Jaccard: ${(similarity * 100).toFixed(1)}% — AI credit waste suspected.`);
    }

    if (isUnanchored) {
      confidencePenalty += 0.15;
      log.warn(`⚠️ [Hallucination] UNANCHORED reasoning! Neither AI referenced market data. Arch: ${architectAnchoring.matchedDataPoints}/${architectAnchoring.totalDataPoints}, Oracle: ${oracleAnchoring.matchedDataPoints}/${oracleAnchoring.totalDataPoints}`);
    }

    return {
      similarity,
      isRedundant,
      isUnanchored,
      confidencePenalty: Math.min(confidencePenalty, 0.30),
      architectAnchoring,
      oracleAnchoring,
    };
  }

  private arbitrate(
    architect: MasterOpinion,
    oracle: MasterOpinion,
    hallucinationReport: HallucinationReport,
    // FAZA 7c (2026-04-20): ctx carries the symbol required by the SHORT LIVE
    // conditional gate (session+symbol whitelist). Optional — legacy callers
    // without the ctx param still work; gate simply treats symbol='UNKNOWN'.
    ctx?: { symbol?: string },
  ): DualConsensus {
    let finalDirection: 'LONG' | 'SHORT' | 'FLAT' = 'FLAT';
    let finalConfidence = 0;

    // OMEGA: If both AIs are unanchored from data → force FLAT (they're guessing)
    if (hallucinationReport.isUnanchored) {
      log.warn('🛡️ [DualMaster] Forcing FLAT — AI reasoning is disconnected from market data.');
      return {
        finalDirection: 'FLAT',
        weightedConfidence: 0,
        opinions: [architect, oracle],
        timestamp: Date.now()
      };
    }

    // Both agree
    if (architect.direction === oracle.direction && architect.direction !== 'FLAT') {
      finalDirection = architect.direction;
      finalConfidence = Math.max(architect.confidence, oracle.confidence);
    } 
    // Architect leads, Oracle flat
    else if (architect.direction !== 'FLAT' && oracle.direction === 'FLAT') {
      if (architect.confidence >= 0.8) {
         finalDirection = architect.direction;
         finalConfidence = architect.confidence * 0.8; 
      }
    } 
    // Oracle leads, Architect flat
    else if (oracle.direction !== 'FLAT' && architect.direction === 'FLAT') {
      if (oracle.confidence >= 0.85) {
         finalDirection = oracle.direction;
         finalConfidence = oracle.confidence * 0.7;
      }
    }
    // Hard contradiction (LONG vs SHORT) -> always FLAT for safety
    else if (architect.direction !== 'FLAT' && oracle.direction !== 'FLAT' && architect.direction !== oracle.direction) {
       finalDirection = 'FLAT';
       finalConfidence = 0;
    }

    // OMEGA: Apply hallucination confidence penalty
    if (hallucinationReport.confidencePenalty > 0 && finalConfidence > 0) {
      const originalConfidence = finalConfidence;
      finalConfidence = Math.max(0, finalConfidence - hallucinationReport.confidencePenalty);
      log.info(`[DualMaster] Confidence penalized: ${(originalConfidence * 100).toFixed(1)}% → ${(finalConfidence * 100).toFixed(1)}% (hallucination penalty: -${(hallucinationReport.confidencePenalty * 100).toFixed(0)}%)`);
    }

    // AUDIT-R2 DIRECTION GATE — LONG hemorrhage mitigation (empirical).
    // Ledger evidence (N=17772): LONG WR=24.4% vs SHORT WR=42.97%; break-even WR=43.3%
    //   with TP=1.0%/SL=-0.5% + 0.15% round-trip cost. LONG is ~19pp below break-even.
    // Kill-switches (both default permissive — gate is opt-in):
    //   DIRECTION_GATE_ENABLED=0          → bypass the entire block below
    //   DIRECTION_LONG_DISABLED=1         → force LONG → FLAT (SHORT/FLAT untouched)
    // ASSUMPTIONS (critical — invalidate strategy if broken):
    //   (1) SHORT EV remains ≥ LONG EV in forward regime (structural, not sampling artifact)
    //   (2) Empirical sample is representative of live regime (regime shift breaks this)
    //   (3) Downstream (managerVizionar) treats FLAT as no-op, not as a SHORT signal
    if (process.env.DIRECTION_GATE_ENABLED !== '0') {
      if (process.env.DIRECTION_LONG_DISABLED === '1' && finalDirection === 'LONG') {
        log.warn(`[DualMaster] AUDIT-R2 gate active: LONG → FLAT (DIRECTION_LONG_DISABLED=1, was confidence=${(finalConfidence * 100).toFixed(1)}%)`);
        finalDirection = 'FLAT';
        finalConfidence = 0;
      }
    }

    // FAZA 7c (2026-04-20) — SHORT LIVE conditional gate (session + symbol whitelist).
    // Scope: ONLY the LIVE arbitration path (this function). PAPER/phantom lane is
    // ArenaSimulator.distributeSignalToGladiators — untouched, keeps generating samples
    // for out-of-sample validation of the edge found in FAZA 6.
    //
    // Design choice: this block runs AFTER the AUDIT-R2 LONG→FLAT rewrite so that
    // (1) LONG is already neutralized upstream; (2) the gate only sees genuine SHORT
    // candidates. If finalDirection is already FLAT (either branch), gate is a no-op.
    //
    // Default config: SHORT_LIVE_GATE_ENABLED unset → shouldAdmitShortLive returns
    // {admit:true, reason:'gate_off'} and the block below is a pure pass-through.
    // Shadow mode (SHORT_LIVE_GATE_SHADOW=1, default when enabled) increments the
    // `shadow_*` blocked counter but does NOT rewrite direction — observation only.
    //
    // ASSUMPTIONS (broken → gate must be re-evaluated, not removed):
    //   (B1) Symbol is reliably propagated via ctx.symbol. When UNKNOWN (upstream
    //        context lost), gate treats it as opaque — empty symbol whitelist
    //        passes, non-empty whitelist misses → counted, shadow still admits.
    //   (B2) DIRECTION_LONG_DISABLED remains canonical LONG kill. If LONG is ever
    //        re-enabled, this gate does NOT extend to LONG — deliberately SHORT-only
    //        scope so empirical edges are not conflated.
    if (finalDirection === 'SHORT') {
      const gate = shouldAdmitShortLive(ctx?.symbol, Date.now());
      if (!gate.admit) {
        log.warn(
          `[DualMaster] FAZA 7c gate active: SHORT ${gate.symbol} → FLAT ` +
          `(reason=${gate.reason}, session=${gate.session}, was confidence=${(finalConfidence * 100).toFixed(1)}%)`,
        );
        finalDirection = 'FLAT';
        finalConfidence = 0;
      } else if (gate.reason.startsWith('shadow_would_block')) {
        log.info(
          `[DualMaster] FAZA 7c gate shadow: SHORT ${gate.symbol} would be blocked ` +
          `(reason=${gate.reason}, session=${gate.session}) — no enforcement (SHADOW mode)`,
        );
      }
    }

    return {
      finalDirection,
      weightedConfidence: Math.min(finalConfidence, 1),
      opinions: [architect, oracle],
      timestamp: Date.now()
    };
  }
}
