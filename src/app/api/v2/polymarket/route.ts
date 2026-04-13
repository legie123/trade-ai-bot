// GET /api/v2/polymarket — Polymarket sector status, scanner, wallet
// POST /api/v2/polymarket — Manual actions (open_position, close_position, etc.)
import { NextResponse } from 'next/server';
import { PolyDivision } from '@/lib/polymarket/polyTypes';
import { testPolymarketConnection, getMarketsByCategory, getMarket } from '@/lib/polymarket/polyClient';
import { scanDivision } from '@/lib/polymarket/marketScanner';
import { getWalletSummary, openPosition, closePosition } from '@/lib/polymarket/polyWallet';
import { evaluateMarket, getPolyLeaderboard } from '@/lib/polymarket/polyGladiators';
import { analyzeMarket } from '@/lib/polymarket/polySyndicate';
import {
  ensureInitialized,
  getWallet,
  getGladiators,
  getLastScans,
  setLastScans,
  persistWallet,
  persistGladiators,
  persistBoth,
  waitForInit,
} from '@/lib/polymarket/polyState';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolymarketRoute');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    ensureInitialized();
    // Wait for init on first request
    await waitForInit();

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'status';
    const division = searchParams.get('division') as PolyDivision | null;

    const wallet = getWallet();
    const gladiators = getGladiators();
    const lastScans = getLastScans();

    switch (action) {
      case 'scan': {
        if (division && Object.values(PolyDivision).includes(division)) {
          const result = await scanDivision(division, 15);
          const updatedScans = { ...lastScans, [division]: result };
          setLastScans(updatedScans);
          return NextResponse.json({ status: 'ok', scan: result, timestamp: Date.now() });
        }
        const quickDivisions = [PolyDivision.TRENDING, PolyDivision.CRYPTO, PolyDivision.POLITICS];
        const scans = await Promise.allSettled(quickDivisions.map(d => scanDivision(d, 10)));
        const results = scans
          .filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof scanDivision>>> => s.status === 'fulfilled')
          .map(s => s.value);
        const updatedScans = { ...lastScans };
        for (const r of results) {
          updatedScans[r.division] = r;
        }
        setLastScans(updatedScans);
        // Persist scan results don't affect wallet — no save needed
        return NextResponse.json({
          status: 'ok',
          scans: results,
          divisionsScanned: results.length,
          timestamp: Date.now(),
        });
      }

      case 'markets': {
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
        const summary = getWalletSummary(wallet);
        return NextResponse.json({ status: 'ok', wallet: summary, timestamp: Date.now() });
      }

      case 'gladiators': {
        const leaderboard = getPolyLeaderboard(gladiators, division || undefined);
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
          persistence: 'supabase',
          divisions: Object.values(PolyDivision).length,
          gladiators: gladiators.length,
          timestamp: Date.now(),
        });
      }

      default: {
        const conn = await testPolymarketConnection();
        const walletSummary = getWalletSummary(wallet);
        const leaderboard = getPolyLeaderboard(gladiators);

        return NextResponse.json({
          status: 'ok',
          sector: 'POLYMARKET',
          version: '1.2.0',
          persistence: 'supabase',
          connection: { clob: conn.clob, gamma: conn.gamma },
          divisions: Object.values(PolyDivision).length,
          divisionList: Object.values(PolyDivision),
          gladiators: {
            total: gladiators.length,
            live: gladiators.filter(g => g.isLive).length,
            training: gladiators.filter(g => g.status === 'IN_TRAINING').length,
            topPerformer: leaderboard[0]
              ? { id: leaderboard[0].id, division: leaderboard[0].division, readiness: leaderboard[0].readinessScore }
              : null,
          },
          wallet: {
            totalBalance: walletSummary.totalBalance,
            totalInvested: walletSummary.totalInvested,
            realizedPnL: walletSummary.realizedPnL,
            positionCount: walletSummary.positionCount,
          },
          lastScans: Object.keys(lastScans).length,
          timestamp: Date.now(),
        });
      }
    }
  } catch (err) {
    log.error('GET handler error', { error: String(err) });
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    ensureInitialized();
    await waitForInit();

    const wallet = getWallet();
    const gladiators = getGladiators();

    const body = (await request.json()) as Record<string, unknown>;
    const action = body.action as string;

    switch (action) {
      case 'open_position': {
        const marketId = body.marketId as string;
        const divisionStr = body.division as string;
        const direction = body.direction as 'BUY_YES' | 'BUY_NO';
        const confidence = (body.confidence as number) ?? 50;
        const edgeScore = (body.edgeScore as number) ?? 50;

        if (!marketId || !divisionStr || !Object.values(PolyDivision).includes(divisionStr as PolyDivision)) {
          return NextResponse.json(
            { status: 'error', error: 'Missing or invalid marketId, division' },
            { status: 400 },
          );
        }

        const division = divisionStr as PolyDivision;
        const market = await getMarket(marketId);
        if (!market) {
          return NextResponse.json({ status: 'error', error: 'Market not found' }, { status: 404 });
        }

        // Find outcome
        const outcome = market.outcomes.find(o => o.name.toUpperCase() === direction.replace('BUY_', ''));
        if (!outcome) {
          return NextResponse.json(
            { status: 'error', error: 'Outcome not found for direction' },
            { status: 400 },
          );
        }

        const position = openPosition(
          wallet,
          marketId,
          division,
          outcome.id,
          direction,
          outcome.price,
          confidence,
          edgeScore,
        );

        if (!position) {
          return NextResponse.json(
            { status: 'error', error: 'Could not open position (limits or insufficient funds)' },
            { status: 400 },
          );
        }

        await persistWallet();

        return NextResponse.json({
          status: 'ok',
          position,
          walletBalance: wallet.totalBalance,
          timestamp: Date.now(),
        });
      }

      case 'close_position': {
        const marketId = body.marketId as string;
        const exitPrice = (body.exitPrice as number) ?? 0.5;

        if (!marketId) {
          return NextResponse.json({ status: 'error', error: 'Missing marketId' }, { status: 400 });
        }

        const position = wallet.allPositions.find(p => p.marketId === marketId);
        if (!position) {
          return NextResponse.json(
            { status: 'error', error: 'Position not found' },
            { status: 404 },
          );
        }

        const pnl = closePosition(wallet, position, exitPrice);
        await persistWallet();

        return NextResponse.json({
          status: 'ok',
          pnl,
          walletBalance: wallet.totalBalance,
          timestamp: Date.now(),
        });
      }

      case 'force_scan': {
        const divisionStr = body.division as string | undefined;
        const limit = (body.limit as number) ?? 15;

        if (divisionStr && !Object.values(PolyDivision).includes(divisionStr as PolyDivision)) {
          return NextResponse.json(
            { status: 'error', error: 'Invalid division' },
            { status: 400 },
          );
        }

        if (divisionStr) {
          const division = divisionStr as PolyDivision;
          const result = await scanDivision(division, limit);
          const scans = { ...getLastScans(), [division]: result };
          setLastScans(scans);
          return NextResponse.json({
            status: 'ok',
            scan: result,
            timestamp: Date.now(),
          });
        }

        // Scan all divisions
        const allDivisions = Object.values(PolyDivision);
        const results = await Promise.allSettled(allDivisions.map(d => scanDivision(d, limit)));
        const scans = getLastScans();
        for (const r of results) {
          if (r.status === 'fulfilled') {
            scans[r.value.division] = r.value;
          }
        }
        setLastScans(scans);

        return NextResponse.json({
          status: 'ok',
          divisionsScanned: results.filter(r => r.status === 'fulfilled').length,
          timestamp: Date.now(),
        });
      }

      case 'analyze_market': {
        const marketId = body.marketId as string;
        const divisionStr = body.division as string;

        if (!marketId || !divisionStr || !Object.values(PolyDivision).includes(divisionStr as PolyDivision)) {
          return NextResponse.json(
            { status: 'error', error: 'Missing or invalid marketId, division' },
            { status: 400 },
          );
        }

        const division = divisionStr as PolyDivision;
        const market = await getMarket(marketId);
        if (!market) {
          return NextResponse.json({ status: 'error', error: 'Market not found' }, { status: 404 });
        }

        const analysis = await analyzeMarket(market, division);

        return NextResponse.json({
          status: 'ok',
          analysis,
          timestamp: Date.now(),
        });
      }

      case 'reset_wallet': {
        // Reset wallet to initial state ($1000 per division)
        for (const [division, divBalance] of wallet.divisionBalances.entries()) {
          divBalance.balance = 1000;
          divBalance.investedCapital = 0;
          divBalance.realizedPnL = 0;
          divBalance.unrealizedPnL = 0;
          divBalance.positions = [];
          divBalance.peakBalance = 1000;
        }

        wallet.totalBalance = 1000 * Object.keys(PolyDivision).length;
        wallet.totalInvested = 0;
        wallet.totalRealizedPnL = 0;
        wallet.allPositions = [];

        await persistWallet();

        return NextResponse.json({
          status: 'ok',
          wallet: getWalletSummary(wallet),
          message: 'Wallet reset to initial state',
          timestamp: Date.now(),
        });
      }

      default:
        return NextResponse.json(
          { status: 'error', error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (err) {
    log.error('POST handler error', { error: String(err) });
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 },
    );
  }
}
