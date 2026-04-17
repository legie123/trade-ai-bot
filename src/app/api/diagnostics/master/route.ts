// GET /api/diagnostics/master — Omega-Route Master Diagnostics
import { createLogger } from '@/lib/core/logger';
import { successResponse } from '@/lib/api-response';

const log = createLogger('DiagnosticsMaster');

export const dynamic = 'force-dynamic';

export async function GET() {
  const startTime = Date.now();
  const report: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    version: 'Omega-Critical V1',
    status: 'RUNNING',
  };

  // ─── 1. MEXC Connectivity Test ───
  try {
    const { getMexcServerTime, getMexcBalances } = await import('@/lib/exchange/mexcClient');
    const { isPaperMode } = await import('@/lib/core/tradingMode');
    const mexcStart = Date.now();
    const serverTime = await getMexcServerTime();
    const mexcLatency = Date.now() - mexcStart;

    // In PAPER mode, only test public endpoints (prices). Private endpoints (balances) need valid API keys + IP whitelist.
    let usdtBalance = 0;
    let totalAssets = 0;
    let balanceNote: string | undefined;

    if (isPaperMode()) {
      balanceNote = 'PAPER mode — private endpoints skipped (not needed)';
    } else {
      try {
        const balances = await getMexcBalances();
        usdtBalance = balances.find(b => b.asset === 'USDT')?.free || 0;
        totalAssets = balances.length;
      } catch (balErr) {
        // In LIVE mode, balance failure is still just a warning, not a full MEXC failure
        balanceNote = `Balance check failed: ${(balErr as Error).message}`;
      }
    }

    report.mexc = {
      status: 'OK',
      latencyMs: mexcLatency,
      serverTime,
      clockDriftMs: Math.abs(Date.now() - serverTime),
      usdtBalance: parseFloat(usdtBalance.toFixed(2)),
      totalAssets,
      healthGrade: mexcLatency < 500 ? 'A' : mexcLatency < 1500 ? 'B' : 'C',
      ...(balanceNote ? { note: balanceNote } : {}),
    };
  } catch (err) {
    report.mexc = { status: 'ERROR', error: (err as Error).message };
  }

  // ─── 2. Supabase Consistency Check ───
  try {
    const { supabase } = await import('@/lib/store/db');
    const supaStart = Date.now();
    
    // Write test
    const testKey = `diag_test_${Date.now()}`;
    const { error: writeErr } = await supabase.from('json_store').upsert({ id: testKey, data: { test: true, ts: Date.now() } });
    const writeLatency = Date.now() - supaStart;
    
    // Read test
    const readStart = Date.now();
    const { data, error: readErr } = await supabase.from('json_store').select('*').eq('id', testKey).single();
    const readLatency = Date.now() - readStart;
    
    // Cleanup
    await supabase.from('json_store').delete().eq('id', testKey);
    
    const consistent = !writeErr && !readErr && data?.data?.test === true;

    report.supabase = {
      status: consistent ? 'OK' : 'DEGRADED',
      writeLatencyMs: writeLatency,
      readLatencyMs: readLatency,
      roundtripMs: writeLatency + readLatency,
      consistent,
      writeError: writeErr?.message || null,
      readError: readErr?.message || null,
      healthGrade: (writeLatency + readLatency) < 300 ? 'A' : (writeLatency + readLatency) < 800 ? 'B' : 'C',
    };
  } catch (err) {
    report.supabase = { status: 'ERROR', error: (err as Error).message };
  }

  // ─── 3. Equity Curve Snapshot ───
  try {
    const { getEquityCurve, getDecisions, getBotConfig } = await import('@/lib/store/db');
    const config = getBotConfig();
    const curve = getEquityCurve();
    const decisions = getDecisions();
    
    const totalTrades = decisions.filter(d => d.outcome !== 'PENDING').length;
    const wins = decisions.filter(d => d.outcome === 'WIN').length;
    const losses = decisions.filter(d => d.outcome === 'LOSS').length;
    const pending = decisions.filter(d => d.outcome === 'PENDING').length;
    
    // Equity peak and current
    let peak = config.paperBalance;
    let currentBalance = config.paperBalance;
    let maxDD = 0;
    
    for (const point of curve) {
      if (point.balance > peak) peak = point.balance;
      currentBalance = point.balance;
      const dd = peak > 0 ? (peak - point.balance) / peak : 0;
      if (dd > maxDD) maxDD = dd;
    }

    // Win rate
    const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;

    // Last 20 trades projection
    const recent20 = decisions.filter(d => d.outcome !== 'PENDING').slice(0, 20);
    const avgPnl = recent20.length > 0 
      ? recent20.reduce((sum, d) => sum + (d.pnlPercent || 0), 0) / recent20.length 
      : 0;

    report.equity = {
      startingBalance: config.paperBalance,
      currentBalance: parseFloat(currentBalance.toFixed(2)),
      peakBalance: parseFloat(peak.toFixed(2)),
      maxDrawdownPercent: parseFloat((maxDD * 100).toFixed(2)),
      totalTrades,
      wins,
      losses,
      pending,
      winRatePercent: parseFloat(winRate.toFixed(1)),
      avgPnlLast20: parseFloat(avgPnl.toFixed(2)),
      projectedNext20Pnl: parseFloat((avgPnl * 20).toFixed(2)),
      mode: config.mode,
      haltedUntil: config.haltedUntil,
      aiStatus: config.aiStatus,
    };
  } catch (err) {
    report.equity = { status: 'ERROR', error: (err as Error).message };
  }

  // ─── 4. Sentinel Risk Metrics ───
  try {
    const { SentinelGuard } = await import('@/lib/v2/safety/sentinelGuard');
    const sentinel = SentinelGuard.getInstance();
    report.sentinel = sentinel.getRiskMetrics();
  } catch (err) {
    report.sentinel = { status: 'ERROR', error: (err as Error).message };
  }

  // ─── 5. Live Positions Summary ───
  try {
    const { getLivePositions } = await import('@/lib/store/db');
    const positions = getLivePositions();
    const open = positions.filter(p => p.status === 'OPEN');
    
    report.positions = {
      total: positions.length,
      open: open.length,
      closed: positions.filter(p => p.status === 'CLOSED').length,
      openDetails: open.map(p => ({
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        quantity: p.quantity,
        partialTPHit: p.partialTPHit,
        highestObserved: p.highestPriceObserved,
        openedAt: p.openedAt,
      })),
    };
  } catch (err) {
    report.positions = { status: 'ERROR', error: (err as Error).message };
  }

  // ─── 6. System Health ───
  const totalDiagTime = Date.now() - startTime;
  report.system = {
    diagnosticDurationMs: totalDiagTime,
    nodeVersion: process.version,
    memoryUsageMB: {
      rss: parseFloat((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
      heapUsed: parseFloat((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)),
      heapTotal: parseFloat((process.memoryUsage().heapTotal / 1024 / 1024).toFixed(1)),
    },
    uptimeSeconds: Math.round(process.uptime()),
  };

  // Overall health grade
  const mexcOk = (report.mexc as Record<string, unknown>)?.status === 'OK';
  const supaOk = (report.supabase as Record<string, unknown>)?.status === 'OK';
  report.overallHealth = mexcOk && supaOk ? 'HEALTHY' : (!mexcOk && !supaOk ? 'CRITICAL' : 'DEGRADED');

  log.info(`[Diagnostics] Master report generated in ${totalDiagTime}ms — Status: ${report.overallHealth}`);

  return successResponse(report);
}
