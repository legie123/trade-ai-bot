import { TradingStrategy } from '@/lib/types/strategy';

export const INITIAL_STRATEGIES: TradingStrategy[] = [
  {
    id: 'momentum_vwap',
    name: 'Momentum VWAP Scalp',
    description: 'High momentum scalp returning to VWAP level',
    targetAssets: ['BTC', 'SOL', 'ETH'],
    status: 'probation',
    entryConditions: [
      { indicator: 'VWAP', operator: '>', value: 'PRICE', timeframe: '15m', params: {} },
      { indicator: 'RSI', operator: '<', value: 30, timeframe: '15m', params: { length: 14 } },
      { indicator: 'VOLUME', operator: '>', value: 2, timeframe: '15m', params: { period: 'MA_20' } }
    ],
    minConditionsRequired: 2,
    exitConditions: [
      { indicator: 'RSI', operator: '>', value: 70, timeframe: '15m', params: { length: 14 } }
    ],
    risk: { stopLossPercent: 1.5, takeProfitPercent: 3.0, trailingStopEnabled: true, trailingStopOffsetPercent: 1.0 },
    createdBy: 'SYSTEM',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'mean_reversion',
    name: 'RSI Mean Reversion',
    description: 'Deep oversold bounce plays',
    targetAssets: ['BTC', 'ETH'],
    status: 'probation',
    entryConditions: [
      { indicator: 'RSI', operator: '<', value: 25, timeframe: '4h', params: { length: 14 } }
    ],
    minConditionsRequired: 1,
    exitConditions: [
      { indicator: 'RSI', operator: '>', value: 60, timeframe: '4h', params: { length: 14 } }
    ],
    risk: { stopLossPercent: 2.0, takeProfitPercent: 4.0, trailingStopEnabled: false },
    createdBy: 'SYSTEM',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'breakout_bb',
    name: 'BB Breakout',
    description: 'Trading the squeeze breakout',
    targetAssets: ['BTC', 'SOL'],
    status: 'probation',
    entryConditions: [
      { indicator: 'BB', operator: 'CROSS_UP', value: 'UPPER_BAND', timeframe: '1h', params: { length: 20, mult: 2 } }
    ],
    minConditionsRequired: 1,
    exitConditions: [
      { indicator: 'PRICE', operator: '<', value: 'BB_MIDDLE', timeframe: '1h', params: {} }
    ],
    risk: { stopLossPercent: 1.5, takeProfitPercent: 5.0, trailingStopEnabled: true, trailingStopOffsetPercent: 1.5 },
    createdBy: 'SYSTEM',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'trend_following',
    name: 'EMA Trend Follower',
    description: 'Classic 50/200 EMA crossover with momentum',
    targetAssets: ['BTC', 'ETH'],
    status: 'probation',
    entryConditions: [
      { indicator: 'EMA', operator: '>', value: 'PRICE', timeframe: '4h', params: { fast: 50, slow: 200 } }
    ],
    minConditionsRequired: 1,
    exitConditions: [
      { indicator: 'EMA', operator: '<', value: 'PRICE', timeframe: '4h', params: { fast: 50, slow: 200 } }
    ],
    risk: { stopLossPercent: 2.5, takeProfitPercent: 6.0, trailingStopEnabled: true, trailingStopOffsetPercent: 2.0 },
    createdBy: 'SYSTEM',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'wick_rejection',
    name: 'Wick Rejection Sniper',
    description: 'Institutional buying wick validation',
    targetAssets: ['BTC', 'SOL'],
    status: 'probation',
    entryConditions: [
      { indicator: 'PRICE', operator: 'WITHIN_PERCENT', value: 'VWAP', timeframe: '15m', params: { wickSize: 60 } }
    ],
    minConditionsRequired: 1,
    exitConditions: [],
    risk: { stopLossPercent: 1.0, takeProfitPercent: 2.5, trailingStopEnabled: false },
    createdBy: 'SYSTEM',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'sfp_reversal',
    name: 'SFP Reversal',
    description: 'Swing Failure Pattern',
    targetAssets: ['BTC'],
    status: 'probation',
    entryConditions: [],
    minConditionsRequired: 1,
    exitConditions: [],
    risk: { stopLossPercent: 1.5, takeProfitPercent: 3.5, trailingStopEnabled: true, trailingStopOffsetPercent: 1.0 },
    createdBy: 'SYSTEM',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'funding_arbitrage',
    name: 'Funding Rate Arb',
    description: 'Capitalize on extreme funding rates',
    targetAssets: ['SOL'],
    status: 'probation',
    entryConditions: [
      { indicator: 'FUNDING_RATE', operator: '<', value: -0.05, timeframe: '1h', params: {} }
    ],
    minConditionsRequired: 1,
    exitConditions: [],
    risk: { stopLossPercent: 3.0, takeProfitPercent: 1.5, trailingStopEnabled: false },
    createdBy: 'SYSTEM',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'orderblock_mitigation',
    name: 'OB Mitigation',
    description: 'Trading the retest of strong order blocks',
    targetAssets: ['BTC', 'ETH', 'SOL'],
    status: 'probation',
    entryConditions: [
      { indicator: 'OB', operator: 'WITHIN_PERCENT', value: 'PRICE', timeframe: '4h', params: {} }
    ],
    minConditionsRequired: 1,
    exitConditions: [],
    risk: { stopLossPercent: 1.0, takeProfitPercent: 4.0, trailingStopEnabled: false },
    createdBy: 'SYSTEM',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'solana_momentum',
    name: 'Solana High-Beta',
    description: 'Catching SOL eco memecoin volume explosions',
    targetAssets: ['SOL_ECO'],
    status: 'probation',
    entryConditions: [
      { indicator: 'VOLUME', operator: '>', value: 3, timeframe: '5m', params: { period: 'MA_20' } },
      { indicator: 'RSI', operator: '<', value: 80, timeframe: '5m', params: { length: 14 } }
    ],
    minConditionsRequired: 2,
    exitConditions: [
      { indicator: 'RSI', operator: '>', value: 85, timeframe: '5m', params: { length: 14 } }
    ],
    risk: { stopLossPercent: 5.0, takeProfitPercent: 15.0, trailingStopEnabled: true, trailingStopOffsetPercent: 3.0 },
    createdBy: 'SYSTEM',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  }
];
