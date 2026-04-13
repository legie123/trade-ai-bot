// ============================================================
// Event Hub — Centralized alert dispatcher for Trade AI Phoenix V2
// Routes system events to Telegram + Supabase audit log
// ============================================================
import { sendMessage } from '@/lib/alerts/telegram';

export type EventSeverity = 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS';
export type EventCategory =
  | 'KILL_SWITCH'
  | 'PROMOTION'
  | 'DEMOTION'
  | 'TRADE_EXECUTED'
  | 'TRADE_PHANTOM'
  | 'ROTATION'
  | 'HEALTH'
  | 'ERROR'
  | 'SENTINEL'
  | 'OMEGA'
  | 'MONTE_CARLO';

export interface SystemEvent {
  category: EventCategory;
  severity: EventSeverity;
  title: string;
  details: Record<string, unknown>;
  timestamp?: string;
}

const SEVERITY_EMOJI: Record<EventSeverity, string> = {
  INFO: 'ℹ️',
  WARNING: '⚠️',
  CRITICAL: '🚨',
  SUCCESS: '✅',
};

const CATEGORY_EMOJI: Record<EventCategory, string> = {
  KILL_SWITCH: '🛑',
  PROMOTION: '🏆',
  DEMOTION: '📉',
  TRADE_EXECUTED: '💰',
  TRADE_PHANTOM: '👻',
  ROTATION: '🔄',
  HEALTH: '💚',
  ERROR: '❌',
  SENTINEL: '🛡️',
  OMEGA: '🧠',
  MONTE_CARLO: '🎲',
};

// In-memory event log (last 100 events for dashboard)
const eventLog: SystemEvent[] = [];
const MAX_LOG_SIZE = 100;

/**
 * Emit a system event — logs locally + sends Telegram for WARNING/CRITICAL/SUCCESS
 */
export async function emitEvent(event: SystemEvent): Promise<void> {
  event.timestamp = event.timestamp || new Date().toISOString();

  // Store in memory
  eventLog.unshift(event);
  if (eventLog.length > MAX_LOG_SIZE) eventLog.pop();

  // Console log always
  const prefix = `[EventHub][${event.severity}][${event.category}]`;
  console.log(`${prefix} ${event.title}`, JSON.stringify(event.details));

  // Telegram for non-INFO events
  if (event.severity !== 'INFO') {
    const sevEmoji = SEVERITY_EMOJI[event.severity];
    const catEmoji = CATEGORY_EMOJI[event.category];

    const detailLines = Object.entries(event.details)
      .slice(0, 6) // Max 6 detail lines
      .map(([k, v]) => `  ${k}: \`${v}\``)
      .join('\n');

    const text = [
      `${sevEmoji}${catEmoji} *${event.title}*`,
      `Category: ${event.category}`,
      detailLines,
      `⏰ ${event.timestamp}`,
    ].join('\n');

    await sendMessage(text).catch(() => {/* fire-and-forget */});
  }
}

/**
 * Get recent events (for dashboard API)
 */
export function getRecentEvents(limit = 50): SystemEvent[] {
  return eventLog.slice(0, limit);
}

// ─── Convenience emitters ────────────────────────

export async function emitKillSwitch(reason: string, details: Record<string, unknown> = {}): Promise<void> {
  await emitEvent({
    category: 'KILL_SWITCH',
    severity: 'CRITICAL',
    title: `Kill Switch Triggered: ${reason}`,
    details,
  });
}

export async function emitPromotion(gladiatorName: string, stats: Record<string, unknown>): Promise<void> {
  await emitEvent({
    category: 'PROMOTION',
    severity: 'SUCCESS',
    title: `${gladiatorName} promoted to LIVE`,
    details: stats,
  });
}

export async function emitDemotion(gladiatorName: string, reason: string): Promise<void> {
  await emitEvent({
    category: 'DEMOTION',
    severity: 'WARNING',
    title: `${gladiatorName} demoted from LIVE`,
    details: { reason },
  });
}

export async function emitTradeExecuted(symbol: string, direction: string, mode: string, details: Record<string, unknown> = {}): Promise<void> {
  await emitEvent({
    category: mode === 'LIVE' ? 'TRADE_EXECUTED' : 'TRADE_PHANTOM',
    severity: mode === 'LIVE' ? 'SUCCESS' : 'INFO',
    title: `${mode} ${direction} ${symbol}`,
    details,
  });
}

export async function emitSentinelVeto(reason: string, details: Record<string, unknown> = {}): Promise<void> {
  await emitEvent({
    category: 'SENTINEL',
    severity: 'WARNING',
    title: `SentinelGuard VETO: ${reason}`,
    details,
  });
}

export async function emitError(context: string, error: string): Promise<void> {
  await emitEvent({
    category: 'ERROR',
    severity: 'CRITICAL',
    title: `Error in ${context}`,
    details: { error },
  });
}
