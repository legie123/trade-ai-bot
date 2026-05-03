// ============================================================
// Strategy Registry — Phase 2
// In-memory registry of strategy plugins. Hydrates metadata from
// poly_strategies Supabase table (lazy refresh, 5-min TTL).
// ============================================================

import { StrategyPlugin, StrategyStatus, StrategyMetadata } from './types';
import { supabase } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('StrategyRegistry');

const METADATA_REFRESH_MS = 5 * 60_000;

class StrategyRegistry {
  private strategies = new Map<string, StrategyPlugin>();
  private lastDbRefresh = 0;

  /** Register a plugin. Called at module load (see strategies/index.ts). */
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
    const set = new Set(statuses);
    return this.getAll().filter((p) => set.has(p.metadata.status));
  }

  /**
   * Refresh in-memory metadata from poly_strategies table.
   * Updates status / gates / kellyFraction / configJson on registered plugins.
   * Plugins not in DB are left at their hardcoded defaults.
   * Plugins in DB but not registered are silently ignored.
   */
  async refreshFromDb(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastDbRefresh < METADATA_REFRESH_MS) return;
    this.lastDbRefresh = now;

    try {
      const { data, error } = await supabase
        .from('poly_strategies')
        .select(
          'strategy_id, display_name, hypothesis, status, bankroll_share_pct, kelly_fraction, min_edge_bps, max_position_usdc, gate_min_sample, gate_min_wr_wilson_lower, gate_min_pf, gate_max_dd_pct, config_json',
        );
      if (error) {
        log.warn('Strategy DB refresh failed', { error: String(error) });
        return;
      }
      if (!data) return;

      let updated = 0;
      for (const row of data) {
        const plugin = this.strategies.get(row.strategy_id as string);
        if (!plugin) continue;
        const next: StrategyMetadata = {
          strategyId: row.strategy_id as string,
          displayName: (row.display_name as string) ?? plugin.metadata.displayName,
          hypothesis: (row.hypothesis as string) ?? plugin.metadata.hypothesis,
          status: (row.status as StrategyStatus) ?? plugin.metadata.status,
          bankrollSharePct: Number(row.bankroll_share_pct ?? plugin.metadata.bankrollSharePct),
          kellyFraction: Number(row.kelly_fraction ?? plugin.metadata.kellyFraction),
          minEdgeBps: Number(row.min_edge_bps ?? plugin.metadata.minEdgeBps),
          maxPositionUsdc: Number(row.max_position_usdc ?? plugin.metadata.maxPositionUsdc),
          gates: {
            minSample: Number(row.gate_min_sample ?? plugin.metadata.gates.minSample),
            minWrWilsonLower: Number(
              row.gate_min_wr_wilson_lower ?? plugin.metadata.gates.minWrWilsonLower,
            ),
            minPf: Number(row.gate_min_pf ?? plugin.metadata.gates.minPf),
            maxDdPct: Number(row.gate_max_dd_pct ?? plugin.metadata.gates.maxDdPct),
          },
          configJson: (row.config_json as Record<string, unknown>) ?? plugin.metadata.configJson,
        };
        plugin.metadata = next;
        updated++;
      }
      if (updated > 0) log.info('Strategy metadata refreshed from DB', { updated });
    } catch (e) {
      log.warn('Strategy DB refresh threw (non-blocking)', { error: String(e) });
    }
  }
}

export const strategyRegistry = new StrategyRegistry();
