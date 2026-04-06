// Trading Strategy types for the Dynamic Interpreter engine

export interface StrategyCondition {
  indicator: 'PRICE' | 'RSI' | 'BB' | 'EMA' | 'VWAP' | 'VOLUME' | 'FUNDING_RATE';
  operator: '>' | '<' | '>=' | '<=' | '==' | 'WITHIN_PERCENT';
  value: number | string;
  timeframe: '15m' | '1h' | '4h';
  params: Record<string, unknown>;
}

export interface TradingStrategy {
  id: string;
  name: string;
  description: string;
  entryConditions: StrategyCondition[];
  minConditionsRequired: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
