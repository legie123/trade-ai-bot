// ============================================================
// useRealtimeData — SSE-powered hook for live dashboard updates
// Replaces all polling with a single SSE stream from /api/live-stream
// Falls back to polling if SSE fails after 5 retries
// ============================================================
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

export interface RealtimeDashboard {
  system: { status: string; uptime: number; memoryUsageRssMB: number; syncQueue?: { pending: number; totalCompleted: number; lastSyncComplete: string } };
  watchdog: { status: string; crashCount: number; alive: boolean };
  heartbeat: {
    status: string;
    providers: Record<string, { ok: boolean; lastLatencyMs: number | null }>;
  } | null;
  killSwitch: { engaged: boolean; reason: string | null };
  trading: {
    totalSignals: number;
    pendingDecisions: number;
    executionsToday: number;
    dailyPnlPercent: number;
    openPositions: number;
  };
  logs: {
    recent: { ts: string; level: string; msg: string }[];
    errorCount1h: number;
  };
  history: { ts: string; mem: number; errors: number }[];
}

export interface RealtimeBotStats {
  stats: {
    mode: string;
    totalDecisions: number;
    todayDecisions: number;
    overallWinRate: number;
    todayWinRate: number;
    totalPnlPercent: number;
    todayPnlPercent: number;
    maxDrawdown: number;
    currentStreak: number;
    streakType: string;
    strategyHealth: string;
    optimizerVersion: number;
    lastOptimized: string | null;
  };
  decisions: Array<{
    id: string;
    symbol: string;
    signal: string;
    direction: string;
    confidence: number;
    price: number;
    timestamp: string;
    outcome: string;
    pnlPercent: number | null;
  }>;
  performance: Array<{
    signalType: string;
    source: string;
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgPnlPercent: number;
    bestTrade: number;
    worstTrade: number;
  }>;
  config: {
    mode: string;
    autoOptimize: boolean;
    paperBalance: number;
    riskPerTrade: number;
    maxOpenPositions: number;
    haltedUntil: string | null;
  };
  equityCurve: Array<{
    timestamp: string;
    pnl: number;
    balance: number;
    outcome: string;
    signal: string;
    symbol: string;
  }>;
  balance: number;
  syndicateAudits?: Array<{
    id: string;
    timestamp: string;
    symbol: string;
    decision: string;
    confidence: number;
    architect: { direction: string; confidence: number; reasoning: string };
    oracle: { direction: string; confidence: number; reasoning: string };
  }>;
  gladiators?: Array<{
    id: string;
    status: string;
    arena: string;
    winRate: number;
    trainingProgress: number;
    isOmega?: boolean;
    genes: Record<string, unknown>;
  }>;
  v2Entities?: {
    masters: Array<{ id: string; name: string; role: string; status: string; power: number }>;
    manager: { name: string; role: string; status: string; description: string };
    sentinels: {
      riskShield: { name: string; limit: string; active: boolean; triggered: boolean };
      lossDaily: { name: string; limit: string; active: boolean; triggered: boolean };
    };
    promoter: { name: string; role: string; status: string };
    scouts: { name: string; role: string; status: string };
  };
  activePositions?: Array<{ symbol: string; side: 'LONG'|'SHORT'; entryPrice: number; size: number }>;
}

export interface RealtimeSignal {
  symbol: string;
  signal: string;
  price: number;
  timestamp: string;
  source: string;
  timeframe: string;
  confidence?: number;
}

export interface RealtimePayload {
  dashboard: RealtimeDashboard;
  bot: RealtimeBotStats;
  signals: RealtimeSignal[];
  _meta: {
    timestamp: string;
    streamVersion: string;
    nextPushMs: number;
  };
}

interface UseRealtimeOptions {
  /** Enable/disable SSE connection */
  enabled?: boolean;
  /** Polling fallback interval ms (default 5000) */
  fallbackIntervalMs?: number;
}

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'polling' | 'error';

export function useRealtimeData(options: UseRealtimeOptions = {}) {
  const { enabled = true, fallbackIntervalMs = 5000 } = options;

  const [data, setData] = useState<RealtimePayload | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [updateCount, setUpdateCount] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const fallbackTimerRef = useRef<NodeJS.Timeout | null>(null);
  const sseRecoveryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const maxRetries = 5;
  // ADDITIVE (Phase 2 Batch 5): probe SSE every 2 minutes while in polling
  const SSE_RECOVERY_PROBE_MS = 120_000;

  // Polling fallback
  const startPolling = useCallback(() => {
    setConnectionStatus('polling');
    const poll = async () => {
      try {
        const [dashRes, botRes] = await Promise.allSettled([
          fetch('/api/dashboard').then(r => r.ok ? r.json() : null),
          fetch('/api/bot').then(r => r.ok ? r.json() : null),
        ]);

        const dashboard = dashRes.status === 'fulfilled' ? dashRes.value : null;
        const bot = botRes.status === 'fulfilled' ? botRes.value : null;

        if (dashboard || bot) {
          setData(prev => ({
            dashboard: dashboard || prev?.dashboard || {} as RealtimeDashboard,
            bot: bot || prev?.bot || {} as RealtimeBotStats,
            signals: prev?.signals || [],
            _meta: {
              timestamp: new Date().toISOString(),
              streamVersion: 'polling',
              nextPushMs: fallbackIntervalMs,
            },
          }));
          setLastUpdate(new Date());
          setUpdateCount(c => c + 1);
        }
      } catch { /* silent */ }
    };

    poll(); // immediate
    fallbackTimerRef.current = setInterval(poll, fallbackIntervalMs);

    // ADDITIVE: periodic SSE recovery probe. If /api/live-stream comes back up,
    // switch from polling back to SSE without needing a page reload.
    if (sseRecoveryTimerRef.current) clearInterval(sseRecoveryTimerRef.current);
    sseRecoveryTimerRef.current = setInterval(() => {
      // reset retry counter so connectRef attempts a full SSE cycle again
      retryCountRef.current = 0;
      try {
        connectRef.current();
      } catch { /* noop */ }
    }, SSE_RECOVERY_PROBE_MS);
  }, [fallbackIntervalMs]);

  // SSE connection — uses ref to allow self-referencing without declaration order issues
  useEffect(() => {
    connectRef.current = () => {
      if (!enabled) return;

      // Clean up existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (fallbackTimerRef.current) {
        clearInterval(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }

      setConnectionStatus('connecting');

      const es = new EventSource('/api/live-stream');
      eventSourceRef.current = es;

      es.addEventListener('connected', () => {
        setConnectionStatus('connected');
        retryCountRef.current = 0;
        // ADDITIVE: tear down polling + recovery probe once SSE is up again
        if (fallbackTimerRef.current) {
          clearInterval(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }
        if (sseRecoveryTimerRef.current) {
          clearInterval(sseRecoveryTimerRef.current);
          sseRecoveryTimerRef.current = null;
        }
        if (sseRecoveryTimerRef.current) {
          clearInterval(sseRecoveryTimerRef.current);
          sseRecoveryTimerRef.current = null;
        }
      });

      es.addEventListener('update', (event) => {
        try {
          const payload = JSON.parse(event.data) as RealtimePayload;
          setData(payload);
          setLastUpdate(new Date());
          setUpdateCount(c => c + 1);
          setConnectionStatus('connected');
        } catch { /* parse error */ }
      });

      es.onerror = () => {
        es.close();
        retryCountRef.current++;

        if (retryCountRef.current >= maxRetries) {
          // Fall back to polling
          startPolling();
        } else {
          setConnectionStatus('reconnecting');
          // Exponential backoff: 1s, 2s, 4s, 8s, 16s
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 16_000);
          setTimeout(() => connectRef.current(), delay);
        }
      };
    };
  }, [enabled, startPolling, maxRetries]);

  // Force refresh — triggers a one-time fetch
  const forceRefresh = useCallback(async () => {
    try {
      const [dashRes, botRes] = await Promise.allSettled([
        fetch('/api/dashboard').then(r => r.ok ? r.json() : null),
        fetch('/api/bot').then(r => r.ok ? r.json() : null),
      ]);

      const dashboard = dashRes.status === 'fulfilled' ? dashRes.value : null;
      const bot = botRes.status === 'fulfilled' ? botRes.value : null;

      if (dashboard || bot) {
        setData(prev => ({
          dashboard: dashboard || prev?.dashboard || {} as RealtimeDashboard,
          bot: bot || prev?.bot || {} as RealtimeBotStats,
          signals: prev?.signals || [],
          _meta: {
            timestamp: new Date().toISOString(),
            streamVersion: 'manual',
            nextPushMs: 0,
          },
        }));
        setLastUpdate(new Date());
        setUpdateCount(c => c + 1);
      }
    } catch { /* silent */ }
  }, []);

  // Initial fetch to prevent UI hydration stall for crawlers
  useEffect(() => {
    // eslint-disable-next-line
    if (enabled && !data) forceRefresh();
  }, [enabled, data, forceRefresh]);

  // Reconnect function exposed to consumers
  const reconnect = useCallback(() => {
    retryCountRef.current = 0;
    connectRef.current();
  }, []);

  // Live Binance WebSocket for Open Positions
  const livePricesRef = useRef<Record<string, number>>({});
  
  useEffect(() => {
    const activePositions = data?.bot?.activePositions || [];
    if (activePositions.length === 0) return;

    const symbols = activePositions.map(p => p.symbol.replace('/', '').toLowerCase() + '@aggTrade');
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbols.join('/')}`);

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.s && payload.p) {
          const symbolStr = payload.s.toUpperCase();
          const p = parseFloat(payload.p);
          livePricesRef.current[symbolStr] = p; // mutate ref directly, NO UI re-render
        }
      } catch {}
    };

    // UI Throttler (updates screen at 1 frame per second max)
    const renderThrottle = setInterval(() => {
      setLivePrices(prev => ({ ...prev, ...livePricesRef.current }));
    }, 1000);

    return () => {
      ws.close();
      clearInterval(renderThrottle);
    };
  }, [data?.bot?.activePositions]);

  // Compute augmented data with live Floating PnL
  const augmentedBot = useMemo(() => {
    if (!data?.bot) return null;
    
    // Deep clone stats so we don't accidentally mutate state object
    const bot = { ...data.bot, stats: { ...data.bot.stats } };
    const activePositions = bot.activePositions || [];
    
    if (activePositions.length === 0) {
      if (!bot.balance) bot.balance = bot.config?.paperBalance || 1000;
      return bot;
    }

    const currentBalance = bot.config?.paperBalance || 1000;
    let floatingPnlValue = 0;

    for (const pos of activePositions) {
      const sanitizedSymbol = pos.symbol.replace('/', '').toUpperCase();
      const currentPrice = livePrices[sanitizedSymbol] || pos.entryPrice;
      const rawDiff = currentPrice - pos.entryPrice;
      const diffPercent = (rawDiff / pos.entryPrice) * 100;
      const pnlPercent = pos.side === 'LONG' ? diffPercent : -diffPercent;
      
      const tradeImpact = currentBalance * pos.size * (pnlPercent / 100);
      floatingPnlValue += tradeImpact;
    }

    bot.balance = Math.round((currentBalance + floatingPnlValue) * 100) / 100;
    
    // Inject/Update the FLOATING point in equityCurve with pure live data
    if (floatingPnlValue !== 0 && bot.equityCurve) {
       const curve = [...bot.equityCurve];
       
       // Handle server-injected pseudo-floating point
       const lastIdx = curve.length - 1;
       const latestClosedPnl = lastIdx >= 0 && curve[lastIdx].outcome === 'FLOATING' 
          ? (lastIdx >= 1 ? curve[lastIdx - 1].pnl : 0)
          : (lastIdx >= 0 ? curve[lastIdx].pnl : 0);

       const livePoint = {
         timestamp: new Date().toISOString(),
         balance: bot.balance,
         pnl: latestClosedPnl, // Base PNL 
         outcome: 'FLOATING',
         signal: 'LIVE',
         symbol: 'MULTIPLE'
       };

       if (lastIdx >= 0 && curve[lastIdx].outcome === 'FLOATING') {
         curve[lastIdx] = livePoint;
       } else {
         curve.push(livePoint);
       }
       bot.equityCurve = curve;
       
       // Update day trailing stats for KPI Bar and performance tracking
       if (bot.stats) {
          const impactPercent = (floatingPnlValue / currentBalance) * 100;
          bot.stats.todayPnlPercent = Math.round(((bot.stats.todayPnlPercent || 0) + impactPercent) * 100) / 100;
          bot.stats.totalPnlPercent = Math.round(((bot.stats.totalPnlPercent || 0) + impactPercent) * 100) / 100;
       }
    }

    return bot;
  }, [data, livePrices]);

  // Lifecycle — connect on mount
  useEffect(() => {
    if (enabled) {
      // Small delay to ensure connectRef is populated
      const timer = setTimeout(() => connectRef.current(), 0);
      return () => {
        clearTimeout(timer);
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        if (fallbackTimerRef.current) {
          clearInterval(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }
        if (sseRecoveryTimerRef.current) {
          clearInterval(sseRecoveryTimerRef.current);
          sseRecoveryTimerRef.current = null;
        }
      };
    }
  }, [enabled]);

  return {
    /** Full real-time payload */
    data: data ? { ...data, bot: augmentedBot as RealtimeBotStats } : null,
    /** Dashboard-specific data */
    dashboard: data?.dashboard || null,
    /** Bot stats + decisions + equity curve */
    bot: augmentedBot,
    /** Latest signals */
    signals: data?.signals || [],
    /** Connection status: connecting | connected | reconnecting | polling | error */
    connectionStatus,
    /** Last successful update timestamp */
    lastUpdate,
    /** Total number of updates received */
    updateCount,
    /** Whether data is available */
    isReady: data !== null,
    /** Whether currently loading (no data yet) */
    isLoading: data === null,
    /** Force an immediate refresh */
    forceRefresh,
    /** Reconnect SSE (useful after network recovery) */
    reconnect,
  };
}
