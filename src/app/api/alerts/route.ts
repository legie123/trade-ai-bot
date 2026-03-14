// GET /api/alerts — evaluate and return active alerts
import { NextResponse } from 'next/server';
import { getAggregatedTokens } from '@/lib/providers/providerManager';
import { evaluateAlerts } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const tokens = await getAggregatedTokens();
    const alerts = evaluateAlerts(tokens);

    return NextResponse.json({
      alerts,
      count: alerts.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to evaluate alerts', detail: (err as Error).message },
      { status: 500 }
    );
  }
}
