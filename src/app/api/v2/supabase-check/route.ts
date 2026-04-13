// ============================================================
// Supabase Health Check — Verifies all required tables exist
// GET /api/v2/supabase-check
// Returns: table status, RLS status, write test results
// ============================================================
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const REQUIRED_TABLES = [
  'json_store',
  'equity_history',
  'syndicate_audits',
  'live_positions',
  'gladiator_stats',
  'gladiator_battles',
  'trade_locks',
  'sentiment_heartbeat',
  'phantom_trades',
];

interface TableStatus {
  table: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  error?: string;
}

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    return NextResponse.json({
      status: 'ERROR',
      error: 'NEXT_PUBLIC_SUPABASE_URL not set',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }

  const keyUsed = serviceKey ? 'SERVICE_ROLE' : anonKey ? 'ANON' : 'NONE';
  const key = serviceKey || anonKey || '';

  if (!key) {
    return NextResponse.json({
      status: 'ERROR',
      error: 'No Supabase key configured (need SUPABASE_SERVICE_ROLE_KEY)',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, key);
  const results: TableStatus[] = [];
  let allOk = true;

  for (const table of REQUIRED_TABLES) {
    const status: TableStatus = { table, exists: false, readable: false, writable: false };

    // Test read
    try {
      const { error } = await supabase.from(table).select('*').limit(1);
      if (error) {
        status.error = error.message;
        if (error.code === '42P01') {
          status.error = 'TABLE DOES NOT EXIST — run supabase_migration_complete.sql';
        } else if (error.code === '42501') {
          status.error = 'RLS BLOCKING — need SUPABASE_SERVICE_ROLE_KEY (not anon key)';
        }
        allOk = false;
      } else {
        status.exists = true;
        status.readable = true;
      }
    } catch (err) {
      status.error = (err as Error).message;
      allOk = false;
    }

    // Test write (only for json_store — non-destructive upsert)
    if (status.readable && table === 'json_store') {
      try {
        const { error } = await supabase.from('json_store').upsert({
          id: '_health_check',
          data: { ok: true, ts: Date.now() },
          updated_at: new Date().toISOString(),
        });
        if (error) {
          status.error = `Write failed: ${error.message}`;
          allOk = false;
        } else {
          status.writable = true;
        }
      } catch (err) {
        status.error = `Write exception: ${(err as Error).message}`;
        allOk = false;
      }
    }

    results.push(status);
  }

  const missing = results.filter(r => !r.exists).map(r => r.table);
  const rlsBlocked = results.filter(r => r.error?.includes('RLS')).map(r => r.table);
  const notWritable = results.filter(r => r.exists && r.table === 'json_store' && !r.writable).map(r => r.table);

  let recommendation = '';
  if (missing.length > 0) {
    recommendation = `Run supabase_migration_complete.sql in Supabase SQL Editor to create: ${missing.join(', ')}`;
  } else if (rlsBlocked.length > 0) {
    recommendation = 'Set SUPABASE_SERVICE_ROLE_KEY in Cloud Run env vars (not anon key)';
  } else if (notWritable.length > 0) {
    recommendation = 'json_store exists but writes fail — check RLS policies';
  } else if (allOk) {
    recommendation = 'All tables healthy ✅';
  }

  return NextResponse.json({
    status: allOk ? 'OK' : 'ERRORS',
    keyUsed,
    serviceRoleConfigured: !!serviceKey,
    tables: results,
    summary: {
      total: REQUIRED_TABLES.length,
      existing: results.filter(r => r.exists).length,
      missing: missing.length,
      rlsBlocked: rlsBlocked.length,
    },
    recommendation,
    timestamp: new Date().toISOString(),
  }, { status: allOk ? 200 : 500 });
}
