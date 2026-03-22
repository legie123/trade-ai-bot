// ============================================================
// 3-Month Historical Replay Engine v2
// Full pipeline: MTF + VWAP + RSI + BB + Trailing Stop
// Downloads real klines from Binance and replays all strategies
// ============================================================

import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('ReplayV2');

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RC { t: number; o: number; h: number; l: number; c: number; v: number; }

// ─── Fetch historical klines ─────────────────────────
async function fetchKlines(symbol: string, interval: string, start: number, end: number): Promise<RC[]> {
  const all: RC[] = [];
  let cursor = start;
  while (cursor < end) {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${end}&limit=1000`);
    const k = await res.json();
    if (!Array.isArray(k) || k.length === 0) break;
    for (const c of k) all.push({ t: c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] });
    cursor = k[k.length - 1][0] + 1;
    await new Promise(r => setTimeout(r, 150));
  }
  return all;
}

// ─── Indicators ──────────────────────────────────────
function ema(values: number[], p: number): number {
  if (values.length < p) return values.reduce((a, b) => a + b, 0) / values.length;
  const k = 2 / (p + 1);
  let e = values.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) ag += d; else al += Math.abs(d);
  }
  ag /= period; al /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function vwap(candles: RC[], n = 50): number {
  const s = candles.slice(-n);
  let tpv = 0, vol = 0;
  for (const c of s) { const tp = (c.h + c.l + c.c) / 3; tpv += tp * c.v; vol += c.v; }
  return vol > 0 ? tpv / vol : 0;
}

function bbSqueeze(closes: number[], period = 20): boolean {
  if (closes.length < period * 2) return false;
  const sma20 = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(closes.slice(-period).map(v => (v - sma20) ** 2).reduce((a, b) => a + b, 0) / period);
  const bw = sma20 > 0 ? (4 * sd) / sma20 : 0;
  
  // Compare to historical average bandwidth
  const bws: number[] = [];
  for (let i = period; i <= closes.length; i++) {
    const sl = closes.slice(i - period, i);
    const m = sl.reduce((a, b) => a + b, 0) / period;
    const s = Math.sqrt(sl.map(v => (v - m) ** 2).reduce((a, b) => a + b, 0) / period);
    bws.push(m > 0 ? (4 * s) / m : 0);
  }
  const avgBw = bws.reduce((a, b) => a + b, 0) / bws.length;
  return bw < avgBw * 0.75;
}

interface Config {
  name: string;
  tp: number;
  sl: number;
  trailingSl: boolean;  // Enable trailing stop
  trailPct: number;     // Trail distance (% behind highest price)
  vwap: boolean;        // VWAP check
  rsiGate: boolean;     // RSI confirmation
  bbBonus: boolean;     // Bollinger Bands squeeze bonus
}

function replay(c1h: RC[], c4h: RC[], cfg: Config) {
  const trades: { entry: number; exit: number; pnl: number; outcome: string; reason: string; rsiVal: number; bbSq: boolean }[] = [];
  const minBars = 200;

  for (let i = minBars; i < c1h.length; i++) {
    const price = c1h[i].c;
    const cl1h = c1h.slice(0, i + 1).map(c => c.c);

    const m4h = c4h.filter(c => c.t <= c1h[i].t);
    if (m4h.length < 50) continue;
    const cl4h = m4h.map(c => c.c);

    // MTF Confluence
    const b1h = price > ema(cl1h, 50) && ema(cl1h, 50) > ema(cl1h, 200);
    const b4h = price > ema(cl4h, 50) && ema(cl4h, 50) > ema(cl4h, 200);
    if (!(b1h && b4h)) continue;

    // VWAP Volume Gate
    if (cfg.vwap) {
      const v = vwap(c1h.slice(Math.max(0, i - 50), i + 1));
      const vols = c1h.slice(Math.max(0, i - 20), i + 1).map(c => c.v);
      const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
      const l3 = (c1h[i].v + c1h[i-1].v + c1h[i-2].v) / 3;
      const ratio = avg > 0 ? l3 / avg : 0;
      if (!(price > v && ratio >= 1.2)) continue;
    }

    // RSI Confirmation
    const rsiVal = rsi(cl1h, 14);
    if (cfg.rsiGate) {
      if (rsiVal < 45 || rsiVal >= 70) continue;
    }

    // BB Squeeze detection
    const bbSq = bbSqueeze(cl1h);

    // Simulate trade with trailing stop
    const entry = price;
    const tpPrice = entry * (1 + cfg.tp / 100);
    let slPrice = entry * (1 - cfg.sl / 100);
    let exitPrice = entry;
    let outcome = 'NEUTRAL';
    let highestPrice = entry;

    for (let j = i + 1; j < Math.min(i + 48, c1h.length); j++) {
      // Update trailing stop
      if (cfg.trailingSl && c1h[j].h > highestPrice) {
        highestPrice = c1h[j].h;
        const trailSl = highestPrice * (1 - cfg.trailPct / 100);
        if (trailSl > slPrice) slPrice = trailSl; // Only move SL up
      }

      if (c1h[j].h >= tpPrice) { exitPrice = tpPrice; outcome = 'WIN'; break; }
      if (c1h[j].l <= slPrice) { exitPrice = slPrice; outcome = 'LOSS'; break; }
    }

    if (outcome === 'NEUTRAL') {
      const li = Math.min(i + 48, c1h.length - 1);
      exitPrice = c1h[li].c;
      outcome = exitPrice > entry ? 'WIN' : 'LOSS';
    }

    const pnl = ((exitPrice - entry) / entry) * 100;
    trades.push({
      entry: Math.round(entry * 100) / 100,
      exit: Math.round(exitPrice * 100) / 100,
      pnl: Math.round(pnl * 100) / 100,
      outcome,
      reason: `MTF${cfg.vwap ? '+VWAP' : ''}${cfg.rsiGate ? '+RSI' : ''}${bbSq && cfg.bbBonus ? '+BB_SQ' : ''}`,
      rsiVal: Math.round(rsiVal),
      bbSq,
    });
    i += 12; // Cooldown
  }

  // Stats
  const wins = trades.filter(t => t.outcome === 'WIN').length;
  const losses = trades.filter(t => t.outcome === 'LOSS').length;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);

  let balance = 1000;
  for (const t of trades) {
    const risk = balance * 0.015;
    const lev = risk / (balance * (cfg.sl / 100));
    balance += balance * lev * (t.pnl / 100);
    if (balance <= 0) { balance = 0; break; }
  }

  return {
    config: cfg.name,
    totalTrades: trades.length,
    wins, losses,
    winRate: trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0,
    totalPnl: Math.round(totalPnl * 100) / 100,
    avgPnl: trades.length > 0 ? Math.round((totalPnl / trades.length) * 100) / 100 : 0,
    finalBalance: Math.round(balance * 100) / 100,
    returnPct: Math.round(((balance - 1000) / 1000) * 100 * 100) / 100,
    maxDrawdown: trades.length > 0 ? Math.round(Math.min(...trades.map(t => t.pnl)) * 100) / 100 : 0,
    bbSqueezeEntries: trades.filter(t => t.bbSq).length,
    trades: trades.slice(0, 15),
  };
}

export async function GET() {
  log.info('Replay V2: Starting full pipeline validation...');
  const now = Date.now();
  const start = now - 90 * 24 * 3600000;

  try {
    const [c1h, c4h] = await Promise.all([
      fetchKlines('BTCUSDT', '1h', start, now),
      fetchKlines('BTCUSDT', '4h', start, now),
    ]);

    log.info(`Downloaded ${c1h.length} 1H + ${c4h.length} 4H candles`);

    const configs: Config[] = [
      { name: '1. Baseline (MTF only)', tp: 4, sl: 0.5, trailingSl: false, trailPct: 0, vwap: false, rsiGate: false, bbBonus: false },
      { name: '2. + VWAP 1.2x', tp: 4, sl: 0.5, trailingSl: false, trailPct: 0, vwap: true, rsiGate: false, bbBonus: false },
      { name: '3. + VWAP + RSI', tp: 4, sl: 0.5, trailingSl: false, trailPct: 0, vwap: true, rsiGate: true, bbBonus: false },
      { name: '4. + VWAP + RSI + BB', tp: 4, sl: 0.5, trailingSl: false, trailPct: 0, vwap: true, rsiGate: true, bbBonus: true },
      { name: '5. FULL + Trailing SL 1%', tp: 4, sl: 0.5, trailingSl: true, trailPct: 1.0, vwap: true, rsiGate: true, bbBonus: true },
    ];

    const results = configs.map(cfg => replay(c1h, c4h, cfg));

    return NextResponse.json({
      success: true,
      period: '3 months',
      data: { candles1h: c1h.length, candles4h: c4h.length },
      startDate: new Date(start).toISOString(),
      endDate: new Date(now).toISOString(),
      results,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
