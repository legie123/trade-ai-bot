// ============================================================
// Watchdog — Monitors scan loop liveness, auto-restarts on crash
// Tracks crash count, consecutive failures, and restart history
// ============================================================
import { createLogger } from '@/lib/core/logger';

const log = createLogger('Watchdog');

export interface WatchdogState {
  alive: boolean;
  lastPing: string | null;
  crashCount: number;
  restartCount: number;
  consecutiveFailures: number;
  maxConsecutiveFailures: number;
  lastRestart: string | null;
  startedAt: string | null;
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'DEAD';
}

// ─── Global singleton ───────────────────────────────
const g = globalThis as unknown as { __watchdog?: WatchdogState };
if (!g.__watchdog) {
  g.__watchdog = {
    alive: true,
    lastPing: new Date().toISOString(),
    crashCount: 0,
    restartCount: 0,
    consecutiveFailures: 0,
    maxConsecutiveFailures: 5,
    lastRestart: null,
    startedAt: new Date().toISOString(),
    status: 'HEALTHY',
  };
}
const state = g.__watchdog;

const WATCHDOG_TIMEOUT_MS = 5 * 60_000; // 5 minutes no heartbeat → dead
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let restartCallback: (() => void) | null = null;

// ─── Ping — called by scan loop each cycle ──────────
export function watchdogPing(): void {
  state.lastPing = new Date().toISOString();
  state.alive = true;
  state.consecutiveFailures = 0;
  state.status = 'HEALTHY';
}

// ─── Report failure — called when scan cycle crashes ─
export function watchdogReportFailure(error: string): void {
  state.consecutiveFailures++;
  state.crashCount++;

  if (state.consecutiveFailures >= state.maxConsecutiveFailures) {
    state.status = 'CRITICAL';
    log.fatal('Max consecutive failures reached — triggering restart', {
      failures: state.consecutiveFailures,
      error,
    });
    triggerRestart();
  } else if (state.consecutiveFailures >= 3) {
    state.status = 'WARNING';
    log.warn('Multiple consecutive failures', {
      failures: state.consecutiveFailures,
      error,
    });
  }
}

// ─── Auto-restart trigger ───────────────────────────
function triggerRestart(): void {
  state.restartCount++;
  state.lastRestart = new Date().toISOString();
  state.consecutiveFailures = 0;

  log.info('Triggering auto-restart of scan loop', {
    restartCount: state.restartCount,
  });

  // Send Telegram alert on restart
  import('@/lib/alerts/telegram').then(({ sendMessage }) => {
    sendMessage(
      `⚠️ *WATCHDOG: Auto-Restart #${state.restartCount}*\n` +
      `Crashes: ${state.crashCount}\n` +
      `Time: ${state.lastRestart}`
    ).catch(() => {});
  }).catch(() => {});

  if (restartCallback) {
    try {
      restartCallback();
    } catch (err) {
      log.error('Restart callback failed', { error: (err as Error).message });
    }
  }
}

// ─── Start watchdog monitor ─────────────────────────
export function startWatchdog(onRestart: () => void): void {
  restartCallback = onRestart;
  state.startedAt = new Date().toISOString();
  state.alive = true;
  state.status = 'HEALTHY';

  // Clear existing timer
  if (watchdogTimer) clearInterval(watchdogTimer);

  // Check liveness every 60 seconds
  watchdogTimer = setInterval(() => {
    if (!state.lastPing) return;

    const elapsed = Date.now() - new Date(state.lastPing).getTime();
    if (elapsed > WATCHDOG_TIMEOUT_MS) {
      state.alive = false;
      state.status = 'DEAD';
      log.error('Scan loop appears dead — no heartbeat for 5 min', {
        lastPing: state.lastPing,
        elapsedMs: elapsed,
      });
      triggerRestart();
    }
  }, 60_000);

  log.info('Watchdog started', { timeoutMs: WATCHDOG_TIMEOUT_MS });
}

// ─── Stop watchdog ──────────────────────────────────
export function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  state.alive = false;
  state.status = 'DEAD';
  log.info('Watchdog stopped');
}

// ─── Get status (serverless-aware) ──────────────────
export function getWatchdogState(): WatchdogState {
  // On serverless, dynamically compute status from lastPing age
  if (state.lastPing) {
    const elapsed = Date.now() - new Date(state.lastPing).getTime();
    if (elapsed > WATCHDOG_TIMEOUT_MS) {
      state.status = 'DEAD';
      state.alive = false;
    } else if (elapsed > WATCHDOG_TIMEOUT_MS / 2) {
      state.status = 'WARNING';
      state.alive = true;
    } else {
      state.status = 'HEALTHY';
      state.alive = true;
    }
  }
  return { ...state };
}
