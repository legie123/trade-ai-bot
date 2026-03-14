// ============================================================
// BTC Signal Engine — Server-side signal generator
// Uses CoinGecko free API for BTC OHLC candles
// Computes EMA 50/200/800, detects liquidity plays,
// and generates BUY/SELL/LONG/SHORT signals automatically.
// ============================================================
import { routeSignal } from '@/lib/router/signalRouter';
import { signalStore } from '@/lib/store/signalStore';
import { Signal } from '@/lib/types/radar';
import { fetchWithRetry } from '@/lib/providers/base';

// ─── Types ─────────────────────────────────────────
interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface AnalysisResult {
  price: number;
  ema50: number;
  ema200: number;
  ema800: number;
  dailyOpen: number;
  dailyClose: number;
  psychHigh: number;
  psychLow: number;
  prevHigh: number;
  prevLow: number;
  signals: { signal: string; reason: string }[];
  timestamp: string;
}

// ─── EMA Calculator ────────────────────────────────
function calcEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

// ─── Fetch BTC OHLC from CoinGecko (free, no key) ──
async function fetchBTCCandles(): Promise<Candle[]> {
  try {
    const res = await fetchWithRetry(
      'https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=30',
      { retries: 2, timeoutMs: 8000 }
    );
    const data: number[][] = await res.json();
    // Format: [timestamp, open, high, low, close]
    return data.map((c) => ({
      t: c[0],
      o: c[1],
      h: c[2],
      l: c[3],
      c: c[4],
    }));
  } catch (err) {
    console.error('[BTC Engine] CoinGecko OHLC failed:', err);
    return [];
  }
}

// ─── Fetch current BTC price ───────────────────────
async function fetchBTCPrice(): Promise<number> {
  try {
    const res = await fetchWithRetry(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true',
      { retries: 2, timeoutMs: 5000 }
    );
    const data = await res.json();
    return data?.bitcoin?.usd || 0;
  } catch {
    return 0;
  }
}

// ─── Main Analysis ─────────────────────────────────
export async function analyzeBTC(): Promise<AnalysisResult> {
  const [candles, livePrice] = await Promise.all([
    fetchBTCCandles(),
    fetchBTCPrice(),
  ]);

  const closes = candles.map((c) => c.c);
  const price = livePrice || (closes.length > 0 ? closes[closes.length - 1] : 0);

  if (price === 0) {
    return emptyResult('No BTC price data available');
  }

  // EMAs
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const ema800 = calcEMA(closes, 800);

  // Psychological levels ($1000 rounding)
  const psychHigh = Math.ceil(price / 1000) * 1000;
  const psychLow = Math.floor(price / 1000) * 1000;

  // Daily Open/Close (from last 2 candles)
  const last = candles.length > 0 ? candles[candles.length - 1] : { o: price, h: price, l: price, c: price, t: Date.now() };
  const prev = candles.length > 1 ? candles[candles.length - 2] : last;
  const dailyOpen = last.o;
  const dailyClose = price;
  const prevHigh = prev.h;
  const prevLow = prev.l;

  const signals: { signal: string; reason: string }[] = [];

  // ── EMA Structure ──
  const aboveAll = price > ema50 && price > ema200 && price > ema800;
  const belowAll = price < ema50 && price < ema200 && price < ema800;
  const bullStack = ema50 > ema200 && ema200 > ema800;
  const bearStack = ema50 < ema200 && ema200 < ema800;

  // EMA 50/200 cross (compare last two EMA values)
  const closesMinusOne = closes.slice(0, -1);
  const prevEma50 = closesMinusOne.length >= 50 ? calcEMA(closesMinusOne, 50) : ema50;
  const prevEma200 = closesMinusOne.length >= 200 ? calcEMA(closesMinusOne, 200) : ema200;
  const crossUp50_200 = prevEma50 <= prevEma200 && ema50 > ema200;
  const crossDown50_200 = prevEma50 >= prevEma200 && ema50 < ema200;

  // ── Liquidity Signals ──

  // Sweep Daily Open (wick below then close above = bullish)
  if (last.l < dailyOpen && price > dailyOpen && price > last.o) {
    signals.push({ signal: 'BUY', reason: 'Liquidity grab at Daily Open — swept & reclaimed' });
  }
  // Rejection at Daily Open from above
  if (last.h > dailyOpen && price < dailyOpen && price < last.o) {
    signals.push({ signal: 'SELL', reason: 'Rejected at Daily Open from above' });
  }

  // Bounce off Psychological Low
  if (last.l <= psychLow && price > psychLow && price > last.o) {
    signals.push({ signal: 'BUY', reason: `Bounce off Psych Low ($${psychLow.toLocaleString()})` });
  }
  // Rejection at Psychological High
  if (last.h >= psychHigh && price < psychHigh && price < last.o) {
    signals.push({ signal: 'SELL', reason: `Rejected at Psych High ($${psychHigh.toLocaleString()})` });
  }

  // Previous candle high/low sweep
  if (last.l < prevLow && price > prevLow) {
    signals.push({ signal: 'BUY', reason: 'Swept previous low + reclaim' });
  }
  if (last.h > prevHigh && price < prevHigh) {
    signals.push({ signal: 'SELL', reason: 'Swept previous high + rejection' });
  }

  // ── EMA Signals ──
  if (crossUp50_200 && aboveAll) {
    signals.push({ signal: 'LONG', reason: 'EMA 50 crossed above EMA 200 — bullish stack confirmed' });
  }
  if (crossDown50_200 && belowAll) {
    signals.push({ signal: 'SHORT', reason: 'EMA 50 crossed below EMA 200 — bearish stack confirmed' });
  }

  // Price reclaims/loses EMA 200
  if (prev.c < ema200 && price > ema200 && price > ema50) {
    signals.push({ signal: 'BUY', reason: 'Price reclaimed EMA 200 with EMA 50 support' });
  }
  if (prev.c > ema200 && price < ema200 && price < ema50) {
    signals.push({ signal: 'SELL', reason: 'Price lost EMA 200 with EMA 50 resistance' });
  }

  // ── Default status if no actionable signal ──
  if (signals.length === 0) {
    if (aboveAll && bullStack) {
      signals.push({ signal: 'NEUTRAL', reason: `Bullish structure — above all EMAs, stack intact` });
    } else if (belowAll && bearStack) {
      signals.push({ signal: 'NEUTRAL', reason: `Bearish structure — below all EMAs` });
    } else if (price > ema200) {
      signals.push({ signal: 'NEUTRAL', reason: `Above EMA 200 — no fresh trigger` });
    } else {
      signals.push({ signal: 'NEUTRAL', reason: `Ranging — no clear signal` });
    }
  }

  return {
    price: Math.round(price * 100) / 100,
    ema50: Math.round(ema50 * 100) / 100,
    ema200: Math.round(ema200 * 100) / 100,
    ema800: Math.round(ema800 * 100) / 100,
    dailyOpen: Math.round(dailyOpen * 100) / 100,
    dailyClose: Math.round(dailyClose * 100) / 100,
    psychHigh,
    psychLow,
    prevHigh: Math.round(prevHigh * 100) / 100,
    prevLow: Math.round(prevLow * 100) / 100,
    signals,
    timestamp: new Date().toISOString(),
  };
}

function emptyResult(reason: string): AnalysisResult {
  return {
    price: 0, ema50: 0, ema200: 0, ema800: 0,
    dailyOpen: 0, dailyClose: 0, psychHigh: 0, psychLow: 0,
    prevHigh: 0, prevLow: 0,
    signals: [{ signal: 'NEUTRAL', reason }],
    timestamp: new Date().toISOString(),
  };
}

// ─── Generate and store signals ────────────────────
export async function generateBTCSignals(): Promise<AnalysisResult> {
  const analysis = await analyzeBTC();

  // Push non-neutral signals to store via router + save to Decision Memory
  for (const sig of analysis.signals) {
    if (sig.signal === 'NEUTRAL') continue;

    const signalId = `btc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const signal: Signal = {
      id: signalId,
      symbol: 'BTC',
      timeframe: '4h',
      signal: sig.signal as Signal['signal'],
      price: analysis.price,
      timestamp: analysis.timestamp,
      source: 'CryptoRadar Engine',
      message: sig.reason,
    };

    const routed = routeSignal(signal);
    signalStore.addSignal(routed);

    // Save Decision Snapshot for performance tracking
    try {
      const { addDecision } = await import('@/lib/store/db');
      addDecision({
        id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        signalId,
        symbol: 'BTC',
        signal: sig.signal as Signal['signal'],
        direction: (routed as unknown as { direction: string }).direction || 'NEUTRAL',
        action: (routed as unknown as { action: string }).action || 'INFO',
        confidence: (routed as unknown as { confidence: number }).confidence || 0,
        price: analysis.price,
        timestamp: analysis.timestamp,
        source: 'CryptoRadar Engine',
        ema50: analysis.ema50,
        ema200: analysis.ema200,
        ema800: analysis.ema800,
        psychHigh: analysis.psychHigh,
        psychLow: analysis.psychLow,
        dailyOpen: analysis.dailyOpen,
        priceAfter5m: null,
        priceAfter15m: null,
        priceAfter1h: null,
        priceAfter4h: null,
        outcome: 'PENDING',
        pnlPercent: null,
        evaluatedAt: null,
      });
    } catch (err) {
      console.warn('[BTC Engine] Failed to save decision:', err);
    }
  }

  return analysis;
}
