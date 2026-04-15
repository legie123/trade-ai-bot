// ============================================================
// Orderbook Intelligence — per-symbol imbalance + spread metrics
//
// ADDITIVE. Pure functions + a small cache. Inputs come from
// polyWsClient (Polymarket "book" events) or MEXC WS depth10
// events routed through WsStreamManager.
// ============================================================

export interface BookLevel {
  price: number;
  size: number;
}

export interface OrderbookSnapshot {
  symbol: string;
  bids: BookLevel[];     // sorted desc by price
  asks: BookLevel[];     // sorted asc by price
  at: number;
}

export interface OrderbookIntel {
  symbol: string;
  mid: number;
  spreadPct: number;          // (ask - bid) / mid
  imbalance: number;          // (bidVol - askVol) / (bidVol + askVol), in [-1, +1]
  depthTop5BidUsd: number;
  depthTop5AskUsd: number;
  liquidityScore: number;     // 0..1 based on depth and spread
  regimeHint: 'pressure_up' | 'pressure_down' | 'balanced' | 'thin';
  at: number;
}

const cache = new Map<string, OrderbookIntel>();

export function computeOrderbookIntel(snap: OrderbookSnapshot): OrderbookIntel {
  const bestBid = snap.bids[0]?.price || 0;
  const bestAsk = snap.asks[0]?.price || 0;
  const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
  const spreadPct = mid > 0 ? (bestAsk - bestBid) / mid : 1;

  const sliceN = 5;
  const topBids = snap.bids.slice(0, sliceN);
  const topAsks = snap.asks.slice(0, sliceN);
  const bidVolUsd = topBids.reduce((s, l) => s + l.price * l.size, 0);
  const askVolUsd = topAsks.reduce((s, l) => s + l.price * l.size, 0);
  const totalUsd = bidVolUsd + askVolUsd;
  const imbalance = totalUsd > 0 ? (bidVolUsd - askVolUsd) / totalUsd : 0;

  // Liquidity score: combine depth and tight spread.
  // Higher depth and tighter spread → higher score.
  const depthScore = Math.min(1, totalUsd / 10_000); // $10k across top 5 = full
  const spreadScore = Math.max(0, 1 - spreadPct * 50); // spread>2% zeros it
  const liquidityScore = Number((0.6 * depthScore + 0.4 * spreadScore).toFixed(4));

  let regimeHint: OrderbookIntel['regimeHint'] = 'balanced';
  if (liquidityScore < 0.1) regimeHint = 'thin';
  else if (imbalance > 0.3) regimeHint = 'pressure_up';
  else if (imbalance < -0.3) regimeHint = 'pressure_down';

  const out: OrderbookIntel = {
    symbol: snap.symbol,
    mid: Number(mid.toFixed(6)),
    spreadPct: Number(spreadPct.toFixed(6)),
    imbalance: Number(imbalance.toFixed(4)),
    depthTop5BidUsd: Number(bidVolUsd.toFixed(2)),
    depthTop5AskUsd: Number(askVolUsd.toFixed(2)),
    liquidityScore,
    regimeHint,
    at: snap.at,
  };
  cache.set(snap.symbol, out);
  return out;
}

export function getOrderbookIntel(symbol: string): OrderbookIntel | null {
  return cache.get(symbol) || null;
}

export function getAllOrderbookIntel(): OrderbookIntel[] {
  return Array.from(cache.values());
}
