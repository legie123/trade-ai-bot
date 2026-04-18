// GET /api/dashboard — Dashboard system state for useRealtimeData hook
import { NextResponse } from 'next/server';
import { getWatchdogState, watchdogPing } from '@/lib/core/watchdog';
import { getFreshHealthSnapshot, startHeartbeat } from '@/lib/core/heartbeat';
import { getKillSwitchState } from '@/lib/core/killSwitch';
import { getRecentLogs } from '@/lib/core/logger';
import { getDecisions, getSyncQueueStats, getLivePositions, getBotConfig, getEquityCurve, initDB } from '@/lib/store/db';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { getMoltbookTelemetry } from '@/lib/moltbook/moltbookClient';
import type { DecisionSnapshot } from '@/lib/types/radar';

export const dynamic = 'force-dynamic';

/**
 * Multi-horizon reliability aggregator (2026-04-18).
 * For each horizon key present on any decision's horizonOutcomes map:
 *   counts: WIN / LOSS / NEUTRAL
 *   winRate = wins / (wins + losses)       // NEUTRALs EXCLUDED from denominator
 *   winRateAll = wins / total              // NEUTRALs in denominator (harsher)
 *   profitFactor = sum(WIN pnl) / |sum(LOSS pnl)|
 *   meanPnlPct, medianPnlPct
 *   wilson95 CI on winRate so the user sees small-sample uncertainty directly.
 *
 * WHY Wilson: low-sample binomial CIs diverge wildly from the naïve ±2σ; Wilson
 * is the correct small-sample interval and makes "n=12, WR=92%" look as shaky
 * as it actually is (lower bound often <70%).
 *
 * WHY two winRate flavors: single-horizon data, ±0.3% threshold → NEUTRAL can
 * dominate. Excluding NEUTRALs gives you directional WR; including them is a
 * harsher real-world measure.
 */
function wilsonLowerUpper(wins: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 0 };
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - margin), hi: Math.min(1, center + margin) };
}

function computeHorizonStats(decisions: DecisionSnapshot[]): Record<string, unknown> {
  const stats: Record<string, unknown> = {};
  const horizonKeys = new Set<string>();
  for (const d of decisions) {
    if (d.horizonOutcomes) Object.keys(d.horizonOutcomes).forEach(k => horizonKeys.add(k));
  }
  // Stable ordering by numeric horizon value
  const sortedKeys = [...horizonKeys].sort((a, b) => Number(a) - Number(b));

  for (const hk of sortedKeys) {
    let wins = 0, losses = 0, neutrals = 0;
    let winPnlSum = 0, lossPnlSum = 0;
    const allPnls: number[] = [];
    for (const d of decisions) {
      const slot = d.horizonOutcomes?.[hk];
      if (!slot) continue;
      allPnls.push(slot.pnlPercent);
      if (slot.label === 'WIN') { wins++; winPnlSum += slot.pnlPercent; }
      else if (slot.label === 'LOSS') { losses++; lossPnlSum += slot.pnlPercent; }
      else neutrals++;
    }
    const n = wins + losses + neutrals;
    const directional = wins + losses;
    const winRate = directional ? wins / directional : 0;
    const winRateAll = n ? wins / n : 0;
    const pf = lossPnlSum < 0 ? winPnlSum / Math.abs(lossPnlSum) : (winPnlSum > 0 ? Infinity : 0);
    const sorted = [...allPnls].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const mean = allPnls.length ? allPnls.reduce((a, b) => a + b, 0) / allPnls.length : 0;
    const wilson = wilsonLowerUpper(wins, directional);
    stats[`${hk}m`] = {
      n, wins, losses, neutrals,
      winRate: Math.round(winRate * 10000) / 10000,
      winRateAll: Math.round(winRateAll * 10000) / 10000,
      profitFactor: isFinite(pf) ? Math.round(pf * 100) / 100 : null,
      meanPnlPct: Math.round(mean * 10000) / 10000,
      medianPnlPct: Math.round(median * 10000) / 10000,
      wilson95: directional >= 10
        ? { lo: Math.round(wilson.lo * 10000) / 10000, hi: Math.round(wilson.hi * 10000) / 10000 }
        : null, // don't show CI for tiny samples — misleading
      // Callout: "winRate is not edge". Any consumer that surfaces this MUST
      // show the sample size prominently. A winRate at n<50 is noise.
    };
  }
  return stats;
}

export async function GET() {
  try {
    // Self-init for serverless: ensure DB cache is hydrated from Supabase on THIS instance
    await initDB();
    startHeartbeat();
    watchdogPing();
    // Also mark scan loop active on this instance
    const gScan = globalThis as unknown as {
      __autoScan?: { running: boolean; lastScanAt: string | null; scanCount: number };
    };
    if (!gScan.__autoScan) {
      gScan.__autoScan = { running: false, lastScanAt: null, scanCount: 0 };
    }

    const watchdog = getWatchdogState();
    const heartbeat = getFreshHealthSnapshot();
    const killSwitch = getKillSwitchState();
    
    // Calculate trading stats
    const decisions = getDecisions();
    const today = new Date().toISOString().split('T')[0];
    // C15 fix (2026-04-18): guard against decisions with missing/null timestamp
    // (seen on cold instances where json_store returns partial rows). Previously
    // crashed the whole dashboard route with "Cannot read properties of undefined
    // (reading 'startsWith')".
    const todayDecisions = decisions.filter(d =>
      typeof d.timestamp === 'string' &&
      d.timestamp.startsWith(today) &&
      d.outcome !== 'PENDING'
    );

    const dailyPnlPercent = todayDecisions.reduce((acc, curr) => acc + (curr.pnlPercent || 0), 0);
    const pendingDecisions = decisions.filter(d => d.outcome === 'PENDING').length;
    const openPositions = getLivePositions().filter(p => p.status === 'OPEN').length;

    // R5-lite observability (2026-04-18): expose confidence distribution so we
    // can VISUALLY verify the de-saturation fix is working in production.
    // Before the fix: EVERYTHING was 100. After the fix: we expect a broad
    // distribution ∈ [0, 95]. A return to clustering at 100 signals a regression.
    // WHY buckets + mean: single-number means lie about skew; buckets reveal
    // "saturated at ceiling" vs "spread realistically".
    // WHY slice(-200): recent window captures current signal-engine behavior
    // without dragging in pre-fix history.
    const evaluatedDecisions = decisions.filter(d => d.outcome !== 'PENDING');
    const recentEvaluated = evaluatedDecisions.slice(-200);
    const confBuckets = { '0-20': 0, '20-40': 0, '40-60': 0, '60-80': 0, '80-95': 0, '95-100': 0 };
    const confValues: number[] = [];
    for (const d of recentEvaluated) {
      const c = Number(d.confidence) || 0;
      confValues.push(c);
      if (c < 20) confBuckets['0-20']++;
      else if (c < 40) confBuckets['20-40']++;
      else if (c < 60) confBuckets['40-60']++;
      else if (c < 80) confBuckets['60-80']++;
      else if (c < 95) confBuckets['80-95']++;
      else confBuckets['95-100']++;
    }
    const sortedConf = [...confValues].sort((a, b) => a - b);
    const median = sortedConf.length ? sortedConf[Math.floor(sortedConf.length / 2)] : 0;
    const confStats = {
      sampleSize: confValues.length,
      mean: confValues.length ? Math.round((confValues.reduce((a, b) => a + b, 0) / confValues.length) * 100) / 100 : 0,
      median: Math.round(median * 100) / 100,
      min: confValues.length ? Math.round(Math.min(...confValues) * 100) / 100 : 0,
      max: confValues.length ? Math.round(Math.max(...confValues) * 100) / 100 : 0,
      buckets: confBuckets,
      // Last 20 (confidence, outcome) points for visual time series of recent signals.
      recent: recentEvaluated.slice(-20).map(d => ({
        ts: d.timestamp,
        symbol: d.symbol,
        action: d.action,
        confidence: Math.round((Number(d.confidence) || 0) * 100) / 100,
        outcome: d.outcome,
        pnl: d.pnlPercent,
      })),
    };

    const recentLogs = getRecentLogs(20);
    const memUsageMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    
    // Active modules check
    const gladiators = gladiatorStore.getGladiators();
    const activeGladiators = gladiators.filter(g => g.isLive).length;

    // Compute real uptime (V2 Genesis Timestamp: April 4, 2026)
    const GENESIS_TIMESTAMP = 1775260800000;
    const uptimeSeconds = (Date.now() - GENESIS_TIMESTAMP) / 1000;

    // Overall system status derived from heartbeat + watchdog + killswitch + bot mode
    const heartbeatStatus = heartbeat?.status || 'YELLOW';
    const botConfig = getBotConfig();
    const isHalted = botConfig.haltedUntil && new Date(botConfig.haltedUntil) > new Date();
    const isSystemHealthy = watchdog.status === 'HEALTHY' && !killSwitch.engaged && heartbeatStatus !== 'RED';
    const systemStatus = killSwitch.engaged ? 'HALTED (KILL SWITCH)' 
      : isHalted ? `HALTED — Cooldown until ${new Date(botConfig.haltedUntil!).toLocaleTimeString()}`
      : watchdog.status === 'DEAD' ? 'CRITICAL — Watchdog Dead'
      : heartbeatStatus === 'RED' ? 'DEGRADED — Heartbeat Red'
      : botConfig.mode === 'OBSERVATION' ? 'OBSERVATION — No Execution'
      : isSystemHealthy ? 'LIVE - SUPER AI OMEGA' 
      : 'WARNING';

    return NextResponse.json({
      system: { 
        status: systemStatus, 
        uptime: uptimeSeconds, 
        memoryUsageRssMB: memUsageMB,
        syncQueue: getSyncQueueStats(),
        moltbook: getMoltbookTelemetry(),
        modulesActive: activeGladiators,
        feedsLive: heartbeat?.providers ? Object.values(heartbeat.providers).filter((p: { ok: boolean }) => p.ok).length : 0,
        sentinelsActive: 4, // Risk + Loss + WinRate + Streak sentinels
        streamStatus: heartbeat?.scanLoop?.running ? 'STREAMING' : 'IDLE',
        runtimeHealth: heartbeatStatus,
        lastSync: heartbeat?.timestamp || new Date().toISOString(),
        blockageReason: killSwitch.engaged ? killSwitch.reason 
          : watchdog.status === 'DEAD' ? 'No heartbeat for 5+ minutes' 
          : heartbeatStatus === 'RED' ? 'Scan loop not running or stale'
          : null,
      },
      watchdog: { 
        status: watchdog.status, 
        crashCount: watchdog.crashCount,
        consecutiveFailures: watchdog.consecutiveFailures,
        lastPing: watchdog.lastPing,
        startedAt: watchdog.startedAt,
        alive: watchdog.alive,
      },
      heartbeat: heartbeat ? {
        status: heartbeat.status,
        providers: heartbeat.providers,
        scanLoop: heartbeat.scanLoop,
        memory: heartbeat.memory,
      } : null,
      killSwitch: { 
        engaged: killSwitch.engaged, 
        reason: killSwitch.reason 
      },
      trading: {
        totalSignals: decisions.length,
        pendingDecisions,
        executionsToday: todayDecisions.length,
        dailyPnlPercent: Math.round(dailyPnlPercent * 100) / 100,
        openPositions,
      },
      confidenceStats: confStats,
      horizonStats: computeHorizonStats(decisions),
      logs: {
        recent: recentLogs.map((l: { ts: string; level: string; module: string; msg: string }) => ({
          ts: l.ts || new Date().toISOString(),
          level: l.level || 'INFO',
          msg: `[${l.module}] ${l.msg}`,
        })),
        errorCount1h: recentLogs.filter((l: { level: string }) => l.level === 'ERROR' || l.level === 'FATAL').length,
      },
      history: getEquityCurve(),
    });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
