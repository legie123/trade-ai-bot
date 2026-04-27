/**
 * eventsStore.ts — Goldsky event ledger (polymarket_events table).
 *
 * FAZA 3.1: Promotes /api/polymarket/ingest from LOG-ONLY → durable,
 * queryable event trail. Append-only. Best-effort: ingest NEVER fails
 * because of a DB glitch (Goldsky would retry indefinitely).
 *
 * ASSUMPTII (invalidare → log warn, ingest continua 2xx):
 *   (1) Supabase e disponibil in majoritatea cazurilor; table + indecsi
 *       aplicati manual via 20260420_polymarket_events.sql
 *   (2) Goldsky payload e JSON; extragem euristic condition_id / tx_hash
 *       / block_number. Schema lor se poate schimba → fallback la raw only.
 *   (3) Rate-limit la ingest gate → nu inserez > 100/min/instance.
 *
 * KILL-SWITCH
 *   POLYMARKET_INGEST_WRITE_ENABLED=0 → insertGoldskyEvent() no-op (return skipped).
 */

import { supabase as supa, SUPABASE_CONFIGURED } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyEventsStore');

export interface GoldskyEventRow {
  id?: number;
  event_id?: string | null;
  pipeline_name?: string | null;
  entity_type?: string | null;
  condition_id?: string | null;
  actor?: string | null;
  block_number?: number | null;
  tx_hash?: string | null;
  raw_payload: unknown;
  received_at?: string;
  processed_at?: string | null;
}

// ── Heuristic payload inspector ─────────────────────────────────
// Goldsky mirror sink forwards the raw subgraph entity. We don't lock to a
// specific schema — we extract what we can, store what's left as raw_payload.
function extractFields(payload: unknown): {
  event_id: string | null;
  entity_type: string | null;
  condition_id: string | null;
  actor: string | null;
  block_number: number | null;
  tx_hash: string | null;
} {
  const fallback = {
    event_id: null,
    entity_type: null,
    condition_id: null,
    actor: null,
    block_number: null,
    tx_hash: null,
  };
  if (!payload || typeof payload !== 'object') return fallback;
  const p = payload as Record<string, unknown>;

  // Common Goldsky/Polymarket field names
  const event_id = asStr(p.id) || asStr(p._id) || asStr(p.event_id) || null;
  const condition_id =
    asStr(p.conditionId) ||
    asStr(p.condition_id) ||
    asStr(p.market) ||
    asStr(p.marketId) ||
    null;
  const actor =
    asStr(p.user) ||
    asStr(p.account) ||
    asStr(p.maker) ||
    asStr(p.taker) ||
    asStr(p.address) ||
    null;
  const block_number = asNum(p.blockNumber) ?? asNum(p.block_number) ?? null;
  const tx_hash = asStr(p.transactionHash) || asStr(p.tx_hash) || asStr(p.txHash) || null;

  // Entity type heuristic: look at a .entity/.type field or infer from shape
  let entity_type: string | null = asStr(p.entity) || asStr(p.type) || asStr(p.__typename) || null;
  if (!entity_type) {
    if ('size' in p && 'price' in p && 'side' in p) entity_type = 'trade';
    else if ('shares' in p && 'user' in p) entity_type = 'position';
    else if ('outcomeTokenAmounts' in p) entity_type = 'resolution';
    else if ('volume' in p || 'liquidity' in p) entity_type = 'market';
  }

  return { event_id, entity_type, condition_id, actor, block_number, tx_hash };
}

function asStr(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}
function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ── Insert ────────────────────────────────────────────────
export async function insertGoldskyEvent(
  pipelineName: string,
  payload: unknown,
): Promise<{ inserted: number; skipped: number; reason?: string }> {
  if (process.env.POLYMARKET_INGEST_WRITE_ENABLED === '0') {
    return { inserted: 0, skipped: 1, reason: 'write_disabled' };
  }
  if (!SUPABASE_CONFIGURED) {
    return { inserted: 0, skipped: 1, reason: 'supabase_unconfigured' };
  }

  // Goldsky can forward single event OR a batch — normalize to array.
  const items: unknown[] = Array.isArray(payload) ? payload : [payload];

  const rows: GoldskyEventRow[] = items.map(item => {
    const ex = extractFields(item);
    return {
      event_id: ex.event_id,
      pipeline_name: pipelineName || null,
      entity_type: ex.entity_type,
      condition_id: ex.condition_id,
      actor: ex.actor,
      block_number: ex.block_number,
      tx_hash: ex.tx_hash,
      raw_payload: item,
    };
  });

  try {
    const { error } = await supa.from('polymarket_events').insert(rows);
    if (error) {
      // Table missing or permission error → soft-fail. Ingest still returns 2xx.
      log.warn('insertGoldskyEvent failed', { error: error.message, rowCount: rows.length });
      return { inserted: 0, skipped: rows.length, reason: error.message };
    }
    return { inserted: rows.length, skipped: 0 };
  } catch (err) {
    log.warn('insertGoldskyEvent threw', { error: String(err), rowCount: rows.length });
    return { inserted: 0, skipped: rows.length, reason: String(err) };
  }
}

// ── Query (paginated) ─────────────────────────────────────
export interface QueryFilter {
  pipeline?: string;
  conditionId?: string;
  entityType?: string;
  sinceIso?: string;
  beforeId?: number;
  limit?: number;
}

export async function queryEvents(filter: QueryFilter = {}): Promise<{
  events: GoldskyEventRow[];
  nextCursor: number | null;
  error?: string;
}> {
  if (!SUPABASE_CONFIGURED) return { events: [], nextCursor: null, error: 'supabase_unconfigured' };

  const limit = Math.max(1, Math.min(filter.limit ?? 100, 500));
  let q = supa.from('polymarket_events').select('*').order('id', { ascending: false }).limit(limit);

  if (filter.pipeline) q = q.eq('pipeline_name', filter.pipeline);
  if (filter.conditionId) q = q.eq('condition_id', filter.conditionId);
  if (filter.entityType) q = q.eq('entity_type', filter.entityType);
  if (filter.sinceIso) q = q.gte('received_at', filter.sinceIso);
  if (filter.beforeId !== undefined) q = q.lt('id', filter.beforeId);

  const { data, error } = await q;
  if (error) return { events: [], nextCursor: null, error: error.message };

  const events = (data ?? []) as GoldskyEventRow[];
  const nextCursor = events.length === limit ? (events[events.length - 1]?.id ?? null) : null;
  return { events, nextCursor };
}

// ── Health / freshness probe ────────────────────────────────
export async function getEventsHealth(): Promise<{
  ok: boolean;
  configured: boolean;
  writeEnabled: boolean;
  lastEventAt: string | null;
  lagSeconds: number | null;
  eventsLast5min: number;
  eventsLast1h: number;
  eventsLast24h: number;
  perPipeline: Array<{ pipeline: string; eventsLast1h: number; lastEventAt: string | null }>;
  error?: string;
}> {
  const writeEnabled = process.env.POLYMARKET_INGEST_WRITE_ENABLED !== '0';
  const base = {
    ok: false,
    configured: SUPABASE_CONFIGURED,
    writeEnabled,
    lastEventAt: null,
    lagSeconds: null,
    eventsLast5min: 0,
    eventsLast1h: 0,
    eventsLast24h: 0,
    perPipeline: [] as Array<{ pipeline: string; eventsLast1h: number; lastEventAt: string | null }>,
  };
  if (!SUPABASE_CONFIGURED) return { ...base, error: 'supabase_unconfigured' };

  const now = Date.now();
  const iso5 = new Date(now - 5 * 60_000).toISOString();
  const iso1h = new Date(now - 60 * 60_000).toISOString();
  const iso24h = new Date(now - 24 * 60 * 60_000).toISOString();

  try {
    const [lastRes, c5, c1h, c24h, perPipe] = await Promise.all([
      supa.from('polymarket_events').select('received_at, pipeline_name').order('received_at', { ascending: false }).limit(1).maybeSingle(),
      supa.from('polymarket_events').select('id', { count: 'exact', head: true }).gte('received_at', iso5),
      supa.from('polymarket_events').select('id', { count: 'exact', head: true }).gte('received_at', iso1h),
      supa.from('polymarket_events').select('id', { count: 'exact', head: true }).gte('received_at', iso24h),
      supa.from('polymarket_events').select('pipeline_name, received_at').gte('received_at', iso1h).order('received_at', { ascending: false }).limit(500),
    ]);

    const lastEventAt = (lastRes.data as { received_at?: string } | null)?.received_at ?? null;
    const lagSeconds = lastEventAt ? Math.max(0, Math.round((now - new Date(lastEventAt).getTime()) / 1000)) : null;

    // Group perPipeline by name
    const agg = new Map<string, { eventsLast1h: number; lastEventAt: string | null }>();
    for (const row of (perPipe.data as Array<{ pipeline_name: string | null; received_at: string }> | null) ?? []) {
      const key = row.pipeline_name ?? 'unknown';
      const cur = agg.get(key) ?? { eventsLast1h: 0, lastEventAt: null };
      cur.eventsLast1h++;
      if (!cur.lastEventAt || row.received_at > cur.lastEventAt) cur.lastEventAt = row.received_at;
      agg.set(key, cur);
    }

    return {
      ok: true,
      configured: true,
      writeEnabled,
      lastEventAt,
      lagSeconds,
      eventsLast5min: c5.count ?? 0,
      eventsLast1h: c1h.count ?? 0,
      eventsLast24h: c24h.count ?? 0,
      perPipeline: Array.from(agg.entries()).map(([pipeline, v]) => ({ pipeline, ...v })),
    };
  } catch (err) {
    return { ...base, error: String(err) };
  }
}
