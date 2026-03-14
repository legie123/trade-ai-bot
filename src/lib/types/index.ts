// ============================================================
// Crypto Deal Radar — Shared Types
// ============================================================

/** Unified token model aggregated from all providers */
export interface NormalizedToken {
  tokenAddress: string;
  chain: string;
  symbol: string;
  name: string;

  // Origin
  sourceOrigin: ProviderName[];
  launchSource: 'pump' | 'raydium' | 'orca' | 'meteora' | 'unknown';
  launchedAt: string | null;

  // Price & Market
  price: number | null;
  marketCap: number | null;
  liquidity: number | null;
  volume5m: number | null;
  volume1h: number | null;
  volume24h: number | null;

  // Trading Activity
  buys5m: number | null;
  sells5m: number | null;
  priceChange5m: number | null;
  priceChange1h: number | null;

  // Holders
  holders: number | null;

  // Boost / Social
  boostLevel: number | null;
  paidOrders: number | null;

  // Risk & Quality
  rugRisk: RiskLevel;
  rugWarnings: string[];
  smartMoneySignal: boolean;
  freshWalletSignal: boolean;

  // Graduation
  graduationStatus: 'bonding' | 'graduated' | 'migrated' | 'unknown';

  // Jupiter Route
  jupiterQuoteQuality: number | null; // 0-100 execution quality

  // Scores
  dealScore: number;
  riskScore: number;
  convictionScore: number;

  // Meta
  lastUpdated: string;
  dataFreshness: DataFreshness;

  // Pool info
  poolAddress: string | null;
  dexName: string | null;

  // Image
  imageUrl: string | null;
}

export type ProviderName =
  | 'dexscreener'
  | 'birdeye'
  | 'jupiter'
  | 'rugcheck'
  | 'geckoterminal'
  | 'pump';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical' | 'unknown';

export type DataFreshness = 'LIVE' | 'CACHED' | 'FALLBACK' | 'UNAVAILABLE';

/** Provider health status */
export interface ProviderHealth {
  name: ProviderName;
  status: 'healthy' | 'degraded' | 'down';
  lastCheck: string;
  latencyMs: number | null;
  message?: string;
}

/** Alert event triggered from live conditions */
export interface AlertEvent {
  id: string;
  type: AlertType;
  tokenAddress: string;
  tokenSymbol: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
  data?: Record<string, unknown>;
}

export type AlertType =
  | 'high_conviction_launch'
  | 'volume_spike'
  | 'fresh_wallet_cluster'
  | 'risk_spike'
  | 'boost_with_liquidity'
  | 'watchlist_threshold';

/** Raw provider response wrapper */
export interface ProviderResponse<T> {
  data: T | null;
  provider: ProviderName;
  freshness: DataFreshness;
  fetchedAt: string;
  error?: string;
}

/** Filter parameters for token queries */
export interface TokenFilters {
  chain?: string;
  ecosystem?: 'pump' | 'all';
  maxAgeMinutes?: number;
  minLiquidity?: number;
  minVolume?: number;
  maxRisk?: RiskLevel;
  boostedOnly?: boolean;
  freshWalletsOnly?: boolean;
  graduatedOnly?: boolean;
  minProviderAgreement?: number; // 1-6
}

/** Scoring weight configuration */
export interface ScoringWeights {
  deal: {
    liquidityQuality: number;
    volumeAcceleration: number;
    buySellImbalance: number;
    priceVelocity: number;
    boostConfirmation: number;
    walletQuality: number;
    executionViability: number;
    launchFreshness: number;
    multiProviderPresence: number;
  };
  risk: {
    rugcheckWarnings: number;
    lowLiquidity: number;
    abnormalConcentration: number;
    suspiciousVolume: number;
    postLaunchSells: number;
    fakeBoost: number;
    unstablePool: number;
  };
  conviction: {
    confidenceMultiplier: number;
  };
}
