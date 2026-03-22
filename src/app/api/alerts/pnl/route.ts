// GET /api/alerts/pnl — run PnL alert checks
// POST /api/alerts/pnl — send daily report manually
import { NextResponse } from 'next/server';
import { runPnlAlertChecks, sendDailyReport } from '@/lib/alerts/pnlAlerts';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await runPnlAlertChecks();
    return NextResponse.json({ status: 'ok', ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST() {
  try {
    await sendDailyReport();
    return NextResponse.json({ status: 'sent', message: 'Daily report sent to Telegram' });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
