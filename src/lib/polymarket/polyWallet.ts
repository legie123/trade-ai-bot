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

// AUTO-TRADE 2026-05-02 — Bet-sizing knobs env-tunable to unblock paper-mode
// position open when Kelly is small. Defaults match historical hardcoded values
// for full back-compat. POLY_MAX_BET_PCT also caps Kelly inside calculateKellyBetSize.
function getMaxBetPct(): number {
  const v = Number(process.env.POLY_MAX_BET_PCT);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.1;
}
function getKellyFraction(): number {
  const v = Number(process.env.POLY_KELLY_FRACTION);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.25;
}
function getMinBetUsd(): number {
  const v = Number(process.env.POLY_MIN_BET_USD);
  return Number.isFinite(v) && v >= 0 ? v : 10;
}

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

// ─── Create wallet ───────────────────────────────────
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
  if (wallet.dailyLossTrackingDate !== today) {
    wallet.dailyLossTrackingDate = today;
    wallet.dailyRealizedPnL = 0;
    wallet.tradingDisabledReason = undefined;
    log.info('Daily loss limit reset', { date: today });
  }
}

export function checkLossLimits(wallet: PolyWallet): { canTrade: boolean; reason?: string } {
  if (wallet.tradingDisabledReason) {
    return { canTrade: false, reason: wallet.tradingDisabledReason };
  }
  const dailyPnL = wallet.dailyRealizedPnL || 0;
  if (dailyPnL < DAILY_LOSS_LIMIT) {
    const reason = `Daily loss limit breached: $${dailyPnL.toFixed(2)} (limit: $${DAILY_LOSS_LIMIT})`;
    wallet.tradingDisabledReason = reason;
    log.warn('Trading disabled due to daily loss limit', { dailyPnL });
    return { canTrade: false, reason };
  }
  const totalUnrealized = calculateUnrealizedPnL(wallet);
  if (totalUnrealized < POSITION_LOSS_LIMIT) {
    const reason = `Position loss limit breached: $${totalUnrealized.toFixed(2)} (limit: $${POSITION_LOSS_LIMIT})`;
    wallet.tradingDisabledReason = reason;
    log.warn('Trading disabled due to position loss limit', { totalUnrealized });
    return { canTrade: false, reason };
  }
  return { canTrade: true };
}

// ─── Calculate Kelly criterion bet size ────────────────────
export function calculateKellyBetSize(
  bankroll: number,
  winProbability: number,
  oddsImplied: number,
  confidence: number,
): number {
  if (winProbability <= oddsImplied || winProbability < 0.51) return 0;

  const b = (1 / oddsImplied) - 1;
  const q = 1 - winProbability;
  const fullKelly = Math.max(0, (winProbability * b - q) / b);

  const confidenceScalar = confidence / 100;
  const kellyFraction = getKellyFraction();
  const betSize = fullKelly * kellyFraction * confidenceScalar;

  // Kelly hard cap = MAX_BET_PCT (env-tunable, was hardcoded 0.1).
  const maxPct = getMaxBetPct();
  return Math.round(bankroll * Math.max(0, Math.min(maxPct, betSize)));
}

// ─── Open position ────────────────────────────────
export function openPosition(
  wallet: PolyWallet,
  marketId: string,
  division: PolyDivision,
  outcomeId: string,
  direction: 'BUY_YES' | 'BUY_NO',
  entryPrice: number,
  confidence: number,
  edgeScore: number,
  decisionId?: string,
): PolyPosition | null {
  validatePaperTrading(wallet);
  checkAndResetDailyLimits(wallet);

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

  if (divBalance.positions.length >= MAX_POSITIONS_PER_DIVISION) {
    log.warn('Max positions reached for division', {
      division,
      current: divBalance.positions.length,
    });
    return null;
  }

  // Calculate bet size using Kelly + env-tunable caps
  const maxBet = divBalance.balance * getMaxBetPct();
  const impliedProb = direction === 'BUY_YES' ? entryPrice : 1 - entryPrice;
  const edgeFraction = (edgeScore / 100) * 0.15;
  const myProb = Math.min(0.95, impliedProb + edgeFraction);
  const kellyBet = calculateKellyBetSize(divBalance.balance, myProb, impliedProb, confidence);
  const betSize = Math.min(maxBet, kellyBet);

  const minBet = getMinBetUsd();
  if (betSize < minBet) {
    log.info('Bet size too small, skipping', { betSize, maxBet, minBet });
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
    decisionId,
  };

  divBalance.positions.push(position);
  divBalance.investedCapital += betSize;
  divBalance.balance -= betSize;

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

// ─── Update position mark-to-market ─────────────────────
export function updatePositionPrice(
  position: PolyPosition,
  currentPrice: number,
): void {
  position.currentPrice = Math.max(0, Math.min(1, currentPrice));
  position.currentValue = position.shares * position.currentPrice;
  const originalValue = position.shares * position.entryPrice;
  position.unrealizedPnL = position.currentValue - originalValue;
  position.roi = originalValue > 0 ? position.unrealizedPnL / originalValue : 0;
}

// ─── Close position ────────────────────────────────
export function closePosition(
  wallet: PolyWallet,
  position: PolyPosition,
  exitPrice: number,
): number {
  const exitValue = position.shares * exitPrice;
  const originalCost = position.capitalAllocated;
  const pnl = exitValue - originalCost;
  const fee = Math.max(0, pnl) * POLYMARKET_FEE;
  const netPnL = pnl - fee;
  const proceeds = originalCost + netPnL;

  const divBalance = wallet.divisionBalances.get(position.division);
  if (divBalance) {
    divBalance.balance += proceeds;
    divBalance.investedCapital -= position.capitalAllocated;
    divBalance.realizedPnL += netPnL;

    if (divBalance.balance < divBalance.peakBalance * 0.5) {
      divBalance.maxDrawdown = Math.max(
        divBalance.maxDrawdown,
        1 - divBalance.balance / divBalance.peakBalance,
      );
    }
    divBalance.peakBalance = Math.max(divBalance.peakBalance, divBalance.balance);
    divBalance.positions = divBalance.positions.filter(p => p.marketId !== position.marketId);
  }

  wallet.allPositions = wallet.allPositions.filter(p => p.marketId !== position.marketId);
  wallet.totalBalance = calculateTotalBalance(wallet);
  wallet.totalInvested = calculateTotalInvested(wallet);
  wallet.totalRealizedPnL += netPnL;
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

// ─── Force liquidation (division down 20%) ────────────────
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

// ─── Rebalance across divisions ─────────────────────────
export function rebalancePortfolio(wallet: PolyWallet): void {
  const divCount = Object.keys(PolyDivision).length;
  if (divCount === 0) return;
  const targetPerDiv = wallet.totalBalance / divCount;

  let availablePool = 0;
  for (const [division, divBalance] of wallet.divisionBalances.entries()) {
    if (divBalance.balance > targetPerDiv * 1.2) {
      const excess = divBalance.balance - targetPerDiv;
      divBalance.balance -= excess;
      availablePool += excess;
      log.debug('Rebalance: Collected excess', { division, excess: excess.toFixed(2) });
    }
  }
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

// ─── Get division stats ───────────────────────────────
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
  const divisionStats = Array.from(wallet.divisionBalances.values()).map(getDivisionStats);
  const totalInvested = Array.from(wallet.divisionBalances.values()).reduce(
    (sum, db) => sum + db.investedCapital, 0);
  const totalUnrealizedPnL = Array.from(wallet.divisionBalances.values()).reduce(
    (sum, db) => sum + db.unrealizedPnL, 0);
  const roi = totalInvested > 0
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

// ─── Helper: Calculate total wallet balance ────────────────────
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

// ─── Helper: Calculate total invested capital ───────────────────
function calculateTotalInvested(wallet: PolyWallet): number {
  let total = 0;
  const divBalances = Array.from(wallet.divisionBalances.values());
  for (const divBalance of divBalances) {
    total += divBalance.investedCapital;
  }
  return total;
}

// ─── Helper: Calculate unrealized PnL ──────────────────────────
export function calculateUnrealizedPnL(wallet: PolyWallet): number {
  let total = 0;
  for (const divBalance of wallet.divisionBalances.values()) {
    for (const position of divBalance.positions) {
      total += (position.unrealizedPnL || 0);
    }
  }
  return total;
}
