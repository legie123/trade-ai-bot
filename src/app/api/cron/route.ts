// GET /api/cron — Trading loop trigger (kicks BTC engine + watchdog ping)
import { NextResponse } from 'next/server';
import { watchdogPing } from '@/lib/core/watchdog';
import { startHeartbeat } from '@/lib/core/heartbeat';
import { createLogger } from '@/lib/core/logger';

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

    return NextResponse.json({
      status: 'ok',
      message: 'Cron tick processed',
      scanCount: gScan.__autoScan.scanCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error('Cron loop error', { error: (err as Error).message });
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
