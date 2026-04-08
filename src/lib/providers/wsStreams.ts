import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('WS-Stream');

type BinanceWsEvent = any;

export class WsStreamManager extends EventEmitter {
  private static instance: WsStreamManager;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private reconnectInterval: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;

  // Active streams like: symbol@kline_1m, symbol@depth20@100ms
  private activeStreams: Set<string> = new Set();
  
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
    if (this.isConnected) return;

    log.info('🔌 [WS] Connecting to Binance Futures WS...');
    // Single combined stream endpoint
    this.ws = new WebSocket('wss://fstream.binance.com/stream');

    this.ws.on('open', () => {
      this.isConnected = true;
      log.info('✅ [WS] Connected to Binance Futures Streams');
      if (this.reconnectInterval) clearInterval(this.reconnectInterval);
      
      // Resubscribe to previous streams if this is a reconnect
      if (this.activeStreams.size > 0) {
        this.subscribe(Array.from(this.activeStreams));
      }

      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.ping();
        }
      }, 30000);
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const payload: BinanceWsEvent = JSON.parse(data.toString());
        
        if (payload.stream && payload.data) {
          // Emit based on the stream name
          this.emit(payload.stream, payload.data);
          // And also emit a general multiplexed event
          this.emit('message', payload);
        }
      } catch (err) {
        log.error('❌ [WS] Message Parse Error', { err });
      }
    });

    this.ws.on('close', () => {
      this.isConnected = false;
      log.warn('📴 [WS] Disconnected from Binance, scheduling reconnect...');
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      log.error('❌ [WS] Socket Error', { err });
      this.ws?.close();
    });
  }

  public subscribe(streams: string[]) {
    for (const s of streams) this.activeStreams.add(s);

    if (!this.isConnected || this.ws?.readyState !== WebSocket.OPEN) {
      this.connect(); // Will auto subscribe when connected
      return;
    }

    const payload = {
      method: "SUBSCRIBE",
      params: streams,
      id: Date.now()
    };

    this.ws.send(JSON.stringify(payload));
    log.info(`📡 [WS] Subscribed to streams: ${streams.join(', ')}`);
  }

  public unsubscribe(streams: string[]) {
    for (const s of streams) this.activeStreams.delete(s);

    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      const payload = {
        method: "UNSUBSCRIBE",
        params: streams,
        id: Date.now()
      };
      this.ws.send(JSON.stringify(payload));
    }
  }

  private scheduleReconnect() {
    if (this.reconnectInterval) return;
    this.reconnectInterval = setInterval(() => {
      log.info('🔄 [WS] Attempting to reconnect...');
      this.connect();
    }, 5000);
  }
}
