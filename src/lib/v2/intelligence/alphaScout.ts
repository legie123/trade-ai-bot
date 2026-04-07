import { createLogger } from '@/lib/core/logger';
import { PromoterData } from '@/lib/types/gladiator';
import { fetchWithRetry } from '@/lib/providers/base';

const log = createLogger('AlphaScout');

// Symbol → CoinGecko ID mapping
const GECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', BTCUSDT: 'bitcoin',
  ETH: 'ethereum', ETHUSDT: 'ethereum',
  SOL: 'solana', SOLUSDT: 'solana',
  XRP: 'ripple', XRPUSDT: 'ripple',
  DOGE: 'dogecoin', DOGEUSDT: 'dogecoin',
  AVAX: 'avalanche-2', AVAXUSDT: 'avalanche-2',
  WIF: 'dogwifcoin', WIFUSDT: 'dogwifcoin',
  BONK: 'bonk', BONKUSDT: 'bonk',
  JUP: 'jupiter', JUPUSDT: 'jupiter',
  RAY: 'raydium', RAYUSDT: 'raydium',
  JTO: 'jito-governance-token', JTOUSDT: 'jito-governance-token',
  PYTH: 'pyth-network', PYTHUSDT: 'pyth-network',
  RNDR: 'render-token', RNDRUSDT: 'render-token',
};

interface GeckoMarketData {
  id: string;
  current_price: number;
  price_change_percentage_24h: number;
  total_volume: number;
  market_cap: number;
  high_24h: number;
  low_24h: number;
}

interface CCSocialData {
  General: {
    Points: number;
    Name: string;
  };
  CryptoCompare: {
    SimilarItems: { Id: number }[];
    Points: number;
    Followers: number;
    Posts: number;
  };
  Twitter: {
    followers: number;
    statuses: number;
    Points: number;
  };
  Reddit: {
    subscribers: number;
    active_users: number;
    posts_per_hour: number;
    comments_per_hour: number;
    Points: number;
  };
}

export class AlphaScout {
  private static instance: AlphaScout;
  private cache: Map<string, { data: string; expiresAt: number }> = new Map();
  private readonly CACHE_TTL = 60_000; // 60s per-symbol cache

  private constructor() {}

  public static getInstance(): AlphaScout {
    if (!AlphaScout.instance) {
      AlphaScout.instance = new AlphaScout();
    }
    return AlphaScout.instance;
  }

  /**
   * Fetches real market data from CoinGecko for top crypto assets.
   */
  public async getMarketSignals(): Promise<PromoterData[]> {
    log.info('🛰️ [AlphaScout] Scanning live market horizons...');
    const signals: PromoterData[] = [];

    try {
      const res = await fetchWithRetry(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false',
        { retries: 2, timeoutMs: 8000 }
      );
      const coins: GeckoMarketData[] = await res.json();

      for (const coin of coins) {
        const change = coin.price_change_percentage_24h || 0;
        let sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
        let confidence = 0.5;

        if (change > 3) { sentiment = 'BULLISH'; confidence = Math.min(0.5 + change / 20, 0.95); }
        else if (change < -3) { sentiment = 'BEARISH'; confidence = Math.min(0.5 + Math.abs(change) / 20, 0.95); }

        signals.push({
          source: 'COINGECKO_MARKET',
          symbol: `${coin.id.toUpperCase()}USDT`,
          sentiment,
          confidenceRate: parseFloat(confidence.toFixed(2)),
          rawPayload: {
            price: coin.current_price,
            change24h: change,
            volume24h: coin.total_volume,
            marketCap: coin.market_cap,
            high24h: coin.high_24h,
            low24h: coin.low_24h,
          },
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      log.warn('[AlphaScout] CoinGecko scan failed, returning empty signals', { error: (err as Error).message });
    }

    return signals;
  }

  /**
   * Deep dive into a specific token using CoinGecko + CryptoCompare social data.
   * Returns a rich text summary that feeds the Dual Master Syndicate.
   */
  public async analyzeToken(symbol: string): Promise<string> {
    // Check cache first
    const cached = this.cache.get(symbol);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    const cleanSymbol = symbol.replace('USDT', '').toUpperCase();
    const geckoId = GECKO_IDS[cleanSymbol] || GECKO_IDS[symbol] || cleanSymbol.toLowerCase();

    log.info(`🔍 [AlphaScout] Deep dive: ${cleanSymbol} (gecko: ${geckoId})`);

    // Parallel fetch: CoinGecko market + CryptoCompare social
    const [marketSummary, socialSummary] = await Promise.all([
      this.fetchGeckoSummary(geckoId),
      this.fetchSocialSummary(cleanSymbol),
    ]);

    const result = `[LIVE INTEL for ${cleanSymbol}] ${marketSummary} | ${socialSummary}`;
    
    // Cache result
    this.cache.set(symbol, { data: result, expiresAt: Date.now() + this.CACHE_TTL });
    
    return result;
  }

  private async fetchGeckoSummary(geckoId: string): Promise<string> {
    try {
      const res = await fetchWithRetry(
        `https://api.coingecko.com/api/v3/coins/${geckoId}?localization=false&tickers=false&community_data=true&developer_data=false`,
        { retries: 1, timeoutMs: 6000 }
      );
      const data = await res.json();

      const price = data.market_data?.current_price?.usd || 0;
      const change24h = data.market_data?.price_change_percentage_24h?.toFixed(2) || '0';
      const change7d = data.market_data?.price_change_percentage_7d?.toFixed(2) || '0';
      const volume = data.market_data?.total_volume?.usd || 0;
      const mcap = data.market_data?.market_cap?.usd || 0;
      const ath = data.market_data?.ath?.usd || 0;
      const athChange = data.market_data?.ath_change_percentage?.usd?.toFixed(1) || '0';

      return `Price: $${price}, 24h: ${change24h}%, 7d: ${change7d}%, Vol: $${(volume / 1e6).toFixed(1)}M, MCap: $${(mcap / 1e9).toFixed(2)}B, ATH: $${ath} (${athChange}% from ATH)`;
    } catch (err) {
      log.warn(`[AlphaScout] Gecko deep dive failed for ${geckoId}`, { error: (err as Error).message });
      return `Market data unavailable for ${geckoId}`;
    }
  }

  private async fetchSocialSummary(symbol: string): Promise<string> {
    try {
      const coinId = this.getCCSocialCoinId(symbol);
      if (coinId === 0) return 'Social data unavailable (unmapped altcoin)';

      const res = await fetchWithRetry(
        `https://min-api.cryptocompare.com/data/social/coin/latest?coinId=${coinId}`,
        { retries: 1, timeoutMs: 5000 }
      );
      const json = await res.json();
      if (json?.Response === 'Error') return `Social data unavailable: ${json.Message || 'API locked'}`;
      
      const data: CCSocialData = json?.Data;
      if (!data || Object.keys(data).length === 0) return 'Social data unavailable';

      const twitterFollowers = data.Twitter?.followers || 0;
      const redditSubs = data.Reddit?.subscribers || 0;
      const redditActive = data.Reddit?.active_users || 0;
      const postsPerHour = data.Reddit?.posts_per_hour || 0;
      const socialScore = data.General?.Points || 0;

      return `Social Score: ${socialScore}, Twitter: ${(twitterFollowers / 1000).toFixed(0)}K followers, Reddit: ${(redditSubs / 1000).toFixed(0)}K subs (${redditActive} active), ${postsPerHour.toFixed(1)} posts/hr`;
    } catch (err) {
      log.warn(`[AlphaScout] CryptoCompare social failed for ${symbol}`, { error: (err as Error).message });
      return 'Social data unavailable';
    }
  }

  // CryptoCompare uses numeric coin IDs for social endpoint
  private getCCSocialCoinId(symbol: string): number {
    const map: Record<string, number> = {
      BTC: 1182, ETH: 7605, SOL: 934443, XRP: 5031,
      DOGE: 4432, AVAX: 910584, ADA: 127380, DOT: 891958,
      MATIC: 321992, LINK: 271745,
    };
    return map[symbol] || 0;
  }
}

