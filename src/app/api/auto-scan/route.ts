// ============================================================
// GET /api/auto-scan — auto-scan status
// POST /api/auto-scan — start/stop/trigger manual scan
// ============================================================
import { NextResponse } from 'next/server';
import {
  startAutoScan,
  stopAutoScan,
  getAutoScanStatus,
  triggerManualScan,
} from '@/lib/engine/autoScan';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = getAutoScanStatus();
    return NextResponse.json({ status: 'ok', autoScan: status });
  } catch (err) {
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    switch (body.action) {
      case 'start': {
        const result = startAutoScan();
        return NextResponse.json({ status: 'ok', ...result });
      }
      case 'stop': {
        const result = stopAutoScan();
        return NextResponse.json({ status: 'ok', ...result });
      }
      case 'scan': {
        const result = await triggerManualScan();
        return NextResponse.json({ status: 'ok', ...result });
      }
      default:
        return NextResponse.json(
          { status: 'error', error: `Unknown action: ${body.action}. Use: start, stop, scan` },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 }
    );
  }
}
