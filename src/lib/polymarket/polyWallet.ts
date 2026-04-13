// ============================================================
// Polymarket Paper Wallet — Position management & Kelly criterion
// Balance per division, fee model, position constraints
// ============================================================

import { PolyDivision } from './polyTypes';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyWallet');

const INITIAL_BALANCE = 1000; // Per division
const POLYMARKET_FEE = 0.02; // 2% on winning bets
const MAX_POSITIONS_PER_DIVISION = 5;
const MAX_BET_PCT_OF_DIVISION_BALANCE = 0.1; // 10%
const KELLY_FRACTION = 0.25; // Fractional Kelly (25% of full Kelly)

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
}

export interface PolyWallet {
  id: string;
  createdAt: string;
  totalBalance: number;
  totalInvested: number;
  totalRealizedPnL: number;
  divisionBalances: Map<PolyDivision, DivisionBalance>;
  allPositions: PolyPosition[];
}

// ─── Create wallet ────────────────────────────────────
export function createPolyWallet(): PolyWallet {
  const wallet: PolyWallet = {
    id: `wallet-${Date.now()}`,
    createdAt: new Date().toISOString(),
    totalBalance: Object.keys(PolyDivision).length * INITIAL_BALANCE,
    totalInvested: 0,
    totalRealizedPnL: 0,
    divisionBalances: new Map(),
    allPositions: [],
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
  edgeScore: number, // NEW: from scanner, 0-100
): PolyPosition | null {
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

  log.info('Closed position', {
    marketId: position.marketId,
    division: position.division,
    pnl: netPnL.toFixed(2),
    fee: fee.toFixed(2),
    proceeds: proceeds.toFixed(2),
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
export function rebalancePortfolio(wallet: PolyWallet): void {
  const targetPerDiv = wallet.totalBalance / Object.keys(PolyDivision).length;

  for (const [division, divBalance] of wallet.divisionBalances.entries()) {
    const currentBal = divBalance.balance;

    if (currentBal > targetPerDiv * 1.2) {
      // Too much capital, move to reserve
      const excess = currentBal - targetPerDiv;
      divBalance.balance -= excess;
      log.debug('Rebalance: Reduce capital', { division, excess: excess.toFixed(2) });
    } else if (currentBal < targetPerDiv * 0.8) {
      // Too little capital, bring up from reserve
      const needed = targetPerDiv - currentBal;
      divBalance.balance += needed;
      log.debug('Rebalance: Add capital', { division, added: needed.toFixed(2) });
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
