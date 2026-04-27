// ============================================================
// Decision Audit Trail — Step 1.1
//
// ADDITIVE. Logs every trade/skip decision as structured JSON.
// Queryable by symbol, gladiator, time range. Async Supabase
// persistence with in-memory buffer for zero-latency logging.
//
// Kill-switch: DISABLE_AUDIT_LOG=true → all functions become no-ops
// ============================================================

import { supabase, SUPABASE_CONFIGURED } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import type { MarketRegime } from '@/lib/v2/intelligence/agents/marketRegime';

const log = createLogger('DecisionAudit');

// ─── Types ────────────────────────────────────────────────────

export interface AgentVote {
  direction: 'LONG' | 'SHORT' | 'FLAT';
  confidence: number;
  reasoning?: string;
}

export interface RiskVoteSummary {
  approved: boolean;
  positionSize: number;
  riskPercent?: number;
  stopLossPercent?: number;
  denialReasons: string[];
}

export interface DebateVerdict {
  verdict: 'CONFIRM' | 'OVERRIDE_FLAT' | 'REDUCE_CONFIDENCE';
  confidenceModifier: number;
  bullScore: number;
  bearScore: number;
  winnerSide: 'BULL' | 'BEAR';
}

export interface DecisionAuditEntry {
  id: string;
  timestamp: number;
  symbol: string;
  gladiatorId: string | null;
  mode: 'PAPER' | 'LIVE';

  // Agent votes
  alphaQuantVote: AgentVote | null;
  sentimentVote: AgentVote | null;
  riskVote: RiskVoteSummary | null;

  // Enrichment
  regime: MarketRegime | string | null;
  omegaModifier: number | null;
  consensusRatio: number | null;

  // Debate (Step 2.1 — null until implemented)
  debateVerdict: DebateVerdict | null;

  // Sentinel
  sentinelSafe: boolean;
  sentinelReason: string | null;

  // Outcome
  action: 'EXECUTE_LONG' | 'EXECUTE_SHORT' | 'SKIP';
  skipReason: string | null;

  // Post-trade (filled async via updatePostTrade)
  slippage: number | null;
  fillPrice: number | null;
  latencyMs: number | null;

  // Experience memory link (Step 3.2 — null until implemented)
  experienceInsight: Record<string, unknown> | null;
}

// ─── Configuration ────────────────────────────────────────────────

const DISABLED = process.env.DISABLE_AUDIT_LOG === 'true';
const BUFFER_FLUSH_SIZE = 10;      // flush to Supabase every 10 entries
const BUFFER_FLUSH_MS = 30_000;    // or every 30 seconds

// ─── Supabase client — uses shared singleton from db.ts ─────

// ─── In-Memory Buffer ───────────────────────────────────────────

const buffer: DecisionAuditEntry[] = [];
const recentDecisions: DecisionAuditEntry[] = []; // last 100 for fast queries
const MAX_RECENT = 100;

let flushTimer: ReturnType<typeof setInterval> | null = null;

function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    if (buffer.length > 0) flushBuffer();
  }, BUFFER_FLUSH_MS);
}

async function flushBuffer(): Promise<void> {
  if (!SUPABASE_CONFIGURED || buffer.length === 0) return;

  const batch = buffer.splice(0, buffer.length);

  try {
    const rows = batch.map(e => ({
      id: e.id,
      timestamp: e.timestamp,
      symbol: e.symbol,
      gladiator_id: e.gladiatorId,
      mode: e.mode,
      alpha_quant_vote: e.alphaQuantVote,
      sentiment_vote: e.sentimentVote,
      risk_vote: e.riskVote,
      regime: e.regime,
      omega_modifier: e.omegaModifier,
      consensus_ratio: e.consensusRatio,
      debate_verdict: e.debateVerdict,
      sentinel_safe: e.sentinelSafe,
      sentinel_reason: e.sentinelReason,
      action: e.action,
      skip_reason: e.skipReason,
      slippage: e.slippage,
      fill_price: e.fillPrice,
      latency_ms: e.latencyMs,
      experience_insight: e.experienceInsight,
    }));

    const { error } = await supabase
      .from('decision_audit')
      .insert(rows);

    if (error) {
      log.error(`[Audit] Supabase flush failed: ${error.message}. Re-buffering ${batch.length} entries.`);
      // Re-add to buffer front (don't lose data) — but cap at 500 to prevent OOM on persistent outage
      buffer.unshift(...batch);
      if (buffer.length > 500) {
        const dropped = buffer.length - 500;
        buffer.length = 500;
        log.warn(`[Audit] Buffer capped at 500, dropped ${dropped} oldest entries to prevent OOM`);
      }
    } else {
      log.info(`[Audit] Flushed ${batch.length} decisions to Supabase`);
    }
  } catch (err) {
    log.error(`[Audit] Flush exception: ${err}`);
    buffer.unshift(...batch);
    if (buffer.length > 500) {
      buffer.length = 500;
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Generate a unique decision ID
 */
function generateId(): string {
  return `dec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Log a decision. Non-blocking — writes to buffer, flushes async.
 */
export function logDecision(entry: Omit<DecisionAuditEntry, 'id'>): string {
  if (DISABLED) return '';

  const id = generateId();
  const full: DecisionAuditEntry = { id, ...entry };

  // Add to recent (fast in-memory query)
  recentDecisions.push(full);
  if (recentDecisions.length > MAX_RECENT) {
    recentDecisions.shift();
  }

  // Add to Supabase buffer
  buffer.push(full);
  if (buffer.length >= BUFFER_FLUSH_SIZE) {
    flushBuffer(); // fire and forget
  }

  startFlushTimer();

  log.info(`[Audit] ${full.action} ${full.symbol} | regime=${full.regime} | consensus=${full.consensusRatio?.toFixed(2)} | sentinel=${full.sentinelSafe}`);

  return id;
}

/**
 * Update post-trade data (slippage, fill price, latency) after execution.
 * Matches by decision ID in recent buffer + updates Supabase.
 */
export async function updatePostTrade(
  decisionId: string,
  update: { slippage?: number; fillPrice?: number; latencyMs?: number }
): Promise<void> {
  if (DISABLED || !decisionId) return;

  // Update in-memory
  const entry = recentDecisions.find(d => d.id === decisionId);
  if (entry) {
    if (update.slippage !== undefined) entry.slippage = update.slippage;
    if (update.fillPrice !== undefined) entry.fillPrice = update.fillPrice;
    if (update.latencyMs !== undefined) entry.latencyMs = update.latencyMs;
  }

  // Update Supabase
  if (SUPABASE_CONFIGURED) {
    try {
      const { error } = await supabase
        .from('decision_audit')
        .update({
          slippage: update.slippage,
          fill_price: update.fillPrice,
          latency_ms: update.latencyMs,
        })
        .eq('id', decisionId);

      if (error) {
        log.warn(`[Audit] Post-trade update failed for ${decisionId}: ${error.message}`);
      }
    } catch (err) {
      log.warn(`[Audit] Post-trade update exception: ${err}`);
    }
  }
}

// ─── Query API ──────────────────────────────────────────────────

/**
 * Get recent decisions from in-memory buffer (fast, no DB call)
 */
export function getRecentDecisions(limit: number = 20): DecisionAuditEntry[] {
  return recentDecisions.slice(-limit);
}

/**
 * Get recent decisions for a specific symbol
 */
export function getDecisionsBySymbol(symbol: string, limit: number = 20): DecisionAuditEntry[] {
  return recentDecisions
    .filter(d => d.symbol === symbol)
    .slice(-limit);
}

/**
 * Get recent decisions for a specific gladiator
 */
export function getDecisionsByGladiator(gladiatorId: string, limit: number = 20): DecisionAuditEntry[] {
  return recentDecisions
    .filter(d => d.gladiatorId === gladiatorId)
    .slice(-limit);
}

/**
 * Get decision stats summary (for cockpit/dashboard)
 */
export function getDecisionStats(): {
  total: number;
  executions: number;
  skips: number;
  sentinelBlocks: number;
  avgConsensus: number;
  regimeDistribution: Record<string, number>;
} {
  const total = recentDecisions.length;
  const executions = recentDecisions.filter(d => d.action !== 'SKIP').length;
  const skips = total - executions;
  const sentinelBlocks = recentDecisions.filter(d => !d.sentinelSafe).length;

  const consensusValues = recentDecisions
    .filter(d => d.consensusRatio !== null)
    .map(d => d.consensusRatio!);
  const avgConsensus = consensusValues.length > 0
    ? consensusValues.reduce((a, b) => a + b, 0) / consensusValues.length
    : 0;

  const regimeDistribution: Record<string, number> = {};
  for (const d of recentDecisions) {
    const r = d.regime ?? 'unknown';
    regimeDistribution[r] = (regimeDistribution[r] || 0) + 1;
  }

  return { total, executions, skips, sentinelBlocks, avgConsensus, regimeDistribution };
}

/**
 * Query decisions from Supabase (for historical analysis)
 */
export async function queryDecisionsFromDb(opts: {
  symbol?: string;
  gladiatorId?: string;
  action?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
}): Promise<DecisionAuditEntry[]> {
  if (!SUPABASE_CONFIGURED) return [];

  try {
    let query = supabase
      .from('decision_audit')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(opts.limit ?? 50);

    if (opts.symbol) query = query.eq('symbol', opts.symbol);
    if (opts.gladiatorId) query = query.eq('gladiator_id', opts.gladiatorId);
    if (opts.action) query = query.eq('action', opts.action);
    if (opts.fromTimestamp) query = query.gte('timestamp', opts.fromTimestamp);
    if (opts.toTimestamp) query = query.lte('timestamp', opts.toTimestamp);

    const { data, error } = await query;

    if (error) {
      log.error(`[Audit] DB query failed: ${error.message}`);
      return [];
    }

    // Map DB rows back to DecisionAuditEntry format
    return (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      timestamp: row.timestamp as number,
      symbol: row.symbol as string,
      gladiatorId: row.gladiator_id as string | null,
      mode: row.mode as 'PAPER' | 'LIVE',
      alphaQuantVote: row.alpha_quant_vote as AgentVote | null,
      sentimentVote: row.sentiment_vote as AgentVote | null,
      riskVote: row.risk_vote as RiskVoteSummary | null,
      regime: row.regime as string | null,
      omegaModifier: row.omega_modifier as number | null,
      consensusRatio: row.consensus_ratio as number | null,
      debateVerdict: row.debate_verdict as DebateVerdict | null,
      sentinelSafe: row.sentinel_safe as boolean,
      sentinelReason: row.sentinel_reason as string | null,
      action: row.action as DecisionAuditEntry['action'],
      skipReason: row.skip_reason as string | null,
      slippage: row.slippage as number | null,
      fillPrice: row.fill_price as number | null,
      latencyMs: row.latency_ms as number | null,
      experienceInsight: row.experience_insight as Record<string, unknown> | null,
    }));
  } catch (err) {
    log.error(`[Audit] DB query exception: ${err}`);
    return [];
  }
}

/**
 * Force flush all buffered entries to Supabase (call on shutdown)
 */
export async function forceFlush(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushBuffer();
}
