// ============================================================
// Arena-Specific Configuration — Trading Style Thresholds
// Defines criteria for different trading arenas (SCALP, SWING, etc)
// ============================================================

import { createLogger } from '@/lib/core/logger';
import { Gladiator, ArenaType } from '@/lib/types/gladiator';

const log = createLogger('ArenaConfig');

/**
 * ArenaConfig defines the minimum thresholds for a gladiator
 * to be eligible and competitive in a specific arena.
 */
export interface ArenaConfig {
  arena: ArenaType;
  minWinRate: number;           // Percentage (40-55)
  minProfitFactor: number;       // 1.2-2.0
  holdTimeMin: string;           // e.g., "5min", "30min", "1h"
  holdTimeMax: string;           // e.g., "15min", "4h", "days"
  minTradesForEval: number;      // Samples needed (15-50)
  maxDrawdown: number;           // Percentage (5-20)
  description: string;
}

/**
 * SCALPING Arena: Fast, high-frequency, tight risk control
 * - WR >= 55% (strict win rate needed for frequent trades)
 * - PF >= 1.5 (avg win > avg loss)
 * - Hold: max 15min
 * - Min 50 trades to evaluate consistency
 * - DD < 5% (tight stops)
 */
export const SCALP_CONFIG: ArenaConfig = {
  arena: 'SCALPING',
  minWinRate: 55,
  minProfitFactor: 1.5,
  holdTimeMin: '30sec',
  holdTimeMax: '15min',
  minTradesForEval: 50,
  maxDrawdown: 5,
  description: 'Ultra-fast scalping with tight stops and high precision',
};

/**
 * SWING Arena: Medium-term positions, moderate risk
 * - WR >= 45% (lower WR acceptable for larger wins)
 * - PF >= 1.8 (high avg win / avg loss)
 * - Hold: 1h to 24h
 * - Min 20 trades
 * - DD < 15%
 */
export const SWING_CONFIG: ArenaConfig = {
  arena: 'SWING',
  minWinRate: 45,
  minProfitFactor: 1.8,
  holdTimeMin: '1h',
  holdTimeMax: '24h',
  minTradesForEval: 20,
  maxDrawdown: 15,
  description: 'Medium-term swing trades capturing intraday/daily moves',
};

/**
 * MOMENTUM Arena: Trend-following, explosive moves
 * - WR >= 40% (momentum can have many breakeven trades)
 * - PF >= 2.0 (big wins when right)
 * - Hold: 30min to 4h
 * - Min 30 trades
 * - DD < 12%
 */
export const MOMENTUM_CONFIG: ArenaConfig = {
  arena: 'DAY_TRADING',
  minWinRate: 40,
  minProfitFactor: 2.0,
  holdTimeMin: '30min',
  holdTimeMax: '4h',
  minTradesForEval: 30,
  maxDrawdown: 12,
  description: 'Momentum-based day trading on breakouts and trends',
};

/**
 * MEAN_REVERSION Arena: Counter-trend, short-term bounces
 * - WR >= 50% (mean reversion relies on high hit rate)
 * - PF >= 1.3 (modest wins but frequent)
 * - Hold: 5min to 2h
 * - Min 40 trades (needs high sample for volatility)
 * - DD < 8% (controlled risk)
 */
export const MEAN_REV_CONFIG: ArenaConfig = {
  arena: 'DEEP_WEB',
  minWinRate: 50,
  minProfitFactor: 1.3,
  holdTimeMin: '5min',
  holdTimeMax: '2h',
  minTradesForEval: 40,
  maxDrawdown: 8,
  description: 'Mean reversion strategy: buy oversold, sell overbought',
};

/**
 * POLYMARKET Arena: Long-term event-driven betting
 * - WR >= 50% (prediction markets reward consistency)
 * - PF >= 1.2 (steady small edges compound)
 * - Hold: days to weeks
 * - Min 15 trades (fewer samples needed for longer holds)
 * - DD < 20% (higher tolerance for volatile events)
 */
export const POLYMARKET_CONFIG: ArenaConfig = {
  arena: 'DEEP_WEB', // Using DEEP_WEB as proxy for long-term
  minWinRate: 50,
  minProfitFactor: 1.2,
  holdTimeMin: '1d',
  holdTimeMax: '4w',
  minTradesForEval: 15,
  maxDrawdown: 20,
  description: 'Long-term event prediction: low leverage, high conviction',
};

// Map arena type to config
const ARENA_CONFIGS: Record<string, ArenaConfig> = {
  SCALPING: SCALP_CONFIG,
  SCALP: SCALP_CONFIG,
  SWING: SWING_CONFIG,
  MOMENTUM: MOMENTUM_CONFIG,
  DAY_TRADING: MOMENTUM_CONFIG,
  MEAN_REV: MEAN_REV_CONFIG,
  MEAN_REVERSION: MEAN_REV_CONFIG,
  POLYMARKET: POLYMARKET_CONFIG,
};

/** All arena types supported */
export const ALL_ARENAS: ArenaConfig[] = [
  SCALP_CONFIG,
  SWING_CONFIG,
  MOMENTUM_CONFIG,
  MEAN_REV_CONFIG,
  POLYMARKET_CONFIG,
];

/**
 * Get arena configuration by type string (case-insensitive)
 * @param arenaType e.g., "SCALPING", "scalp", "SWING", "momentum"
 * @returns ArenaConfig or null if not found
 */
export function getArenaConfig(arenaType: string): ArenaConfig | null {
  const normalized = arenaType.toUpperCase();
  const config = ARENA_CONFIGS[normalized];

  if (!config) {
    log.warn('Unknown arena type', { arenaType });
    return null;
  }

  return config;
}

/**
 * Check if a gladiator is eligible for a specific arena
 * @param gladiator The gladiator to evaluate
 * @param arenaType Target arena (e.g., "SCALPING", "SWING")
 * @returns { eligible: boolean; reason: string; failedChecks: string[] }
 */
export function isEligibleForArena(
  gladiator: Gladiator,
  arenaType: string
): { eligible: boolean; reason: string; failedChecks: string[] } {
  const config = getArenaConfig(arenaType);
  if (!config) {
    return {
      eligible: false,
      reason: `Unknown arena: ${arenaType}`,
      failedChecks: ['INVALID_ARENA'],
    };
  }

  const failures: string[] = [];

  // Check 1: Win Rate
  if (gladiator.stats.winRate < config.minWinRate) {
    failures.push(
      `WR=${gladiator.stats.winRate}% < ${config.minWinRate}% required`
    );
  }

  // Check 2: Profit Factor
  if (gladiator.stats.profitFactor < config.minProfitFactor) {
    failures.push(
      `PF=${gladiator.stats.profitFactor} < ${config.minProfitFactor} required`
    );
  }

  // Check 3: Total trades (must have minimum sample size)
  if (gladiator.stats.totalTrades < config.minTradesForEval) {
    failures.push(
      `Trades=${gladiator.stats.totalTrades} < ${config.minTradesForEval} required`
    );
  }

  // Check 4: Max Drawdown
  if (gladiator.stats.maxDrawdown > config.maxDrawdown) {
    failures.push(
      `DD=${gladiator.stats.maxDrawdown}% > ${config.maxDrawdown}% max allowed`
    );
  }

  const eligible = failures.length === 0;

  log.debug('Eligibility check', {
    gladiator: gladiator.name,
    arena: arenaType,
    eligible,
    failedChecks: failures,
  });

  return {
    eligible,
    reason: eligible
      ? `${gladiator.name} qualifies for ${arenaType}`
      : `${gladiator.name} does not meet ${arenaType} criteria`,
    failedChecks: failures,
  };
}

/**
 * Get all arenas a gladiator is eligible for
 * @param gladiator The gladiator to evaluate
 * @returns Array of eligible arena names
 */
export function getEligibleArenas(gladiator: Gladiator): string[] {
  return ALL_ARENAS
    .filter(config => isEligibleForArena(gladiator, config.arena).eligible)
    .map(config => config.arena);
}

/**
 * Rank gladiators within an arena by fitness score
 * Fitness = (WR - minWR) + (PF - minPF) + (1 - DD/maxDD)
 * Higher is better
 */
export function scoreGladiatorForArena(
  gladiator: Gladiator,
  arenaType: string
): number {
  const config = getArenaConfig(arenaType);
  if (!config) return 0;

  const wrBonus = Math.max(0, gladiator.stats.winRate - config.minWinRate);
  const pfBonus = Math.max(0, gladiator.stats.profitFactor - config.minProfitFactor);
  const ddPenalty = 1 - Math.min(1, gladiator.stats.maxDrawdown / config.maxDrawdown);

  return wrBonus + pfBonus + ddPenalty;
}
