// ============================================================
// Advanced Analytics — Heatmaps, correlations, win rate per source
// ============================================================
import { getDecisions, getPerformance } from '@/lib/store/db';

export interface HourlyPerformance {
  hour: number;
  trades: number;
  wins: number;
  winRate: number;
  avgPnl: number;
}

export interface SymbolPerformance {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  bestTrade: number;
  worstTrade: number;
}

export interface SourcePerformance {
  source: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnl: number;
  avgConfidence: number;
}

export interface CorrelationEntry {
  symbol1: string;
  symbol2: string;
  correlation: number;  // -1 to 1
}

export interface AnalyticsReport {
  hourlyHeatmap: HourlyPerformance[];
  symbolPerformance: SymbolPerformance[];
  sourcePerformance: SourcePerformance[];
  correlations: CorrelationEntry[];
  summary: {
    totalDecisions: number;
    evaluated: number;
    bestHour: number;
    worstHour: number;
    bestSymbol: string;
    bestSource: string;
    avgHoldTime: number;  // minutes
  };
}

export function generateAnalytics(): AnalyticsReport {
  const decisions = getDecisions();
  const evaluated = decisions.filter((d) => d.outcome === 'WIN' || d.outcome === 'LOSS');

  // ─── Hourly Heatmap ──────────────────────────────
  const hourlyMap: Record<number, { trades: number; wins: number; pnls: number[] }> = {};
  for (let h = 0; h < 24; h++) hourlyMap[h] = { trades: 0, wins: 0, pnls: [] };

  for (const d of evaluated) {
    const hour = new Date(d.timestamp).getHours();
    hourlyMap[hour].trades++;
    if (d.outcome === 'WIN') hourlyMap[hour].wins++;
    hourlyMap[hour].pnls.push(d.pnlPercent || 0);
  }

  const hourlyHeatmap: HourlyPerformance[] = Object.entries(hourlyMap).map(([h, v]) => ({
    hour: parseInt(h),
    trades: v.trades,
    wins: v.wins,
    winRate: v.trades > 0 ? Math.round((v.wins / v.trades) * 100) : 0,
    avgPnl: v.pnls.length > 0 ? Math.round((v.pnls.reduce((a, b) => a + b, 0) / v.pnls.length) * 100) / 100 : 0,
  }));

  // ─── Symbol Performance ──────────────────────────
  const symMap: Record<string, { w: number; l: number; pnls: number[] }> = {};
  for (const d of evaluated) {
    if (!symMap[d.symbol]) symMap[d.symbol] = { w: 0, l: 0, pnls: [] };
    if (d.outcome === 'WIN') symMap[d.symbol].w++;
    else symMap[d.symbol].l++;
    symMap[d.symbol].pnls.push(d.pnlPercent || 0);
  }

  const symbolPerformance: SymbolPerformance[] = Object.entries(symMap)
    .map(([sym, v]) => ({
      symbol: sym,
      trades: v.w + v.l,
      wins: v.w,
      losses: v.l,
      winRate: v.w + v.l > 0 ? Math.round((v.w / (v.w + v.l)) * 100) : 0,
      totalPnl: Math.round(v.pnls.reduce((a, b) => a + b, 0) * 100) / 100,
      avgPnl: Math.round((v.pnls.reduce((a, b) => a + b, 0) / v.pnls.length) * 100) / 100,
      bestTrade: v.pnls.length > 0 ? Math.max(...v.pnls) : 0,
      worstTrade: v.pnls.length > 0 ? Math.min(...v.pnls) : 0,
    }))
    .sort((a, b) => b.totalPnl - a.totalPnl);

  // ─── Source Performance ──────────────────────────
  const srcMap: Record<string, { w: number; trades: number; pnls: number[]; confs: number[] }> = {};
  for (const d of evaluated) {
    const src = d.source || 'Unknown';
    if (!srcMap[src]) srcMap[src] = { w: 0, trades: 0, pnls: [], confs: [] };
    srcMap[src].trades++;
    if (d.outcome === 'WIN') srcMap[src].w++;
    srcMap[src].pnls.push(d.pnlPercent || 0);
    srcMap[src].confs.push(d.confidence);
  }

  const sourcePerformance: SourcePerformance[] = Object.entries(srcMap)
    .map(([src, v]) => ({
      source: src,
      trades: v.trades,
      wins: v.w,
      winRate: v.trades > 0 ? Math.round((v.w / v.trades) * 100) : 0,
      avgPnl: Math.round((v.pnls.reduce((a, b) => a + b, 0) / v.pnls.length) * 100) / 100,
      avgConfidence: Math.round(v.confs.reduce((a, b) => a + b, 0) / v.confs.length),
    }))
    .sort((a, b) => b.winRate - a.winRate);

  // ─── Correlation (simplified — direction agreement) ──
  const symbols = [...new Set(evaluated.map((d) => d.symbol))];
  const correlations: CorrelationEntry[] = [];
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const d1 = evaluated.filter((d) => d.symbol === symbols[i]).map((d) => d.pnlPercent || 0);
      const d2 = evaluated.filter((d) => d.symbol === symbols[j]).map((d) => d.pnlPercent || 0);
      const len = Math.min(d1.length, d2.length, 20);
      if (len < 3) continue;
      const s1 = d1.slice(0, len), s2 = d2.slice(0, len);
      const m1 = s1.reduce((a, b) => a + b) / len, m2 = s2.reduce((a, b) => a + b) / len;
      let num = 0, den1 = 0, den2 = 0;
      for (let k = 0; k < len; k++) {
        num += (s1[k] - m1) * (s2[k] - m2);
        den1 += (s1[k] - m1) ** 2;
        den2 += (s2[k] - m2) ** 2;
      }
      const corr = den1 > 0 && den2 > 0 ? num / Math.sqrt(den1 * den2) : 0;
      correlations.push({ symbol1: symbols[i], symbol2: symbols[j], correlation: Math.round(corr * 100) / 100 });
    }
  }

  // ─── Summary ─────────────────────────────────────
  const bestHourEntry = hourlyHeatmap.filter((h) => h.trades > 0).sort((a, b) => b.avgPnl - a.avgPnl)[0];
  const worstHourEntry = hourlyHeatmap.filter((h) => h.trades > 0).sort((a, b) => a.avgPnl - b.avgPnl)[0];

  return {
    hourlyHeatmap,
    symbolPerformance,
    sourcePerformance,
    correlations,
    summary: {
      totalDecisions: decisions.length,
      evaluated: evaluated.length,
      bestHour: bestHourEntry?.hour ?? -1,
      worstHour: worstHourEntry?.hour ?? -1,
      bestSymbol: symbolPerformance[0]?.symbol || 'N/A',
      bestSource: sourcePerformance[0]?.source || 'N/A',
      avgHoldTime: 60, // placeholder — would need evaluatedAt timestamps
    },
  };
}
