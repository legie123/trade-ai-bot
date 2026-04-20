/**
 * llmCostTracker.ts — per-market LLM cost attribution for Polymarket syndicate.
 *
 * FAZA 3.3 maieutic layer — "which markets burned our LLM budget?"
 *
 * Problem we solve:
 *   PolySyndicate pings 2-3 LLMs per market (architect + oracle + optional
 *   Gemini fallback). Without per-market attribution the operator cannot
 *   answer: which markets are expensive to analyze? Are we wasting budget
 *   on inactive or low-liquidity markets?
 *
 * Design decisions:
 *   - In-memory ring buffer keyed by marketId. Process-local, ephemeral.
 *     Reset on cold start. Cloud Run instances each have their own view;
 *     for cross-instance rollup use the Prom metric path (llmCalls + cost
 *     histograms scoped by provider/model — market cardinality stays local).
 *   - No Supabase writeback by default — cardinality bomb risk. Opt-in via
 *     LLM_COST_PERSIST=1 (not wired yet — future batch).
 *   - TTL 24h per market, bucketed by hour for trendlines.
 *   - Safe: every public method try/catches; never throws upward.
 *
 * Kill-switch: LLM_COST_TRACKER_ENABLED=0 → record/snapshot become no-ops.
 */

import { createLogger } from '@/lib/core/logger';

const log = createLogger('LLMCost');

// ── Pricing (USD per 1M tokens, blended in+out avg). Mirrors v2/callLLM ──
// Single source of truth: mutate here and v2/callLLM will drift. Acceptable
// cost for avoiding cross-module imports from polymarket → v2/llm layer.
const PRICING_USD_PER_MTOK: Record<string, number> = {
  'deepseek-chat': 0.21,
  'deepseek-reasoner': 1.10,
  'gpt-4o-mini': 0.375,
  'gpt-4o': 7.50,
  'gpt-4-turbo': 15.00,
  'o1-mini': 4.50,
  'o1': 30.00,
  'gemini-2.0-flash': 0.15,
  'gemini-1.5-flash': 0.15,
  'gemini-1.5-pro': 3.75,
};
const DEFAULT_RATE_USD_PER_MTOK = 1.00;

export function priceFor(model: string): number {
  return PRICING_USD_PER_MTOK[model] ?? DEFAULT_RATE_USD_PER_MTOK;
}

export function costUsd(model: string, tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return (tokens / 1_000_000) * priceFor(model);
}

// ── In-memory store ────────────────────────────────────────────────────

interface ProviderBreakdown {
  calls: number;
  tokens: number;
  costUsd: number;
}

interface MarketCostEntry {
  marketId: string;
  firstSeen: number;
  lastCall: number;
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  byProvider: Record<string, ProviderBreakdown>;   // provider → breakdown
  byRole: Record<string, ProviderBreakdown>;       // 'architect' | 'oracle' | ...
  titleHint?: string;                              // optional: title for UI
  division?: string;
}

const store = new Map<string, MarketCostEntry>();

// ── Config ─────────────────────────────────────────────────────────────

const TTL_MS = 24 * 60 * 60 * 1000;                // 24h
const MAX_MARKETS = 5000;                          // hard cap, memory guard

function isEnabled(): boolean {
  return process.env.LLM_COST_TRACKER_ENABLED !== '0';
}

function ensureEntry(marketId: string): MarketCostEntry {
  let e = store.get(marketId);
  if (!e) {
    e = {
      marketId,
      firstSeen: Date.now(),
      lastCall: Date.now(),
      totalCalls: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      byProvider: {},
      byRole: {},
    };
    store.set(marketId, e);
  }
  return e;
}

function trimIfNeeded() {
  if (store.size <= MAX_MARKETS) return;
  // Drop oldest 10% by lastCall.
  const entries = Array.from(store.values()).sort((a, b) => a.lastCall - b.lastCall);
  const dropCount = Math.max(1, Math.floor(entries.length * 0.1));
  for (let i = 0; i < dropCount; i++) {
    store.delete(entries[i].marketId);
  }
}

function purgeExpired() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, e] of store) {
    if (e.lastCall < cutoff) store.delete(id);
  }
}

// ── Record path ────────────────────────────────────────────────────────

export interface RecordCallInput {
  marketId: string;
  role: string;                       // 'architect' | 'oracle' | other
  provider: string;                   // 'deepseek' | 'openai' | 'gemini'
  model: string;
  tokens: number;
  titleHint?: string;
  division?: string;
}

export function recordLlmCall(input: RecordCallInput): void {
  try {
    if (!isEnabled()) return;
    if (!input.marketId) return;
    const dollars = costUsd(input.model, input.tokens);
    const e = ensureEntry(input.marketId);
    e.lastCall = Date.now();
    e.totalCalls += 1;
    e.totalTokens += Number.isFinite(input.tokens) ? input.tokens : 0;
    e.totalCostUsd += dollars;
    if (input.titleHint) e.titleHint = input.titleHint;
    if (input.division) e.division = input.division;

    const pb = (e.byProvider[input.provider] ||= { calls: 0, tokens: 0, costUsd: 0 });
    pb.calls += 1;
    pb.tokens += input.tokens || 0;
    pb.costUsd += dollars;

    const rb = (e.byRole[input.role] ||= { calls: 0, tokens: 0, costUsd: 0 });
    rb.calls += 1;
    rb.tokens += input.tokens || 0;
    rb.costUsd += dollars;

    trimIfNeeded();
  } catch (err) {
    log.debug('recordLlmCall failed (soft)', { error: String(err) });
  }
}

// ── Snapshot path ──────────────────────────────────────────────────────

export interface LlmCostSnapshot {
  generatedAt: number;
  tracking: boolean;
  totalMarkets: number;
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  byProvider: Record<string, ProviderBreakdown>;
  byRole: Record<string, ProviderBreakdown>;
  markets: Array<
    Omit<MarketCostEntry, 'byProvider' | 'byRole'> & {
      byProvider: Record<string, ProviderBreakdown>;
      byRole: Record<string, ProviderBreakdown>;
    }
  >;
  topSpenders: Array<{
    marketId: string;
    titleHint?: string;
    division?: string;
    totalCostUsd: number;
    totalCalls: number;
    totalTokens: number;
    lastCall: number;
  }>;
}

export function getLlmCostSnapshot(limitTop = 50): LlmCostSnapshot {
  purgeExpired();

  const byProvider: Record<string, ProviderBreakdown> = {};
  const byRole: Record<string, ProviderBreakdown> = {};
  let totalCalls = 0;
  let totalTokens = 0;
  let totalCost = 0;

  for (const e of store.values()) {
    totalCalls += e.totalCalls;
    totalTokens += e.totalTokens;
    totalCost += e.totalCostUsd;
    for (const [p, pb] of Object.entries(e.byProvider)) {
      const agg = (byProvider[p] ||= { calls: 0, tokens: 0, costUsd: 0 });
      agg.calls += pb.calls;
      agg.tokens += pb.tokens;
      agg.costUsd += pb.costUsd;
    }
    for (const [r, rb] of Object.entries(e.byRole)) {
      const agg = (byRole[r] ||= { calls: 0, tokens: 0, costUsd: 0 });
      agg.calls += rb.calls;
      agg.tokens += rb.tokens;
      agg.costUsd += rb.costUsd;
    }
  }

  const markets = Array.from(store.values()).map((e) => ({ ...e }));
  const topSpenders = markets
    .slice()
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
    .slice(0, limitTop)
    .map((e) => ({
      marketId: e.marketId,
      titleHint: e.titleHint,
      division: e.division,
      totalCostUsd: e.totalCostUsd,
      totalCalls: e.totalCalls,
      totalTokens: e.totalTokens,
      lastCall: e.lastCall,
    }));

  return {
    generatedAt: Date.now(),
    tracking: isEnabled(),
    totalMarkets: store.size,
    totalCalls,
    totalTokens,
    totalCostUsd: totalCost,
    byProvider,
    byRole,
    markets,
    topSpenders,
  };
}

// ── Single-market lookup (for decision drill-down) ─────────────────────

export function getMarketCost(marketId: string): MarketCostEntry | null {
  purgeExpired();
  return store.get(marketId) ?? null;
}

// ── Testing / admin ────────────────────────────────────────────────────

export function _resetLlmCostForTests(): void {
  store.clear();
}
