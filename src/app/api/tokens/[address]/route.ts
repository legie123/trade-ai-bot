// GET /api/tokens/[address] — single token detail
import { NextRequest, NextResponse } from 'next/server';
import { getTokenDetail } from '@/lib/providers/providerManager';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const token = await getTokenDetail(address);

    if (!token) {
      return NextResponse.json(
        { error: 'Token not found', address },
        { status: 404 }
      );
    }

    return NextResponse.json({
      token,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Token detail error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch token detail', detail: (err as Error).message },
      { status: 500 }
    );
  }
}
