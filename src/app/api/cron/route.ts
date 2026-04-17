// GET /api/cron — Trading loop trigger (kicks BTC engine + watchdog ping)
import { NextRequest, NextResponse } from 'next/server';
import { watchdogPing } from '@/lib/core/watchdog';
import { startHeartbeat } from '@/lib/core/heartbeat';
import { createLogger } from '@/lib/core/logger';
import { ArenaSimulator } from '@/lib/v2/arena/simulator';
import { DNAExtractor } from '@/lib/v2/superai/dnaExtractor';
import { initDB } from '@/lib/store/db';

const log = createLogger('CronLoop');

export const dynamic = 'force-dynamic';

let loopStarted = false;

export async function GET(request: NextRequest) {
  // Auth: require CRON_SECRET header (Railway/Vercel cron must send it)
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET env var not set — blocking all cron requests');
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const auth = request.headers.get('authorization') || request.headers.get('x-cron-secret') || request.nextUrl.searchParams.get('secret');
  if (auth !== cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized. Set x-cron-secret header.' }, { status: 401 });
  }
  try {
    // CRITICAL: Load Supabase cache (gladiators, decisions, etc.) before anything runs
    await initDB();

    // Ensure heartbeat is running
    if (!loopStarted) {
      startHeartbeat();
      loopStarted = true;
      log.info('Cron loop initialized — heartbeat started');
    }

    // Ping watchdog to keep it alive
    watchdogPing();

    // Mark scan loop as active via globalThis
    const gScan = globalThis as unknown as {
      __autoScan?: { running: boolean; lastScanAt: string | null; scanCount: number };
    };
    if (!gScan.__autoScan) {
      gScan.__autoScan = { running: false, lastScanAt: null, scanCount: 0 };
    }
    gScan.__autoScan.running = true;
    gScan.__autoScan.lastScanAt = new Date().toISOString();
    gScan.__autoScan.scanCount++;
    const scanStart = Date.now();

    // Evaluate Phantom Trades for the Arena Combat Engine
    await ArenaSimulator.getInstance().evaluatePhantomTrades();

    // Evaluate Live Positions (Asymmetric TP/SL Engine — supplements Cloud Scheduler)
    const { positionManager } = await import('@/lib/v2/manager/positionManager');
    await positionManager.evaluateLivePositions();

    // SRE Auto-Debug Diagnostics Check (Continuous ML Evaluation)
    try {
      const { autoDebugEngine } = await import('@/lib/v2/safety/autoDebugEngine');
      autoDebugEngine.runDeterministicDiagnostics().catch((e) => log.warn('autoDebug diagnostics failed', { error: String(e) }));
    } catch (e) {
      log.error('Failed to trigger AutoDebugEngine', { error: String(e) });
    }

    // Trigger Market Scanners (so the AI trades even when the user's browser is closed)
    try {
      // Fire directly using V8 internal JS context instead of looping back via Cloud Run HTTP
      const { GET: runBtc } = await import('@/app/api/btc-signals/route');
      const { GET: runSolana } = await import('@/app/api/solana-signals/route');
      const { GET: runMeme } = await import('@/app/api/meme-signals/route');
      
      runBtc().catch(() => null);
      runSolana().catch(() => null);
      runMeme().catch(() => null);
      log.info(`[Market Scanners] Background TA & Meme sweep triggered via direct function calls`);
    } catch (e) {
      log.error('Failed to trigger background scanners', { error: String(e) });
    }

    // Evaluate Real/Shadow Main System Decisions
    const { getPendingDecisions, updateDecision, recalculatePerformance, appendToEquityCurve, getLivePositions, updateLivePosition } = await import('@/lib/store/db');
    const { getMexcPrices } = await import('@/lib/exchange/mexcClient');
    
    const pending = getPendingDecisions();
    let mainDecisionsEvaluated = 0;

    // Batch: fetch unique symbols once instead of per-decision
    const eligibleDecisions = pending.filter(dec => {
      const elapsedMin = (Date.now() - new Date(dec.timestamp).getTime()) / 60000;
      return elapsedMin > 10;
    });

    const uniqueSymbols = [...new Set(eligibleDecisions.map(d => d.symbol))];

    // Fetch all unique prices in parallel for decisions and live positions
    const livePos = getLivePositions().filter(p => p.status === 'OPEN');
    const liveSymbols = livePos.map(p => p.symbol);
    const allSymbols = [...new Set([...uniqueSymbols, ...liveSymbols])];

    // OMEGA OPTIMIZATION: Use Batch Price fetcher. One request, no rate-limit delay.
    const priceCache = await getMexcPrices(allSymbols);

    for (const dec of eligibleDecisions) {
      const currentPrice = priceCache[dec.symbol];
      if (!currentPrice || !dec.price) continue;
      
      const pnlDiff = (currentPrice - dec.price) / dec.price;
      const pnlPercent = (dec.action === 'LONG' || dec.action === 'BUY') ? pnlDiff * 100 : -pnlDiff * 100;
      
      // BUG FIX: Previous threshold was 0.05% — any micro-movement was a WIN.
      // In crypto, 0.05% moves in seconds → inflated win rates to ~80%+.
      // 0.3% is the minimum meaningful edge after fees (~0.1% MEXC taker).
      const WIN_THRESHOLD = 0.3;
      const outcome = pnlPercent > WIN_THRESHOLD ? 'WIN' : (pnlPercent < -WIN_THRESHOLD ? 'LOSS' : 'NEUTRAL');

      updateDecision(dec.id, {
         priceAfter15m: currentPrice,
         pnlPercent: parseFloat(pnlPercent.toFixed(4)),
         outcome,
         evaluatedAt: new Date().toISOString()
      });

      appendToEquityCurve({ ...dec, outcome }, pnlPercent);

      // DNA LEARNING: Inject pure Shadow mode experience into RL engine
      // Only log if the decision source belongs to a shadow gladiator (V2 Shadow)
      if (dec.source.includes('Shadow')) {
        const gladiatorIdMatch = dec.source.match(/\((.*?)\)/);
        const elapsedMin = (Date.now() - new Date(dec.timestamp).getTime()) / 60000;
        if (gladiatorIdMatch && gladiatorIdMatch[1]) {
          try {
            await DNAExtractor.getInstance().logBattle({
              id: `shadow_${dec.id}`,
              gladiatorId: gladiatorIdMatch[1],
              symbol: dec.symbol,
              decision: dec.action as 'LONG' | 'SHORT' | 'FLAT',
              entryPrice: dec.price,
              outcomePrice: currentPrice,
              pnlPercent: parseFloat(pnlPercent.toFixed(4)),
              isWin: outcome === 'WIN',
              timestamp: Date.now(),
              marketContext: { exitType: 'SHADOW_TIME_BASED', holdTimeSec: elapsedMin * 60 }
            });
          } catch (err) {
             log.error(`Failed to inject shadow DNA for ${dec.id}`, { error: String(err) });
          }
        }
      }

      mainDecisionsEvaluated++;
    }

    // Update Floating PnL for live positions
    let livePositionsUpdated = 0;
    for (const pos of livePos) {
      if (priceCache[pos.symbol]) {
        updateLivePosition(pos.id, { 
          currentPrice: priceCache[pos.symbol],
          highestPriceObserved: Math.max(pos.highestPriceObserved, priceCache[pos.symbol]),
          lowestPriceObserved: Math.min(pos.lowestPriceObserved, priceCache[pos.symbol])
        });
        livePositionsUpdated++;
      }
    }

    if (mainDecisionsEvaluated > 0) {
      recalculatePerformance();
      log.info(`[Trade AI] Resolved ${mainDecisionsEvaluated} main real/paper decisions. PnL recalibrated.`);
    }

    // Extract behaviors to The Forge (Omega Gladiator)
    const { extractWinningBehaviors } = await import('@/lib/v2/forge/dnaExtractor');
    const forgeStats = extractWinningBehaviors();

    // Mark scan as complete so heartbeat doesn't report RED
    gScan.__autoScan.running = false;

    return NextResponse.json({
      status: 'ok',
      message: 'Cron tick processed',
      scanCount: gScan.__autoScan.scanCount,
      durationMs: Date.now() - scanStart,
      mainDecisionsEvaluated,
      livePositionsUpdated,
      pricesFetched: Object.keys(priceCache).length,
      forgeProgress: forgeStats.progressPercent,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // Always reset running flag, even on error
    const gScanErr = globalThis as unknown as {
      __autoScan?: { running: boolean };
    };
    if (gScanErr.__autoScan) gScanErr.__autoScan.running = false;
    log.error('Cron loop error', { error: (err as Error).message });
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}

