import { useState, useEffect, useCallback } from 'react';

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

/**
 * Hook that fetches live bot stats from /api/bot every `intervalMs`.
 * Returns real-time equity, P&L, drawdown, win rate, etc.
 */
export function useBotStats(intervalMs = 30_000) {
  const [stats, setStats] = useState<LiveBotStats>(DEFAULT_STATS);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/bot', { signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (!res || !res.ok) return;
      const data = await res.json();
      const s = data.stats;
      const config = data.config;
      const equityCurve = data.equityCurve || [];
      const lastEquity = equityCurve.length > 0
        ? equityCurve[equityCurve.length - 1].balance
        : config?.paperBalance || 1000;

      setStats({
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
        paperBalance: config?.paperBalance || 1000,
        equity: Math.round(lastEquity * 100) / 100,
      });
      setLoading(false);
    } catch {
      // silent — keep last known stats
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(fetchStats, 0);
    const interval = setInterval(fetchStats, intervalMs);
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [fetchStats, intervalMs]);

  return { stats, loading, refresh: fetchStats };
}
