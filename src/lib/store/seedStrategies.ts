// Initial gladiator strategies for the Phoenix V2 Combat Arena
// These are seed data — real performance will overwrite via the RL loop
//
// DNA DESIGN (2026-04-18):
// Each gladiator has unique signal acceptance criteria to create real strategy
// differentiation. Without DNA, all gladiators take identical trades → Arena
// selection is noise-driven. With DNA, each specializes in a niche:
//   - Symbol specialists (BTC-only, ETH-only, SOL-only, meme-only)
//   - Confidence gates (scalpers accept noisy signals, swing traders demand quality)
//   - Direction bias (trend followers = LONG_ONLY, mean-rev = BOTH)
//
// ASSUMPTION THAT INVALIDATES:
//   If signal source coverage is narrow (e.g., only BTC signals exist), symbol
//   specialists for ETH/SOL/meme will starve — zero trades → no selection.
//   Monitor per-gladiator trade counts; if any gladiator has <10 trades after
//   24h, widen its symbolFilter or add new signal sources.

import type { GladiatorDNA } from '../types/gladiator';

export interface SeedStrategy {
  id: string;
  name: string;
  description: string;
  dna: GladiatorDNA;
}

export const INITIAL_STRATEGIES: SeedStrategy[] = [
  // ─── DAY TRADING Arena ───
  {
    id: 'btc-momentum-alpha',
    name: 'BTC Momentum Alpha',
    description: 'Trend-following on BTC using EMA crossovers and volume confirmation',
    dna: { symbolFilter: ['BTC'], minConfidence: 20, directionBias: 'BOTH', timeframes: ['15m', '1h'] },
  },
  {
    id: 'eth-breakout-hunter',
    name: 'ETH Breakout Hunter',
    description: 'Captures ETH breakouts from key support/resistance zones',
    dna: { symbolFilter: ['ETH'], minConfidence: 25, directionBias: 'BOTH', timeframes: ['15m', '1h'] },
  },
  {
    id: 'multi-asset-mean-rev',
    name: 'Multi-Asset Mean Reversion',
    description: 'Exploits price reversion to mean across top-10 crypto assets',
    dna: { symbolFilter: ['*'], minConfidence: 15, directionBias: 'BOTH' },
  },

  // ─── SCALPING Arena ───
  {
    id: 'btc-scalp-sniper',
    name: 'BTC Scalp Sniper',
    description: 'Ultra-short scalps on BTC using order flow and liquidity grabs',
    dna: { symbolFilter: ['BTC'], minConfidence: 10, directionBias: 'BOTH', timeframes: ['1m', '5m', '15m'] },
  },
  {
    id: 'alt-scalp-machine',
    name: 'Alt Scalp Machine',
    description: 'High-frequency scalping on altcoins with tight spreads',
    // Accepts everything EXCEPT BTC — complement to btc-scalp-sniper
    dna: { symbolFilter: ['ETH', 'SOL', 'DOGE', 'PEPE', 'WIF', 'BONK', 'JUP', 'RAY', 'RNDR', 'ARB', 'OP'], minConfidence: 10, directionBias: 'BOTH' },
  },
  {
    id: 'spread-scalp-arb',
    name: 'Spread Scalp Arbitrage',
    description: 'Cross-exchange micro-arbitrage on top pairs',
    dna: { symbolFilter: ['*'], minConfidence: 30, directionBias: 'BOTH' },
  },

  // ─── SWING Arena ───
  {
    id: 'swing-trend-follow',
    name: 'Swing Trend Follower',
    description: 'Multi-day trend following using daily EMA800 and weekly structure',
    // LONG_ONLY: trend followers ride momentum, don't counter-trade
    dna: { symbolFilter: ['*'], minConfidence: 35, directionBias: 'LONG_ONLY', timeframes: ['1h', '4h'] },
  },
  {
    id: 'btc-swing-macro',
    name: 'BTC Swing Macro',
    description: 'Long-term BTC plays based on macro cycles and halving dynamics',
    dna: { symbolFilter: ['BTC'], minConfidence: 40, directionBias: 'LONG_ONLY', timeframes: ['4h'] },
  },
  {
    id: 'eth-swing-defi',
    name: 'ETH Swing DeFi',
    description: 'ETH swing trades triggered by DeFi TVL and gas fee anomalies',
    dna: { symbolFilter: ['ETH'], minConfidence: 30, directionBias: 'BOTH', timeframes: ['1h', '4h'] },
  },

  // ─── DEEP WEB Arena (Solana Ecosystem + Memes) ───
  {
    id: 'solana-momentum',
    name: 'Solana Momentum',
    description: 'SOL-native momentum strategy using DEX volume and NFT mint data',
    dna: { symbolFilter: ['SOL'], minConfidence: 15, directionBias: 'BOTH' },
  },
  {
    id: 'solana-eco-tracker',
    name: 'Solana Eco Tracker',
    description: 'Tracks emerging Solana ecosystem tokens via social and on-chain signals',
    dna: { symbolFilter: ['SOL', 'JUP', 'RAY', 'JTO', 'PYTH', 'RNDR'], minConfidence: 10, directionBias: 'BOTH' },
  },
  {
    id: 'memecoin-degen',
    name: 'Memecoin Degen',
    description: 'High-risk memecoin hunter with strict risk caps and quick exits',
    // Low confidence gate — meme signals are inherently noisy, we accept that
    dna: { symbolFilter: ['WIF', 'BONK', 'PEPE', 'DOGE', 'SHIB', 'FLOKI'], minConfidence: 5, directionBias: 'BOTH' },
  },
];
