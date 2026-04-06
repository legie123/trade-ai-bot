// ============================================================
// Signal Store — in-memory with deduplication
// Uses globalThis to persist across Next.js hot reloads
// ============================================================
import { Signal, TradeEntry, DashboardStats } from '@/lib/types/radar';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('SignalStore');

const MAX_SIGNALS = 200;
const DEDUP_WINDOW_MS = 120_000; // 120 seconds dedup window (matches 2min scan interval)

class SignalStore {
  signals: Signal[] = [];
  private trades: TradeEntry[] = [];
  private dedupHits = 0;
  private dedupTotal = 0;

  addSignal(signal: Signal): { added: boolean; reason?: string } {
    this.dedupTotal++;

    // Dedup: same symbol + signal + timeframe + source within window
    const isDupe = this.signals.some(
      (s) =>
        s.symbol === signal.symbol &&
        s.signal === signal.signal &&
        s.timeframe === signal.timeframe &&
        s.source === signal.source &&
        Math.abs(new Date(s.timestamp).getTime() - new Date(signal.timestamp).getTime()) < DEDUP_WINDOW_MS
    );

    if (isDupe) {
      this.dedupHits++;
      return { added: false, reason: `Duplicate signal within ${DEDUP_WINDOW_MS / 1000}s window` };
    }

    this.signals.unshift(signal);
    if (this.signals.length > MAX_SIGNALS) {
      this.signals = this.signals.slice(0, MAX_SIGNALS);
    }

    log.info(`Added: ${signal.signal} ${signal.symbol} @ ${signal.price} (${signal.source})`);
    return { added: true };
  }

  getSignals(limit = 50): Signal[] {
    return this.signals.slice(0, limit);
  }

  getSignalsToday(): Signal[] {
    const today = new Date().toISOString().split('T')[0];
    return this.signals.filter((s) => s.timestamp.startsWith(today));
  }

  getTrades(limit = 50): TradeEntry[] {
    return this.trades.slice(0, limit);
  }

  getDedupStats(): { hits: number; total: number; rate: string } {
    return {
      hits: this.dedupHits,
      total: this.dedupTotal,
      rate: this.dedupTotal > 0 ? `${Math.round((this.dedupHits / this.dedupTotal) * 100)}%` : '0%',
    };
  }

  getStats(): DashboardStats {
    const todaySignals = this.getSignalsToday();
    const activeAlerts = todaySignals.filter(
      (s) => s.signal === 'BUY' || s.signal === 'SELL' || s.signal === 'LONG' || s.signal === 'SHORT'
    );

    let strongestMover: DashboardStats['strongestMover'] = null;
    if (todaySignals.length > 0) {
      const symbolCounts: Record<string, number> = {};
      for (const s of todaySignals) {
        symbolCounts[s.symbol] = (symbolCounts[s.symbol] || 0) + 1;
      }
      const topSymbol = Object.entries(symbolCounts).sort((a, b) => b[1] - a[1])[0];
      if (topSymbol) {
        strongestMover = { symbol: topSymbol[0], change: topSymbol[1] };
      }
    }

    return {
      totalSignalsToday: todaySignals.length,
      activeAlerts: activeAlerts.length,
      strongestMover,
      lastWebhookAt: this.signals[0]?.timestamp || null,
    };
  }

  clear(): void {
    this.signals = [];
    this.dedupHits = 0;
    this.dedupTotal = 0;
  }
}

// ---- Global singleton (survives Next.js dev hot reload) ----
const globalForStore = globalThis as unknown as { __signalStore?: SignalStore };
if (!globalForStore.__signalStore) {
  globalForStore.__signalStore = new SignalStore();
}
export const signalStore: SignalStore = globalForStore.__signalStore;
