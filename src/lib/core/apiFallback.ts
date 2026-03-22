// ============================================================
// API Price Fallback — Multi-exchange resilient fetching
// Sequences: Binance → DexScreener → CoinGecko
// Returns the first successful response to prevent system halt
// ============================================================
import { createLogger } from '@/lib/core/logger';
import { fetchWithRetry } from '@/lib/providers/base';
import { getPrice as getBinancePrice } from '@/lib/exchange/binanceClient';

const log = createLogger('ApiFallback');

export interface FallbackPrice {
  symbol: string;
  price: number;
  source: string;
  latencyMs: number;
}

// ─── Direct CoinGecko Fetch ─────────────────────────
async function fetchCoinGeckoPrice(symbol: string): Promise<number | null> {
  const map: Record<string, string> = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana',
    BONK: 'bonk', WIF: 'dogwifcoin', JUP: 'jupiter-exchange-solana',
    RAY: 'raydium', JTO: 'jito-governance-token',
    PYTH: 'pyth-network', RNDR: 'render-token'
  };
  const cgId = map[symbol] || symbol.toLowerCase();
  
  try {
    const res = await fetchWithRetry(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`,
      { retries: 1, timeoutMs: 3000 }
    );
    const data = await res.json();
    return data[cgId]?.usd || null;
  } catch {
    return null;
  }
}

// ─── Direct DexScreener Fetch ───────────────────────
async function fetchDexScreenerPrice(symbol: string): Promise<number | null> {
  const map: Record<string, string> = {
    SOL: 'So11111111111111111111111111111111111111112',
    BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    JTO: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
    PYTH: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
    RNDR: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',
  };
  const addr = map[symbol];
  if (!addr) return null; // DexScreener mostly for Solana tokens here

  try {
    const res = await fetchWithRetry(
      `https://api.dexscreener.com/tokens/v1/solana/${addr}`,
      { retries: 1, timeoutMs: 3000 }
    );
    const pairs = await res.json();
    if (Array.isArray(pairs) && pairs.length > 0) {
      return parseFloat(pairs[0].priceUsd || '0') || null;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Main Resilient Fetcher ─────────────────────────
export async function getResilientPrice(symbol: string): Promise<FallbackPrice> {
  const start = Date.now();

  // 1. Primary: Binance
  try {
    const binanceSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
    // For meme coins like BONK, Binance uses 1000BONK
    const querySymbol = symbol === 'BONK' ? '1000BONKUSDT' : binanceSymbol;
    
    // We race Binance against a 2s timeout
    const pricePromise = getBinancePrice(querySymbol);
    const timeoutPromise = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Binance Timeout')), 2000));
    
    const price = await Promise.race([pricePromise, timeoutPromise]);
    
    // Reverse the 1000x multiplier if it was applied
    const adjustedPrice = symbol === 'BONK' ? price / 1000 : price;

    if (adjustedPrice > 0) {
      return { symbol, price: adjustedPrice, source: 'Binance', latencyMs: Date.now() - start };
    }
  } catch (err) {
    log.warn('Binance price fetch logic failed, falling back', { symbol, error: (err as Error).message });
  }

  // 2. Fallback: DexScreener (Solana native tokens)
  try {
    const dsStart = Date.now();
    const price = await fetchDexScreenerPrice(symbol);
    if (price && price > 0) {
      log.info('Used DexScreener fallback', { symbol, price });
      return { symbol, price, source: 'DexScreener', latencyMs: Date.now() - dsStart };
    }
  } catch { /* ignore */ }

  // 3. Fallback: CoinGecko (Everything else)
  try {
    const cgStart = Date.now();
    const price = await fetchCoinGeckoPrice(symbol);
    if (price && price > 0) {
      log.info('Used CoinGecko fallback', { symbol, price });
      return { symbol, price, source: 'CoinGecko', latencyMs: Date.now() - cgStart };
    }
  } catch { /* ignore */ }

  log.error('All price sources failed', { symbol });
  throw new Error(`Failed to fetch price for ${symbol} across all providers`);
}
