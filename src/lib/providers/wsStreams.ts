import { EventEmitter } from 'events';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('WS-Stream');

/**
 * WebSocket Stream Manager — DISABLED (MEXC Migration)
 * 
 * Binance WS connection was disabled during MEXC migration.
 * This stub maintains the interface so imports don't break,
 * but performs no actual WebSocket connections.
 * 
 * Re-enable when MEXC WebSocket integration is implemented.
 */
export class WsStreamManager extends EventEmitter {
  private static instance: WsStreamManager;
  private isConnected = false;
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
    log.info('🔌 [WS] WebSocket bypassed (MEXC migration — no active WS streams)');
    this.isConnected = true;
  }

  public subscribe(streams: string[]) {
    for (const s of streams) this.activeStreams.add(s);
    log.info(`📡 [WS] Stream subscribe request stored (inactive): ${streams.join(', ')}`);
  }

  public unsubscribe(streams: string[]) {
    for (const s of streams) this.activeStreams.delete(s);
  }
}
