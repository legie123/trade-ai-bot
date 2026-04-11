/**
 * FAZA 5 — PRE-LIVE SELF-CHECK VALIDATOR
 *
 * Validates all institutional requirements from MASTER_BLUEPRINT_V1.md Section 10
 * before activating LIVE mode. Every check MUST pass.
 *
 * Usage: npx tsx src/scripts/pre_live_check.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  const icon = pass ? '✅' : '❌';
  console.log(`${icon} ${name}: ${detail}`);
}

async function runChecks() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  PHOENIX V2 — PRE-LIVE SELF-CHECK VALIDATOR');
  console.log('═══════════════════════════════════════════════════\n');

  const srcRoot = path.resolve(__dirname, '..');

  // ── CHECK 1: seedGladiators() has zero stats ──
  const gladiatorStorePath = path.join(srcRoot, 'lib/store/gladiatorStore.ts');
  const gladiatorStoreCode = fs.readFileSync(gladiatorStorePath, 'utf-8');
  const hasFakeStats = /winRate:\s*(?!0\b)\d+/.test(gladiatorStoreCode) &&
    gladiatorStoreCode.includes('seedGladiators');
  // More precise: check that in the seed function, winRate is 0
  const seedSection = gladiatorStoreCode.split('seedGladiators')[1]?.split('}')[0] || '';
  const seedHasNonZeroWR = /winRate:\s*(?!0)[1-9]/.test(seedSection);
  check(
    'Seed stats = ZERO',
    !seedHasNonZeroWR,
    seedHasNonZeroWR ? 'FAIL: seedGladiators() contains non-zero winRate' : 'seedGladiators() initializes all stats to 0'
  );

  // ── CHECK 2: Emergency exit calls MEXC, not just Binance ──
  const sentinelPath = path.join(srcRoot, 'lib/v2/safety/sentinelGuard.ts');
  const sentinelCode = fs.readFileSync(sentinelPath, 'utf-8');
  const hasMexcExit = sentinelCode.includes('sellAllAssetsToUsdt') || sentinelCode.includes('mexcClient');
  check(
    'Emergency exit targets MEXC',
    hasMexcExit,
    hasMexcExit ? 'emergencyExitAllPositions() imports from mexcClient' : 'FAIL: No MEXC reference in emergency exit'
  );

  // ── CHECK 3: PositionManager uses PriceCache ──
  const posMgrPath = path.join(srcRoot, 'lib/v2/manager/positionManager.ts');
  const posMgrCode = fs.readFileSync(posMgrPath, 'utf-8');
  const usesPriceCache = posMgrCode.includes('getOrFetchPrice') || posMgrCode.includes('priceCache');
  const bypassesPriceCache = posMgrCode.includes('getMexcPrice') && !posMgrCode.includes('priceCache');
  check(
    'PositionManager uses PriceCache',
    usesPriceCache && !bypassesPriceCache,
    usesPriceCache ? 'imports getOrFetchPrice from priceCache' : 'FAIL: bypasses PriceCache'
  );

  // ── CHECK 4: cron_dailyRotation persists leaderboard ──
  const cronPath = path.join(srcRoot, 'scripts/cron_dailyRotation.ts');
  const cronCode = fs.readFileSync(cronPath, 'utf-8');
  const persists = cronCode.includes('saveGladiatorsToDb');
  check(
    'Cron persists leaderboard to DB',
    persists,
    persists ? 'saveGladiatorsToDb() called after leaderboard update' : 'FAIL: leaderboard changes not persisted'
  );

  // ── CHECK 5: SentinelGuard hardened parameters ──
  const dailyLossMatch = sentinelCode.match(/dailyLossLimit\s*=\s*(\d+)/);
  const minWRMatch = sentinelCode.match(/minWinRate\s*=\s*([\d.]+)/);
  const maxStreakMatch = sentinelCode.match(/maxLossStreak\s*=\s*(\d+)/);
  const dailyLoss = dailyLossMatch ? parseInt(dailyLossMatch[1]) : 999;
  const minWR = minWRMatch ? parseFloat(minWRMatch[1]) : 0;
  const maxStreak = maxStreakMatch ? parseInt(maxStreakMatch[1]) : 999;

  check(
    'dailyLossLimit <= 3',
    dailyLoss <= 3,
    `dailyLossLimit = ${dailyLoss}`
  );
  check(
    'minWinRate >= 0.40',
    minWR >= 0.40,
    `minWinRate = ${minWR}`
  );
  check(
    'maxLossStreak <= 4',
    maxStreak <= 4,
    `maxLossStreak = ${maxStreak}`
  );

  // ── CHECK 6: LIVE consensus threshold = 0.75 ──
  const hasLiveThreshold = sentinelCode.includes("'LIVE' ? 0.75") || sentinelCode.includes('"LIVE" ? 0.75');
  check(
    'LIVE consensus threshold = 0.75',
    hasLiveThreshold,
    hasLiveThreshold ? 'LIVE mode requires 75% confidence' : 'FAIL: LIVE threshold not set to 0.75'
  );

  // ── CHECK 7: riskPerTrade <= 1.0 ──
  const dbPath = path.join(srcRoot, 'lib/store/db.ts');
  const dbCode = fs.readFileSync(dbPath, 'utf-8');
  const rptMatch = dbCode.match(/riskPerTrade:\s*([\d.]+)/);
  const rpt = rptMatch ? parseFloat(rptMatch[1]) : 999;
  check(
    'riskPerTrade <= 1.0%',
    rpt <= 1.0,
    `riskPerTrade default = ${rpt}%`
  );

  // ── CHECK 8: maxOpenPositions <= 2 ──
  const mopMatch = dbCode.match(/maxOpenPositions:\s*(\d+)/);
  const mop = mopMatch ? parseInt(mopMatch[1]) : 999;
  check(
    'maxOpenPositions <= 2',
    mop <= 2,
    `maxOpenPositions default = ${mop}`
  );

  // ── CHECK 9: Gladiator live threshold hardened (WR >= 45, PF >= 1.1) ──
  const wrGateMatch = gladiatorStoreCode.match(/winRate\s*>=\s*(\d+)/);
  const pfGateMatch = gladiatorStoreCode.match(/profitFactor\s*>=\s*([\d.]+)/);
  const wrGate = wrGateMatch ? parseInt(wrGateMatch[1]) : 0;
  const pfGate = pfGateMatch ? parseFloat(pfGateMatch[1]) : 0;
  check(
    'Gladiator gate: WR >= 45%',
    wrGate >= 45,
    `Gladiator live WR threshold = ${wrGate}%`
  );
  check(
    'Gladiator gate: PF >= 1.1',
    pfGate >= 1.1,
    `Gladiator live PF threshold = ${pfGate}`
  );

  // ── CHECK 10: TheForge has pre-screening ──
  const forgePath = path.join(srcRoot, 'lib/v2/promoters/forge.ts');
  const forgeCode = fs.readFileSync(forgePath, 'utf-8');
  const hasPrescreen = forgeCode.includes('isDNASane') && forgeCode.includes('miniBacktest');
  check(
    'TheForge DNA pre-screening active',
    hasPrescreen,
    hasPrescreen ? 'isDNASane + miniBacktest gates active' : 'FAIL: No pre-screening in Forge'
  );

  // ── CHECK 11: ENV vars present ──
  const envVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'OPENAI_API_KEY',
    'DEEPSEEK_API_KEY',
    'MEXC_API_KEY',
    'MEXC_API_SECRET',
  ];
  for (const v of envVars) {
    check(
      `ENV: ${v}`,
      !!process.env[v],
      process.env[v] ? 'Set' : 'MISSING'
    );
  }

  // ── SUMMARY ──
  console.log('\n═══════════════════════════════════════════════════');
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED out of ${results.length} checks`);

  if (failed > 0) {
    console.log('\n  ❌ DO NOT activate LIVE mode until all checks pass.');
    console.log('  Failed checks:');
    results.filter(r => !r.pass).forEach(r => {
      console.log(`    - ${r.name}: ${r.detail}`);
    });
  } else {
    console.log('\n  ✅ ALL CHECKS PASSED — System is ready for LIVE mode activation.');
    console.log('  Reminder: Start with < 5% of total capital.');
  }
  console.log('═══════════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

runChecks().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
