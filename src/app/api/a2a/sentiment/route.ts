/**
 * Arena 2 — Sentiment
 * POST /api/a2a/sentiment
 *
 * Aggregates Moltbook swarm intelligence and on-chain bias into a
 * BULLISH/BEARISH/NEUTRAL sentiment score for the given symbol.
 */
import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { omegaExtractor } from '@/lib/v2/superai/omegaExtractor';

export const dynamic = 'force-dynamic';

const log = createLogger('Arena:Sentiment');

interface SentimentRequest {
  symbol: string;
  /** Optional: pre-fetched Moltbook posts */
  posts?: Array<{
    content: string;
    timestamp: string;
    sentiment?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence?: number;
  }>;
  timeframe?: '1h' | '4h' | '24h';
}

function verifyToken(request: Request): boolean {
  const token = process.env.SWARM_TOKEN;
  if (!token) { log.warn('SWARM_TOKEN not set — allowing internal calls'); return true; }
  return request.headers.get('x-swarm-token') === token;
}

function scorePosts(
  posts: SentimentRequest['posts'],
  symbol: string,
): { direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; score: number; processed: number } {
  if (!posts || posts.length === 0) {
    return { direction: 'NEUTRAL', score: 50, processed: 0 };
  }

  // Filter posts that mention the symbol (loose match)
  const symBase = symbol.replace('/USDT', '').replace('/BTC', '').toLowerCase();
  const relevant = posts.filter(p =>
    p.content.toLowerCase().includes(symBase) || !symBase
  );

  if (relevant.length === 0) {
    return { direction: 'NEUTRAL', score: 50, processed: 0 };
  }

  let bullish = 0, bearish = 0, neutral = 0;
  for (const post of relevant) {
    if (post.sentiment === 'BULLISH') bullish++;
    else if (post.sentiment === 'BEARISH') bearish++;
    else neutral++;
  }

  const total = bullish + bearish + neutral;
  const bullRatio = bullish / total;
  const bearRatio = bearish / total;

  let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  let score: number;

  if (bullRatio > 0.55) {
    direction = 'BULLISH';
    score = Math.round(50 + bullRatio * 50);
  } else if (bearRatio > 0.55) {
    direction = 'BEARISH';
    score = Math.round(50 + bearRatio * 50);
  } else {
    direction = 'NEUTRAL';
    score = 50;
  }

  return { direction, score, processed: relevant.length };
}

export async function POST(request: Request) {
  if (!verifyToken(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: SentimentRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { symbol, posts, timeframe = '4h' } = body;
  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }

  log.info(`[Sentiment] Analyzing ${symbol} sentiment (${timeframe})`);

  try {
    // Omega direction bias
    const synthesis = omegaExtractor.getCurrentSynthesis();
    const omegaBias = synthesis?.directionBias ?? 'NEUTRAL';
    const omegaMod = omegaExtractor.getModifierForSymbol(symbol);

    // Score posts
    const { direction, score, processed } = scorePosts(posts, symbol);

    // Blend with Omega bias
    let finalDirection = direction;
    let finalScore = score;

    if (omegaBias !== 'NEUTRAL') {
      const omegaDir = omegaBias === 'LONG' ? 'BULLISH' : 'BEARISH';
      if (omegaDir === direction) {
        // Agreement — amplify
        finalScore = Math.min(95, Math.round(score * omegaMod));
      } else if (direction === 'NEUTRAL') {
        // Omega breaks neutral
        finalDirection = omegaDir;
        finalScore = Math.round(50 * omegaMod);
      }
      // Conflict — keep original direction, reduce score
      else {
        finalScore = Math.round(score * 0.85);
      }
    }

    // Strong/weak symbols from Omega
    const isStrong = synthesis?.strongSymbols.includes(symbol) ?? false;
    const isWeak = synthesis?.weakSymbols.includes(symbol) ?? false;

    return NextResponse.json({
      arena: 'sentiment',
      symbol,
      timeframe,
      direction: finalDirection,
      score: finalScore,
      insightsProcessed: processed,
      omegaBias,
      omegaModifier: omegaMod,
      symbolStrength: isStrong ? 'STRONG' : isWeak ? 'WEAK' : 'NEUTRAL',
      rawPosts: processed,
      timestamp: Date.now(),
    });

  } catch (err) {
    log.error('[Sentiment] Error', { error: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    arena: 'sentiment',
    status: 'ready',
    description: 'Moltbook swarm sentiment + Omega bias arena',
    accepts: 'POST { symbol, posts?, timeframe? }',
  });
}
