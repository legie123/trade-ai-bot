// GET /api/indicators — Global market context (RSI, VWAP, Fear&Greed, BB) 
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

let cache: { data: Record<string, unknown>; expiresAt: number } | null = null;
const CACHE_TTL = 30_000; // 30s

async function fetchFearGreed(): Promise<{ value: number; label: string }> {
  try {
    const res = await fetch('https://api.alternative.me/fng/', { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      const v = parseInt(data?.data?.[0]?.value || '50', 10);
      return { value: v, label: data?.data?.[0]?.value_classification || 'Neutral' };
    }
  } catch { /* fallback */ }
  return { value: 50, label: 'Neutral' };
}

export async function GET() {
  try {
    const now = Date.now();
    if (cache && now < cache.expiresAt) {
      return NextResponse.json(cache.data);
    }

    // Fetch BTC data for indicator calculations
    let btcPrice = 0, btcSignals: Record<string, unknown>[] = [];
    try {
      const { getServiceUrl } = await import('@/lib/core/serviceUrl');
      const btcRes = await fetch(`${getServiceUrl()}/api/btc-signals`, { signal: AbortSignal.timeout(5000) });
      if (btcRes.ok) {
        const btcData = await btcRes.json();
        btcPrice = btcData.btc?.price || 0;
        btcSignals = btcData.signals || [];
      }
    } catch { /* internal fetch may fail, use fallback */ }

    // If internal fetch fails, try MEXC directly  
    if (!btcPrice) {
      try {
        const mexcRes = await fetch('https://api.mexc.com/api/v3/ticker/price?symbol=BTCUSDT', { signal: AbortSignal.timeout(3000) });
        if (mexcRes.ok) {
          const d = await mexcRes.json();
          btcPrice = parseFloat(d.price);
        }
      } catch { /* */ }
    }

    const fearGreed = await fetchFearGreed();

    // Derive RSI from BTC signals metadata (simplified)
    const rsiSignal = btcSignals.find((s: Record<string, unknown>) => 
      typeof s.reason === 'string' && s.reason.includes('RSI'));
    const rsiMatch = rsiSignal?.reason ? String(rsiSignal.reason).match(/RSI[:\s]*(\d+)/i) : null;
    const rsiValue = rsiMatch ? parseInt(rsiMatch[1], 10) : 50;
    const rsiZone = rsiValue >= 70 ? 'OVERBOUGHT' : rsiValue <= 30 ? 'OVERSOLD' : 'NEUTRAL';

    // VWAP estimate from BTC price (simplified — NOT real VWAP, flagged isEstimate)
    const vwapValue = btcPrice * 0.985;
    // FIX 2026-04-18 (DAILY-AUDIT W1): eliminate Math.random volumeRatio.
    // No real volume feed wired here. Return null + isEstimate=true so UI shows N/A instead of fake data.
    // Downstream conviction scoring uses its own volumeRatio computed from real engines — this route is UI-only.
    const volumeRatio: number | null = null;

    // Bollinger Bands estimate as percentage around price (still estimate, flagged)
    const bbSpread = btcPrice * 0.025;
    
    // Derive regime from signals
    const buySignals = btcSignals.filter((s: Record<string, unknown>) => s.signal === 'BUY').length;
    const sellSignals = btcSignals.filter((s: Record<string, unknown>) => s.signal === 'SELL').length;
    const regime = buySignals > sellSignals ? 'BULL_TREND' : sellSignals > buySignals ? 'BEAR_TREND' : 'RANGING';

    const data = {
      regime,
      fearGreed,
      rsi: { value: rsiValue, zone: rsiZone },
      // volumeRatio intentionally null — no real volume feed; consumers must treat as N/A.
      vwap: { value: Math.round(vwapValue * 100) / 100, volumeRatio, volumeSurge: false, isEstimate: true },
      bollingerBands: {
        upper: Math.round((btcPrice + bbSpread) * 100) / 100,
        middle: btcPrice,
        lower: Math.round((btcPrice - bbSpread) * 100) / 100,
        bandwidth: ((bbSpread * 2) / btcPrice * 100).toFixed(2),
        isEstimate: true,
      },
      btcPrice,
      timestamp: new Date().toISOString(),
    };

    cache = { data, expiresAt: now + CACHE_TTL };
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
