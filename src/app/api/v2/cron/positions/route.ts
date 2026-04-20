import { NextResponse } from 'next/server';
import { positionManager } from '@/lib/v2/manager/positionManager';
import { createLogger } from '@/lib/core/logger';
import { initDB, getLivePositions } from '@/lib/store/db';
import { requireCronAuth } from '@/lib/core/cronAuth';
import { isKillSwitchEngaged } from '@/lib/core/killSwitch';
import { instrumentCron } from '@/lib/observability/cronInstrument';
import { metrics, safeSet } from '@/lib/observability/metrics';

const log = createLogger('Cron-PositionManager');

// FAZA 3.12 — AUDIT-R4 shadow telemetry knob.
// Aligned with simulator.ts MAX_HOLD_SEC (3600s default). Env override lets
// operator tune the threshold without redeploy. Pure read: not used to close
// positions in this cron — only to count how many *would* be closed if a
// future enforcement cron applied this rule.
// Kill / restore: unset POLY_LIVE_MAX_HOLD_SEC → defaults to 3600.
const SHADOW_MAX_HOLD_SEC = Number.parseInt(process.env.LIVE_MAX_HOLD_SEC ?? '3600', 10);

// Cron job triggered externally (e.g. Google Cloud Scheduler or Vercel Cron)
// Designed to run every 1 minute.
export const dynamic = 'force-dynamic';

export const GET = instrumentCron('positions', async (request: Request) => {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    // Ensure DB is loaded (important for Serverless environments like Cloud Run)
    await initDB();

    // FIX: Check kill switch before evaluating — prevents redundant orders during liquidation
    if (isKillSwitchEngaged()) {
      log.warn('[Cron] Kill switch engaged — skipping position evaluation');
      return NextResponse.json({ status: 'skipped', reason: 'kill_switch_engaged', timestamp: new Date().toISOString() });
    }

    const openPositions = getLivePositions().filter(p => p.status === 'OPEN');
    log.info(`[Cron] Position Manager tick — ${openPositions.length} open positions.`);

    // FIX: Add 45s timeout to prevent cron cascade when MEXC is slow
    const evalPromise = positionManager.evaluateLivePositions();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Position evaluation timed out after 45s')), 45_000)
    );

    await Promise.race([evalPromise, timeoutPromise]);

    // FAZA 3.12 — SHADOW TELEMETRY for AUDIT-R4 (MAX_HOLD_SEC neaplicat în LIVE).
    // Read current OPEN positions AFTER evaluate (so TP/SL/trailing exits are
    // already removed from the pool). What remains is the true "stuck" set.
    // ASUMPȚII:
    //   - pos.openedAt is ISO-parseable → new Date().getTime() finite. Guard
    //     with Number.isFinite to avoid NaN propagating into Prometheus.
    //   - positionManager.evaluateLivePositions has already closed any TP/SL
    //     hits in this tick, so these are POST-evaluation residuals.
    //   - SHADOW only: never closes a position. Enforcement decision is
    //     deferred to a future phase once the gap is quantified.
    // Kill-switch: gauges fail-soft via safeSet (swallow on error). Disable
    //   observability by removing this block; no effect on execution path.
    try {
      const now = Date.now();
      const postOpen = getLivePositions().filter(p => p.status === 'OPEN');
      let oldestAgeSec = 0;
      let overMax = 0;
      for (const p of postOpen) {
        const openedMs = new Date(p.openedAt).getTime();
        if (!Number.isFinite(openedMs)) continue;
        const ageSec = Math.max(0, (now - openedMs) / 1000);
        if (ageSec > oldestAgeSec) oldestAgeSec = ageSec;
        if (ageSec >= SHADOW_MAX_HOLD_SEC) overMax++;
      }
      safeSet(metrics.livePositionOldestAgeSec, oldestAgeSec);
      safeSet(metrics.livePositionOverMaxHold, overMax);
    } catch (e) {
      // Observability must never take down a cron. Log + continue.
      log.warn('[Cron] shadow hold-age telemetry failed', { error: String(e) });
    }

    return NextResponse.json({
      status: 'ok',
      openPositions: openPositions.length,
      positions: openPositions.map(p => ({
        id: p.id,
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        partialTPHit: p.partialTPHit,
        highestObserved: p.highestPriceObserved,
      })),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error('Position Manager Cron Failed:', { error: errorMsg });
    return NextResponse.json({ status: 'error', message: errorMsg }, { status: 500 });
  }
});
