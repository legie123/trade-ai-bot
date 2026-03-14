// ============================================================
// Signal Store — in-memory with deduplication
// Uses globalThis to persist across Next.js hot reloads
// ============================================================
import { Signal, WatchlistItem, TradeEntry, DashboardStats } from '@/lib/types/radar';

const MAX_SIGNALS = 200;
const DEDUP_WINDOW_MS = 5_000; // 5 seconds dedup window

class SignalStore {
  signals: Signal[] = [];
  private trades: TradeEntry[] = [];

  addSignal(signal: Signal): { added: boolean; reason?: string } {
    // Check duplicate: same symbol + signal + timeframe within window
    const isDupe = this.signals.some(
      (s) =>
        s.symbol === signal.symbol &&
        s.signal === signal.signal &&
        s.timeframe === signal.timeframe &&
        Math.abs(new Date(s.timestamp).getTime() - new Date(signal.timestamp).getTime()) < DEDUP_WINDOW_MS
    );

    if (isDupe) {
      return { added: false, reason: 'Duplicate signal within dedup window' };
    }

    this.signals.unshift(signal);
    if (this.signals.length > MAX_SIGNALS) {
      this.signals = this.signals.slice(0, MAX_SIGNALS);
    }

    console.log(`[SignalStore] Added: ${signal.signal} ${signal.symbol} @ ${signal.price} (${signal.source})`);
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
  }
}

// ---- Global singleton (survives Next.js dev hot reload) ----
const globalForStore = globalThis as unknown as { __signalStore?: SignalStore };
if (!globalForStore.__signalStore) {
  globalForStore.__signalStore = new SignalStore();
}
export const signalStore: SignalStore = globalForStore.__signalStore;
