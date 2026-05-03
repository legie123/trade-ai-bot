// ============================================================
// Syndicate LLM Strategy — Phase 3
//
// Wraps polySyndicate.analyzeMarket() as a Strategy plugin.
//
// Hypothesis: Multi-LLM consensus (architect=fundamentals + oracle=sentiment)
// extracts edge from collective LLM reasoning that single-model strategies miss.
// Edge expected on text-rich markets (POLITICS / GEOPOLITICS / BREAKING)
// where outcome decomposition benefits from LLM analysis.
//
// Status: shadow (registered but no paper bets emitted until DB row promoted).
// ============================================================

import type { StrategyPlugin, StrategyContext, StrategyProposal } from './types';
import { strategyRegistry } from './registry';
import { analyzeMarket } from '../polySyndicate';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('SyndicateLlmStrategy');

const plugin: StrategyPlugin = {
  metadata: {
    strategyId: 'syndicate_llm',
    displayName: 'Multi-LLM Syndicate',
    hypothesis:
      '>=3/4 LLM agreement on direction with conviction >=70 → positive edge from collective reasoning',
    status: 'shadow',
    bankrollSharePct: 0,
    kellyFraction: 0.25,
    minEdgeBps: 0,
    maxPositionUsdc: 5,
    gates: {
      minSample: 50,
      minWrWilsonLower: 0.55,
      minPf: 1.20,
      maxDdPct: 30,
    },
    configJson: { min_agreement: 3, min_conviction: 70 },
  },

  async evaluate(ctx: StrategyContext): Promise<StrategyProposal> {
    if (!ctx.market.active || !ctx.market.outcomes || ctx.market.outcomes.length < 2) {
      return {
        direction: 'SKIP',
        conviction: 0,
        confidence: 0,
        reasoning: 'Market inactive or malformed',
      };
    }

    try {
      const analysis = await analyzeMarket(ctx.market, ctx.division);

      // Map MarketAnalysis to StrategyProposal.
      // analyzeMarket returns YES/NO/SKIP — strategy uses BUY_YES/BUY_NO.
      let direction: 'BUY_YES' | 'BUY_NO' | 'SKIP' = 'SKIP';
      if (analysis.direction === 'YES') direction = 'BUY_YES';
      else if (analysis.direction === 'NO') direction = 'BUY_NO';

      // Conviction = consensusScore (LLM agreement strength 0-100).
      // Apply min_conviction gate: under threshold → SKIP regardless of direction.
      const minConviction = Number(
        (plugin.metadata.configJson as { min_conviction?: number }).min_conviction ?? 70,
      );
      const conviction = Math.round(analysis.consensusScore);
      if (direction !== 'SKIP' && conviction < minConviction) {
        return {
          direction: 'SKIP',
          conviction,
          confidence: analysis.confidence,
          reasoning: `Syndicate consensus ${conviction} < min_conviction ${minConviction}`,
        };
      }

      return {
        direction,
        conviction,
        confidence: analysis.confidence,
        reasoning: `Syndicate: ${analysis.reasoning}`,
        metadata: {
          architectView: analysis.architectView,
          oracleView: analysis.oracleView,
        },
      };
    } catch (e) {
      log.warn('Syndicate evaluate failed (non-blocking)', {
        marketId: ctx.market.id,
        error: String(e),
      });
      return {
        direction: 'SKIP',
        conviction: 0,
        confidence: 0,
        reasoning: `Syndicate error: ${String(e).substring(0, 100)}`,
      };
    }
  },
};

strategyRegistry.register(plugin);
export default plugin;
