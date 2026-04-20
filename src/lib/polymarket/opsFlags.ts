/**
 * opsFlags — single source of truth for every kill-switch + operational env flag.
 *
 * FAZA 3.9. Read env at request time (Cloud Run keeps env stable within a pod;
 * operator flips a flag → new revision → fresh snapshot). Never throws; unknown
 * defaults rendered as `?`.
 *
 * Classification is manual — these are operator-facing labels, not runtime config.
 * Every flag lives in code with kill-switch docs; this page mirrors that contract
 * so operator answers "what's gated off RIGHT NOW?" in one glance.
 *
 * Layer: L4 AUDIT (operational state snapshot).
 */

export type Domain =
  | 'trade'        // gladiator entry gates, direction, sizing
  | 'shadow'       // diag endpoints, not yet promoted
  | 'polymarket'   // polymarket brain
  | 'forge'        // gladiator forge / dedup
  | 'butcher'      // graveyard / survivorship
  | 'fees'         // fees / slippage model
  | 'observability' // metrics, cost tracker
  | 'ui';          // client-side visual toggles

export type Risk = 'critical' | 'high' | 'medium' | 'low';

export interface FlagSpec {
  name: string;            // env var name
  domain: Domain;
  description: string;     // what the flag does
  defaultBehavior: string; // what happens when unset (usually "on" or "shadow")
  riskIfOff: string;       // operator impact of flipping it off
  risk: Risk;              // severity class
  publicClient?: boolean;  // NEXT_PUBLIC_* — leaks to browser
}

export interface FlagReading extends FlagSpec {
  rawValue: string | undefined;
  state: 'on' | 'off' | 'shadow' | 'default' | 'custom';
  overridden: boolean;     // non-empty env → operator has pinned a value
}

export interface OpsFlagsSnapshot {
  generatedAt: number;
  totalFlags: number;
  overriddenCount: number;
  offCount: number;
  byDomain: Record<Domain, FlagReading[]>;
  all: FlagReading[];
}

/**
 * Canonical flag catalog. KEEP ALPHABETIZED PER DOMAIN. Defaults mirror prod.
 * When adding a new kill-switch anywhere in the codebase, append here.
 */
const CATALOG: FlagSpec[] = [
  // ——— TRADE ———
  {
    name: 'DIRECTION_GATE_ENABLED',
    domain: 'trade',
    description: 'Master gate that honors DIRECTION_LONG_DISABLED / DIRECTION_SHORT_DISABLED. Set to 0 to bypass direction policy entirely.',
    defaultBehavior: 'enabled (honors per-direction disables)',
    riskIfOff: 'bypasses LONG/SHORT disables — all directions route through.',
    risk: 'high',
  },
  {
    name: 'DIRECTION_LONG_DISABLED',
    domain: 'trade',
    description: 'Block LONG entries pool-wide. Active since 2026-04-19 after LONG EV_net=-0.16% audit.',
    defaultBehavior: 'disabled (LONGs allowed)',
    riskIfOff: 'flipping off re-opens negative-EV LONG bucket.',
    risk: 'high',
  },
  {
    name: 'DIRECTION_SHORT_DISABLED',
    domain: 'trade',
    description: 'Block SHORT entries pool-wide. Symmetric counterpart to LONG disable.',
    defaultBehavior: 'disabled (SHORTs allowed)',
    riskIfOff: 'kills currently-positive SHORT bucket.',
    risk: 'high',
  },

  // ——— SHADOW (not yet promoted) ———
  {
    name: 'REGIME_GATE_ENABLED',
    domain: 'shadow',
    description: 'ADX(14) regime filter — shadow mode, does not block trades yet.',
    defaultBehavior: 'shadow (metrics only)',
    riskIfOff: 'removes regime telemetry; no live-PnL impact.',
    risk: 'low',
  },
  {
    name: 'SENTIMENT_FLAG_ENABLED',
    domain: 'shadow',
    description: 'F&G × funding divergence flag — shadow mode.',
    defaultBehavior: 'shadow',
    riskIfOff: 'sentiment diag endpoint goes dark.',
    risk: 'low',
  },
  {
    name: 'SIZING_AGGREGATOR_ENABLED',
    domain: 'shadow',
    description: 'Regime × sentiment × Kelly × DD aggregator — shadow multiplier [0.30, 1.50].',
    defaultBehavior: 'shadow',
    riskIfOff: 'sizing-mult diag endpoint returns neutral 1.0 constant.',
    risk: 'low',
  },
  {
    name: 'CPCV_SHADOW_ENABLED',
    domain: 'shadow',
    description: 'CPCV + embargo cross-validation stub — shadow-only accuracy signal.',
    defaultBehavior: 'shadow',
    riskIfOff: 'CPCV diag returns empty; learning loop loses signal.',
    risk: 'low',
  },
  {
    name: 'META_LABEL_SHADOW_ENABLED',
    domain: 'shadow',
    description: 'Stub logistic meta-labeler. Shadow accepts/rejects on top of primary signal.',
    defaultBehavior: 'shadow',
    riskIfOff: 'meta-label metrics flatline.',
    risk: 'low',
  },
  {
    name: 'WASH_CROSS_GLADIATOR_ENABLED',
    domain: 'shadow',
    description: 'Cross-gladiator wash detection — 30min bucket + Pearson on signed pnl.',
    defaultBehavior: 'shadow',
    riskIfOff: 'wash diag returns empty; silent colluding risk.',
    risk: 'medium',
  },

  // ——— POLYMARKET ———
  {
    name: 'POLYMARKET_INGEST_ENABLED',
    domain: 'polymarket',
    description: 'Goldsky subgraph Global OI webhook ingest — /api/polymarket/ingest. Log-only currently.',
    defaultBehavior: 'enabled (log-only)',
    riskIfOff: 'Global OI feed freezes → stale feed detector flags polymarket.',
    risk: 'high',
  },
  {
    name: 'POLYMARKET_CORRELATION_ENABLED',
    domain: 'polymarket',
    description: 'Polymarket × crypto correlation bias — feeds syndicate sentiment hint.',
    defaultBehavior: 'enabled',
    riskIfOff: 'polySyndicate loses cross-market context.',
    risk: 'medium',
  },
  {
    name: 'SYNDICATE_SENTIMENT_BIAS',
    domain: 'polymarket',
    description: 'Manual sentiment bias injected into architect prompt (-1..+1). Override for stress tests.',
    defaultBehavior: 'unset (no bias)',
    riskIfOff: 'no effect when unset; set=nonzero distorts all syndicate decisions.',
    risk: 'medium',
  },

  // ——— FORGE ———
  {
    name: 'FORGE_DEDUP_ENABLED',
    domain: 'forge',
    description: 'DNA similarity dedup (70/30 num/cat) at gladiator forge time.',
    defaultBehavior: 'enabled',
    riskIfOff: 'pool fills with near-duplicates; diversity collapses.',
    risk: 'high',
  },
  {
    name: 'FORGE_DUPE_THRESHOLD',
    domain: 'forge',
    description: 'Similarity threshold above which a new gladiator is rejected at forge (default 0.82).',
    defaultBehavior: '0.82',
    riskIfOff: 'lower → fewer dupes but pool growth stalls; higher → clones leak in.',
    risk: 'medium',
  },

  // ——— BUTCHER ———
  {
    name: 'BUTCHER_GRAVEYARD_ENABLED',
    domain: 'butcher',
    description: 'Graveyard writeback + survivorship-bias-corrected WR/PF.',
    defaultBehavior: 'enabled',
    riskIfOff: 'arena_pool_population_weighted gauge goes stale; learning loop loses killed cohort.',
    risk: 'high',
  },

  // ——— FEES ———
  {
    name: 'FEE_INCLUDE_SLIPPAGE',
    domain: 'fees',
    description: 'Include SLIPPAGE_ROUND_TRIP on top of MEXC fees in pnlPercentNet.',
    defaultBehavior: 'enabled',
    riskIfOff: 'net pnl becomes fee-only — overstates realized edge by ~slippage bps.',
    risk: 'medium',
  },
  {
    name: 'SLIPPAGE_ROUND_TRIP',
    domain: 'fees',
    description: 'Round-trip slippage assumption in bps. Default 0.08% per side × 2.',
    defaultBehavior: '0.16% round-trip',
    riskIfOff: 'unset → falls back to default; explicit 0 disables slippage (overstates pnl).',
    risk: 'low',
  },

  // ——— OBSERVABILITY ———
  {
    name: 'LLM_COST_TRACKER_ENABLED',
    domain: 'observability',
    description: 'Process-local per-market LLM attribution store (24h TTL, 5000-market cap).',
    defaultBehavior: 'enabled',
    riskIfOff: '/polymarket/audit/llm-cost goes dark; Prom llmCostDollars{provider,model} unaffected.',
    risk: 'low',
  },
  {
    name: 'METRICS_TOKEN',
    domain: 'observability',
    description: 'Bearer token for /api/metrics Prom scrape endpoint. Rotate quarterly.',
    defaultBehavior: 'required — unset makes /api/metrics return 401',
    riskIfOff: 'Grafana Cloud agent loses scrape; dashboards go stale.',
    risk: 'critical',
  },

  // ——— UI ———
  {
    name: 'NEXT_PUBLIC_HEARTBEAT_STRIP',
    domain: 'ui',
    description: 'Stale-feed pill strip in audit nav — polls /feed-health every 30s.',
    defaultBehavior: 'enabled',
    riskIfOff: 'operator loses at-a-glance feed-health visibility.',
    risk: 'medium',
    publicClient: true,
  },
  {
    name: 'NEXT_PUBLIC_EXPLAIN_BADGES',
    domain: 'ui',
    description: 'Hide the maieutic explain badges (layer/confidence/source) but keep values.',
    defaultBehavior: 'enabled',
    riskIfOff: 'ExplainCard falls back to legacy KPI look — values still render.',
    risk: 'low',
    publicClient: true,
  },
];

/** Classify an env value into a display state. */
function classifyState(
  raw: string | undefined,
  defaultBehavior: string,
): 'on' | 'off' | 'shadow' | 'default' | 'custom' {
  if (raw === undefined || raw === '') {
    if (defaultBehavior.startsWith('shadow')) return 'shadow';
    if (defaultBehavior.startsWith('disabled')) return 'off';
    if (defaultBehavior.startsWith('enabled')) return 'on';
    return 'default';
  }
  const v = raw.trim().toLowerCase();
  if (v === '0' || v === 'off' || v === 'false' || v === 'no' || v === 'disabled') return 'off';
  if (v === '1' || v === 'on' || v === 'true' || v === 'yes' || v === 'enabled') return 'on';
  if (v === 'shadow') return 'shadow';
  return 'custom';
}

/** Read one flag + attach state. Never throws. */
function readOne(spec: FlagSpec): FlagReading {
  let raw: string | undefined;
  try {
    raw = process.env[spec.name];
  } catch {
    raw = undefined;
  }
  const overridden = raw !== undefined && raw !== '';
  const state = classifyState(raw, spec.defaultBehavior);
  // Redact secret-shaped flags (METRICS_TOKEN etc.) — only state + length shown.
  const isSecret = /token|secret|key|password/i.test(spec.name);
  return {
    ...spec,
    rawValue: !overridden ? undefined : isSecret ? `<redacted · ${raw!.length} chars>` : raw,
    state,
    overridden,
  };
}

/** Main export — snapshot across all catalog entries, grouped by domain. */
export function getOpsFlagsSnapshot(): OpsFlagsSnapshot {
  const readings = CATALOG.map(readOne);
  const byDomain: Record<Domain, FlagReading[]> = {
    trade: [],
    shadow: [],
    polymarket: [],
    forge: [],
    butcher: [],
    fees: [],
    observability: [],
    ui: [],
  };
  for (const r of readings) byDomain[r.domain].push(r);

  return {
    generatedAt: Date.now(),
    totalFlags: readings.length,
    overriddenCount: readings.filter((r) => r.overridden).length,
    offCount: readings.filter((r) => r.state === 'off').length,
    byDomain,
    all: readings,
  };
}

/** Domain display labels + order. */
export const DOMAIN_ORDER: Domain[] = [
  'trade',
  'polymarket',
  'forge',
  'butcher',
  'fees',
  'shadow',
  'observability',
  'ui',
];

export const DOMAIN_LABEL: Record<Domain, string> = {
  trade: 'TRADE · LIVE GATES',
  shadow: 'SHADOW · DIAG ONLY',
  polymarket: 'POLYMARKET',
  forge: 'FORGE',
  butcher: 'BUTCHER · GRAVEYARD',
  fees: 'FEES · SLIPPAGE',
  observability: 'OBSERVABILITY',
  ui: 'UI · CLIENT',
};
