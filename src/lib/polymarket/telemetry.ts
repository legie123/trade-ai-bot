// ============================================================
// Polymarket Telemetry — Event Logging to Supabase
// Captures all significant events in the Polymarket trading engine
// ============================================================

import { supabase } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyTelemetry');

export type PolyEventType =
  | 'SCAN_COMPLETE'
  | 'BET_PLACED'
  | 'BET_RESOLVED'
  | 'POSITION_OPENED'
  | 'POSITION_CLOSED'
  | 'RISK_HALT'
  | 'RISK_RESUME'
  | 'DRAWDOWN_ALERT'
  | 'LLM_ANALYSIS'
  | 'GLADIATOR_PROMOTED'
  | 'GLADIATOR_RETIRED'
  | 'WALLET_RESET'
  | 'ERROR';

export interface PolyEvent {
  id: string;
  type: PolyEventType;
  division?: string;
  marketId?: string;
  strategyId?: string;
  gladiatorId?: string;
  direction?: string;
  amount?: number;
  pnl?: number;
  details: Record<string, unknown>;
  timestamp: string;
}

// ─── In-Memory Event Buffer ─────────────────────────
const MAX_BUFFER_SIZE = 500;
let eventBuffer: PolyEvent[] = [];

// ─── Log a Polymarket Event ─────────────────────────
export function logPolyEvent(
  type: PolyEventType,
  details: Record<string, unknown>,
  context?: {
    division?: string;
    marketId?: string;
    strategyId?: string;
    gladiatorId?: string;
    direction?: string;
    amount?: number;
    pnl?: number;
  }
): PolyEvent {
  const event: PolyEvent = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    division: context?.division,
    marketId: context?.marketId,
    strategyId: context?.strategyId,
    gladiatorId: context?.gladiatorId,
    direction: context?.direction,
    amount: context?.amount,
    pnl: context?.pnl,
    details,
    timestamp: new Date().toISOString(),
  };

  // Add to memory buffer
  eventBuffer.unshift(event);
  if (eventBuffer.length > MAX_BUFFER_SIZE) {
    eventBuffer = eventBuffer.slice(0, MAX_BUFFER_SIZE);
  }

  // Sync to cloud
  syncEventsToCloud();

  log.debug(`Event logged: ${type}`, { eventId: event.id });

  return event;
}

// ─── Sync events to Supabase ────────────────────────
async function syncEventsToCloud() {
  try {
    // Fire and forget — don't block on cloud sync
    (async () => {
      try {
        // Use syncToCloud pattern from db.ts (via module-level sync task)
        // For direct Supabase, we upsert the entire events array under 'poly_events'
        const { error } = await supabase.from('json_store').upsert({
          id: 'poly_events',
          data: eventBuffer.slice(0, MAX_BUFFER_SIZE),
        });

        if (error) {
          log.warn('Failed to sync Polymarket events to cloud', {
            error: error.message,
            bufferSize: eventBuffer.length,
          });
        }
      } catch (err) {
        log.warn('Polymarket telemetry sync failed', {
          error: String(err),
        });
      }
    })();
  } catch (err) {
    log.error('Telemetry sync queue error', { error: String(err) });
  }
}

// ─── Get Events from Memory Buffer ──────────────────
export function getPolyEvents(
  type?: PolyEventType,
  limit: number = 100
): PolyEvent[] {
  let result = eventBuffer;

  if (type) {
    result = result.filter((e) => e.type === type);
  }

  return result.slice(0, limit);
}

// ─── Get Event Summary ──────────────────────────────
export interface PolyEventSummary {
  totalEvents: number;
  eventsByType: Record<PolyEventType, number>;
  lastEventTime: string | null;
  lastEventType: PolyEventType | null;
}

export function getPolyEventsSummary(): PolyEventSummary {
  const eventsByType: Record<PolyEventType, number> = {
    SCAN_COMPLETE: 0,
    BET_PLACED: 0,
    BET_RESOLVED: 0,
    POSITION_OPENED: 0,
    POSITION_CLOSED: 0,
    RISK_HALT: 0,
    RISK_RESUME: 0,
    DRAWDOWN_ALERT: 0,
    LLM_ANALYSIS: 0,
    GLADIATOR_PROMOTED: 0,
    GLADIATOR_RETIRED: 0,
    WALLET_RESET: 0,
    ERROR: 0,
  };

  for (const event of eventBuffer) {
    eventsByType[event.type]++;
  }

  return {
    totalEvents: eventBuffer.length,
    eventsByType,
    lastEventTime: eventBuffer.length > 0 ? eventBuffer[0].timestamp : null,
    lastEventType: eventBuffer.length > 0 ? eventBuffer[0].type : null,
  };
}

// ─── Clear/Reset Events (for testing or manual cleanup) ─
export function clearPolyEvents(): void {
  eventBuffer = [];
  log.info('Polymarket event buffer cleared');
}

// ─── Get raw buffer (for diagnostics) ────────────────
export function getEventBuffer(): PolyEvent[] {
  return [...eventBuffer];
}
