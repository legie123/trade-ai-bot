// ============================================================
// Polymarket Module — Barrel re-exports
// ============================================================

export * from './polyTypes';
export * from './polyClient';
export * from './marketScanner';
export * from './polyGladiators';
export * from './polySyndicate';
export { createPolyWallet, calculateKellyBetSize, openPosition, closePosition, updatePositionPrice, emergencyLiquidate, rebalancePortfolio, getDivisionStats, getWalletSummary, calculateUnrealizedPnL } from './polyWallet';
export type { DivisionBalance, PolyWallet } from './polyWallet';

// ── New modules ──
export * from './riskManager';
export * from './strategies';
export * from './telemetry';
export * from './alerts';
export * from './polyState';
