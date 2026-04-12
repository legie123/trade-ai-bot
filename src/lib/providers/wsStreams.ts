import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('WS-Stream');

/**
 * WebSocket Stream Manager (MEXC Native)
 * Automatically converts MEXC V3 WebSocket events into the structure AlphaScout expects.
 */
export class WsStreamManager extends EventEmitter {
  private static instance: WsStreamManager;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private activeStreams: Set<string> = new Set();
  private reconnectTimer: NodeJS.Timeout | null = null;
  
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
    if (this.isConnected || this.ws) return;
    
    log.info('🔌 [WS] Connecting to MEXC WebSocket...');
    this.ws = new WebSocket('wss://wbs.mexc.com/ws');

    this.ws.on('open', () => {
      log.info('🟢 [WS] MEXC WebSocket connected');
      this.isConnected = true;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

      // Resubscribe active streams
      if (this.activeStreams.size > 0) {
        this.sendSubscribe(Array.from(this.activeStreams));
      }
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const payload = JSON.parse(data.toString());
        this.handleMexcMessage(payload);
      } catch (err) {
        log.warn('Failed to parse MEXC WS message', { error: (err as Error).message });
      }
    });

    this.ws.on('close', () => {
      log.warn('🔴 [WS] MEXC WebSocket disconnected');
      this.isConnected = false;
      this.ws = null;
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      log.error(`[WS] MEXC Error: ${err.message}`);
    });
  }

  private scheduleReconnect() {
    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        log.info('🔌 [WS] Attempting to reconnect...');
        this.reconnectTimer = null;
        this.connect();
      }, 5000); // 5 sec backoff
    }
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
