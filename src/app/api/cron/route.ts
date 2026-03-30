// ============================================================
// GET /api/cron — Automated trading loop
// 1. Runs BTC engine → generates signals → creates PENDING decisions
// 2. Evaluates old decisions → marks WIN/LOSS → updates equity curve
// 3. Should be called every 60s by frontend polling or Cloud Scheduler
// ============================================================
import { NextResponse } from 'next/server';
import { initDB, getDecisions, getBotConfig, getEquityCurve } from '@/lib/store/db';
import { analyzeBTC } from '@/lib/engine/btcEngine';
import { evaluatePendingDecisions } from '@/lib/engine/tradeEvaluator';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('CronLoop');

export const dynamic = 'force-dynamic';

// Track last run to prevent double-runs
let lastRunTimestamp = 0;
const MIN_INTERVAL_MS = 45_000; // minimum 45s between runs

export async function GET() {
  const now = Date.now();

  // Prevent double-runs
  if (now - lastRunTimestamp < MIN_INTERVAL_MS) {
    return NextResponse.json({
      status: 'throttled',
      message: `Last run ${Math.round((now - lastRunTimestamp) / 1000)}s ago, min interval is ${MIN_INTERVAL_MS / 1000}s`,
    });
  }
  lastRunTimestamp = now;

  try {
    await initDB();
    const config = getBotConfig();

    log.info('=== CRON LOOP START ===');

    // ── Step 1: Run BTC Engine → generates signals + decisions ──
    let btcSignals = 0;
    try {
      const btcResult = await analyzeBTC();
      btcSignals = btcResult.signals.length;
      log.info(`BTC Engine: ${btcSignals} signals generated, price $${btcResult.price}`);
    } catch (err) {
      log.error('BTC Engine failed', { error: (err as Error).message });
    }

    // ── Step 2: Evaluate pending decisions (older than 5 min) ──
    let evalResult = { evaluated: 0, wins: 0, losses: 0 };
    try {
      evalResult = await evaluatePendingDecisions();
      if (evalResult.evaluated > 0) {
        log.info(`Evaluator: ${evalResult.evaluated} evaluated (${evalResult.wins}W / ${evalResult.losses}L)`);
      }
    } catch (err) {
      log.error('Evaluator failed', { error: (err as Error).message });
    }

    // ── Step 3: Gather current state ──
    const decisions = getDecisions();
    const pending = decisions.filter(d => d.outcome === 'PENDING').length;
    const total = decisions.length;
    const equityCurve = getEquityCurve();
    const lastBalance = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].balance : config.paperBalance;

    // Calculate total P&L
    const evaluated = decisions.filter(d => d.outcome !== 'PENDING');
    const totalPnl = evaluated.reduce((s, d) => s + (d.pnlPercent || 0), 0);
    const winRate = evaluated.length > 0
      ? Math.round((evaluated.filter(d => d.outcome === 'WIN').length / evaluated.length) * 100)
      : 0;

    log.info(`=== CRON LOOP END === Balance: $${lastBalance.toFixed(2)} | P&L: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}% | WinRate: ${winRate}% | Pending: ${pending} | Total: ${total}`);

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      loop: {
        btcSignals,
        evaluated: evalResult.evaluated,
        wins: evalResult.wins,
        losses: evalResult.losses,
      },
      state: {
        balance: Math.round(lastBalance * 100) / 100,
        totalPnlPercent: Math.round(totalPnl * 100) / 100,
        winRate,
        pendingDecisions: pending,
        totalDecisions: total,
        equityCurvePoints: equityCurve.length,
        mode: config.mode,
      },
    });

  } catch (err) {
    log.error('Cron loop error', { error: (err as Error).message });
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
