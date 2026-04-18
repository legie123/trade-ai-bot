/**
 * GET /api/v2/cron/sentiment — Sentiment Heartbeat (Faza 9+10)
 *
 * Called every 30 minutes by Cloud Scheduler.
 * Fetches latest Moltbook posts, runs LLM-enhanced NLP sentiment analysis,
 * and stores aggregated scores in Supabase for the Sentiment Arena to consume.
 *
 * NLP approach: GPT-4o-mini with keyword fallback (Faza 10 upgrade).
 */
import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { analyzeSentimentLLM } from '@/lib/v2/superai/llmSentiment';
import { requireCronAuth } from '@/lib/core/cronAuth';

export const dynamic = 'force-dynamic';

const log = createLogger('Cron:Sentiment');

// ── Simple keyword NLP scorer ─────────────────────────────────
const BULLISH_KEYWORDS = [
  'moon', 'pump', 'bull', 'breakout', 'long', 'buy', 'accumulate',
  'reversal up', 'golden cross', 'higher high', 'support held',
  'dip buying', 'whale buy', 'institutional', 'undervalued',
  'oversold bounce', 'strong bid', 'green candle', 'ATH',
];

const BEARISH_KEYWORDS = [
  'dump', 'crash', 'bear', 'short', 'sell', 'liquidation',
  'death cross', 'lower low', 'resistance rejected', 'overvalued',
  'overbought', 'whale sell', 'fear', 'capitulation', 'rug',
  'red candle', 'breakdown', 'FUD', 'exit scam',
];

interface SentimentScore {
  symbol: string;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  score: number;            // -100 to +100
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  postsAnalyzed: number;
}

function classifyPost(text: string): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const lower = text.toLowerCase();
  let bullScore = 0;
  let bearScore = 0;

  for (const kw of BULLISH_KEYWORDS) {
    if (lower.includes(kw)) bullScore++;
  }
  for (const kw of BEARISH_KEYWORDS) {
    if (lower.includes(kw)) bearScore++;
  }

  if (bullScore > bearScore + 1) return 'BULLISH';
  if (bearScore > bullScore + 1) return 'BEARISH';
  return 'NEUTRAL';
}

export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  log.info('[Sentiment Heartbeat] Starting 30-min pulse...');

  try {
    // Fetch recent Moltbook posts from our internal API
    const { getServiceUrl } = await import('@/lib/core/serviceUrl');
    const origin = getServiceUrl();
    let posts: Array<{ content: string; symbol?: string; timestamp?: string }> = [];

    try {
      const res = await fetch(`${origin}/api/moltbook-cron`, {
        headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET ?? ''}` },
      });
      if (res.ok) {
        const data = await res.json() as { posts?: Array<{ content: string; symbol?: string }> };
        posts = data.posts ?? [];
      }
    } catch {
      log.warn('[Sentiment Heartbeat] Moltbook API unavailable, using empty set');
    }

    if (posts.length === 0) {
      return NextResponse.json({
        status: 'ok',
        message: 'No posts to analyze',
        heartbeatAt: new Date().toISOString(),
        nextPulse: '30 minutes',
      });
    }

    // Group posts by symbol mention
    const TOP_SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'MATIC', 'DOT', 'LINK'];
    const symbolScores: SentimentScore[] = [];

    for (const sym of TOP_SYMBOLS) {
      const symLower = sym.toLowerCase();
      const symbolPosts = posts.filter(p =>
        p.content.toLowerCase().includes(symLower) || p.symbol === sym
      );

      if (symbolPosts.length === 0) continue;

      // Try LLM-enhanced analysis first (Faza 10) with error fallback
      // FIX: Wrap LLM call in try-catch to prevent entire cron from failing on LLM errors
      let llmResult: { method: string; score: number; direction: string } = { method: 'KEYWORD', score: 0, direction: 'NEUTRAL' };
      try {
        llmResult = await analyzeSentimentLLM(sym, symbolPosts.map(p => p.content));
      } catch (llmErr) {
        log.warn(`[Sentiment] LLM analysis failed for ${sym}, falling back to keyword`, { error: String(llmErr) });
      }

      // Also run keyword for comparison stats
      let bullish = 0, bearish = 0, neutral = 0;
      for (const post of symbolPosts) {
        const cls = classifyPost(post.content);
        if (cls === 'BULLISH') bullish++;
        else if (cls === 'BEARISH') bearish++;
        else neutral++;
      }

      const total = bullish + bearish + neutral;

      // Use LLM score if available, otherwise keyword
      // FIX: Clamp LLM score to [-100, 100] to prevent garbage values from malformed LLM responses
      const rawScore = llmResult.method === 'LLM' ? llmResult.score
        : Math.round(((bullish - bearish) / total) * 100);
      const finalScore = Math.max(-100, Math.min(100, rawScore));
      const llmDir = llmResult.direction as 'BULLISH' | 'BEARISH' | 'NEUTRAL';
      const finalDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = llmResult.method === 'LLM'
        ? (['BULLISH', 'BEARISH', 'NEUTRAL'].includes(llmDir) ? llmDir : 'NEUTRAL')
        : (finalScore > 15 ? 'BULLISH' : finalScore < -15 ? 'BEARISH' : 'NEUTRAL');

      symbolScores.push({
        symbol: sym,
        bullishCount: bullish,
        bearishCount: bearish,
        neutralCount: neutral,
        score: finalScore,
        direction: finalDirection,
        postsAnalyzed: total,
      });
    }

    // Store to Supabase if available
    try {
      const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!sbUrl || !sbKey) throw new Error('Supabase credentials not configured');
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(sbUrl, sbKey);

      for (const score of symbolScores) {
        await supabase.from('sentiment_heartbeat').upsert({
          symbol: score.symbol,
          score: score.score,
          direction: score.direction,
          bullish_count: score.bullishCount,
          bearish_count: score.bearishCount,
          neutral_count: score.neutralCount,
          posts_analyzed: score.postsAnalyzed,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'symbol' });
      }
    } catch {
      log.warn('[Sentiment Heartbeat] Supabase write failed (table may not exist yet)');
    }

    log.info(`[Sentiment Heartbeat] Analyzed ${posts.length} posts across ${symbolScores.length} symbols`);

    return NextResponse.json({
      status: 'ok',
      postsAnalyzed: posts.length,
      symbolScores,
      heartbeatAt: new Date().toISOString(),
      nextPulse: '30 minutes',
    });

  } catch (err) {
    log.error('[Sentiment Heartbeat] Error', { error: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
