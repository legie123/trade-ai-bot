// GET /api/v2/polymarket — Polymarket sector status, scanner, wallet
import { NextResponse } from 'next/server';
import { PolyDivision } from '@/lib/polymarket/polyTypes';
import { testPolymarketConnection, getMarketsByCategory } from '@/lib/polymarket/polyClient';
import { scanDivision } from '@/lib/polymarket/marketScanner';
import { createPolyWallet, getWalletSummary } from '@/lib/polymarket/polyWallet';
import { spawnPolyGladiator, getPolyLeaderboard, type PolyGladiator } from '@/lib/polymarket/polyGladiators';

export const dynamic = 'force-dynamic';

// In-memory state (reset on cold start — Supabase persistence is TODO)
let polyWallet = createPolyWallet();
let polyGladiators: PolyGladiator[] = [];
let lastScanResults: Record<string, any> = {};
let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  initialized = true;

  // Spawn 1 gladiator per division
  const divisions = Object.values(PolyDivision);
  for (const division of divisions) {
    const g = spawnPolyGladiator(division, `${division} Analysis`);
    polyGladiators.push(g);
  }
}

export async function GET(request: Request) {
  try {
    ensureInitialized();

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'status';
    const division = searchParams.get('division') as PolyDivision | null;

    switch (action) {
      case 'scan': {
        // Scan a single division or all
        if (division && Object.values(PolyDivision).includes(division)) {
          const result = await scanDivision(division, 15);
          lastScanResults[division] = result;
          return NextResponse.json({
            status: 'ok',
            scan: result,
            timestamp: Date.now(),
          });
        }
        // Scan top 3 divisions by default (avoid rate limits)
        const quickDivisions = [PolyDivision.TRENDING, PolyDivision.CRYPTO, PolyDivision.POLITICS];
        const scans = await Promise.allSettled(
          quickDivisions.map(d => scanDivision(d, 10)),
        );
        const results = scans
          .filter((s): s is PromiseFulfilledResult<any> => s.status === 'fulfilled')
          .map(s => s.value);
        for (const r of results) {
          lastScanResults[r.division] = r;
        }
        return NextResponse.json({
          status: 'ok',
          scans: results,
          divisionsScanned: results.length,
          timestamp: Date.now(),
        });
      }

      case 'markets': {
        // Get markets for a division
        const div = division || PolyDivision.TRENDING;
        const markets = await getMarketsByCategory(div, 20);
        return NextResponse.json({
          status: 'ok',
          division: div,
          markets: markets.map(m => ({
            id: m.id,
            title: m.title,
            outcomes: m.outcomes,
            volume24h: m.volume24h,
            liquidityUSD: m.liquidityUSD,
            endDate: m.endDate,
            active: m.active,
          })),
          total: markets.length,
          timestamp: Date.now(),
        });
      }

      case 'wallet': {
        const summary = getWalletSummary(polyWallet);
        return NextResponse.json({
          status: 'ok',
          wallet: summary,
          timestamp: Date.now(),
        });
      }

      case 'gladiators': {
        const leaderboard = getPolyLeaderboard(polyGladiators, division || undefined);
        return NextResponse.json({
          status: 'ok',
          gladiators: leaderboard.map(g => ({
            id: g.id,
            name: g.name,
            division: g.division,
            readinessScore: g.readinessScore,
            divisionExpertise: g.divisionExpertise,
            winRate: g.stats.winRate.toFixed(3),
            totalBets: g.stats.totalTrades,
            phantomBets: g.phantomBets.length,
            cumulativeEdge: g.cumulativeEdge.toFixed(2),
            status: g.status,
            isLive: g.isLive,
          })),
          total: leaderboard.length,
          timestamp: Date.now(),
        });
      }

      case 'health': {
        const conn = await testPolymarketConnection();
        return NextResponse.json({
          status: 'ok',
          polymarket: {
            clob: conn.clob,
            gamma: conn.gamma,
            walletConfigured: !!process.env.POLYMARKET_WALLET,
            apiKeyConfigured: !!process.env.POLYMARKET_API_KEY,
          },
          divisions: Object.values(PolyDivision).length,
          gladiators: polyGladiators.length,
          timestamp: Date.now(),
        });
      }

      default: {
        // Full status overview
        const conn = await testPolymarketConnection();
        const walletSummary = getWalletSummary(polyWallet);
        const leaderboard = getPolyLeaderboard(polyGladiators);

        return NextResponse.json({
          status: 'ok',
          sector: 'POLYMARKET',
          version: '1.0.0',
          connection: {
            clob: conn.clob,
            gamma: conn.gamma,
          },
          divisions: Object.values(PolyDivision).length,
          divisionList: Object.values(PolyDivision),
          gladiators: {
            total: polyGladiators.length,
            live: polyGladiators.filter(g => g.isLive).length,
            training: polyGladiators.filter(g => g.status === 'IN_TRAINING').length,
            topPerformer: leaderboard[0] ? {
              id: leaderboard[0].id,
              division: leaderboard[0].division,
              readiness: leaderboard[0].readinessScore,
            } : null,
          },
          wallet: {
            totalBalance: walletSummary.totalBalance,
            totalInvested: walletSummary.totalInvested,
            realizedPnL: walletSummary.realizedPnL,
            positionCount: walletSummary.positionCount,
          },
          lastScans: Object.keys(lastScanResults).length,
          timestamp: Date.now(),
        });
      }
    }
  } catch (err) {
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 },
    );
  }
}
