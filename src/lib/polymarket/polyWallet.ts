// ============================================================
// Polymarket Paper Wallet — Position management & Kelly criterion
// Balance per division, fee model, position constraints
// ============================================================

import { PolyDivision } from './polyTypes';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyWallet');

// FAZA 4.1 (2026-04-20) — Capital reduction per operator directive.
// Was 1000/division → 16 × 1000 = 16,000 total (user observed in UI).
// Now 100/division → 16 × 100 = 1,600 total. Env override lets operator
// retune without redeploy. Note: a change here is a NO-OP on wallets
// already hydrated from Supabase — a POST /api/v2/polymarket action=reset_wallet
// call is required to rebuild state with the new INITIAL_BALANCE.
export const INITIAL_BALANCE = Number.parseInt(process.env.POLY_INITIAL_BALANCE_PER_DIVISION ?? '100', 10);
const POLYMARKET_FEE = 0.02; // 2% on winning bets
const MAX_POSITIONS_PER_DIVISION = 5;
const MAX_BET_PCT_OF_DIVISION_BALANCE = 0.1; // 10%
const KELLY_FRACTION = 0.25; // Fractional Kelly (25% of full Kelly)
const DAILY_LOSS_LIMIT = -50; // Stop trading if down $50/day
const POSITION_LOSS_LIMIT = -25; // Stop trading if open positions down $25

export interface DivisionBalance {
  division: PolyDivision;
  balance: number;
  investedCapital: number;
  unrealizedPnL: number;
  realizedPnL: number;
  positions: PolyPosition[];
  maxDrawdown: number;
  peakBalance: number;
}

export interface PolyPosition {
  marketId: string;
  division: PolyDivision;
  outcomeId: string;
  direction: 'BUY_YES' | 'BUY_NO';
  entryPrice: number; // Entry probability (0-1)
  currentPrice: number; // Current probability
  shares: number;
  capitalAllocated: number;
  enteredAt: string;
  currentValue?: number;
  unrealizedPnL?: number;
  roi?: number; // Return on invested capital
  decisionId?: string; // FAZA 3.7 — links wallet position to polymarket_decisions row for settlement writeback
}

export interface PolyWallet {
  id: string;
  createdAt: string;
  type: 'PAPER' | 'LIVE'; // CRITICAL: Paper trading only, no live execution
  totalBalance: number;
  totalInvested: number;
  totalRealizedPnL: number;
  divisionBalances: Map<PolyDivision, DivisionBalance>;
  allPositions: PolyPosition[];
  dailyLossTrackingDate?: string; // Date of last reset (YYYY-MM-DD)
  dailyRealizedPnL?: number; // Today's realized P&L (resets at midnight UTC)
  tradingDisabledReason?: string; // If set, reason why trading is paused
}

// ─── Create wallet ────────────────────────────────────
export function createPolyWallet(type: 'PAPER' | 'LIVE' = 'PAPER'): PolyWallet {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const wallet: PolyWallet = {
    id: `wallet-${Date.now()}`,
    createdAt: new Date().toISOString(),
    type, // Default to PAPER
    totalBalance: Object.keys(PolyDivision).length * INITIAL_BALANCE,
    totalInvested: 0,
    totalRealizedPnL: 0,
    divisionBalances: new Map(),
    allPositions: [],
    dailyLossTrackingDate: today,
    dailyRealizedPnL: 0,
    tradingDisabledReason: undefined,
  };

  // Initialize each division
  Object.values(PolyDivision).forEach(division => {
    wallet.divisionBalances.set(division, {
      division,
      balance: INITIAL_BALANCE,
      investedCapital: 0,
      unrealizedPnL: 0,
      realizedPnL: 0,
      positions: [],
      maxDrawdown: 0,
      peakBalance: INITIAL_BALANCE,
    });
  });

  return wallet;
}

// ─── Validate paper trading only ──────────────────────
/**
 * CRITICAL VALIDATION: This system is PAPER TRADING ONLY
 *
 * No real trades are executed. No real money is at risk.
 *
 * If you intend to add live trading in the future:
 * 1. Create a separate wallet type 'LIVE' with different validation
 * 2. Create a separate execution layer (do NOT reuse phantom bet logic)
 * 3. Add 2FA + API key management
 * 4. Add transaction signing
 * 5. Add real-time position monitoring
 * 6. Add kill switches at exchange API level
 *
 * DO NOT modify this function or wallet.type validation.
 */
export function validatePaperTrading(wallet: PolyWallet): void {
  if (wallet.type !== 'PAPER') {
    const error = 'FATAL: Attempted to trade against NON-PAPER wallet. ' +
      'This system is PAPER TRADING ONLY. No real money trades allowed.';
    log.error(error, { walletId: wallet.id, type: wallet.type });
    throw new Error(error);
  }
}

// ─── Check daily loss limits ──────────────────────────
export function checkAndResetDailyLimits(wallet: PolyWallet): void {
  const today = new Date().toISOString().split('T')[0];

  // Reset daily P&L if date changed
  if (wallet.dailyLossTrackingDate !== today) {
    wallet.dailyLossTrackingDate = today;
    wallet.dailyRealizedPnL = 0;
    wallet.tradingDisabledReason = undefined; // Re-enable trading
    log.info('Daily loss limit reset', { date: today });
  }
}

export function checkLossLimits(wallet: PolyWallet): { canTrade: boolean; reason?: string } {
  // Check if trading is already disabled
  if (wallet.tradingDisabledReason) {
    return { canTrade: false, reason: wallet.tradingDisabledReason };
  }

  // Check daily loss limit
  const dailyPnL = wallet.dailyRealizedPnL || 0;
  if (dailyPnL < DAILY_LOSS_LIMIT) {
    const reason = `Daily loss limit breached: $${dailyPnL.toFixed(2)} (limit: $${DAILY_LOSS_LIMIT})`;
    wallet.tradingDisabledReason = reason;
    log.warn('Trading disabled due to daily loss limit', { dailyPnL });
    return { canTrade: false, reason };
  }

  // Check total unrealized loss across open positions
  const totalUnrealized = calculateUnrealizedPnL(wallet);
  if (totalUnrealized < POSITION_LOSS_LIMIT) {
    const reason = `Position loss limit breached: $${totalUnrealized.toFixed(2)} (limit: $${POSITION_LOSS_LIMIT})`;
    wallet.tradingDisabledReason = reason;
    log.warn('Trading disabled due to position loss limit', { totalUnrealized });
    return { canTrade: false, reason };
  }

  return { canTrade: true };
}

// ─── Calculate Kelly criterion bet size ────────────────
export function calculateKellyBetSize(
  bankroll: number,
  winProbability: number,
  oddsImplied: number, // Probability implied by current market price
  confidence: number, // 0-100
): number {
  // Standard Kelly: f* = (p*b - q) / b
  // Where: b = payout odds, p = win probability, q = 1-p
  // For binary: b = (1/oddsImplied) - 1

  if (winProbability <= oddsImplied || winProbability < 0.51) {
    return 0; // No positive edge
  }

  // Payout odds for binary outcome
  const b = (1 / oddsImplied) - 1;
  const q = 1 - winProbability;
  const fullKelly = Math.max(0, (winProbability * b - q) / b);

  // Apply fractional Kelly and confidence scaling
  const confidenceScalar = confidence / 100;
  const betSize = fullKelly * KELLY_FRACTION * confidenceScalar;

  // Size the bet as % of bankroll
  return Math.round(bankroll * Math.max(0, Math.min(0.1, betSize)));
}

// ─── Open position ────────────────────────────────────
export function openPosition(
  wallet: PolyWallet,
  marketId: string,
  division: PolyDivision,
  outcomeId: string,
  direction: 'BUY_YES' | 'BUY_NO',
  entryPrice: number,
  confidence: number,
  edgeScore: number, // from scanner, 0-100
  decisionId?: string, // FAZA 3.7 — link to polymarket_decisions.decision_id for settlement
): PolyPosition | null {
  // CRITICAL: Validate paper trading only
  validatePaperTrading(wallet);

  // Check and reset daily limits
  checkAndResetDailyLimits(wallet);

  // Check if trading is allowed
  const limits = checkLossLimits(wallet);
  if (!limits.canTrade) {
    log.warn('Position rejected due to loss limits', { reason: limits.reason });
    return null;
  }

  const divBalance = wallet.divisionBalances.get(division);
  if (!divBalance) {
    log.warn('Division not found', { division });
    return null;
  }

  // Check position limits
  if (divBalance.positions.length >= MAX_POSITIONS_PER_DIVISION) {
    log.warn('Max positions reached for division', {
      division,
      current: divBalance.positions.length,
    });
    return null;
  }

  // Calculate bet size using Kelly
  const maxBet = divBalance.balance * MAX_BET_PCT_OF_DIVISION_BALANCE;
  const impliedProb = direction === 'BUY_YES' ? entryPrice : 1 - entryPrice;
  // Edge score 0-100 maps to 0-15% edge above market price
  const edgeFraction = (edgeScore / 100) * 0.15; // max 15% edge at perfect score
  const myProb = Math.min(0.95, impliedProb + edgeFraction);
  const kellyBet = calculateKellyBetSize(divBalance.balance, myProb, impliedProb, confidence);
  const betSize = Math.min(maxBet, kellyBet);

  if (betSize < 10) {
    log.info('Bet size too small, skipping', { betSize, maxBet });
    return null;
  }

  const position: PolyPosition = {
    marketId,
    division,
    outcomeId,
    direction,
    entryPrice,
    currentPrice: entryPrice,
    shares: Math.round(betSize / entryPrice),
    capitalAllocated: betSize,
    enteredAt: new Date().toISOString(),
    currentValue: betSize,
    unrealizedPnL: 0,
    roi: 0,
    decisionId, // FAZA 3.7 — undefined when caller cannot resolve decision row
  };

  // Update division balance
  divBalance.positions.push(position);
  divBalance.investedCapital += betSize;
  divBalance.balance -= betSize;

  // Update wallet totals
  wallet.allPositions.push(position);
  wallet.totalBalance = calculateTotalBalance(wallet);
  wallet.totalInvested = calculateTotalInvested(wallet);

  log.info('Opened position', {
    marketId,
    division,
    shares: position.shares,
    capital: betSize,
  });

  return position;
}

// ─── Update position mark-to-market ───────────────────
export function updatePositionPrice(
  position: PolyPosition,
  currentPrice: number,
): void {
  position.currentPrice = Math.max(0, Math.min(1, currentPrice));

  // Current value = shares * current price
  position.currentValue = position.shares * position.currentPrice;

  // Unrealized P&L
  const originalValue = position.shares * position.entryPrice;
  position.unrealizedPnL = position.currentValue - originalValue;
  position.roi = originalValue > 0 ? position.unrealizedPnL / originalValue : 0;
}

// ─── Close position ───────────────────────────────────
export function closePosition(
  wallet: PolyWallet,
  position: PolyPosition,
  exitPrice: number,
): number {
  const exitValue = position.shares * exitPrice;
  const originalCost = position.capitalAllocated;

  // Apply Polymarket fee (2%) on winnings only
  const pnl = exitValue - originalCost;
  const fee = Math.max(0, pnl) * POLYMARKET_FEE;
  const netPnL = pnl - fee;
  const proceeds = originalCost + netPnL;

  // Update division balance
  const divBalance = wallet.divisionBalances.get(position.division);
  if (divBalance) {
    divBalance.balance += proceeds;
    divBalance.investedCapital -= position.capitalAllocated;
    divBalance.realizedPnL += netPnL;

    // Update max drawdown
    if (divBalance.balance < divBalance.peakBalance * 0.5) {
      divBalance.maxDrawdown = Math.max(
        divBalance.maxDrawdown,
        1 - divBalance.balance / divBalance.peakBalance,
      );
    }

    // Update peak balance
    divBalance.peakBalance = Math.max(divBalance.peakBalance, divBalance.balance);

    // Remove position
    divBalance.positions = divBalance.positions.filter(p => p.marketId !== position.marketId);
  }

  // Update wallet totals
  wallet.allPositions = wallet.allPositions.filter(p => p.marketId !== position.marketId);
  wallet.totalBalance = calculateTotalBalance(wallet);
  wallet.totalInvested = calculateTotalInvested(wallet);
  wallet.totalRealizedPnL += netPnL;

  // Track daily P&L separately
  wallet.dailyRealizedPnL = (wallet.dailyRealizedPnL || 0) + netPnL;

  log.info('Closed position', {
    marketId: position.marketId,
    division: position.division,
    pnl: netPnL.toFixed(2),
    fee: fee.toFixed(2),
    proceeds: proceeds.toFixed(2),
    dailyPnL: wallet.dailyRealizedPnL?.toFixed(2),
  });

  return netPnL;
}

// ─── Force liquidation (division down 20%) ────────────
export function emergencyLiquidate(
  wallet: PolyWallet,
  division: PolyDivision,
  exitPrices: Map<string, number>,
): void {
  const divBalance = wallet.divisionBalances.get(division);
  if (!divBalance) return;

  const positions = [...divBalance.positions];
  for (const position of positions) {
    const exitPrice = exitPrices.get(position.marketId) || position.currentPrice;
    closePosition(wallet, position, exitPrice);
  }

  log.warn('Emergency liquidation triggered', {
    division,
    remainingBalance: divBalance.balance,
  });
}

// ─── Rebalance across divisions ────────────────────────
// FIX CRITICAL: Previous implementation created money from nothing.
// Now uses a two-pass approach: collect excess first, then distribute to deficit divisions.
export function rebalancePortfolio(wallet: PolyWallet): void {
  const divCount = Object.keys(PolyDivision).length;
  if (divCount === 0) return;
  const targetPerDiv = wallet.totalBalance / divCount;

  // Pass 1: Collect excess from over-allocated divisions
  let availablePool = 0;
  for (const [division, divBalance] of wallet.divisionBalances.entries()) {
    if (divBalance.balance > targetPerDiv * 1.2) {
      const excess = divBalance.balance - targetPerDiv;
      divBalance.balance -= excess;
      availablePool += excess;
      log.debug('Rebalance: Collected excess', { division, excess: excess.toFixed(2) });
    }
  }

  // Pass 2: Distribute collected pool to under-allocated divisions (only from pool, not thin air)
  for (const [division, divBalance] of wallet.divisionBalances.entries()) {
    if (divBalance.balance < targetPerDiv * 0.8 && availablePool > 0) {
      const needed = Math.min(targetPerDiv - divBalance.balance, availablePool);
      divBalance.balance += needed;
      availablePool -= needed;
      log.debug('Rebalance: Distributed from pool', { division, added: needed.toFixed(2), remainingPool: availablePool.toFixed(2) });
    }
  }

  wallet.totalBalance = calculateTotalBalance(wallet);
}

// ─── Get division stats ────────────────────────────────
export function getDivisionStats(divBalance: DivisionBalance) {
  const totalInvested = divBalance.investedCapital;
  const realizedReturn = totalInvested > 0 ? divBalance.realizedPnL / totalInvested : 0;
  const unrealizedReturn = totalInvested > 0 ? divBalance.unrealizedPnL / totalInvested : 0;
  const totalReturn = realizedReturn + unrealizedReturn;

  return {
    division: divBalance.division,
    balance: Math.round(divBalance.balance),
    invested: Math.round(totalInvested),
    realizedPnL: Math.round(divBalance.realizedPnL),
    unrealizedPnL: Math.round(divBalance.unrealizedPnL),
    totalReturn: Math.round(totalReturn * 100),
    roi: totalInvested > 0 ? Math.round((totalReturn / totalInvested) * 100) : 0,
    maxDrawdown: Math.round(divBalance.maxDrawdown * 100),
    positionCount: divBalance.positions.length,
  };
}

// ─── Get wallet summary ────────────────────────────────
export function getWalletSummary(wallet: PolyWallet) {
  const divisionStats = Array.from(wallet.divisionBalances.values()).map(
    getDivisionStats,
  );

  const totalInvested = Array.from(wallet.divisionBalances.values()).reduce(
    (sum, db) => sum + db.investedCapital,
    0,
  );
  const totalUnrealizedPnL = Array.from(wallet.divisionBalances.values()).reduce(
    (sum, db) => sum + db.unrealizedPnL,
    0,
  );

  const roi =
    totalInvested > 0
      ? ((wallet.totalRealizedPnL + totalUnrealizedPnL) / totalInvested) * 100
      : 0;

  return {
    walletId: wallet.id,
    createdAt: wallet.createdAt,
    totalBalance: Math.round(wallet.totalBalance),
    totalInvested: Math.round(totalInvested),
    realizedPnL: Math.round(wallet.totalRealizedPnL),
    unrealizedPnL: Math.round(totalUnrealizedPnL),
    totalPnL: Math.round(wallet.totalRealizedPnL + totalUnrealizedPnL),
    roi: Math.round(roi),
    positionCount: wallet.allPositions.length,
    divisionStats,
  };
}

// ─── Helper: Calculate total wallet balance ────────────
function calculateTotalBalance(wallet: PolyWallet): number {
  let total = 0;
  const divBalances = Array.from(wallet.divisionBalances.values());
  for (const divBalance of divBalances) {
    total += divBalance.balance;
    for (const position of divBalance.positions) {
      total += position.currentValue || 0;
    }
  }
  return total;
}

// ─── Helper: Calculate total invested capital ─────────
function calculateTotalInvested(wallet: PolyWallet): number {
  let total = 0;
  const divBalances = Array.from(wallet.divisionBalances.values());
  for (const divBalance of divBalances) {
    total += divBalance.investedCapital;
  }
  return total;
}

// ─── Helper: Calculate unrealized PnL ──────────────────
export function calculateUnrealizedPnL(wallet: PolyWallet): number {
  let total = 0;
  for (const divBalance of wallet.divisionBalances.values()) {
    for (const position of divBalance.positions) {
      total += (position.unrealizedPnL || 0);
    }
  }
  return total;
}
