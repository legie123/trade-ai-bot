// ============================================================
// Multi-Coin Signal Engine — Solana Ecosystem
// Hardened with apiFallback, structured logging, stale guards
// ============================================================
import { routeSignal } from '@/lib/router/signalRouter';
import { trySignal } from '@/lib/engine/signalCooldown';
import { getStreakStatus } from '@/lib/engine/streakGuard';
import { signalStore } from '@/lib/store/signalStore';
import { Signal } from '@/lib/types/radar';
import { createLogger } from '@/lib/core/logger';
import { getResilientPrice } from '@/lib/core/apiFallback';
import { fetchWithRetry } from '@/lib/providers/base';
import { checkVWAP } from '@/lib/engine/vwapFilter';
import { analyzeRSI } from '@/lib/engine/rsiIndicator';
import { getStrategies } from '@/lib/store/db';
import { evaluateStrategy, MarketContext } from '@/lib/engine/dynamicInterpreter';

const log = createLogger('SolanaEngine');

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
  signals: { signal: string; reason: string; sourceId?: string }[];
  timestamp: string;
}

export interface MultiCoinResult {
  coins: CoinAnalysis[];
  totalSignals: number;
  timestamp: string;
  cached: boolean;
}

// ─── Global Cache ──────────────────────────────────
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

const PRICE_TTL = 1 * 60_000;
const OHLC_TTL = 5 * 60_000;
const RESULT_TTL = 2 * 60_000;

function calcEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) return values.reduce((a, b) => a + b, 0) / values.length;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
  return ema;
}

// ─── Resilient Dual-Fetching for Prices ────────────
async function fetchAllPrices(): Promise<Record<string, number>> {
  const now = Date.now();
  if (now - cache.prices.ts < PRICE_TTL && Object.keys(cache.prices.data).length > 0) {
    return cache.prices.data;
  }

  const prices: Record<string, number> = {};

  // Try bulk DexScreener first
  try {
    const addresses = SOLANA_COINS.filter(c => c.address).map(c => c.address).join(',');
    const res = await fetchWithRetry(`https://api.dexscreener.com/tokens/v1/solana/${addresses}`, {
      retries: 1, timeoutMs: 5000,
    });
    const pairs = await res.json();
    for (const coin of SOLANA_COINS) {
      const pair = Array.isArray(pairs) ? pairs.find((p: { baseToken?: { address: string } }) => p.baseToken?.address === coin.address) : null;
      if (pair) prices[coin.id] = parseFloat((pair as { priceUsd?: string }).priceUsd || '0');
    }
  } catch (err) {
    log.warn('Bulk price fetch failed, falling back to apiFallback per-coin', { error: (err as Error).message });
  }

  // Backfill with apiFallback for any missing
  for (const coin of SOLANA_COINS) {
    if (!prices[coin.id] || prices[coin.id] <= 0) {
      try {
        const fbReq = await getResilientPrice(coin.symbol);
        prices[coin.id] = fbReq.price;
      } catch {
        prices[coin.id] = 0;
      }
    }
  }

  cache.prices = { data: prices, ts: now };
  return prices;
}

// ─── Fetch OHLC (Real from Binance + Synthetic Fallback) ───────
async function fetchOHLC(coinId: string): Promise<Candle[]> {
  const now = Date.now();
  const cached = cache.ohlc[coinId];
  if (cached && now - cached.ts > 10 * 60_000) delete cache.ohlc[coinId];
  if (cached && now - cached.ts < OHLC_TTL && cached.data.length > 0) return cached.data;

  const coin = SOLANA_COINS.find((c) => c.id === coinId);
  if (!coin) return [];

  // Try Binance Real OHLC first
  try {
    let binanceSymbol = `${coin.symbol.toUpperCase()}USDT`;
    if (coin.symbol.toUpperCase() === 'RNDR') binanceSymbol = 'RENDERUSDT';

    const res = await fetchWithRetry(`https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=4h&limit=250`, { retries: 1, timeoutMs: 3000 });
    const klines = await res.json();
    
    if (Array.isArray(klines) && klines.length > 0) {
      const candles: Candle[] = klines.map((k: [number, string, string, string, string]) => ({
        t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4])
      }));
      cache.ohlc[coinId] = { data: candles, ts: now };
      return candles;
    }
  } catch (err) {
    log.warn(`Binance OHLC failed for ${coinId}, falling back to synthetic`, { err: (err as Error).message });
  }

  // Synthetic Fallback Native
  try {
    if (!coin.address) return [];
    const res = await fetchWithRetry(`https://api.dexscreener.com/tokens/v1/solana/${coin.address}`, { retries: 1, timeoutMs: 4000 });
    const pairs = await res.json();
    const pair = Array.isArray(pairs) && pairs.length > 0 ? pairs[0] as { priceUsd?: string; priceChange?: { h1?: number; h6?: number; h24?: number } } : null;

    if (!pair) return [];

    const price = parseFloat(pair.priceUsd || '0');
    const h1Change = (pair.priceChange?.h1 || 0) / 100;
    const h6Change = (pair.priceChange?.h6 || 0) / 100;
    const h24Change = (pair.priceChange?.h24 || 0) / 100;

    const candles: Candle[] = [];
    const baseT = now - 30 * 24 * 60 * 60 * 1000;
    const p24h = price / (1 + h24Change);
    const p6h = price / (1 + h6Change);
    const p1h = price / (1 + h1Change);

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
    return [];
  }
}

// ─── Analysis Logic ────────────────────────────────
function analyzeCoin(symbol: string, name: string, candles: Candle[], livePrice: number): CoinAnalysis {
  const closes = candles.map((c) => c.c);
  const price = livePrice || (closes.length > 0 ? closes[closes.length - 1] : 0);

  if (price === 0 || closes.length < 10) {
    return {
      symbol, name, price: 0, ema50: 0, ema200: 0,
      psychHigh: 0, psychLow: 0, dailyOpen: 0, prevHigh: 0, prevLow: 0,
      signals: [{ signal: 'NEUTRAL', reason: 'Insufficient data or price missing' }],
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

  const signals: { signal: string; reason: string; sourceId?: string }[] = [];
  const aboveAll = price > ema50 && price > ema200;
  const belowAll = price < ema50 && price < ema200;

  const closesMinusOne = closes.slice(0, -1);
  const prevEma50 = closesMinusOne.length >= 50 ? calcEMA(closesMinusOne, 50) : ema50;
  const prevEma200 = closesMinusOne.length >= 200 ? calcEMA(closesMinusOne, 200) : ema200;
  
  // ── Bullish Signals ──
  if (last.l < dailyOpen && price > dailyOpen && price > last.o) signals.push({ signal: 'BUY', reason: 'Liquidity grab at Daily Open' });
  if (last.l <= psychLow && price > psychLow && price > last.o) signals.push({ signal: 'BUY', reason: 'Bounce off Psych Low' });
  if (prevEma50 <= prevEma200 && ema50 > ema200 && aboveAll) signals.push({ signal: 'LONG', reason: 'EMA Golden Cross' });

  // ── Bearish Signals (Calibration #3) ──
  if (last.h >= psychHigh && price < psychHigh && price < last.o) signals.push({ signal: 'SELL', reason: 'Rejection at Psych High' });
  if (last.h > dailyOpen && price < dailyOpen && price < last.o) signals.push({ signal: 'SELL', reason: 'Failed breakout above Daily Open' });
  if (prevEma50 >= prevEma200 && ema50 < ema200 && belowAll) signals.push({ signal: 'SHORT', reason: 'EMA Death Cross' });
  
  // ── Momentum: price far below EMA50 = bearish continuation ──
  if (belowAll && price < ema50 * 0.97) signals.push({ signal: 'SELL', reason: `Bearish momentum: price 3%+ below EMA50` });
  // ── Momentum: price far above EMA50 = overbought ──  
  if (aboveAll && price > ema50 * 1.05) signals.push({ signal: 'SELL', reason: `Overbought: price 5%+ above EMA50` });

  // ==== DYNAMIC AI STRATEGIES EVALUATION ====
  const activeStrategies = getStrategies().filter(s => 
    (s.targetAssets.includes(symbol) || s.targetAssets.includes('SOL_ECO') || s.targetAssets.includes('ALL')) && 
    (s.status === 'active' || s.status === 'probation')
  );

  const marketContext: MarketContext = {
    symbol,
    price,
    closes15m: closes,
    closes1h: closes,
    closes4h: closes,
    vwap: price, 
  };

  for (const strategy of activeStrategies) {
    try {
      if (evaluateStrategy(strategy, marketContext)) {
        signals.push({
          signal: 'BUY',
          reason: `🤖 [AI STRATEGY: ${strategy.name}] Condition met for ${symbol}!`,
          sourceId: strategy.id
        });
      }
    } catch (err) {
      log.error(`Strategy ${strategy.name} eval failed on ${symbol}`, { error: String(err) });
    }
  }

  // ── TREND FILTER: Block signals against EMA trend (Calibration #3) ──
  const trendUp = ema50 > ema200;
  const trendDown = ema50 < ema200;
  const filtered: typeof signals = [];

  for (const sig of signals) {
    if (sig.signal === 'NEUTRAL') { filtered.push(sig); continue; }

    // Mean-reversion signals are allowed against trend (overbought SELL in uptrend, oversold BUY in downtrend)
    const isMeanReversion = sig.reason.includes('Overbought') || sig.reason.includes('momentum') || sig.reason.includes('Bounce');

    if ((sig.signal === 'BUY' || sig.signal === 'LONG') && trendDown && !isMeanReversion) {
      log.debug(`${symbol} ${sig.signal} BLOCKED by Trend Filter (EMA50 < EMA200)`);
      continue;
    }
    if ((sig.signal === 'SELL' || sig.signal === 'SHORT') && trendUp && !isMeanReversion) {
      log.debug(`${symbol} ${sig.signal} BLOCKED by Trend Filter (EMA50 > EMA200)`);
      continue;
    }
    filtered.push(sig);
  }

  if (filtered.length === 0) {
    filtered.push({ signal: 'NEUTRAL', reason: aboveAll ? 'Bullish structure (no setup)' : belowAll ? 'Bearish structure (no setup)' : 'Ranging' });
  }

  // Replace signals with filtered version
  signals.length = 0;
  signals.push(...filtered);

  return {
    symbol, name,
    price: Math.round(price * 10000) / 10000,
    ema50: Math.round(ema50 * 10000) / 10000,
    ema200: Math.round(ema200 * 10000) / 10000,
    psychHigh: Math.round(psychHigh * 10000) / 10000,
    psychLow: Math.round(psychLow * 10000) / 10000,
    dailyOpen: Math.round(dailyOpen * 10000) / 10000,
    prevHigh: Math.round(prevHigh * 10000) / 10000,
    prevLow: Math.round(prevLow * 10000) / 10000,
    signals, timestamp: new Date().toISOString(),
  };
}

export async function analyzeMultiCoin(): Promise<MultiCoinResult> {
  const now = Date.now();
  if (now - cache.result.ts < RESULT_TTL && cache.result.data.coins.length > 0) return { ...cache.result.data, cached: true };

  const prices = await fetchAllPrices();
  const results: CoinAnalysis[] = [];
  let totalSignals = 0;

  for (const coin of SOLANA_COINS) {
    const candles = await fetchOHLC(coin.id);
    const analysis = analyzeCoin(coin.symbol, coin.name, candles, prices[coin.id] || 0);
    results.push(analysis);
    await new Promise((r) => setTimeout(r, 200)); // Respecting rate limits
  }

  for (const coin of results) {
    for (const sig of coin.signals) {
      if (sig.signal === 'NEUTRAL') continue;

      // ── VWAP Volume Gate ──
      const vwap = await checkVWAP(coin.symbol, coin.price, sig.signal as 'BUY' | 'SELL');
      if (!vwap.confirmed) {
        log.info(`${coin.symbol} signal ${sig.signal} REJECTED by VWAP`, { ratio: vwap.volumeRatio });
        sig.signal = 'NEUTRAL';
        sig.reason = `${sig.reason} — REJECTED by VWAP (Vol ${vwap.volumeRatio}x)`;
        continue;
      }

      // ── RSI Momentum Gate ──
      const coinData = SOLANA_COINS.find(c => c.symbol === coin.symbol);
      if (coinData) {
        const candles = await fetchOHLC(coinData.id);
        const closes = candles.map(c => c.c);
        if (closes.length > 20) {
          const rsi = analyzeRSI(closes, sig.signal as 'BUY' | 'SELL');
          if (!rsi.confirmsSignal) {
            log.info(`${coin.symbol} signal ${sig.signal} REJECTED by RSI`, { rsi: rsi.rsi, zone: rsi.zone });
            sig.signal = 'NEUTRAL';
            sig.reason = `${sig.reason} — REJECTED by RSI: ${rsi.reason}`;
            continue;
          }
          sig.reason = `${sig.reason} | VWAP ✅ Vol ${vwap.volumeRatio}x | RSI ✅ ${rsi.rsi}`;
        } else {
          sig.reason = `${sig.reason} | VWAP ✅ Vol ${vwap.volumeRatio}x`;
        }
      }
      totalSignals++;

      // Cooldown gate: prevent duplicate signals per coin
      if (!trySignal(coin.symbol, sig.signal)) continue;

      const signalId = `sol_${coin.symbol}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      const signal: Signal = {
        id: signalId, symbol: coin.symbol, timeframe: '4h',
        signal: sig.signal as Signal['signal'], price: coin.price,
        timestamp: coin.timestamp, source: 'Solana Engine', message: sig.reason,
      };

      const routed = routeSignal(signal);
      signalStore.addSignal(routed);

      const confidence = (routed as unknown as { confidence: number }).confidence || 0;

      // Calibration #5: Confidence gate — skip weak signals
      // Calibration #9: Dynamic confidence threshold based on loss streak
      const streak = getStreakStatus();
      const MIN_CONFIDENCE = 70 + streak.confidenceBoost;
      if (confidence < MIN_CONFIDENCE) {
        log.info(`${coin.symbol} ${sig.signal} SKIPPED: confidence ${confidence}% < ${MIN_CONFIDENCE}%`);
        continue;
      }

      try {
        const { addDecision } = await import('@/lib/store/db');
        const { scoreSignal } = await import('@/lib/engine/mlFilter');

        const decisionData = {
          id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          signalId, symbol: coin.symbol, signal: sig.signal as Signal['signal'],
          direction: (routed as unknown as { direction: string }).direction || 'NEUTRAL', action: 'INFO',
          confidence,
          price: coin.price, timestamp: coin.timestamp,
          source: sig.sourceId || `SOL Engine | ${coin.symbol}`,
          ema50: coin.ema50, ema200: coin.ema200, ema800: 0,
          psychHigh: coin.psychHigh, psychLow: coin.psychLow, dailyOpen: coin.dailyOpen,
          priceAfter5m: null, priceAfter15m: null, priceAfter1h: null, priceAfter4h: null,
          outcome: 'PENDING' as const, pnlPercent: null, evaluatedAt: null,
        };

        // Calibration #15: ML Filter gate
        const mlScore = scoreSignal(decisionData as Parameters<typeof scoreSignal>[0]);
        if (mlScore.verdict === 'REJECT') {
          log.info(`${coin.symbol} ${sig.signal} ML-REJECTED: score ${mlScore.score}/100`);
        } else {
          addDecision(decisionData);
          log.info(`${coin.symbol} DECISION SAVED: ${sig.signal} @ $${coin.price} conf:${confidence}% ml:${mlScore.score}/100 [${mlScore.verdict}]`);
        }
      } catch (err) {
        log.error(`Decision save failed for ${coin.symbol}`, { error: (err as Error).message });
      }
    }
  }

  const result: MultiCoinResult = { coins: results, totalSignals, timestamp: new Date().toISOString(), cached: false };
  cache.result = { data: result, ts: now };
  return result;
}
