// ============================================================
// Strategy Registry — Auto-load all bundled plugins.
//
// Importing this module triggers registration via side effects.
// Add new strategies here when introduced (Phase 3+).
// ============================================================

import './nullBaseline';
// Phase 3 additions:
// import './syndicateLlm';
// Phase 4 additions:
// import './calibrationArb';
// import './closingLine';
// import './whaleFollow';
// import './newsLatency';

export { strategyRegistry } from './registry';
export type {
  StrategyPlugin,
  StrategyContext,
  StrategyProposal,
  StrategyStatus,
  StrategyMetadata,
  StrategyGates,
} from './types';
