// ============================================================
// Dynamic Strategy Schema
// Allows AI to generate logic and store it in Supabase as JSON
// ============================================================

export type IndicatorName = 'RSI' | 'MACD' | 'VWAP' | 'BB' | 'EMA' | 'VOLUME' | 'PRICE' | 'FUNDING_RATE' | 'OB';
export type ComparisonOperator = '>' | '<' | '>=' | '<=' | '==' | 'CROSS_UP' | 'CROSS_DOWN' | 'WITHIN_PERCENT';

export interface StrategyCondition {
  indicator: IndicatorName;
  params: Record<string, number | string>; // e.g., { length: 14 } or { fast: 12, slow: 26 }
  operator: ComparisonOperator;
  value: number | string; // e.g., 30, or 'VWAP_LOWER_BAND'
  timeframe: '5m' | '15m' | '1h' | '4h' | '1d';
}

export interface RiskProfile {
  stopLossPercent: number; // e.g., 2.0 (%)
  takeProfitPercent: number; // e.g., 4.0 (%)
  useAtrMultipliers?: boolean; // When true, fixed percentages are overridden dynamically
  atrStopLossMultiplier?: number; // e.g., 1.5 * ATR
  atrTakeProfitMultiplier?: number; // e.g., 3.0 * ATR
  trailingStopEnabled: boolean;
  trailingStopOffsetPercent?: number; // e.g., 1.0 (%)
}

export interface TradingStrategy {
  id: string; // e.g., 'solana_ai_v1_rsi_bounce'
  name: string; // e.g., 'AI Gen: SOL RSI Bounce'
  description: string;
  targetAssets: string[]; // e.g., ['SOL', 'WIF', 'JUP'], or ['BTC']
  status: 'active' | 'probation' | 'cooldown' | 'retired';
  
  // Entry Rules
  entryConditions: StrategyCondition[];
  minConditionsRequired: number; // If 3 conditions, can require 3/3 or 2/3
  
  // Exit Rules (apart from RiskProfile limits)
  exitConditions: StrategyCondition[];
  
  // Risk
  risk: RiskProfile;
  
  // Meta
  createdBy: 'SYSTEM' | 'AI_DISCOVERY';
  createdAt: string;
  lastUpdated: string;
  backtestScore?: number; // Win rate from offline backtest
}
