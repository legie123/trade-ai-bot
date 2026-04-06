// GET /api/cron — Trading loop trigger (kicks BTC engine + watchdog ping)
import { NextResponse } from 'next/server';
import { watchdogPing } from '@/lib/core/watchdog';
import { startHeartbeat } from '@/lib/core/heartbeat';
import { createLogger } from '@/lib/core/logger';
import { ArenaSimulator } from '@/lib/v2/arena/simulator';

const log = createLogger('CronLoop');

export const dynamic = 'force-dynamic';

let loopStarted = false;

export async function GET() {
  try {
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
      gScan.__autoScan = { running: true, lastScanAt: new Date().toISOString(), scanCount: 0 };
    }
    gScan.__autoScan.running = true;
    gScan.__autoScan.lastScanAt = new Date().toISOString();
    gScan.__autoScan.scanCount++;

    // Evaluate Phantom Trades for the Arena Combat Engine
    await ArenaSimulator.getInstance().evaluatePhantomTrades();

    // Evaluate Live Positions (Asymmetric TP/SL Engine)
    const { PositionManager } = await import('@/lib/v2/manager/positionManager');
    await PositionManager.getInstance().evaluateLivePositions();

    // Evaluate Real/Shadow Main System Decisions
    const { getPendingDecisions, updateDecision, recalculatePerformance } = await import('@/lib/store/db');
    const { getMexcPrice } = await import('@/lib/exchange/mexcClient');
    
    const pending = getPendingDecisions();
    let mainDecisionsEvaluated = 0;

    // Batch: fetch unique symbols once instead of per-decision
    const eligibleDecisions = pending.filter(dec => {
      const elapsedMin = (Date.now() - new Date(dec.timestamp).getTime()) / 60000;
      return elapsedMin > 10;
    });

    const uniqueSymbols = [...new Set(eligibleDecisions.map(d => d.symbol))];
    const priceCache: Record<string, number> = {};

    // Fetch all unique prices in parallel
    await Promise.all(
      uniqueSymbols.map(async (sym) => {
        try {
          const price = await getMexcPrice(sym);
          if (price > 0) priceCache[sym] = price;
        } catch {
          log.warn(`Could not fetch price for ${sym}`);
        }
      })
    );

    for (const dec of eligibleDecisions) {
      const currentPrice = priceCache[dec.symbol];
      if (!currentPrice || !dec.price) continue;
      
      const pnlDiff = (currentPrice - dec.price) / dec.price;
      const pnlPercent = (dec.action === 'LONG' || dec.action === 'BUY') ? pnlDiff * 100 : -pnlDiff * 100;
      const outcome = pnlPercent > 0.05 ? 'WIN' : (pnlPercent < -0.05 ? 'LOSS' : 'NEUTRAL');

      updateDecision(dec.id, {
         priceAfter15m: currentPrice,
         pnlPercent: parseFloat(pnlPercent.toFixed(2)),
         outcome,
         evaluatedAt: new Date().toISOString()
      });

      mainDecisionsEvaluated++;
    }

    if (mainDecisionsEvaluated > 0) {
      recalculatePerformance();
      log.info(`[Trade AI] Resolved ${mainDecisionsEvaluated} main real/paper decisions. PnL recalibrated.`);
    }

    return NextResponse.json({
      status: 'ok',
      message: 'Cron tick processed',
      scanCount: gScan.__autoScan.scanCount,
      mainDecisionsEvaluated,
      pricesFetched: Object.keys(priceCache).length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error('Cron loop error', { error: (err as Error).message });
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}

