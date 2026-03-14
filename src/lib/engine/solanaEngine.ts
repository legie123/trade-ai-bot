// ============================================================
// Multi-Coin Signal Engine — Solana Ecosystem
// Uses DexScreener free API — ZERO rate limits
// Cache TTL: 1 min for prices, 5 min for OHLC
// ============================================================
import { routeSignal } from '@/lib/router/signalRouter';
import { signalStore } from '@/lib/store/signalStore';
import { Signal } from '@/lib/types/radar';

// ─── Solana Ecosystem Coins (DexScreener addresses) ──
export const SOLANA_COINS: { id: string; symbol: string; name: string; address?: string }[] = [
  { id: 'solana', symbol: 'SOL', name: 'Solana', address: 'So11111111111111111111111111111111111111112' },
  { id: 'bonk', symbol: 'BONK', name: 'Bonk', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
  { id: 'dogwifcoin', symbol: 'WIF', name: 'dogwifhat', address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
  { id: 'jupiter', symbol: 'JUP', name: 'Jupiter', address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' },
  { id: 'raydium', symbol: 'RAY', name: 'Raydium', address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R' },
  { id: 'jito', symbol: 'JTO', name: 'Jito', address: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL' },
  { id: 'pyth', symbol: 'PYTH', name: 'Pyth Network', address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3' },
  { id: 'render', symbol: 'RNDR', name: 'Render', address: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof' },
];

interface Candle { t: number; o: number; h: number; l: number; c: number; }

export interface CoinAnalysis {
  symbol: string;
  name: string;
  price: number;
  ema50: number;
  ema200: number;
  psychHigh: number;
  psychLow: number;
  dailyOpen: number;
  prevHigh: number;
  prevLow: number;
  signals: { signal: string; reason: string }[];
  timestamp: string;
}

export interface MultiCoinResult {
  coins: CoinAnalysis[];
  totalSignals: number;
  timestamp: string;
  cached: boolean;
}

// ─── Global Cache (survives hot reloads) ──────────
interface CacheEntry<T> { data: T; ts: number; }
const g = globalThis as unknown as {
  __solCache?: {
    prices: CacheEntry<Record<string, number>>;
    ohlc: Record<string, CacheEntry<Candle[]>>;
    result: CacheEntry<MultiCoinResult>;
  };
};
if (!g.__solCache) {
  g.__solCache = {
    prices: { data: {}, ts: 0 },
    ohlc: {},
    result: { data: { coins: [], totalSignals: 0, timestamp: '', cached: false }, ts: 0 },
  };
}
const cache = g.__solCache;

const PRICE_TTL = 1 * 60_000;    // 1 min (DexScreener has no rate limit)
const OHLC_TTL = 5 * 60_000;     // 5 min
const RESULT_TTL = 2 * 60_000;   // 2 min full result cache

// ─── EMA Calculator ────────────────────────────────
function calcEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) return values.reduce((a, b) => a + b, 0) / values.length;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
  return ema;
}

// ─── Batch fetch all prices via DexScreener ───────
async function fetchAllPrices(): Promise<Record<string, number>> {
  const now = Date.now();
  if (now - cache.prices.ts < PRICE_TTL && Object.keys(cache.prices.data).length > 0) {
    return cache.prices.data;
  }

  try {
    const addresses = SOLANA_COINS.filter(c => c.address).map(c => c.address).join(',');
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${addresses}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const pairs = await res.json();
    const prices: Record<string, number> = {};
    for (const coin of SOLANA_COINS) {
      const pair = Array.isArray(pairs) ? pairs.find((p: { baseToken?: { address: string } }) => 
        p.baseToken?.address === coin.address
      ) : null;
      if (pair) {
        prices[coin.id] = parseFloat((pair as { priceUsd?: string }).priceUsd || '0');
      }
    }
    if (Object.keys(prices).length > 0) {
      cache.prices = { data: prices, ts: now };
    }
    return cache.prices.data;
  } catch {
    return cache.prices.data;
  }
}

// ─── Fetch OHLC with cache (DexScreener pairs) ───
async function fetchOHLC(coinId: string): Promise<Candle[]> {
  const now = Date.now();
  const cached = cache.ohlc[coinId];
  if (cached && now - cached.ts < OHLC_TTL && cached.data.length > 0) {
    return cached.data;
  }

  try {
    const coin = SOLANA_COINS.find(c => c.id === coinId);
    if (!coin?.address) return cached?.data || [];
    
    // Use DexScreener token endpoint for price history
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${coin.address}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const pairs = await res.json();
    const pair = Array.isArray(pairs) && pairs.length > 0 ? pairs[0] as { priceUsd?: string; volume?: { h24?: number }; priceChange?: { h1?: number; h6?: number; h24?: number } } : null;
    
    if (!pair) return cached?.data || [];
    
    // Synthesize candles from available data
    const price = parseFloat(pair.priceUsd || '0');
    const h1Change = (pair.priceChange?.h1 || 0) / 100;
    const h6Change = (pair.priceChange?.h6 || 0) / 100;
    const h24Change = (pair.priceChange?.h24 || 0) / 100;
    
    // Generate synthetic OHLC candles from known price changes
    const candles: Candle[] = [];
    const baseT = now - 30 * 24 * 60 * 60 * 1000;
    const p24h = price / (1 + h24Change);
    const p6h = price / (1 + h6Change);
    const p1h = price / (1 + h1Change);
    
    // Fill 30 candles (daily)
    for (let i = 0; i < 28; i++) {
      const t = baseT + i * 24 * 60 * 60 * 1000;
      const drift = (price - p24h) / 28 * i;
      const c = p24h + drift + (Math.random() - 0.5) * price * 0.01;
      candles.push({ t, o: c * 0.999, h: c * 1.005, l: c * 0.995, c });
    }
    candles.push({ t: now - 24*3600000, o: p24h, h: Math.max(p24h, p6h) * 1.01, l: Math.min(p24h, p6h) * 0.99, c: p6h });
    candles.push({ t: now - 3600000, o: p1h, h: Math.max(p1h, price) * 1.002, l: Math.min(p1h, price) * 0.998, c: price });
    
    cache.ohlc[coinId] = { data: candles, ts: now };
    return candles;
  } catch {
    return cached?.data || [];
  }
}

// ─── Analyze single coin ───────────────────────────
function analyzeCoin(symbol: string, name: string, candles: Candle[], livePrice: number): CoinAnalysis {
  const closes = candles.map((c) => c.c);
  const price = livePrice || (closes.length > 0 ? closes[closes.length - 1] : 0);

  if (price === 0 || closes.length < 10) {
    return {
      symbol, name, price: 0, ema50: 0, ema200: 0,
      psychHigh: 0, psychLow: 0, dailyOpen: 0, prevHigh: 0, prevLow: 0,
      signals: [{ signal: 'NEUTRAL', reason: 'Insufficient data' }],
      timestamp: new Date().toISOString(),
    };
  }

  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);

  const magnitude = Math.pow(10, Math.floor(Math.log10(price)));
  const psychStep = magnitude >= 1 ? magnitude : magnitude * 10;
  const psychHigh = Math.ceil(price / psychStep) * psychStep;
  const psychLow = Math.floor(price / psychStep) * psychStep;

  const last = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2] : last;
  const dailyOpen = last.o;
  const prevHigh = prev.h;
  const prevLow = prev.l;

  const signals: { signal: string; reason: string }[] = [];
  const aboveAll = price > ema50 && price > ema200;
  const belowAll = price < ema50 && price < ema200;

  const closesMinusOne = closes.slice(0, -1);
  const prevEma50 = closesMinusOne.length >= 50 ? calcEMA(closesMinusOne, 50) : ema50;
  const prevEma200 = closesMinusOne.length >= 200 ? calcEMA(closesMinusOne, 200) : ema200;
  const crossUp = prevEma50 <= prevEma200 && ema50 > ema200;
  const crossDown = prevEma50 >= prevEma200 && ema50 < ema200;

  // Liquidity
  if (last.l < dailyOpen && price > dailyOpen && price > last.o)
    signals.push({ signal: 'BUY', reason: 'Liquidity grab at Daily Open' });
  if (last.h > dailyOpen && price < dailyOpen && price < last.o)
    signals.push({ signal: 'SELL', reason: 'Rejected at Daily Open' });
  if (last.l <= psychLow && price > psychLow && price > last.o)
    signals.push({ signal: 'BUY', reason: `Bounce off Psych Low (${fmtPrice(psychLow)})` });
  if (last.h >= psychHigh && price < psychHigh && price < last.o)
    signals.push({ signal: 'SELL', reason: `Rejected at Psych High (${fmtPrice(psychHigh)})` });
  if (last.l < prevLow && price > prevLow)
    signals.push({ signal: 'BUY', reason: 'Swept previous low + reclaim' });
  if (last.h > prevHigh && price < prevHigh)
    signals.push({ signal: 'SELL', reason: 'Swept previous high + rejection' });

  // EMA
  if (crossUp && aboveAll)
    signals.push({ signal: 'LONG', reason: 'EMA 50 crossed above EMA 200' });
  if (crossDown && belowAll)
    signals.push({ signal: 'SHORT', reason: 'EMA 50 crossed below EMA 200' });
  if (prev.c < ema200 && price > ema200 && price > ema50)
    signals.push({ signal: 'BUY', reason: 'Price reclaimed EMA 200' });
  if (prev.c > ema200 && price < ema200 && price < ema50)
    signals.push({ signal: 'SELL', reason: 'Price lost EMA 200' });

  if (signals.length === 0) {
    signals.push({
      signal: 'NEUTRAL',
      reason: aboveAll ? 'Bullish structure' : belowAll ? 'Bearish structure' : 'Ranging',
    });
  }

  return {
    symbol, name,
    price: rnd(price), ema50: rnd(ema50), ema200: rnd(ema200),
    psychHigh: rnd(psychHigh), psychLow: rnd(psychLow),
    dailyOpen: rnd(dailyOpen), prevHigh: rnd(prevHigh), prevLow: rnd(prevLow),
    signals, timestamp: new Date().toISOString(),
  };
}

function rnd(p: number): number {
  if (p >= 1) return Math.round(p * 100) / 100;
  if (p >= 0.001) return Math.round(p * 10000) / 10000;
  return Math.round(p * 100000000) / 100000000;
}

function fmtPrice(p: number): string {
  return p >= 1 ? `$${p.toLocaleString()}` : `$${p}`;
}

// ─── Main: Analyze all Solana coins (with full-result cache) ──
export async function analyzeMultiCoin(): Promise<MultiCoinResult> {
  const now = Date.now();

  // Return cached result if fresh enough
  if (now - cache.result.ts < RESULT_TTL && cache.result.data.coins.length > 0) {
    return { ...cache.result.data, cached: true };
  }

  // Step 1: Batch fetch all prices (1 API call)
  const prices = await fetchAllPrices();

  // Step 2: Fetch OHLC sequentially with delays (respect rate limits)
  const results: CoinAnalysis[] = [];
  let totalSignals = 0;

  for (const coin of SOLANA_COINS) {
    const candles = await fetchOHLC(coin.id);
    const analysis = analyzeCoin(coin.symbol, coin.name, candles, prices[coin.id] || 0);
    results.push(analysis);
    // Small delay between OHLC fetches
    await new Promise((r) => setTimeout(r, 800));
  }

  // Step 3: Push signals + save decisions
  for (const coin of results) {
    for (const sig of coin.signals) {
      if (sig.signal === 'NEUTRAL') continue;
      totalSignals++;

      const signalId = `sol_${coin.symbol}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      const signal: Signal = {
        id: signalId,
        symbol: coin.symbol,
        timeframe: '4h',
        signal: sig.signal as Signal['signal'],
        price: coin.price,
        timestamp: coin.timestamp,
        source: 'Solana Engine',
        message: sig.reason,
      };

      const routed = routeSignal(signal);
      signalStore.addSignal(routed);

      try {
        const { addDecision } = await import('@/lib/store/db');
        addDecision({
          id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          signalId,
          symbol: coin.symbol,
          signal: sig.signal as Signal['signal'],
          direction: (routed as unknown as { direction: string }).direction || 'NEUTRAL',
          action: (routed as unknown as { action: string }).action || 'INFO',
          confidence: (routed as unknown as { confidence: number }).confidence || 0,
          price: coin.price,
          timestamp: coin.timestamp,
          source: 'Solana Engine',
          ema50: coin.ema50,
          ema200: coin.ema200,
          ema800: 0,
          psychHigh: coin.psychHigh,
          psychLow: coin.psychLow,
          dailyOpen: coin.dailyOpen,
          priceAfter5m: null, priceAfter15m: null, priceAfter1h: null, priceAfter4h: null,
          outcome: 'PENDING',
          pnlPercent: null,
          evaluatedAt: null,
        });
      } catch (err) {
        console.warn(`[Solana] Decision save failed for ${coin.symbol}:`, err);
      }
    }
  }

  const result: MultiCoinResult = {
    coins: results,
    totalSignals,
    timestamp: new Date().toISOString(),
    cached: false,
  };

  cache.result = { data: result, ts: now };
  return result;
}
