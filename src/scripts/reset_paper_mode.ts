/**
 * FAZA 5 — PAPER MODE RESET SCRIPT
 *
 * Clears all trading data from Supabase for a fresh PAPER mode start.
 * Run this ONCE before beginning the 14-day validation cycle.
 *
 * Usage: npx tsx src/scripts/reset_paper_mode.ts
 *
 * ⚠️ WARNING: This DELETES all existing trading data. Irreversible.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function resetForPaperMode() {
  console.log('═══════════════════════════════════════════');
  console.log('  PHOENIX V2 — PAPER MODE RESET');
  console.log('═══════════════════════════════════════════\n');

  const tables = [
    'equity_history',
    'syndicate_audits',
    'live_positions',
    'gladiator_stats',
    'gladiator_battles',
    'trade_locks',
  ];

  // 1. Truncate all trading data tables
  for (const table of tables) {
    const { error } = await supabase.from(table).delete().gte('id', '');
    if (error) {
      // Some tables use different PK types — try alternative
      const { error: err2 } = await supabase.from(table).delete().neq('id', '__impossible__');
      if (err2) {
        console.warn(`⚠️  Could not clear ${table}: ${err2.message}`);
      } else {
        console.log(`✅ Cleared: ${table}`);
      }
    } else {
      console.log(`✅ Cleared: ${table}`);
    }
  }

  // 2. Reset json_store config to PAPER mode defaults
  const defaultConfig = {
    key: 'phoenix_v2_state',
    value: JSON.stringify({
      config: {
        mode: 'PAPER',
        autoOptimize: false,
        paperBalance: 1000,
        riskPerTrade: 1.0,
        maxOpenPositions: 2,
        evaluationIntervals: [5, 15, 60, 240],
        aiStatus: 'OK',
        haltedUntil: null,
      },
      decisions: [],
      gladiators: [],
      syndicateAudits: [],
      gladiatorDna: [],
      phantomTrades: [],
      livePositions: [],
      invalidSymbols: [],
      equityHistory: [],
      omega: {
        currentStrategy: null,
        improvementPercent: 0,
        history: [],
      },
    }),
  };

  const { error: jsonErr } = await supabase
    .from('json_store')
    .upsert(defaultConfig, { onConflict: 'key' });

  if (jsonErr) {
    console.warn(`⚠️  Could not reset json_store: ${jsonErr.message}`);
  } else {
    console.log('✅ Reset json_store to PAPER mode defaults');
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('  RESET COMPLETE');
  console.log('  Mode: PAPER | Balance: $1000 | Risk: 1.0%');
  console.log('  Max Positions: 2 | All stats zeroed');
  console.log('═══════════════════════════════════════════');
  console.log('\nNext steps:');
  console.log('  1. Deploy to Cloud Run');
  console.log('  2. Verify /api/health returns 200');
  console.log('  3. Monitor for 14 days');
  console.log('  4. If WR > 45%, proceed to LIVE with < 5% capital');
}

resetForPaperMode().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
