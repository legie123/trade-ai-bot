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
// Note: PolyPosition re-exported from polyTypes, polyWallet has its own local PolyPosition
