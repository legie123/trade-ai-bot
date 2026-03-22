import { NextResponse } from 'next/server';
import { initDB } from '@/lib/store/db';
import { triggerManualScan } from '@/lib/engine/autoScan';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('Vercel-Cron');

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow cloud function to run up to 60s

export async function GET(req: Request) {
  // 1. Authenticate the Cron request
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    log.error('Unauthorized cron invocation attempted');
    return new Response('Unauthorized', { status: 401 });
  }

  log.info('Cloud Cron cycle initiating...');

  try {
    // 2. Hydrate memory from Supabase Database (Cloud Cache Sync)
    await initDB();

    // 3. Trigger the entire Engine process
    // (Pulls prices, generates indicators, scores Confluence, evaluates portfolio, logs to Supabase)
    const results = await triggerManualScan();

    log.info('Cloud Cron cycle completed', results);
    return NextResponse.json({ success: true, timestamp: new Date().toISOString(), results });
  } catch (err) {
    log.error('Cloud Cron cycle failed', { error: String(err) });
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
