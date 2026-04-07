import { useState, useEffect, useCallback, useMemo } from 'react';

export interface LiveBotStats {
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
  paperBalance: number;
  equity: number;
}

const DEFAULT_STATS: LiveBotStats = {
  mode: 'PAPER',
  totalDecisions: 0,
  todayDecisions: 0,
  overallWinRate: 0,
  todayWinRate: 0,
  totalPnlPercent: 0,
  todayPnlPercent: 0,
  maxDrawdown: 0,
  currentStreak: 0,
  streakType: 'NONE',
  strategyHealth: 'GOOD',
  paperBalance: 1000,
  equity: 1000,
};

export function useBotStats(intervalMs = 30_000) {
  const [stats, setStats] = useState<LiveBotStats>(DEFAULT_STATS);
  const [activePositions, setActivePositions] = useState<{ symbol: string; side: 'LONG'|'SHORT'; entryPrice: number; size: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/bot', { signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (!res || !res.ok) return;
      const data = await res.json();
      const s = data.stats || {};
      const config = data.config || {};
      
      setActivePositions(data.activePositions || []);

      setStats(prev => ({
        mode: s.mode || 'PAPER',
        totalDecisions: s.totalDecisions || 0,
        todayDecisions: s.todayDecisions || 0,
        overallWinRate: s.overallWinRate || 0,
        todayWinRate: s.todayWinRate || 0,
        totalPnlPercent: s.totalPnlPercent || 0,
        todayPnlPercent: s.todayPnlPercent || 0,
        maxDrawdown: s.maxDrawdown || 0,
        currentStreak: s.currentStreak || 0,
        streakType: s.streakType || 'NONE',
        strategyHealth: s.strategyHealth || 'GOOD',
        paperBalance: s.paperBalance || config.paperBalance || prev.paperBalance,
        equity: s.paperBalance || config.paperBalance || prev.paperBalance, // Will be overridden by live calculation
      }));
      setLoading(false);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(fetchStats, 0);
    const interval = setInterval(fetchStats, intervalMs);
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [fetchStats, intervalMs]);

  // LIVE WebSocket for open positions to tick Equity to the second
  useEffect(() => {
    if (activePositions.length === 0) return;

    const symbols = activePositions.map(p => p.symbol.replace('/', '').toLowerCase() + '@aggTrade');
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbols.join('/')}`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.s && data.p) {
          const symbolStr = data.s.toUpperCase();
          const p = parseFloat(data.p);
          setLivePrices(prev => ({ ...prev, [symbolStr]: p }));
        }
      } catch {}
    };

    return () => ws.close();
  }, [activePositions]);

  // Compute live equity safely during render to avoid cascading updates
  const computedStats = useMemo(() => {
    if (activePositions.length === 0) {
      return { ...stats, equity: stats.paperBalance };
    }
    
    let floatingPnlValue = 0;
    const currentBalance = stats.paperBalance || 1000;

    for (const pos of activePositions) {
      const sanitizedSymbol = pos.symbol.replace('/', '').toUpperCase();
      const currentPrice = livePrices[sanitizedSymbol] || pos.entryPrice;
      const rawDiff = currentPrice - pos.entryPrice;
      const diffPercent = (rawDiff / pos.entryPrice) * 100;
      const pnlPercent = pos.side === 'LONG' ? diffPercent : -diffPercent;
      
      const tradeImpact = currentBalance * pos.size * (pnlPercent / 100);
      floatingPnlValue += tradeImpact;
    }

    return {
      ...stats,
      equity: Math.round((stats.paperBalance + floatingPnlValue) * 100) / 100
    };
  }, [livePrices, activePositions, stats]);

  return { stats: computedStats, loading, refresh: fetchStats };
}
