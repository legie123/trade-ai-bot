// ============================================================
// Portfolio Tracker — Real-time PnL, allocation, positions
// ============================================================
import { getDecisions, getBotConfig } from '@/lib/store/db';


// Price cache: avoid hammering APIs — 30s TTL per symbol
const gp = globalThis as unknown as { __priceCache?: Map<string, { price: number; at: number }> };
if (!gp.__priceCache) gp.__priceCache = new Map();
const priceCache = gp.__priceCache;
const PRICE_CACHE_TTL = 30_000;

async function getLivePrice(symbol: string): Promise<number | null> {
  // Check cache first
  const cached = priceCache.get(symbol);
  if (cached && Date.now() - cached.at < PRICE_CACHE_TTL) {
    return cached.price;
  }

  try {
    const { getResilientPrice } = await import('@/lib/core/apiFallback');
    const result = await getResilientPrice(symbol);
    priceCache.set(symbol, { price: result.price, at: Date.now() });
    return result.price;
  } catch {
    return null;
  }
}

export interface PortfolioPosition {
  symbol: string;
  side: string;
  entryPrice: number;
  currentEstimate: number;
  quantity: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  entryTime: string;
  holdDuration: string;
}

export interface PortfolioAllocation {
  symbol: string;
  percent: number;
  value: number;
}

export interface PortfolioSummary {
  totalBalance: number;
  cashBalance: number;
  investedBalance: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  realizedPnl: number;
  totalPnl: number;
  positions: PortfolioPosition[];
  allocation: PortfolioAllocation[];
  dailyPnl: number;
  weeklyPnl: number;
  bestPosition: string;
  worstPosition: string;
}

function getDuration(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h`;
  return `${Math.floor(ms / 86400_000)}d`;
}

export async function getPortfolio(): Promise<PortfolioSummary> {
  const config = getBotConfig();
  const paperBalance = (config as { paperBalance?: number }).paperBalance || 1000;
  const decisions = getDecisions();

  // Simulated positions from pending decisions
  const pending = decisions.filter(d => d.outcome === 'PENDING');
  const evaluated = decisions.filter(d => d.outcome === 'WIN' || d.outcome === 'LOSS');

  // Group pending by symbol
  const posMap: Record<string, { entries: typeof pending }> = {};
  for (const d of pending.slice(-20)) {
    if (!posMap[d.symbol]) posMap[d.symbol] = { entries: [] };
    posMap[d.symbol].entries.push(d);
  }

  const riskPerTrade = (config as { riskPerTrade?: number }).riskPerTrade || 2;
  const tradeSize = paperBalance * (riskPerTrade / 100);

  // Fetch live prices for top 5 positions (limit API calls)
  const symbols = Object.keys(posMap).slice(0, 5);
  const livePrices: Record<string, number> = {};
  await Promise.allSettled(
    symbols.map(async (sym) => {
      const price = await getLivePrice(sym);
      if (price && price > 0) livePrices[sym] = price;
    })
  );

  const positions: PortfolioPosition[] = Object.entries(posMap).map(([symbol, { entries }]) => {
    const latest = entries[entries.length - 1];
    const entryPrice = latest.price;
    // Use live price if available, fallback to entry price
    const currentEstimate = livePrices[symbol] || entryPrice;
    const qty = tradeSize / entryPrice;
    const pnl = (currentEstimate - entryPrice) * qty * (latest.signal === 'SELL' || latest.signal === 'SHORT' ? -1 : 1);
    const pnlPct = ((currentEstimate / entryPrice) - 1) * 100 * (latest.signal === 'SELL' || latest.signal === 'SHORT' ? -1 : 1);

    return {
      symbol,
      side: latest.signal,
      entryPrice,
      currentEstimate: Math.round(currentEstimate * 10000) / 10000,
      quantity: Math.round(qty * 10000) / 10000,
      unrealizedPnl: Math.round(pnl * 100) / 100,
      unrealizedPnlPercent: Math.round(pnlPct * 100) / 100,
      entryTime: latest.timestamp,
      holdDuration: getDuration(latest.timestamp),
    };
  });

  const investedBalance = positions.length * tradeSize;
  const unrealizedPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const realizedPnl = evaluated.reduce((s, d) => s + (d.pnlPercent || 0), 0) * (paperBalance / 100);

  // Allocation
  const allocation: PortfolioAllocation[] = positions.map(p => ({
    symbol: p.symbol,
    percent: Math.round((tradeSize / paperBalance) * 100),
    value: tradeSize + p.unrealizedPnl,
  }));
  const cashPercent = Math.round(((paperBalance - investedBalance) / paperBalance) * 100);
  allocation.unshift({ symbol: 'CASH', percent: cashPercent, value: paperBalance - investedBalance });

  // Daily / Weekly PnL
  const today = new Date().toISOString().slice(0, 10);
  const dailyDecisions = evaluated.filter(d => d.timestamp.startsWith(today));
  const dailyPnl = dailyDecisions.reduce((s, d) => s + (d.pnlPercent || 0), 0);

  const weekAgo = Date.now() - 7 * 86400_000;
  const weeklyDecisions = evaluated.filter(d => new Date(d.timestamp).getTime() > weekAgo);
  const weeklyPnl = weeklyDecisions.reduce((s, d) => s + (d.pnlPercent || 0), 0);

  const best = [...positions].sort((a, b) => b.unrealizedPnlPercent - a.unrealizedPnlPercent)[0];
  const worst = [...positions].sort((a, b) => a.unrealizedPnlPercent - b.unrealizedPnlPercent)[0];

  return {
    totalBalance: Math.round((paperBalance + unrealizedPnl + realizedPnl) * 100) / 100,
    cashBalance: Math.round((paperBalance - investedBalance) * 100) / 100,
    investedBalance: Math.round(investedBalance * 100) / 100,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    unrealizedPnlPercent: investedBalance > 0 ? Math.round((unrealizedPnl / investedBalance) * 10000) / 100 : 0,
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    totalPnl: Math.round((unrealizedPnl + realizedPnl) * 100) / 100,
    positions,
    allocation,
    dailyPnl: Math.round(dailyPnl * 100) / 100,
    weeklyPnl: Math.round(weeklyPnl * 100) / 100,
    bestPosition: best?.symbol || 'N/A',
    worstPosition: worst?.symbol || 'N/A',
  };
}
