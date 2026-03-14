// GET /api/telegram — test connection
// POST /api/telegram — send alert or configure
import { NextResponse } from 'next/server';
import { testTelegram, sendAlert, sendMessage, sendDailySummary } from '@/lib/alerts/telegram';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await testTelegram();
    return NextResponse.json({ status: 'ok', ...result });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    switch (body.action) {
      case 'test':
        return NextResponse.json({ status: 'ok', sent: await sendMessage('🤖 Trading AI Bot connected!') });
      case 'alert':
        return NextResponse.json({ status: 'ok', sent: await sendAlert(body.alert) });
      case 'summary':
        return NextResponse.json({ status: 'ok', sent: await sendDailySummary(body.stats) });
      default:
        return NextResponse.json({ status: 'error', error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
