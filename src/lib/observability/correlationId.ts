// ============================================================
// correlationId — P2-6a + P2-6b (2026-04-20)
// End-to-end request-scoped identifier for audit trail + debugging.
//
// WHY: Cron tick → in-process arena scanners (btc/solana/meme) →
// ManagerVizionar → DualMaster → addSyndicateAudit. Without a shared ID,
// correlating a Grafana Loki log line back to the originating tick or
// Supabase audit row means grep-gymnastics across 6+ modules.
//
// CONVENTION: `cid_<ms-epoch>_<8-hex>` — time-sortable prefix, short enough
// to paste in Grafana filters without line-wrap. NOT a UUID: we do not need
// crypto-grade uniqueness for intra-day audit trail (collision prob on 8 hex
// chars within a 1s window with <10 concurrent ticks is ~10^-8).
//
// KILL-SWITCH: CORRELATION_ID_ENABLED=off → newCorrelationId() returns ''.
// All callers must treat "" as "no cid this tick" and skip header injection.
// Downstream code that logs `cid=${x}` just prints `cid=` (cosmetic; no crash).
// addSyndicateAudit writes NULL into correlation_id column when cid is "".
//
// ASUMPȚIE: globalThis.crypto.randomUUID() available (Node 19+ / Cloud Run gen2).
// Fallback via Math.random() if absent — NOT collision-safe, but kill-switch
// off already means "don't rely on cid", so fallback is acceptable.
// ============================================================

export function newCorrelationId(): string {
  if (process.env.CORRELATION_ID_ENABLED === 'off') return '';

  let hex8: string;
  try {
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    const uuid = g.crypto?.randomUUID?.();
    hex8 = uuid ? uuid.replace(/-/g, '').slice(0, 8) : Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  } catch {
    hex8 = Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  }
  return `cid_${Date.now()}_${hex8}`;
}

// Helper for callers that want "keep the one passed in, or mint new".
// ASUMPȚIE: empty string ("") means "kill-switch off — do not mint a replacement".
// Only mints when cid is undefined/null. Preserves caller intent.
export function ensureCorrelationId(cid: string | null | undefined): string {
  if (cid === '') return '';           // respect kill-switch propagation
  if (cid) return cid;                 // preserve upstream cid
  return newCorrelationId();           // mint fresh
}

// ============================================================
// AsyncLocalStorage layer — P2-6b (2026-04-20)
//
// WHY: cron → arena scanner GETs are IN-PROCESS imports, not HTTP fetches.
// No headers → no x-correlation-id. We need request-scoped context that
// flows across await boundaries. AsyncLocalStorage does exactly this
// (Node 16+ stable API, used by every serious tracing lib).
//
// USAGE:
//   // cron side (wrap the scanner block):
//   await cidContext.run(cid, async () => {
//     await Promise.allSettled([runBtc(), runSolana(), runMeme()]);
//   });
//
//   // arena side (deep inside processSignal / stamping):
//   const cid = getCurrentCid();   // '' if outside a run() scope
//
// KILL-SWITCH: if CORRELATION_ID_ENABLED=off → newCorrelationId returns '',
// cidContext.run('', ...) still works but getCurrentCid() returns ''.
// Downstream `if (cid) ...` guards make this a no-op. Safe.
//
// ASUMPȚIE: single-threaded Node runtime per tick (Cloud Run gen2). Per-async
// context is isolated by default. Cross-tick contamination impossible.
// ============================================================
import { AsyncLocalStorage } from 'node:async_hooks';

export const cidContext = new AsyncLocalStorage<string>();

/** Returns the current async-scope cid or '' if outside a cidContext.run() scope. */
export function getCurrentCid(): string {
  return cidContext.getStore() ?? '';
}
