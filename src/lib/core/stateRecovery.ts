// ============================================================
// State Recovery — Restores in-memory state after a crash
// Reconciles pending decisions, restores executions, and resets daily loss
// ============================================================
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@/lib/core/logger';
import { getDecisions, getBotConfig } from '@/lib/store/db';
import { restoreExecutionLog, ExecutionResult } from '@/lib/engine/executor';
import { recordDailyLoss } from '@/lib/engine/riskManager';

const log = createLogger('StateRecovery');

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_RECOVERY_FILE = path.join(DATA_DIR, 'state-snapshot.json');

interface InMemorySnapshot {
  timestamp: string;
  execLog: ExecutionResult[];
}

// ─── Save in-memory snapshot ────────────────────────
export function persistStateSnapshot(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Access executor's log directly from the exported getter
    const execLog = getExecutionLog();
    
    // We only keep executions from the last 24 hours to prevent ballooning file
    const recentOpts = execLog.filter(e => {
      if (!e.timestamp) return false;
      return Date.now() - new Date(e.timestamp).getTime() < 86400_000;
    });

    const snapshot: InMemorySnapshot = {
      timestamp: new Date().toISOString(),
      execLog: recentOpts,
    };

    // Atomic write
    const tempFile = `${STATE_RECOVERY_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(snapshot, null, 2), 'utf-8');
    fs.renameSync(tempFile, STATE_RECOVERY_FILE);
    
  } catch (err) {
    log.error('Failed to persist state snapshot', { error: (err as Error).message });
  }
}

// ─── Recover state on boot ──────────────────────────
export function recoverStateOnBoot(): void {
  log.info('Running state recovery on boot...');

  // 1. Recover Execution Log
  if (fs.existsSync(STATE_RECOVERY_FILE)) {
    try {
      const raw = fs.readFileSync(STATE_RECOVERY_FILE, 'utf-8');
      const snapshot = JSON.parse(raw) as InMemorySnapshot;
      
      if (snapshot.execLog && Array.isArray(snapshot.execLog)) {
        restoreExecutionLog(snapshot.execLog);
        log.info(`Restored ${snapshot.execLog.length} execution records from snapshot`);
      }
    } catch (err) {
      log.warn('State snapshot corrupted or missing, starting fresh memory state.', { error: (err as Error).message });
    }
  }

  // 2. Re-calculate daily loss from Decisions
  try {
    const today = new Date().toISOString().slice(0, 10);
    const decisions = getDecisions();
    
    let dailyLoss = 0;
    for (const d of decisions) {
      if (d.timestamp.startsWith(today) && d.outcome !== 'PENDING' && typeof d.pnlPercent === 'number' && d.pnlPercent < 0) {
        dailyLoss += Math.abs(d.pnlPercent);
      }
    }

    if (dailyLoss > 0) {
      recordDailyLoss(dailyLoss);
      log.info(`Rebuilt daily loss accumulator: ${dailyLoss.toFixed(2)}%`);
    } else {
      recordDailyLoss(0);
    }
  } catch (err) {
    log.warn('Failed to rebuild daily loss', { error: (err as Error).message });
  }

  // 3. Start snapshot loop (every 10 minutes)
  const g = globalThis as unknown as { __recoveryInterval?: ReturnType<typeof setInterval> };
  if (!g.__recoveryInterval) {
    g.__recoveryInterval = setInterval(() => {
      persistStateSnapshot();
    }, 10 * 60_000); // 10 minutes
  }

  log.info('State recovery complete');
}

// Private helper just to avoid cycles:
function getExecutionLog(): ExecutionResult[] {
  const g = globalThis as unknown as { __execLog?: ExecutionResult[] };
  return g.__execLog || [];
}
