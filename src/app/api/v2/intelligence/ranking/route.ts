// ============================================================
// GET /api/v2/intelligence/ranking — ranked opportunity list
//
// Combines: momentum (from Polymarket scan cache + polyWsClient.getLastEvent),
//           sentiment (sentimentAgent),
//           orderbook intel (orderbookIntel cache),
//           volume intel (optional, when available),
//           market regime (optional).
//
// Pure additive. Does not mutate the existing scanner or wallet.
// ============================================================
import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import { rankCandidates, RankingCandidate } from '@/lib/v2/intelligence/agents/opportunityRanker';
import { sentimentAgent } from '@/lib/v2/intelligence/agents/sentimentAgent';
import { getAllOrderbookIntel, getOrderbookIntel } from '@/lib/v2/intelligence/agents/orderbookIntel';
import { getLastScans } from '@/lib/polymarket/polyState';
import { polyWsClient } from '@/lib/polymarket/polyWsClient';

export const dynamic = 'force-dynamic';

type RawScanResults = Record<string, unknown>;

function extractPolymarketCandidates(lastScans: RawScanResults): RankingCandidate[] {
  // Scanner writes per-division arrays with { market, signals, ... }. We walk
  // conservatively so we never crash when the shape drifts.
  const out: RankingCandidate[] = [];
  const seen = new Set<string>();
  for (const divKey of Object.keys(lastScans || {})) {
    const val = (lastScans as Record<string, unknown>)[divKey];
    if (!val || typeof val !== 'object') continue;
    const scan = val as { opportunities?: Array<Record<string, unknown>>; markets?: Array<Record<string, unknown>> };
    const list = scan.opportunities || scan.markets || [];
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      const id = String(m.id || m.marketId || m.slug || m.assetId || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const price = typeof m.price === 'number' ? m.price : undefined;
      const prevPrice = typeof m.prevPrice === 'number' ? m.prevPrice : undefined;
      const momentum = price && prevPrice && prevPrice > 0 ? Math.max(-1, Math.min(1, (price - prevPrice) / prevPrice * 10)) : undefined;
      const title = String(m.title || m.question || m.slug || id);
      const orderbook = getOrderbookIntel(id) || null;

      // Pull any available last WS event for recency
      const lastEv = polyWsClient.getLastEvent(id);
      const recencyMs = lastEv ? Date.now() - lastEv.receivedAt : undefined;

      out.push({
        id,
        symbol: title.slice(0, 80),
        sector: 'POLYMARKET',
        momentum,
        orderbook,
        recencyMs,
        meta: { source: 'polymarket-scan', division: divKey },
      });
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(200, Number(searchParams.get('limit') || 25)));
    const sector = (searchParams.get('sector') || '').toUpperCase().trim();

    // 1. Pull cached Polymarket scans
    const lastScans = getLastScans() as RawScanResults;
    let candidates = extractPolymarketCandidates(lastScans);

    // 2. Enrich with sentiment (match by symbol token if present in title)
    const sent = await sentimentAgent.getSnapshot();
    for (const c of candidates) {
      // match symbol heuristically
      for (const sy of sent.bySymbol) {
        if (c.symbol.toUpperCase().includes(sy.symbol)) {
          c.sentimentScore = sy.aggScore;
          c.sentimentCount = sy.count;
          break;
        }
      }
    }

    // 3. Add crypto-symbol candidates from orderbook intel cache (MEXC WS)
    const obs = getAllOrderbookIntel();
    for (const ob of obs) {
      const symUpper = ob.symbol.toUpperCase();
      // avoid dup if already present
      if (candidates.some((c) => c.id === symUpper)) continue;
      const sy = sent.bySymbol.find((s) => symUpper.includes(s.symbol));
      candidates.push({
        id: symUpper,
        symbol: symUpper,
        sector: 'CRYPTO',
        orderbook: ob,
        sentimentScore: sy?.aggScore,
        sentimentCount: sy?.count,
        recencyMs: Date.now() - ob.at,
        meta: { source: 'mexc-ws-book' },
      });
    }

    if (sector) candidates = candidates.filter((c) => (c.sector || '').toUpperCase() === sector);

    const ranked = rankCandidates(candidates).slice(0, limit);

    return successResponse({
      status: 'ok',
      count: ranked.length,
      totalCandidates: candidates.length,
      sector: sector || 'ALL',
      ranked,
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('INTEL_RANKING_FAILED', (err as Error).message, 500);
  }
}
