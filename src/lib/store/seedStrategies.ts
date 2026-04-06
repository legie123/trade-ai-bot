// Initial gladiator strategies for the Phoenix V2 Combat Arena
// These are seed data — real performance will overwrite via the RL loop

export interface SeedStrategy {
  id: string;
  name: string;
  description: string;
}

export const INITIAL_STRATEGIES: SeedStrategy[] = [
  // ─── DAY TRADING Arena ───
  { id: 'btc-momentum-alpha', name: 'BTC Momentum Alpha', description: 'Trend-following on BTC using EMA crossovers and volume confirmation' },
  { id: 'eth-breakout-hunter', name: 'ETH Breakout Hunter', description: 'Captures ETH breakouts from key support/resistance zones' },
  { id: 'multi-asset-mean-rev', name: 'Multi-Asset Mean Reversion', description: 'Exploits price reversion to mean across top-10 crypto assets' },

  // ─── SCALPING Arena ───
  { id: 'btc-scalp-sniper', name: 'BTC Scalp Sniper', description: 'Ultra-short scalps on BTC using order flow and liquidity grabs' },
  { id: 'alt-scalp-machine', name: 'Alt Scalp Machine', description: 'High-frequency scalping on altcoins with tight spreads' },
  { id: 'spread-scalp-arb', name: 'Spread Scalp Arbitrage', description: 'Cross-exchange micro-arbitrage on top pairs' },

  // ─── SWING Arena ───
  { id: 'swing-trend-follow', name: 'Swing Trend Follower', description: 'Multi-day trend following using daily EMA800 and weekly structure' },
  { id: 'btc-swing-macro', name: 'BTC Swing Macro', description: 'Long-term BTC plays based on macro cycles and halving dynamics' },
  { id: 'eth-swing-defi', name: 'ETH Swing DeFi', description: 'ETH swing trades triggered by DeFi TVL and gas fee anomalies' },

  // ─── DEEP WEB Arena (Solana Ecosystem) ───
  { id: 'solana-momentum', name: 'Solana Momentum', description: 'SOL-native momentum strategy using DEX volume and NFT mint data' },
  { id: 'solana-eco-tracker', name: 'Solana Eco Tracker', description: 'Tracks emerging Solana ecosystem tokens via social and on-chain signals' },
  { id: 'memecoin-degen', name: 'Memecoin Degen', description: 'High-risk memecoin hunter with strict risk caps and quick exits' },
];
