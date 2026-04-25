import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { createLogger } from '@/lib/core/logger';
import { recordProviderHealth } from '@/lib/core/heartbeat';
import { metrics, safeInc } from '@/lib/observability/metrics';

const log = createLogger('WS-Stream');

// ─── ADDITIVE RESILIENCE CONSTANTS ───
const PING_INTERVAL_MS = 20_000;      // send PING every 20s
const STALE_THRESHOLD_MS = 45_000;    // mark stale if no message in 45s
const STALE_CHECK_INTERVAL_MS = 10_000; // evaluate staleness every 10s
const RECONNECT_BASE_MS = 5_000;      // first reconnect delay
const RECONNECT_CAP_MS = 60_000;      // max backoff
const MAX_CONSECUTIVE_RECONNECTS = 999; // soft cap, logs loudly past this

/**
 * WebSocket Stream Manager (MEXC Native)
 * Automatically converts MEXC V3 WebSocket events into the structure AlphaScout expects.
 *
 * PHASE 2 BATCH 2 HARDENING (additive):
 *   - PING keepalive every 20s
 *   - Stale-feed detection: marks STALE after 45s with no server message
 *   - Exponential backoff reconnect (5s → 10s → 20s → 40s → cap 60s)
 *   - Provider health tracking via heartbeat module
 *   - Public getFeedHealth() for observability
 */
export class WsStreamManager extends EventEmitter {
  private static instance: WsStreamManager;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private activeStreams: Set<string> = new Set();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private staleTimer: NodeJS.Timeout | null = null;

  // Resilience tracking
  private lastMessageAt = 0;
  private lastOpenAt = 0;
  private lastCloseAt = 0;
  private reconnectAttempts = 0;
  private totalReconnects = 0;
  private isStale = false;

  // Track last kline timestamp to simulate 'closed' (k.x = true)
  private lastKlineTime: Map<string, number> = new Map();

  private constructor() {
    super();
  }

  public static getInstance(): WsStreamManager {
    if (!WsStreamManager.instance) {
      WsStreamManager.instance = new WsStreamManager();
    }
    return WsStreamManager.instance;
  }

  public connect(): void {
    // AUDIT FIX C6a: Don't bail if ws is a zombie (non-OPEN ref left over from prior session).
    // Prior guard `if (this.isConnected || this.ws) return;` trapped us in a dead state where
    // `ws` exists but readyState !== OPEN → no reconnect ever fired.
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) return;

    // Clean up any zombie ws ref before reconnecting.
    //
    // AUDIT FIX C6c (2026-04-18): calling `terminate()` on a socket in
    // CONNECTING state triggers an ASYNC 'error' event ("WebSocket was closed
    // before the connection was established"). Because we already called
    // `removeAllListeners()`, there is no error handler attached → Node
    // surfaces it as `uncaughtException`, which can crash the Cloud Run
    // container. Observed live every ~5min since C6b tick-level health check
    // amplified the race (tick forces reconnect while prior socket still
    // CONNECTING).
    //
    // Fix: (a) skip terminate() on CONNECTING — socket will close itself or
    // surface error on its own listener which we keep attached; (b) attach a
    // noop error handler BEFORE terminate for CLOSING/CLOSED state to absorb
    // any residual async error.
    //
    // ASUMPȚIE: orphaned CONNECTING socket will not leak beyond ~15s because
    // WebSocket constructor has its own internal connection timeout. If that
    // asumption breaks, we have a tiny handle leak (acceptable vs. crash).
    if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
      const prev = this.ws;
      if (prev.readyState === WebSocket.CONNECTING) {
        // Leave CONNECTING sockets alone — attach noop to absorb any error
        // from the handshake racing with our new connect(), then drop ref.
        try { prev.on('error', () => { /* absorb */ }); } catch { /* ignore */ }
      } else {
        // CLOSING/CLOSED: safe to terminate, but still guard against async error.
        try {
          prev.on('error', () => { /* absorb */ });
          prev.removeAllListeners('message');
          prev.removeAllListeners('open');
          prev.removeAllListeners('close');
          prev.terminate();
        } catch { /* ignore */ }
      }
      this.ws = null;
      this.isConnected = false;
    }

    log.info('🔌 [WS] Connecting to MEXC WebSocket...');
    this.ws = new WebSocket('wss://wbs.mexc.com/ws');

    this.ws.on('open', () => {
      log.info('🟢 [WS] MEXC WebSocket connected');
      this.isConnected = true;
      this.lastOpenAt = Date.now();
      this.lastMessageAt = Date.now();
      this.isStale = false;
      this.reconnectAttempts = 0; // reset backoff on successful open
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      recordProviderHealth('mexc-ws', true, null);

      // Start keepalive + stale watchdog
      this.startPing();
      this.startStaleWatchdog();

      // Resubscribe active streams
      if (this.activeStreams.size > 0) {
        this.sendSubscribe(Array.from(this.activeStreams));
      }
    });

    this.ws.on('message', (data: Buffer) => {
      this.lastMessageAt = Date.now();
      if (this.isStale) {
        log.info('🟢 [WS] MEXC feed recovered from STALE');
        this.isStale = false;
        recordProviderHealth('mexc-ws', true, null);
      }
      try {
        const payload = JSON.parse(data.toString());
        // Swallow server pong/ack frames (no c/d fields)
        this.handleMexcMessage(payload);
      } catch (err) {
        log.warn('Failed to parse MEXC WS message', { error: (err as Error).message });
      }
    });

    this.ws.on('close', () => {
      log.warn('🔴 [WS] MEXC WebSocket disconnected');
      this.isConnected = false;
      this.lastCloseAt = Date.now();
      this.ws = null;
      this.stopPing();
      this.stopStaleWatchdog();
      recordProviderHealth('mexc-ws', false, null);
      // P1-2: stale-watchdog already set this.isStale=true before forcing close.
      // Distinguish: stale_watchdog vs plain close.
      this.scheduleReconnect(this.isStale ? 'stale_watchdog' : 'close');
    });

    this.ws.on('error', (err) => {
      log.error(`[WS] MEXC Error: ${err.message}`);
      recordProviderHealth('mexc-ws', false, null);
      // 'close' event will fire after 'error' on most ws errors. Counter is
      // bumped there with reason=close. We record error-only via log.
    });
  }

  private scheduleReconnect(reason: 'close' | 'stale_watchdog' | 'error' | 'unknown' = 'close') {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    this.totalReconnects++;
    safeInc(metrics.wsReconnects, { provider: 'mexc-ws', reason });
    if (this.reconnectAttempts > MAX_CONSECUTIVE_RECONNECTS) {
      log.error(`[WS] MEXC max consecutive reconnects (${MAX_CONSECUTIVE_RECONNECTS}) reached — continuing with capped backoff`);
    }
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, Math.min(this.reconnectAttempts - 1, 4)),
      RECONNECT_CAP_MS
    );
    log.info(`🔌 [WS] Reconnect attempt #${this.reconnectAttempts} in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          // MEXC V3 accepts PING as a JSON method
          this.ws.send(JSON.stringify({ method: 'PING' }));
        } catch (err) {
          log.warn('[WS] PING send failed', { error: (err as Error).message });
        }
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private startStaleWatchdog() {
    this.stopStaleWatchdog();
    this.staleTimer = setInterval(() => {
      if (!this.isConnected) return;
      const age = Date.now() - this.lastMessageAt;
      if (age > STALE_THRESHOLD_MS && !this.isStale) {
        log.warn(`[WS] MEXC feed STALE — no message for ${age}ms. Forcing reconnect.`);
        this.isStale = true;
        recordProviderHealth('mexc-ws', false, null);
        try {
          this.ws?.close();
        } catch (err) {
          log.warn('[WS] close on stale failed', { error: (err as Error).message });
        }
      }
    }, STALE_CHECK_INTERVAL_MS);
  }

  private stopStaleWatchdog() {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
  }

  /**
   * Public observability surface. Consumed by /api/v2/polymarket?action=feed-health
   * and any future dashboard truthfulness layer.
   */
  public getFeedHealth(): {
    provider: 'mexc-ws';
    connected: boolean;
    stale: boolean;
    lastMessageAgoMs: number | null;
    lastOpenAt: number | null;
    lastCloseAt: number | null;
    reconnectAttempts: number;
    totalReconnects: number;
    activeStreams: number;
  } {
    return {
      provider: 'mexc-ws',
      connected: this.isConnected,
      stale: this.isStale,
      lastMessageAgoMs: this.lastMessageAt ? Date.now() - this.lastMessageAt : null,
      lastOpenAt: this.lastOpenAt || null,
      lastCloseAt: this.lastCloseAt || null,
      reconnectAttempts: this.reconnectAttempts,
      totalReconnects: this.totalReconnects,
      activeStreams: this.activeStreams.size,
    };
  }

  // AlphaScout passes Binance-style formatted strings: "btcusdt@kline_1m", "btcusdt@depth10@100ms"
  // We map them to MEXC params before sending
  public subscribe(streams: string[]) {
    for (const s of streams) this.activeStreams.add(s);
    if (this.isConnected) {
      this.sendSubscribe(streams);
    }
  }

  public unsubscribe(streams: string[]) {
    for (const s of streams) this.activeStreams.delete(s);
    // Unsubscription API is not strictly necessary for our passive tracking, but can be added.
  }

  private sendSubscribe(streams: string[]) {
    const mexcParams: string[] = [];
    
    for (const stream of streams) {
      const parts = stream.split('@');
      const binanceSym = parts[0]; // e.g. "btcusdt"
      const mexcSym = binanceSym.toUpperCase();
      
      if (parts[1] === 'kline_1m') {
        mexcParams.push(`spot@public.kline.v3.api@${mexcSym}@Min1`);
      } else if (parts[1].startsWith('depth')) {
        mexcParams.push(`spot@public.limit.depth.v3.api@${mexcSym}@10`);
      }
    }

    if (mexcParams.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: "SUBSCRIPTION",
        params: mexcParams
      }));
      log.info(`📡 [WS] Subscribed to MEXC streams: ${mexcParams.join(', ')}`);
    }
  }

  private handleMexcMessage(msg: Record<string, unknown>) {
    if (!msg.c || !msg.d) return; // Ignore ping/pong or acks

    const channel = msg.c as string;
    const symbol = msg.s as string;
    const lowerSym = symbol.toLowerCase();
    const d = msg.d as Record<string, unknown>;

    // Map MEXC K-Line → Binance format
    if (channel.includes('spot@public.kline.v3.api')) {
      const k = d.k as Record<string, unknown> | undefined;
      if (!k) return;
      
      const eventTime = k.t as number; // start time
      const isClosed = this.lastKlineTime.get(symbol) !== eventTime;
      
      if (isClosed) {
        // Emit the simulated "closed" kline for the PREVIOUS minute
        this.emit('message', {
          stream: `${lowerSym}@kline_1m`,
          data: {
            s: symbol,
            k: {
              x: true,
              c: k.c, // using current open as pseudo-close of prev
              v: k.v  
            }
          }
        });
        this.lastKlineTime.set(symbol, eventTime);
      }
    }
    
    // Map MEXC Depth → Binance format
    else if (channel.includes('spot@public.limit.depth.v3.api')) {
      const bidsArr = (d.bids || d.b || []) as Array<Record<string, unknown> | unknown[]>;
      const asksArr = (d.asks || d.a || []) as Array<Record<string, unknown> | unknown[]>;
      
      const bids = bidsArr.map((x: Record<string, unknown> | unknown[]) => {
        if (Array.isArray(x)) return [x[0], x[1]];
        return [x.p, x.v];
      });
      const asks = asksArr.map((x: Record<string, unknown> | unknown[]) => {
        if (Array.isArray(x)) return [x[0], x[1]];
        return [x.p, x.v];
      });
      
      this.emit('message', {
        stream: `${lowerSym}@depth10@100ms`,
        data: {
          s: symbol,
          b: bids,
          a: asks
        }
      });
    }
  }
}
