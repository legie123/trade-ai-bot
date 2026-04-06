// POST /api/v2/dry-run — Mock Execution Test (Full Pipeline, Zero Risk)
import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('DryRun');

export const dynamic = 'force-dynamic';

interface StageReport {
  stage: string;
  status: 'OK' | 'ERROR' | 'SKIPPED';
  durationMs: number;
  details: Record<string, unknown>;
}

export async function POST() {
  const startTime = Date.now();
  const stages: StageReport[] = [];

  const symbol = 'BTCUSDT';
  let realPrice = 0;

  // ─── STAGE 1: Get Real MEXC Price ───
  try {
    const stageStart = Date.now();
    const { getMexcPrice } = await import('@/lib/exchange/mexcClient');
    realPrice = await getMexcPrice(symbol);
    
    stages.push({
      stage: '1_MEXC_PRICE',
      status: realPrice > 0 ? 'OK' : 'ERROR',
      durationMs: Date.now() - stageStart,
      details: { symbol, price: realPrice },
    });
  } catch (err) {
    stages.push({
      stage: '1_MEXC_PRICE',
      status: 'ERROR',
      durationMs: Date.now() - startTime,
      details: { error: (err as Error).message },
    });
    // Can't continue without price
    return NextResponse.json({ status: 'FAILED', stages, totalMs: Date.now() - startTime });
  }

  // ─── STAGE 2: AlphaScout Intelligence ───
  let alphaContext = '';
  try {
    const stageStart = Date.now();
    const { AlphaScout } = await import('@/lib/v2/intelligence/alphaScout');
    const scout = AlphaScout.getInstance();
    alphaContext = await scout.analyzeToken(symbol);
    
    stages.push({
      stage: '2_ALPHA_SCOUT',
      status: 'OK',
      durationMs: Date.now() - stageStart,
      details: { contextLength: alphaContext.length, preview: alphaContext.substring(0, 200) },
    });
  } catch (err) {
    stages.push({
      stage: '2_ALPHA_SCOUT',
      status: 'ERROR',
      durationMs: Date.now() - startTime,
      details: { error: (err as Error).message },
    });
    alphaContext = 'Alpha Scout offline — proceeding with raw data.';
  }

  // ─── STAGE 3: DualMaster AI Consensus ───
  let consensus = null;
  try {
    const stageStart = Date.now();
    const { DualMasterConsciousness } = await import('@/lib/v2/master/dualMaster');
    const syndicate = new DualMasterConsciousness();
    
    const marketData = {
      symbol,
      price: realPrice,
      signal: 'BUY',
      alphaContext,
      source: 'DRY_RUN_TEST',
      timestamp: new Date().toISOString(),
    };

    consensus = await syndicate.getConsensus(marketData, {});
    
    stages.push({
      stage: '3_DUAL_MASTER_CONSENSUS',
      status: 'OK',
      durationMs: Date.now() - stageStart,
      details: {
        finalDirection: consensus.finalDirection,
        weightedConfidence: (consensus.weightedConfidence * 100).toFixed(2) + '%',
        architectDirection: consensus.opinions[0]?.direction,
        architectConfidence: consensus.opinions[0]?.confidence,
        oracleDirection: consensus.opinions[1]?.direction,
        oracleConfidence: consensus.opinions[1]?.confidence,
        architectReasoning: consensus.opinions[0]?.reasoning?.substring(0, 150),
        oracleReasoning: consensus.opinions[1]?.reasoning?.substring(0, 150),
      },
    });
  } catch (err) {
    stages.push({
      stage: '3_DUAL_MASTER_CONSENSUS',
      status: 'ERROR',
      durationMs: Date.now() - startTime,
      details: { error: (err as Error).message },
    });
  }

  // ─── STAGE 4: Sentinel Guard Check ───
  let sentinelResult: { safe: boolean; reason?: string } = { safe: false, reason: 'Consensus unavailable' };
  try {
    const stageStart = Date.now();
    
    if (consensus) {
      const { SentinelGuard } = await import('@/lib/v2/safety/sentinelGuard');
      const sentinel = SentinelGuard.getInstance();
      
      const testSignal = {
        id: `dryrun_${Date.now()}`,
        symbol,
        signal: 'BUY' as const,
        price: realPrice,
        timestamp: new Date().toISOString(),
        source: 'DRY_RUN',
        timeframe: '15m',
      };

      sentinelResult = await sentinel.check(testSignal, consensus);

      stages.push({
        stage: '4_SENTINEL_GUARD',
        status: 'OK',
        durationMs: Date.now() - stageStart,
        details: {
          approved: sentinelResult.safe,
          reason: sentinelResult.reason || 'All checks passed',
          riskMetrics: sentinel.getRiskMetrics(),
        },
      });
    } else {
      stages.push({
        stage: '4_SENTINEL_GUARD',
        status: 'SKIPPED',
        durationMs: 0,
        details: { reason: 'No consensus to validate' },
      });
    }
  } catch (err) {
    stages.push({
      stage: '4_SENTINEL_GUARD',
      status: 'ERROR',
      durationMs: Date.now() - startTime,
      details: { error: (err as Error).message },
    });
  }

  // ─── STAGE 5: Execution Simulation (DRY RUN — no real order) ───
  try {
    const stageStart = Date.now();
    
    if (consensus && sentinelResult.safe) {
      const { executeMexcTrade } = await import('@/lib/v2/scouts/executionMexc');
      const side = consensus.finalDirection === 'LONG' ? 'BUY' as const : 'SELL' as const;
      
      // DRY RUN flag prevents actual order placement
      const result = await executeMexcTrade(symbol, side, undefined, true);
      
      stages.push({
        stage: '5_EXECUTION_SIMULATION',
        status: 'OK',
        durationMs: Date.now() - stageStart,
        details: {
          dryRun: true,
          wouldExecute: result.executed,
          symbol: result.symbol,
          side: result.side,
          price: result.price,
          quantity: result.quantity,
          usdAmount: result.usdAmount,
          error: result.error || null,
        },
      });
    } else {
      stages.push({
        stage: '5_EXECUTION_SIMULATION',
        status: 'SKIPPED',
        durationMs: 0,
        details: { 
          reason: !consensus ? 'No consensus' : `Sentinel blocked: ${sentinelResult.reason}`,
          dryRun: true,
        },
      });
    }
  } catch (err) {
    stages.push({
      stage: '5_EXECUTION_SIMULATION',
      status: 'ERROR',
      durationMs: Date.now() - startTime,
      details: { error: (err as Error).message, dryRun: true },
    });
  }

  const totalMs = Date.now() - startTime;
  const allOk = stages.every(s => s.status === 'OK' || s.status === 'SKIPPED');

  log.info(`[DryRun] Complete in ${totalMs}ms — ${stages.filter(s => s.status === 'OK').length}/${stages.length} stages OK`);

  return NextResponse.json({
    status: allOk ? 'DRY_RUN_COMPLETE' : 'DRY_RUN_PARTIAL',
    totalDurationMs: totalMs,
    stagesPassed: stages.filter(s => s.status === 'OK').length,
    stagesTotal: stages.length,
    stages,
    timestamp: new Date().toISOString(),
  });
}
