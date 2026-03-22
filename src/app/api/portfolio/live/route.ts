// ============================================================
// Portfolio Tracker — Live holdings from all exchanges
// GET /api/portfolio/live — real-time portfolio from exchanges
// ============================================================
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface Holding {
  asset: string;
  free: number;
  locked: number;
  total: number;
  usdValue: number | null;
  exchange: string;
}

export async function GET() {
  const holdings: Holding[] = [];
  let totalUsdValue = 0;

  // MEXC balances
  if (process.env.MEXC_API_KEY) {
    try {
      const { getMexcBalances, getMexcPrice } = await import('@/lib/exchange/mexcClient');
      const balances = await getMexcBalances();
      for (const b of balances) {
        let usdValue: number | null = null;
        if (b.asset === 'USDT' || b.asset === 'USDC') {
          usdValue = b.free + (b.locked || 0);
        } else {
          try {
            const price = await getMexcPrice(`${b.asset}USDT`);
            usdValue = (b.free + (b.locked || 0)) * price;
          } catch { /* skip */ }
        }
        holdings.push({
          asset: b.asset, free: b.free, locked: b.locked,
          total: b.free + b.locked, usdValue, exchange: 'mexc',
        });
        if (usdValue) totalUsdValue += usdValue;
      }
    } catch { /* skip */ }
  }

  // Binance balances (testnet)
  if (process.env.BINANCE_API_KEY) {
    try {
      const { getBalances, getPrice } = await import('@/lib/exchange/binanceClient');
      const balances = await getBalances();
      for (const b of balances) {
        let usdValue: number | null = null;
        if (b.asset === 'USDT' || b.asset === 'USDC' || b.asset === 'BUSD') {
          usdValue = b.free + b.locked;
        } else {
          try {
            const price = await getPrice(`${b.asset}USDT`);
            usdValue = (b.free + b.locked) * price;
          } catch { /* skip */ }
        }
        holdings.push({
          asset: b.asset, free: b.free, locked: b.locked,
          total: b.free + b.locked, usdValue,
          exchange: `binance${process.env.BINANCE_TESTNET === 'true' ? ' (testnet)' : ''}`,
        });
        if (usdValue) totalUsdValue += usdValue;
      }
    } catch { /* skip */ }
  }

  // Sort by USD value
  holdings.sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0));

  return NextResponse.json({
    totalUsdValue: Math.round(totalUsdValue * 100) / 100,
    holdingsCount: holdings.length,
    holdings,
    exchanges: {
      mexc: !!process.env.MEXC_API_KEY,
      binance: !!process.env.BINANCE_API_KEY,
      bybit: !!process.env.BYBIT_API_KEY,
    },
    timestamp: new Date().toISOString(),
  });
}
