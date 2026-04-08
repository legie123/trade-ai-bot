// GET /api/meme-signals
import { NextResponse } from 'next/server';
import { runMemeEngineScan } from '@/lib/v2/scouts/ta/memeEngine';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('MemeApi');

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const result = await runMemeEngineScan();
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    log.error('Meme-signals engine failed', { error });
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
