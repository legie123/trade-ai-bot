// GET /api/portfolio — real-time portfolio summary
import { NextResponse } from 'next/server';
import { getPortfolio } from '@/lib/engine/portfolio';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const portfolio = await getPortfolio();
    return NextResponse.json({ status: 'ok', ...portfolio });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
