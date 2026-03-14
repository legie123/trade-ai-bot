// GET /api/signals — unified ranked signal stream
import { NextResponse } from 'next/server';
import { getAggregatedSignals, getAggregatorStats } from '@/lib/engine/signalAggregator';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit')) || 30;
    const signals = getAggregatedSignals(limit);
    const stats = getAggregatorStats();

    return NextResponse.json({ status: 'ok', signals, stats });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
