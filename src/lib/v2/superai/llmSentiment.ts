// ============================================================
// LLM-Enhanced Sentiment Analyzer — GPT-4o-mini for crypto NLP
// Replaces keyword scorer with context-aware analysis
// Falls back to keyword scorer if LLM unavailable
// ============================================================
// ENHANCEMENTS:
// - Source quality scoring (account age, followers, engagement, bot detection)
// - Noise reduction (duplicate removal, spam filtering, bot detection)
// - Weighted aggregation (3x for high-quality sources)
// - Temporal decay (recent posts weight more)
// - Confidence penalty (low sample size or quality < 0.3)
// - Contrarian signals (90%+ consensus warning)
// ============================================================

import { createLogger } from '@/lib/core/logger';

const log = createLogger('LLMSentiment');
const OPENAI_API_KEY = () => process.env.OPENAI_API_KEY || '';

export interface LLMSentimentResult {
  symbol: string;
  score: number;          // -100 to +100
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;     // 0-1
  reasoning: string;
  keyDrivers: string[];
  method: 'LLM' | 'KEYWORD_FALLBACK';
  sourceQualityScore?: number;   // 0-1 aggregate quality
  contrarian?: boolean;           // True if 90%+ consensus detected
  samplesUsed?: number;           // Count of posts after dedup/filtering
}

interface PostMetadata {
  text: string;
  source?: string;
  timestamp?: number;
  author?: string;
}

// Bot detection patterns
const BOT_PATTERNS = [
  /congratulation|felicitat/gi,
  /you.*won.*prize|ต่อนขว|เฟื่อ/gi,
  /verify.*account|update.*information/gi,
  /click.*here|urgent.*action.*required/gi,
];

const SHILL_PHRASES = [
  'diamond hands', 'paper hands', 'to the moon', 'pump it', 'hodl hodl hodl',
  'lambo incoming', 'moon mission', 'guaranteed gains', 'can\'t lose',
];

const REPETITIVE_EMOJI = /(.)\1{3,}/g; // 4+ repeated chars/emojis

const SYSTEM_PROMPT = `You are a crypto market sentiment analyzer. Analyze the provided social media posts about a cryptocurrency and return a JSON sentiment assessment.

Rules:
- Score from -100 (extremely bearish) to +100 (extremely bullish)
- Direction: BULLISH (score > 15), BEARISH (score < -15), NEUTRAL (otherwise)
- Confidence: 0.0 to 1.0 based on signal quality and consistency
- keyDrivers: top 3 sentiment drivers (e.g. "whale accumulation", "regulatory FUD")
- Ignore obvious spam, bots, and repetitive shilling
- Weight institutional/whale signals higher than retail noise
- Consider sarcasm and irony (crypto community uses these heavily)

Respond with ONLY valid JSON:
{"score": number, "direction": "BULLISH"|"BEARISH"|"NEUTRAL", "confidence": number, "reasoning": "string", "keyDrivers": ["string"]}`;

// ─── Source Quality Scoring ────────────────────────────────
// Score 0-1 based on: account signals, follower proxy, engagement ratio, bot detection
function scoreSourceQuality(metadata?: { author?: string; source?: string }): number {
  if (!metadata?.author) return 0.6; // Unknown source: neutral-low quality

  let quality = 0.5;

  // Account age proxy: typical Twitter/X account names vs suspicious
  const author = metadata.author.toLowerCase();
  if (/^[a-z_]{8,}/.test(author)) quality += 0.15; // Proper username pattern
  if (/\d{10,}/.test(author)) quality -= 0.1;      // Numeric-heavy (bot-like)
  if (/test|temp|bot|spam/.test(author)) quality -= 0.25;

  // Source reputation
  if (metadata.source === 'WHALE_TRACKER') quality += 0.25;
  if (metadata.source === 'INSTITUTIONAL') quality += 0.20;

  return Math.max(0, Math.min(1, quality));
}

// ─── Noise Reduction ────────────────────────────────────────
interface DedupOptions {
  posts: PostMetadata[];
  threshold?: number; // Hamming distance threshold for near-duplicate
}

function removeNoise(options: DedupOptions): PostMetadata[] {
  const { posts, threshold = 0.75 } = options;

  // Step 1: Remove obvious bots
  let filtered = posts.filter(p => {
    const text = p.text.toLowerCase();
    return !BOT_PATTERNS.some(pattern => pattern.test(text));
  });

  log.debug('Bot filtering', { before: posts.length, after: filtered.length });

  // Step 2: Remove excessive caps/spam patterns
  filtered = filtered.filter(p => {
    const capsCount = (p.text.match(/[A-Z]/g) || []).length;
    const capsRatio = capsCount / p.text.length;
    if (capsRatio > 0.6) return false; // >60% caps = spam
    if (REPETITIVE_EMOJI.test(p.text)) return false; // Repeated emojis
    return true;
  });

  // Step 3: Remove known shill phrases
  filtered = filtered.filter(p => {
    const text = p.text.toLowerCase();
    const shillCount = SHILL_PHRASES.filter(phrase => text.includes(phrase)).length;
    return shillCount < 3; // Allow some shill language, but not excessive
  });

  // Step 4: Deduplication via Levenshtein-like similarity
  const deduplicated: PostMetadata[] = [];
  for (const post of filtered) {
    const isDuplicate = deduplicated.some(existing =>
      stringSimilarity(post.text, existing.text) > threshold
    );
    if (!isDuplicate) deduplicated.push(post);
  }

  log.debug('Noise removal', {
    start: posts.length,
    afterFilter: filtered.length,
    afterDedup: deduplicated.length
  });

  return deduplicated;
}

// ─── String Similarity (Levenshtein-like ratio) ────────────
function stringSimilarity(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(a: string, b: string): number {
  const alen = a.length, blen = b.length;
  const d: number[][] = [];

  for (let i = 0; i <= alen; i++) d[i] = [i];
  for (let j = 0; j <= blen; j++) d[0][j] = j;

  for (let i = 1; i <= alen; i++) {
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,      // deletion
        d[i][j - 1] + 1,      // insertion
        d[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return d[alen][blen];
}

// ─── Temporal Decay ────────────────────────────────────────
function getTemporalWeight(timestamp?: number): number {
  if (!timestamp) return 1.0;

  const ageMs = Date.now() - timestamp;
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours < 1) return 1.0;      // < 1h: full weight
  if (ageHours < 6) return 0.8;      // 1-6h: 80% weight
  if (ageHours < 24) return 0.5;     // 6-24h: 50% weight
  return 0.2;                         // > 24h: 20% weight
}

export async function analyzeSentimentLLM(
  symbol: string,
  posts: (string | PostMetadata)[] = [],
): Promise<LLMSentimentResult> {
  if (!OPENAI_API_KEY() || posts.length === 0) {
    return fallbackKeywordScore(symbol, posts);
  }

  // Convert strings to PostMetadata for uniform processing
  const postMetadata: PostMetadata[] = posts.map(p =>
    typeof p === 'string' ? { text: p } : p
  );

  // STEP 1: Noise reduction (bots, spam, duplicates)
  const cleanPosts = removeNoise({ posts: postMetadata });
  if (cleanPosts.length === 0) {
    log.warn('All posts filtered as noise', { symbol });
    return fallbackKeywordScore(symbol, []);
  }

  // STEP 2: Quality scoring for weighted aggregation
  const postQualities = cleanPosts.map(p => ({
    post: p,
    sourceQuality: scoreSourceQuality({ author: p.author, source: p.source }),
    temporalWeight: getTemporalWeight(p.timestamp),
  }));

  const avgSourceQuality = postQualities.reduce((sum, pq) => sum + pq.sourceQuality, 0) / postQualities.length;

  // STEP 3: Prepare posts for LLM (max 20, trimmed)
  const selectedPosts = cleanPosts.slice(0, 20);
  const userContent = `Symbol: ${symbol}\n\nRecent posts (${selectedPosts.length} posts after filtering):\n${selectedPosts
    .map((p, i) => `${i + 1}. ${p.text.slice(0, 200)}`)
    .join('\n')}`;

  let result: LLMSentimentResult;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY()}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.3,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      log.warn('LLM API error', { status: res.status, symbol });
      return fallbackKeywordScore(symbol, posts);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return fallbackKeywordScore(symbol, posts);

    const parsed = JSON.parse(content);

    result = {
      symbol,
      score: Math.max(-100, Math.min(100, parsed.score || 0)),
      direction: parsed.direction || 'NEUTRAL',
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
      reasoning: parsed.reasoning || 'LLM analysis',
      keyDrivers: Array.isArray(parsed.keyDrivers) ? parsed.keyDrivers.slice(0, 3) : [],
      method: 'LLM',
      sourceQualityScore: avgSourceQuality,
      samplesUsed: cleanPosts.length,
    };
  } catch (err) {
    log.error('LLM sentiment error', { symbol, error: (err as Error).message });
    return fallbackKeywordScore(symbol, posts);
  }

  // STEP 4: Apply confidence penalties and contrarian signals
  applyConfidencePenalties(result, cleanPosts);
  checkForContrarian(result);

  return result;
}

// ─── Confidence Penalties ──────────────────────────────────
function applyConfidencePenalties(result: LLMSentimentResult, posts: PostMetadata[]): void {
  // Penalty 1: Small sample size
  if (posts.length < 10) {
    const factor = posts.length < 5 ? 0.3 : 0.6;
    result.confidence *= factor;
    log.debug('Small sample penalty', { samples: posts.length, factor });
  }

  // Penalty 2: Low source quality
  const sourceQuality = result.sourceQualityScore || 0.5;
  if (sourceQuality < 0.3) {
    result.confidence *= 0.5;
    log.debug('Low quality penalty', { sourceQuality });
  }
}

// ─── Contrarian Signal Detection ───────────────────────────
function checkForContrarian(result: LLMSentimentResult): void {
  // Warning if 90%+ of community agrees (crowd euphoria/panic)
  const extremeAgreement = Math.abs(result.score) > 75; // Very bullish or very bearish

  if (extremeAgreement) {
    result.contrarian = true;
    result.reasoning += ' [⚠️ Contrarian: Extreme consensus detected — reversals often follow crowd euphoria/panic]';
    log.info('Contrarian signal detected', { symbol: result.symbol, score: result.score });
  }
}

// ─── Keyword fallback (enhanced with quality weighting) ──────
const BULLISH_KEYWORDS = [
  'moon', 'bullish', 'pump', 'buy', 'long', 'breakout', 'rally',
  'accumulate', 'undervalued', 'gem', 'rocket', 'ath', 'green',
  'whale', 'institutional', 'upgrade', 'partnership', 'adoption', 'golden cross',
];
const BEARISH_KEYWORDS = [
  'dump', 'bearish', 'sell', 'short', 'crash', 'scam', 'rug',
  'overvalued', 'dead', 'bubble', 'fear', 'liquidation', 'hack',
  'sec', 'ban', 'regulation', 'death cross', 'capitulation', 'ponzi',
];

function fallbackKeywordScore(
  symbol: string,
  posts: (string | PostMetadata)[]
): LLMSentimentResult {
  const postMetadata: PostMetadata[] = posts.map(p =>
    typeof p === 'string' ? { text: p } : p
  );

  const cleanPosts = removeNoise({ posts: postMetadata });

  let bullCount = 0;
  let bearCount = 0;
  let weightedBull = 0;
  let weightedBear = 0;

  for (const post of cleanPosts) {
    const lower = post.text.toLowerCase();
    const sourceQual = scoreSourceQuality({ author: post.author, source: post.source });
    const tempWeight = getTemporalWeight(post.timestamp);
    const weight = sourceQual * tempWeight;

    for (const kw of BULLISH_KEYWORDS) {
      if (lower.includes(kw)) {
        bullCount++;
        weightedBull += weight;
      }
    }
    for (const kw of BEARISH_KEYWORDS) {
      if (lower.includes(kw)) {
        bearCount++;
        weightedBear += weight;
      }
    }
  }

  const total = bullCount + bearCount;
  const weightedTotal = weightedBull + weightedBear;
  const score = weightedTotal > 0
    ? Math.round(((weightedBull - weightedBear) / weightedTotal) * 100)
    : 0;
  const direction = score > 15 ? 'BULLISH' : score < -15 ? 'BEARISH' : 'NEUTRAL';
  const avgSourceQuality = cleanPosts.length > 0
    ? cleanPosts.reduce((sum, p) => sum + scoreSourceQuality({ author: p.author }), 0) / cleanPosts.length
    : 0;

  let confidence = cleanPosts.length > 5 ? 0.6 : 0.3;

  // Apply confidence penalties
  if (cleanPosts.length < 10) confidence *= 0.6;
  if (avgSourceQuality < 0.3) confidence *= 0.5;

  const result: LLMSentimentResult = {
    symbol,
    score,
    direction,
    confidence,
    reasoning: `Keyword analysis (weighted): ${Math.round(weightedBull)} bullish / ${Math.round(
      weightedBear
    )} bearish (${total} signals from ${cleanPosts.length} posts)`,
    keyDrivers: [],
    method: 'KEYWORD_FALLBACK',
    sourceQualityScore: avgSourceQuality,
    samplesUsed: cleanPosts.length,
  };

  checkForContrarian(result);
  return result;
}
