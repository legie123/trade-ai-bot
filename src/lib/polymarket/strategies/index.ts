// ============================================================
// Strategy Registry — Auto-load all bundled plugins.
// ============================================================

import './nullBaseline';
import './syndicateLlm';
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
