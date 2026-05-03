// ============================================================
// Strategy Registry — Phase 2 (in-memory only)
// DB hydration deferred to Phase 3.
// ============================================================

import type { StrategyPlugin, StrategyStatus } from './types';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('StrategyRegistry');

class StrategyRegistry {
  private strategies = new Map<string, StrategyPlugin>();

  register(plugin: StrategyPlugin): void {
    if (this.strategies.has(plugin.metadata.strategyId)) {
      log.warn('Strategy already registered, overwriting', {
        strategyId: plugin.metadata.strategyId,
      });
    }
    this.strategies.set(plugin.metadata.strategyId, plugin);
    log.info('Strategy registered', {
      strategyId: plugin.metadata.strategyId,
      status: plugin.metadata.status,
    });
  }

  get(strategyId: string): StrategyPlugin | undefined {
    return this.strategies.get(strategyId);
  }

  getAll(): StrategyPlugin[] {
    return Array.from(this.strategies.values());
  }

  getByStatus(...statuses: StrategyStatus[]): StrategyPlugin[] {
    const set = new Set<StrategyStatus>(statuses);
    return this.getAll().filter((p) => set.has(p.metadata.status));
  }
}

export const strategyRegistry = new StrategyRegistry();
