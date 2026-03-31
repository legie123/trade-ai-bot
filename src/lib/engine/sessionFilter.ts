// ============================================================
// Session Timing Filter — Crypto market session-aware trading
// Asian/London/NY sessions have distinct patterns for crypto
// ============================================================
import { createLogger } from '@/lib/core/logger';

const log = createLogger('SessionFilter');

export type SessionName = 'ASIAN' | 'LONDON' | 'NY_OPEN' | 'NY_CLOSE' | 'OFF_HOURS';

export interface SessionInfo {
  session: SessionName;
  multiplier: number;      // Confidence multiplier (0.5 - 1.3)
  volatility: 'LOW' | 'MEDIUM' | 'HIGH';
  bestFor: string;
  reason: string;
}

// Session definitions (UTC hours)
const SESSIONS: { name: SessionName; start: number; end: number; multiplier: number; volatility: 'LOW' | 'MEDIUM' | 'HIGH'; bestFor: string }[] = [
  { name: 'ASIAN',     start: 0,  end: 8,  multiplier: 0.7,  volatility: 'LOW',    bestFor: 'Accumulation / Range' },
  { name: 'LONDON',    start: 8,  end: 12, multiplier: 1.3,  volatility: 'HIGH',   bestFor: 'Breakouts / Reversals' },
  { name: 'NY_OPEN',   start: 13, end: 17, multiplier: 1.2,  volatility: 'HIGH',   bestFor: 'Momentum / Continuation' },
  { name: 'NY_CLOSE',  start: 17, end: 21, multiplier: 0.8,  volatility: 'MEDIUM', bestFor: 'Reversals / Caution' },
  { name: 'OFF_HOURS', start: 21, end: 0,  multiplier: 0.6,  volatility: 'LOW',    bestFor: 'Avoid new entries' },
];

/**
 * Get current session info based on UTC time
 */
export function getCurrentSession(utcHour?: number): SessionInfo {
  const hour = utcHour ?? new Date().getUTCHours();

  for (const s of SESSIONS) {
    if (s.start <= s.end) {
      if (hour >= s.start && hour < s.end) {
        return {
          session: s.name,
          multiplier: s.multiplier,
          volatility: s.volatility,
          bestFor: s.bestFor,
          reason: `${s.name} session (${s.start}:00-${s.end}:00 UTC) — ${s.bestFor}`,
        };
      }
    } else {
      // Wraps around midnight (OFF_HOURS: 21-0)
      if (hour >= s.start || hour < s.end) {
        return {
          session: s.name,
          multiplier: s.multiplier,
          volatility: s.volatility,
          bestFor: s.bestFor,
          reason: `${s.name} session — ${s.bestFor}`,
        };
      }
    }
  }

  // Fallback
  return {
    session: 'OFF_HOURS',
    multiplier: 0.6,
    volatility: 'LOW',
    bestFor: 'Avoid',
    reason: 'Off-hours — low liquidity',
  };
}

/**
 * Apply session filter to a signal confidence
 * Returns adjusted confidence and whether to trade
 */
export function applySessionFilter(
  confidence: number,
  signalType: 'BUY' | 'SELL' | 'LONG' | 'SHORT'
): { adjustedConfidence: number; sessionInfo: SessionInfo; shouldTrade: boolean } {
  const session = getCurrentSession();

  // London open is the best session for reversals after Asian range
  // NY open best for momentum continuation
  let multiplier = session.multiplier;

  // Bonus: SELL signals during NY_CLOSE are more reliable (end-of-day distribution)
  if (session.session === 'NY_CLOSE' && (signalType === 'SELL' || signalType === 'SHORT')) {
    multiplier = 1.1;
  }

  // Penalty: BUY during OFF_HOURS is very risky (low liquidity wicks)
  if (session.session === 'OFF_HOURS' && (signalType === 'BUY' || signalType === 'LONG')) {
    multiplier = 0.5;
  }

  const adjustedConfidence = Math.min(100, Math.round(confidence * multiplier)); // Cap at 100
  const shouldTrade = adjustedConfidence >= 70; // Only trade if adjusted confidence is high enough

  log.debug(`Session: ${session.session} | Confidence: ${confidence}→${adjustedConfidence} | x${multiplier}`);

  return { adjustedConfidence, sessionInfo: session, shouldTrade };
}
