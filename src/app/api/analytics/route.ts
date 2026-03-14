// GET /api/analytics — full analytics report
import { NextResponse } from 'next/server';
import { generateAnalytics } from '@/lib/engine/analytics';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const report = generateAnalytics();
    return NextResponse.json({ status: 'ok', ...report });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
