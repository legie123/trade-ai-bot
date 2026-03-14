// GET /api/health — comprehensive system health check
import { NextResponse } from 'next/server';
import { getAllProviderHealth } from '@/lib/providers/providerManager';
import { getDecisions } from '@/lib/store/db';
import { testConnection } from '@/lib/exchange/binanceClient';
import { getExecutionLog } from '@/lib/engine/executor';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const providers = await getAllProviderHealth();
    const allHealthy = providers.every((p) => p.status === 'healthy');
    const decisions = getDecisions();
    const execLog = getExecutionLog();

    // Binance status
    let binanceOk = false;
    let binanceMode = 'UNKNOWN';
    try {
      const conn = await testConnection();
      binanceOk = conn.ok;
      binanceMode = conn.mode;
    } catch { /* */ }

    // System metrics
    const uptime = process.uptime();
    const mem = process.memoryUsage();
    const pending = decisions.filter(d => d.outcome === 'PENDING').length;
    const today = new Date().toISOString().slice(0, 10);
    const todayDecisions = decisions.filter(d => d.timestamp.startsWith(today)).length;
    const executedToday = execLog.filter(r => r.executed).length;

    return NextResponse.json({
      status: allHealthy && binanceOk ? 'healthy' : 'degraded',
      version: '5.0.0',
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      autoTrading: process.env.AUTO_TRADE_ENABLED === 'true',
      binance: { ok: binanceOk, mode: binanceMode },
      telegram: { configured: !!process.env.TELEGRAM_BOT_TOKEN },
      decisions: { total: decisions.length, pending, today: todayDecisions },
      execution: { totalOrders: execLog.filter(r => r.executed).length, todayOrders: executedToday, errors: execLog.filter(r => r.error).length },
      memory: { rss: `${Math.round(mem.rss / 1048576)}MB`, heap: `${Math.round(mem.heapUsed / 1048576)}MB` },
      providers,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
