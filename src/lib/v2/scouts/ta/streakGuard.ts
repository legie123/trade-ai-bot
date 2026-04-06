// ============================================================
// Loss Streak Guard — Adaptive risk reduction during drawdowns
// Calibration #9: protects against consecutive losses & deep drawdowns
// ============================================================
import { getDecisions } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('StreakGuard');

export interface StreakStatus {
  consecutiveLosses: number;
  action: 'NORMAL' | 'REDUCE' | 'PAUSE' | 'COOLOFF';
  confidenceBoost: number;   // Added to MIN_CONFIDENCE threshold (0 = normal, +10 = stricter)
  cooloffMinutes: number;    // Extra cooldown minutes to add
  reason: string;
}

/**
 * Analyze recent trade outcomes and determine risk adjustment
 * 
 * Rules:
 * - 0-2 consecutive losses: NORMAL trading
 * - 3 consecutive losses:   REDUCE — raise confidence threshold by +10
 * - 4 consecutive losses:   PAUSE — raise by +15, add 10min extra cooldown  
 * - 5+ consecutive losses:  COOLOFF — raise by +20, add 30min extra cooldown
 */
export function getStreakStatus(): StreakStatus {
  const decisions = getDecisions();
  
  // Get evaluated decisions, most recent first
  const evaluated = decisions
    .filter(d => d.outcome === 'WIN' || d.outcome === 'LOSS')
    .sort((a, b) => new Date(b.evaluatedAt || b.timestamp).getTime() - new Date(a.evaluatedAt || a.timestamp).getTime());

  if (evaluated.length === 0) {
    return { consecutiveLosses: 0, action: 'NORMAL', confidenceBoost: 0, cooloffMinutes: 0, reason: 'No history' };
  }

  // Count consecutive losses from most recent
  let consecutiveLosses = 0;
  for (const d of evaluated) {
    if (d.outcome === 'LOSS') {
      consecutiveLosses++;
    } else {
      break; // First WIN breaks the streak
    }
  }

  if (consecutiveLosses >= 5) {
    log.warn(`🛑 COOLOFF MODE: ${consecutiveLosses} consecutive losses — heavy restrictions active`);
    return {
      consecutiveLosses,
      action: 'COOLOFF',
      confidenceBoost: 20,   // MIN_CONFIDENCE becomes 90%
      cooloffMinutes: 30,     // 30min extra cooldown on all signals
      reason: `${consecutiveLosses} loss streak — COOLOFF: conf+20, +30min cooldown`,
    };
  }

  if (consecutiveLosses >= 4) {
    log.warn(`⚠️ PAUSE MODE: ${consecutiveLosses} consecutive losses`);
    return {
      consecutiveLosses,
      action: 'PAUSE',
      confidenceBoost: 15,
      cooloffMinutes: 10,
      reason: `${consecutiveLosses} loss streak — PAUSE: conf+15, +10min cooldown`,
    };
  }

  if (consecutiveLosses >= 3) {
    log.info(`⚡ REDUCE MODE: ${consecutiveLosses} consecutive losses`);
    return {
      consecutiveLosses,
      action: 'REDUCE',
      confidenceBoost: 10,   // MIN_CONFIDENCE becomes 80%
      cooloffMinutes: 0,
      reason: `${consecutiveLosses} loss streak — REDUCE: conf+10`,
    };
  }

  return {
    consecutiveLosses,
    action: 'NORMAL',
    confidenceBoost: 0,
    cooloffMinutes: 0,
    reason: consecutiveLosses > 0 ? `${consecutiveLosses} loss(es) — within tolerance` : 'Healthy streak',
  };
}
