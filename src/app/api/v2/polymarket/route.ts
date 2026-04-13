// GET /api/v2/polymarket — Polymarket sector status, scanner, wallet
import { NextResponse } from 'next/server';
import { PolyDivision } from '@/lib/polymarket/polyTypes';
import { testPolymarketConnection, getMarketsByCategory } from '@/lib/polymarket/polyClient';
import { scanDivision } from '@/lib/polymarket/marketScanner';
import {
  createPolyWallet,
  getWalletSummary,
  type PolyWallet,
  type PolyPosition,
  type DivisionBalance,
} from '@/lib/polymarket/polyWallet';
import { spawnPolyGladiator, getPolyLeaderboard, type PolyGladiator } from '@/lib/polymarket/polyGladiators';
import {
  loadPolyStateFromCloud,
  savePolyWalletToCloud,
  savePolyGladiatorsToCloud,
  initDB,
} from '@/lib/store/db';

export const dynamic = 'force-dynamic';

let polyWallet: PolyWallet = createPolyWallet();
let polyGladiators: PolyGladiator[] = [];
let lastScanResults: Record<string, unknown> = {};
let initialized = false;
let initPromise: Promise<void> | null = null;

// ── Serialize Map → plain object for Supabase ──
function serializeWallet(w: PolyWallet): Record<string, unknown> {
  return {
    id: w.id,
    createdAt: w.createdAt,
    totalBalance: w.totalBalance,
    totalInvested: w.totalInvested,
    totalRealizedPnL: w.totalRealizedPnL,
    allPositions: w.allPositions,
    divisionBalances: Object.fromEntries(w.divisionBalances),
  };
}

// ── Deserialize plain object → PolyWallet with Map ──
function deserializeWallet(data: Record<string, unknown>): PolyWallet {
  const wallet = createPolyWallet();
  wallet.id = data.id as string;
  wallet.createdAt = data.createdAt as string;
  wallet.totalBalance = (data.totalBalance as number) ?? wallet.totalBalance;
  wallet.totalInvested = (data.totalInvested as number) ?? 0;
  wallet.totalRealizedPnL = (data.totalRealizedPnL as number) ?? 0;
  wallet.allPositions = (data.allPositions as PolyPosition[]) ?? [];

  const divBalances = data.divisionBalances as Record<string, DivisionBalance> | null;
  if (divBalances) {
    for (const [div, balance] of Object.entries(divBalances)) {
      wallet.divisionBalances.set(div as PolyDivision, balance);
    }
  }
  return wallet;
}

async function initPolyState(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Ensure Supabase is ready
  await initDB();

  // Load persisted state
  const { wallet: savedWallet, gladiators: savedGladiators } = await loadPolyStateFromCloud();

  if (savedWallet) {
    try {
      polyWallet = deserializeWallet(savedWallet);
    } catch {
      polyWallet = createPolyWallet();
    }
  }

  if (savedGladiators && Array.isArray(savedGladiators) && savedGladiators.length > 0) {
    polyGladiators = savedGladiators as PolyGladiator[];
  } else {
    // Spawn 1 gladiator per division on first boot
    const divisions = Object.values(PolyDivision);
    for (const division of divisions) {
      const g = spawnPolyGladiator(division, `${division} Analysis`);
      polyGladiators.push(g);
    }
    savePolyGladiatorsToCloud(polyGladiators);
  }

  if (!savedWallet) {
    savePolyWalletToCloud(serializeWallet(polyWallet));
  }
}

function ensureInitialized(): void {
  if (!initPromise) {
    initPromise = initPolyState().catch(() => { /* non-fatal */ });
  }
}

export async function GET(request: Request) {
  try {
    ensureInitialized();
    // Wait for init on first request
    if (initPromise) await initPromise;

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'status';
    const division = searchParams.get('division') as PolyDivision | null;

    switch (action) {
      case 'scan': {
        if (division && Object.values(PolyDivision).includes(division)) {
          const result = await scanDivision(division, 15);
          lastScanResults[division] = result;
          return NextResponse.json({ status: 'ok', scan: result, timestamp: Date.now() });
        }
        const quickDivisions = [PolyDivision.TRENDING, PolyDivision.CRYPTO, PolyDivision.POLITICS];
        const scans = await Promise.allSettled(quickDivisions.map(d => scanDivision(d, 10)));
        const results = scans
          .filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof scanDivision>>> => s.status === 'fulfilled')
          .map(s => s.value);
        for (const r of results) {
          lastScanResults[r.division] = r;
        }
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
        const summary = getWalletSummary(polyWallet);
        return NextResponse.json({ status: 'ok', wallet: summary, timestamp: Date.now() });
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
          persistence: 'supabase',
          divisions: Object.values(PolyDivision).length,
          gladiators: polyGladiators.length,
          timestamp: Date.now(),
        });
      }

      default: {
        const conn = await testPolymarketConnection();
        const walletSummary = getWalletSummary(polyWallet);
        const leaderboard = getPolyLeaderboard(polyGladiators);

        return NextResponse.json({
          status: 'ok',
          sector: 'POLYMARKET',
          version: '1.1.0',
          persistence: 'supabase',
          connection: { clob: conn.clob, gamma: conn.gamma },
          divisions: Object.values(PolyDivision).length,
          divisionList: Object.values(PolyDivision),
          gladiators: {
            total: polyGladiators.length,
            live: polyGladiators.filter(g => g.isLive).length,
            training: polyGladiators.filter(g => g.status === 'IN_TRAINING').length,
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
