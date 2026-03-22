// GET /api/copy-trading — whale activity + copy signals
import { NextResponse } from 'next/server';
import { getCopyTradingData } from '@/lib/engine/copyTrader';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getCopyTradingData();
    return NextResponse.json({ status: 'ok', ...data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
