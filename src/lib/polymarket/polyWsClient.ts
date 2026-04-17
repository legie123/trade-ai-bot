// ============================================================
// Polymarket WebSocket Client — real-time market channel
//
// ⚠️ PAPER TRADING ONLY ⚠️
// This client READS market events (price, orderbook, trades).
// It never places real orders. Orders are gated globally by
// src/lib/core/tradingMode.ts — regardless of what this file does.
//
// ADDITIVE: this file is brand-new. It does NOT replace polyClient.ts
// (which remains the REST/Gamma/CLOB client). AlphaScout, marketScanner
// and polyGladiators keep working exactly as before.
//
// Consumers:
//   - opportunityRanker (Phase 2 Layer E, next batch)
//   - orderbookIntel    (Phase 2 Layer E, next batch)
//   - /api/v2/polymarket?action=feed-health
//   - /api/live-stream (aggregate feed health)
//
// The endpoint and message shapes follow Polymarket's public CLOB WS
// market channel. If the endpoint changes, only adapt this module.
// ============================================================
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { createLogger } from '@/lib/core/logger';
import { recordProviderHealth } from '@/lib/core/heartbeat';

const log = createLogger('PolyWS');

// Resilience constants (mirrors wsStreams for uniformity)
const PING_INTERVAL_MS = 25_000;
const STALE_THRESHOLD_MS = 60_000;
const STALE_CHECK_INTERVAL_MS = 10_000;
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_CAP_MS = 60_000;
const MAX_CACHE_ENTRIES = 500;

// Default endpoint. Override via POLYMARKET_WS_URL env.
const DEFAULT_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

export type PolyWsChannel = 'market';
export type PolyWsEventType = 'price_change' | 'book' | 'trade' | 'last_trade_price' | 'tick_size_change' | 'unknown';

export interface PolyWsEvent {
  type: PolyWsEventType;
  assetId?: string;           // token / outcome id
  marketSlug?: string;        // optional if we can correlate
  price?: number;
  size?: number;
  side?: 'BUY' | 'SELL';
  raw: unknown;               // original payload for debugging
  receivedAt: number;
}

export interface PolyFeedHealth {
  provider: 'polymarket-ws';
  url: string;
  connected: boolean;
  stale: boolean;
  lastMessageAgoMs: number | null;
  lastOpenAt: number | null;
  lastCloseAt: number | null;
  reconnectAttempts: number;
  totalReconnects: number;
  subscribedAssets: number;
  eventsReceived: number;
}

export class PolyWsClient extends EventEmitter {
  private static instance: PolyWsClient | null = null;
  private ws: WebSocket | null = null;
  private url: string;

  private isConnected = false;
  private isStale = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private staleTimer: NodeJS.Timeout | null = null;

  private lastMessageAt = 0;
  private lastOpenAt = 0;
  private lastCloseAt = 0;
  private reconnectAttempts = 0;
  private totalReconnects = 0;
  private eventsReceived = 0;

  private subscribedAssets: Set<string> = new Set();

  // Hot cache: last event per assetId (quick read for rankers)
  private lastEventByAsset: Map<string, PolyWsEvent> = new Map();

  private constructor() {
    super();
    this.url = process.env.POLYMARKET_WS_URL || DEFAULT_WS_URL;
  }

  public static getInstance(): PolyWsClient {
    if (!PolyWsClient.instance) {
      PolyWsClient.instance = new PolyWsClient();
    }
    return PolyWsClient.instance;
  }

  public connect(): void {
    if (this.isConnected || this.ws) return;

    log.info(`🔌 [PolyWS] Connecting to ${this.url}`);
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      log.error('[PolyWS] WebSocket constructor threw', { error: (err as Error).message });
      recordProviderHealth('polymarket-ws', false, null);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      log.info('🟢 [PolyWS] Connected to Polymarket market channel');
      this.isConnected = true;
      this.lastOpenAt = Date.now();
      this.lastMessageAt = Date.now();
      this.isStale = false;
      this.reconnectAttempts = 0;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      recordProviderHealth('polymarket-ws', true, null);

      this.startPing();
      this.startStaleWatchdog();

      if (this.subscribedAssets.size > 0) {
        this.sendSubscribe(Array.from(this.subscribedAssets));
      }
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const text = data.toString();
        // Polymarket sometimes sends a literal "PONG" string or heartbeats
        // Do NOT count PING/PONG toward lastMessageAt — only real data resets stale timer
        if (text === 'PONG' || text === 'PING') return;

        this.lastMessageAt = Date.now();
        if (this.isStale) {
          log.info('🟢 [PolyWS] Feed recovered from STALE');
          this.isStale = false;
          recordProviderHealth('polymarket-ws', true, null);
        }
        const payload = JSON.parse(text);
        this.handleMessage(payload);
      } catch (err) {
        log.warn('[PolyWS] parse failed', { error: (err as Error).message });
      }
    });

    this.ws.on('close', () => {
      log.warn('🔴 [PolyWS] disconnected');
      this.isConnected = false;
      this.lastCloseAt = Date.now();
      this.ws = null;
      this.stopPing();
      this.stopStaleWatchdog();
      recordProviderHealth('polymarket-ws', false, null);
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      log.error(`[PolyWS] socket error: ${err.message}`);
      recordProviderHealth('polymarket-ws', false, null);
    });
  }

  public disconnect(): void {
    this.stopPing();
    this.stopStaleWatchdog();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
    this.ws = null;
    this.isConnected = false;
  }

  public subscribe(assetIds: string[]): void {
    if (assetIds.length === 0) return;
    const fresh: string[] = [];
    for (const id of assetIds) {
      if (!this.subscribedAssets.has(id)) {
        this.subscribedAssets.add(id);
        fresh.push(id);
      }
    }
    if (fresh.length > 0 && this.isConnected) {
      this.sendSubscribe(fresh);
    }
  }

  public unsubscribe(assetIds: string[]): void {
    for (const id of assetIds) this.subscribedAssets.delete(id);
  }

  private sendSubscribe(assetIds: string[]): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      const msg = {
        type: 'market',
        assets_ids: assetIds,
      };
      this.ws.send(JSON.stringify(msg));
      log.info(`📡 [PolyWS] subscribed to ${assetIds.length} asset(s)`);
    } catch (err) {
      log.warn('[PolyWS] subscribe send failed', { error: (err as Error).message });
    }
  }

  private handleMessage(payload: unknown): void {
    this.eventsReceived++;
    // Polymarket returns either a single event or an array
    if (Array.isArray(payload)) {
      for (const item of payload) this.emitEvent(item);
    } else if (payload && typeof payload === 'object') {
      this.emitEvent(payload as Record<string, unknown>);
    }
  }

  private emitEvent(raw: unknown): void {
    const r = (raw || {}) as Record<string, unknown>;
    const rawType = (r.event_type || r.type || 'unknown') as string;
    let type: PolyWsEventType = 'unknown';
    if (rawType === 'price_change') type = 'price_change';
    else if (rawType === 'book') type = 'book';
    else if (rawType === 'trade') type = 'trade';
    else if (rawType === 'last_trade_price') type = 'last_trade_price';
    else if (rawType === 'tick_size_change') type = 'tick_size_change';

    const assetId = (r.asset_id || r.assetId || r.market || undefined) as string | undefined;
    const priceVal = (r.price || r.p || undefined) as number | string | undefined;
    const sizeVal = (r.size || r.q || undefined) as number | string | undefined;
    const sideVal = (r.side || r.S || undefined) as string | undefined;

    const ev: PolyWsEvent = {
      type,
      assetId,
      price: priceVal != null ? Number(priceVal) : undefined,
      size: sizeVal != null ? Number(sizeVal) : undefined,
      side: sideVal === 'BUY' || sideVal === 'SELL' ? sideVal : undefined,
      raw,
      receivedAt: Date.now(),
    };

    // Update hot cache
    if (assetId) {
      this.lastEventByAsset.set(assetId, ev);
      // LRU trim
      if (this.lastEventByAsset.size > MAX_CACHE_ENTRIES) {
        const firstKey = this.lastEventByAsset.keys().next().value;
        if (firstKey) this.lastEventByAsset.delete(firstKey);
      }
    }

    this.emit('event', ev);
    this.emit(type, ev);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send('PING');
        } catch (err) {
          log.warn('[PolyWS] PING failed', { error: (err as Error).message });
        }
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private startStaleWatchdog(): void {
    this.stopStaleWatchdog();
    this.staleTimer = setInterval(() => {
      if (!this.isConnected) return;
      const age = Date.now() - this.lastMessageAt;
      if (age > STALE_THRESHOLD_MS && !this.isStale) {
        log.warn(`[PolyWS] feed STALE — no message for ${age}ms. Forcing reconnect.`);
        this.isStale = true;
        recordProviderHealth('polymarket-ws', false, null);
        try {
          this.ws?.close();
        } catch {
          /* noop */
        }
      }
    }, STALE_CHECK_INTERVAL_MS);
  }

  private stopStaleWatchdog(): void {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    this.totalReconnects++;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, Math.min(this.reconnectAttempts - 1, 4)),
      RECONNECT_CAP_MS
    );
    log.info(`🔌 [PolyWS] reconnect attempt #${this.reconnectAttempts} in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  public getLastEvent(assetId: string): PolyWsEvent | null {
    return this.lastEventByAsset.get(assetId) || null;
  }

  public getFeedHealth(): PolyFeedHealth {
    return {
      provider: 'polymarket-ws',
      url: this.url,
      connected: this.isConnected,
      stale: this.isStale,
      lastMessageAgoMs: this.lastMessageAt ? Date.now() - this.lastMessageAt : null,
      lastOpenAt: this.lastOpenAt || null,
      lastCloseAt: this.lastCloseAt || null,
      reconnectAttempts: this.reconnectAttempts,
      totalReconnects: this.totalReconnects,
      subscribedAssets: this.subscribedAssets.size,
      eventsReceived: this.eventsReceived,
    };
  }
}

// Convenience singletons for consumers
export const polyWsClient = PolyWsClient.getInstance();

/**
 * Optional opt-in autostart. Kept OFF by default so a missing endpoint
 * never affects existing cron-based scanners. Controlled by env:
 *   POLYMARKET_WS_AUTOSTART=true
 */
if ((process.env.POLYMARKET_WS_AUTOSTART || '').toLowerCase() === 'true') {
  try {
    polyWsClient.connect();
  } catch (err) {
    log.warn('[PolyWS] autostart failed', { error: (err as Error).message });
  }
}
