// ============================================================
// Polymarket Paper Wallet — Position management & Kelly criterion
// ============================================================

import { PolyDivision } from './polyTypes';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyWallet');

export const INITIAL_BALANCE = Number.parseInt(process.env.POLY_INITIAL_BALANCE_PER_DIVISION ?? '100', 10);
const POLYMARKET_FEE = 0.02;
const MAX_POSITIONS_PER_DIVISION = 5;

// AUTO-TRADE 2026-05-02 — env-tunable knobs.
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

// Flat bet mode: when >0, bypass Kelly entirely and use flat bet sizing.
// Required because momentum on efficient markets has no real edge — Kelly
// correctly refuses (returns 0). Flat bet allows visual proof of auto-flow.
// Capped at MAX_BET_PCT × division balance for safety.
function getFlatBetUsd(): number {
  const v = Number(process.env.POLY_FLAT_BET_USD);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

const DAILY_LOSS_LIMIT = -50;
const POSITION_LOSS_LIMIT = -25;

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
  entryPrice: number;       // YES price snapshot (kept for compat / display)
  buyPrice?: number;        // ACTUAL buy price (= yesPrice for BUY_YES, 1-yesPrice for BUY_NO). Optional for back-compat with existing positions.
  currentPrice: number;
  shares: number;
  capitalAllocated: number;
  enteredAt: string;
  currentValue?: number;
  unrealizedPnL?: number;
  roi?: number;
  decisionId?: string;
}

export interface PolyWallet {
  id: string;
  createdAt: string;
  type: 'PAPER' | 'LIVE';
  totalBalance: number;
  totalInvested: number;
  totalRealizedPnL: number;
  divisionBalances: Map<PolyDivision, DivisionBalance>;
  allPositions: PolyPosition[];
  dailyLossTrackingDate?: string;
  dailyRealizedPnL?: number;
  tradingDisabledReason?: string;
}

export function createPolyWallet(type: 'PAPER' | 'LIVE' = 'PAPER'): PolyWallet {
  const today = new Date().toISOString().split('T')[0];
  const wallet: PolyWallet = {
    id: `wallet-${Date.now()}`,
    createdAt: new Date().toISOString(),
    type,
    totalBalance: Object.keys(PolyDivision).length * INITIAL_BALANCE,
    totalInvested: 0,
    totalRealizedPnL: 0,
    divisionBalances: new Map(),
    allPositions: [],
    dailyLossTrackingDate: today,
    dailyRealizedPnL: 0,
    tradingDisabledReason: undefined,
  };
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

export function validatePaperTrading(wallet: PolyWallet): void {
  if (wallet.type !== 'PAPER') {
    const error = 'FATAL: Attempted to trade against NON-PAPER wallet.';
    log.error(error, { walletId: wallet.id, type: wallet.type });
    throw new Error(error);
  }
}

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
  if (wallet.tradingDisabledReason) return { canTrade: false, reason: wallet.tradingDisabledReason };
  const dailyPnL = wallet.dailyRealizedPnL || 0;
  if (dailyPnL < DAILY_LOSS_LIMIT) {
    const reason = `Daily loss limit breached: $${dailyPnL.toFixed(2)} (limit: $${DAILY_LOSS_LIMIT})`;
    wallet.tradingDisabledReason = reason;
    return { canTrade: false, reason };
  }
  const totalUnrealized = calculateUnrealizedPnL(wallet);
  if (totalUnrealized < POSITION_LOSS_LIMIT) {
    const reason = `Position loss limit breached: $${totalUnrealized.toFixed(2)} (limit: $${POSITION_LOSS_LIMIT})`;
    wallet.tradingDisabledReason = reason;
    return { canTrade: false, reason };
  }
  return { canTrade: true };
}

export function calculateKellyBetSize(
  bankroll: number, winProbability: number, oddsImplied: number, confidence: number,
): number {
  if (winProbability <= oddsImplied || winProbability < 0.51) return 0;
  const b = (1 / oddsImplied) - 1;
  const q = 1 - winProbability;
  const fullKelly = Math.max(0, (winProbability * b - q) / b);
  const confidenceScalar = confidence / 100;
  const betSize = fullKelly * getKellyFraction() * confidenceScalar;
  const maxPct = getMaxBetPct();
  return Math.round(bankroll * Math.max(0, Math.min(maxPct, betSize)));
}

export function openPosition(
  wallet: PolyWallet,
  marketId: string,
  division: PolyDivision,
  outcomeId: string,
  direction: 'BUY_YES' | 'BUY_NO',
  entryPrice: number,    // yesPrice snapshot (per Gamma outcomes[0].price)
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
    log.warn('Max positions reached for division', { division, current: divBalance.positions.length });
    return null;
  }

  // ACTUAL buy price (FIX 2026-05-02): BUY_NO buys NO shares at (1-yesPrice),
  // not at yesPrice. Previously shares calc used entryPrice=yesPrice for both,
  // overstating BUY_NO win payoffs by factor 1/(1-yesPrice). Now correct.
  const buyPrice = direction === 'BUY_YES' ? entryPrice : Math.max(0.0001, 1 - entryPrice);

  // Bet sizing: flat-bet mode (env override) OR Kelly-driven (legacy default).
  const flatBet = getFlatBetUsd();
  let betSize: number;
  if (flatBet > 0) {
    // Flat bet mode: capped at MAX_BET_PCT × balance for safety.
    const maxBet = divBalance.balance * getMaxBetPct();
    betSize = Math.min(flatBet, maxBet);
  } else {
    // Kelly mode (legacy default).
    const maxBet = divBalance.balance * getMaxBetPct();
    const impliedProb = direction === 'BUY_YES' ? entryPrice : 1 - entryPrice;
    const edgeFraction = (edgeScore / 100) * 0.15;
    const myProb = Math.min(0.95, impliedProb + edgeFraction);
    const kellyBet = calculateKellyBetSize(divBalance.balance, myProb, impliedProb, confidence);
    betSize = Math.min(maxBet, kellyBet);
  }

  const minBet = getMinBetUsd();
  if (betSize < minBet) {
    log.info('Bet size too small, skipping', { betSize, minBet, mode: flatBet > 0 ? 'flat' : 'kelly' });
    return null;
  }

  const position: PolyPosition = {
    marketId,
    division,
    outcomeId,
    direction,
    entryPrice,                                 // YES price snapshot (compat)
    buyPrice,                                   // actual buy price
    currentPrice: entryPrice,
    shares: Math.round(betSize / buyPrice),     // FIX: shares from buyPrice not yesPrice
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
    marketId, division, direction,
    shares: position.shares, capital: betSize, buyPrice,
    mode: flatBet > 0 ? 'flat' : 'kelly',
  });
  return position;
}

export function updatePositionPrice(position: PolyPosition, currentPrice: number): void {
  position.currentPrice = Math.max(0, Math.min(1, currentPrice));
  position.currentValue = position.shares * position.currentPrice;
  // For BUY_NO, current YES price reflects market belief; equivalent NO price = 1-currentPrice.
  // Use stored buyPrice if available (back-compat: fall back to entryPrice).
  const refBuyPrice = position.buyPrice ?? position.entryPrice;
  const originalValue = position.shares * refBuyPrice;
  position.unrealizedPnL = position.currentValue - originalValue;
  position.roi = originalValue > 0 ? position.unrealizedPnL / originalValue : 0;
}

export function closePosition(
  wallet: PolyWallet, position: PolyPosition, exitPrice: number,
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
      divBalance.maxDrawdown = Math.max(divBalance.maxDrawdown, 1 - divBalance.balance / divBalance.peakBalance);
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
    marketId: position.marketId, division: position.division,
    pnl: netPnL.toFixed(2), fee: fee.toFixed(2), proceeds: proceeds.toFixed(2),
  });
  return netPnL;
}

export function emergencyLiquidate(
  wallet: PolyWallet, division: PolyDivision, exitPrices: Map<string, number>,
): void {
  const divBalance = wallet.divisionBalances.get(division);
  if (!divBalance) return;
  const positions = [...divBalance.positions];
  for (const position of positions) {
    const exitPrice = exitPrices.get(position.marketId) || position.currentPrice;
    closePosition(wallet, position, exitPrice);
  }
  log.warn('Emergency liquidation triggered', { division, remainingBalance: divBalance.balance });
}

export function rebalancePortfolio(wallet: PolyWallet): void {
  const divCount = Object.keys(PolyDivision).length;
  if (divCount === 0) return;
  const targetPerDiv = wallet.totalBalance / divCount;
  let availablePool = 0;
  for (const [, divBalance] of wallet.divisionBalances.entries()) {
    if (divBalance.balance > targetPerDiv * 1.2) {
      const excess = divBalance.balance - targetPerDiv;
      divBalance.balance -= excess;
      availablePool += excess;
    }
  }
  for (const [, divBalance] of wallet.divisionBalances.entries()) {
    if (divBalance.balance < targetPerDiv * 0.8 && availablePool > 0) {
      const needed = Math.min(targetPerDiv - divBalance.balance, availablePool);
      divBalance.balance += needed;
      availablePool -= needed;
    }
  }
  wallet.totalBalance = calculateTotalBalance(wallet);
}

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

export function getWalletSummary(wallet: PolyWallet) {
  const divisionStats = Array.from(wallet.divisionBalances.values()).map(getDivisionStats);
  const totalInvested = Array.from(wallet.divisionBalances.values()).reduce((sum, db) => sum + db.investedCapital, 0);
  const totalUnrealizedPnL = Array.from(wallet.divisionBalances.values()).reduce((sum, db) => sum + db.unrealizedPnL, 0);
  const roi = totalInvested > 0 ? ((wallet.totalRealizedPnL + totalUnrealizedPnL) / totalInvested) * 100 : 0;
  return {
    walletId: wallet.id, createdAt: wallet.createdAt,
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

function calculateTotalBalance(wallet: PolyWallet): number {
  let total = 0;
  for (const divBalance of wallet.divisionBalances.values()) {
    total += divBalance.balance;
    for (const position of divBalance.positions) total += position.currentValue || 0;
  }
  return total;
}

function calculateTotalInvested(wallet: PolyWallet): number {
  let total = 0;
  for (const divBalance of wallet.divisionBalances.values()) total += divBalance.investedCapital;
  return total;
}

export function calculateUnrealizedPnL(wallet: PolyWallet): number {
  let total = 0;
  for (const divBalance of wallet.divisionBalances.values()) {
    for (const position of divBalance.positions) total += (position.unrealizedPnL || 0);
  }
  return total;
}
