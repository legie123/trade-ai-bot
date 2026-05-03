// ============================================================
// Null Baseline Strategy — Phase 2
//
// Random direction (50/50) with fixed conviction. Acts as the control
// arm for measuring REAL edge of other strategies via statistical
// significance testing.
//
// Hypothesis: ~50% WR over large sample (assumes binary markets).
// If a candidate strategy fails to outperform null_baseline statistically,
// it has no edge — promotion blocked.
//
// Status: shadow (no paper / no real positions) — logging only until
// Phase 3 wires the strategy decision flow.
// ============================================================

import { StrategyPlugin, StrategyContext, StrategyProposal } from './types';
import { strategyRegistry } from './registry';

const plugin: StrategyPlugin = {
  metadata: {
    strategyId: 'null_baseline',
    displayName: 'Null Baseline (random control)',
    hypothesis:
      'Random direction 50/50 — control to measure real edge of other strategies',
    status: 'shadow',
    bankrollSharePct: 0,
    kellyFraction: 0,
    minEdgeBps: 0,
    maxPositionUsdc: 5,
    gates: {
      minSample: 30,
      minWrWilsonLower: 0,
      minPf: 0,
      maxDdPct: 100,
    },
    configJson: { role: 'control' },
  },

  async evaluate(ctx: StrategyContext): Promise<StrategyProposal> {
    // Skip clearly broken markets even for the random baseline — don't
    // contaminate the control arm with garbage data.
    if (!ctx.market.active || !ctx.market.outcomes || ctx.market.outcomes.length < 2) {
      return {
        direction: 'SKIP',
        conviction: 0,
        confidence: 0,
        reasoning: 'Market inactive or malformed (control arm skip)',
      };
    }

    const r = Math.random();
    return {
      direction: r < 0.5 ? 'BUY_YES' : 'BUY_NO',
      conviction: 50,
      confidence: 50,
      reasoning: `Null baseline: r=${r.toFixed(3)} → ${r < 0.5 ? 'BUY_YES' : 'BUY_NO'}`,
      metadata: { rand: r, marketYesPrice: ctx.market.outcomes[0]?.price },
    };
  },
};

strategyRegistry.register(plugin);
export default plugin;
