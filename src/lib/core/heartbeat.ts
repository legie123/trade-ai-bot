// ============================================================
// Heartbeat — Periodic system health snapshot
// Records memory, scan state, data freshness, provider status
// ============================================================
import { createLogger } from '@/lib/core/logger';

const log = createLogger('Heartbeat');

export interface HealthSnapshot {
  timestamp: string;
  uptime: number;             // seconds
  memory: { rss: number; heapUsed: number; heapTotal: number };
  scanLoop: {
    running: boolean;
    lastScanAt: string | null;
    scanCount: number;
    staleSince: number | null;   // ms since last scan, null if fresh
  };
  providers: Record<string, { ok: boolean; lastLatencyMs: number | null }>;
  errors: number;
  status: 'GREEN' | 'YELLOW' | 'RED';
}

// ─── Global singleton ───────────────────────────────
const g = globalThis as unknown as {
  __heartbeat?: {
    snapshots: HealthSnapshot[];
    intervalId: ReturnType<typeof setInterval> | null;
    running: boolean;
    providerHealth: Record<string, { ok: boolean; lastLatencyMs: number | null }>;
    errorCount: number;
  };
};
if (!g.__heartbeat) {
  g.__heartbeat = {
    snapshots: [],
    intervalId: null,
    running: false,
    providerHealth: {},
    errorCount: 0,
  };
}
const hb = g.__heartbeat;

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const MAX_SNAPSHOTS = 120; // 1 hour of snapshots at 30s interval
const STALE_SCAN_THRESHOLD_MS = 5 * 60_000; // 5 min = stale

// ─── Record a provider health update ────────────────
export function recordProviderHealth(
  name: string,
  ok: boolean,
  latencyMs: number | null
): void {
  hb.providerHealth[name] = { ok, lastLatencyMs: latencyMs };
}

// ─── Record an error ────────────────────────────────
export function recordError(): void {
  hb.errorCount++;
}

// ─── Take a health snapshot ─────────────────────────
function takeSnapshot(): HealthSnapshot {
  const mem = process.memoryUsage();
  const uptime = process.uptime();

  // Get scan loop state
  let scanRunning = false;
  let lastScanAt: string | null = null;
  let scanCount = 0;

  try {
    // Access autoScan state via globalThis (safe, no import cycle)
    const gScan = globalThis as unknown as {
      __autoScan?: { running: boolean; lastScanAt: string | null; scanCount: number };
    };
    if (gScan.__autoScan) {
      scanRunning = gScan.__autoScan.running;
      lastScanAt = gScan.__autoScan.lastScanAt;
      scanCount = gScan.__autoScan.scanCount;
    }
  } catch { /* safe fallback */ }

  const staleSince = lastScanAt
    ? Date.now() - new Date(lastScanAt).getTime()
    : null;

  const isStale = staleSince !== null && staleSince > STALE_SCAN_THRESHOLD_MS;
  const criticalDown = hb.providerHealth['binance'] && !hb.providerHealth['binance'].ok;

  const status: HealthSnapshot['status'] =
    !scanRunning || isStale ? 'RED' :
    criticalDown || hb.errorCount > 10 ? 'YELLOW' :
    'GREEN';

  const snapshot: HealthSnapshot = {
    timestamp: new Date().toISOString(),
    uptime: Math.round(uptime),
    memory: {
      rss: Math.round(mem.rss / 1048576),
      heapUsed: Math.round(mem.heapUsed / 1048576),
      heapTotal: Math.round(mem.heapTotal / 1048576),
    },
    scanLoop: {
      running: scanRunning,
      lastScanAt,
      scanCount,
      staleSince: isStale ? staleSince : null,
    },
    providers: { ...hb.providerHealth },
    errors: hb.errorCount,
    status,
  };

  // Store
  hb.snapshots.push(snapshot);
  if (hb.snapshots.length > MAX_SNAPSHOTS) {
    hb.snapshots = hb.snapshots.slice(-MAX_SNAPSHOTS);
  }

  return snapshot;
}

// ─── Start heartbeat ────────────────────────────────
export function startHeartbeat(): void {
  if (hb.running && hb.intervalId) return;

  hb.running = true;
  hb.errorCount = 0;

  // Take first snapshot
  takeSnapshot();

  hb.intervalId = setInterval(() => {
    try {
      const snap = takeSnapshot();
      if (snap.status === 'RED') {
        log.warn('System health RED', {
          scanRunning: snap.scanLoop.running,
          staleSince: snap.scanLoop.staleSince,
        });
        // Send Telegram alert (max once every 5 minutes)
        const now = Date.now();
        const lastAlert = (hb as unknown as { lastRedAlert?: number }).lastRedAlert || 0;
        if (now - lastAlert > 5 * 60_000) {
          (hb as unknown as { lastRedAlert: number }).lastRedAlert = now;
          import('@/lib/alerts/telegram').then(({ sendMessage }) => {
            sendMessage(
              `🔴 *ALERT: System Health RED*\n` +
              `Scan Running: ${snap.scanLoop.running}\n` +
              `Last Scan: ${snap.scanLoop.lastScanAt || 'never'}\n` +
              `Memory: ${snap.memory.rss}MB\n` +
              `Errors: ${snap.errors}`
            ).catch(() => {});
          }).catch(() => {});
        }
      }
    } catch (err) {
      log.error('Heartbeat snapshot failed', { error: (err as Error).message });
    }
  }, HEARTBEAT_INTERVAL_MS);

  log.info('Heartbeat started', { intervalMs: HEARTBEAT_INTERVAL_MS });
}

// ─── Stop heartbeat ────────────────────────────────
export function stopHeartbeat(): void {
  if (hb.intervalId) {
    clearInterval(hb.intervalId);
    hb.intervalId = null;
  }
  hb.running = false;
  log.info('Heartbeat stopped');
}

// ─── Get latest snapshot ────────────────────────────
export function getHealthSnapshot(): HealthSnapshot | null {
  return hb.snapshots.length > 0 ? hb.snapshots[hb.snapshots.length - 1] : null;
}

// ─── Get snapshot history ───────────────────────────
export function getSnapshotHistory(limit = 30): HealthSnapshot[] {
  return hb.snapshots.slice(-limit);
}

// ─── Get a fresh snapshot (for serverless API routes) ─
export function getFreshHealthSnapshot(): HealthSnapshot {
  return takeSnapshot();
}
