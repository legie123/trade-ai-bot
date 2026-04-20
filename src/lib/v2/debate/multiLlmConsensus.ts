// ============================================================
// Multi-LLM Consensus — FAZA 3 Batch 9/9 (SHADOW-ONLY)
//
// Additive module. Runs 3 providers IN PARALLEL (not fallback) and
// aggregates via weighted vote. Complementary to DebateEngine (Bull/Bear).
// Intent: observe whether a 3-way consensus vote DIVERGES from primary
// signal often enough to be worth promoting to an active gate in Batch 9b.
//
// Kill-switches (4 layers):
//   1. LLM_CONSENSUS_ENABLED ∈ {off,shadow,active}   (default: off)
//   2. LLM_CONSENSUS_DAILY_BUDGET_USD                (default: 1.00)
//   3. LLM_CONSENSUS_TIMEOUT_MS per provider          (default: 3000)
//   4. Per-provider circuit breaker: 5 consecutive failures → auto-off
//      until UTC rollover
//
// Sample gate (budget preservation):
//   Only runs if primaryConfidence ∈ [SAMPLE_MIN, SAMPLE_MAX]
//   Default window: [0.35, 0.75] — includes the ambiguous + weakly
//   certain bands, excludes strongly certain / strongly reject.
//
// Rate limit: max 1 consensus / 60s (LLM_CONSENSUS_RATE_LIMIT_SEC).
// Coalescing: if a call lands during cooldown → bypass (counted as
// skippedByRateLimit), primary signal unaffected.
//
// Shadow contract: runConsensus() returns a result but OMNI-X callers
// must NOT gate on it. Current wiring = none (manual POST /diag/
// llm-consensus for operator validation). Wiring to hot path = Batch 9b.
//
// ASSUMPTIONS (if broken, invalidate this module's utility):
//  A. API keys DEEPSEEK_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY all
//     present in Cloud Run env (verified in .env).
//  B. Each provider responds with STRICT JSON per instruction.
//     Parse failures are DROPPED (not retried).
//  C. Latency <3s per provider under normal load. Hard timeout otherwise.
//  D. Prompt stability: prompt template is versioned (PROMPT_VERSION)
//     so A/B comparison across commits is traceable.
//
// DESIGN NOTE — why this is separate from debateEngine.ts:
//  debateEngine does Bull/Bear adversarial (2 prompts, 2 roles). This
//  does 3-way consensus (3 prompts, same role, parallel voting). They
//  serve different purposes and run on different providers/timings.
//  Keeping them separate avoids entangling active path with shadow data.
// ============================================================

import { createLogger } from '@/lib/core/logger';
import { metrics, safeInc } from '@/lib/observability/metrics';
// Pas 5: fire-and-forget audit persist. Gated by LLM_CONSENSUS_PERSIST_ENABLED
// inside the module — zero cost when off. NEVER await this, NEVER let it throw.
import { persistConsensusAudit } from './multiLlmConsensusAudit';

const log = createLogger('LlmConsensus');

// ─── Config ─────────────────────────────────────────────────

export type ConsensusMode = 'off' | 'shadow' | 'active';

function readMode(): ConsensusMode {
  const raw = (process.env.LLM_CONSENSUS_ENABLED || 'off').toLowerCase();
  if (raw === 'shadow' || raw === 'active') return raw;
  return 'off';
}

const PROMPT_VERSION = 'v1.0.0'; // Bump on prompt change

// Budget: hard cap, resets at 00:00 UTC.
function readDailyBudgetUsd(): number {
  const v = Number(process.env.LLM_CONSENSUS_DAILY_BUDGET_USD);
  return Number.isFinite(v) && v > 0 ? v : 1.0;
}

// Per-provider timeout. Total latency ~= max(providers) + overhead.
function readTimeoutMs(): number {
  const v = Number(process.env.LLM_CONSENSUS_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 500 && v <= 10_000 ? v : 3_000;
}

// Rate limit window in seconds (cooldown between debates).
function readRateLimitSec(): number {
  const v = Number(process.env.LLM_CONSENSUS_RATE_LIMIT_SEC);
  return Number.isFinite(v) && v >= 0 && v <= 3600 ? v : 60;
}

// Sample gate: only run for borderline decisions.
function readSampleBounds(): { min: number; max: number } {
  const min = Number(process.env.LLM_CONSENSUS_SAMPLE_MIN);
  const max = Number(process.env.LLM_CONSENSUS_SAMPLE_MAX);
  return {
    min: Number.isFinite(min) && min >= 0 && min <= 1 ? min : 0.35,
    max: Number.isFinite(max) && max >= 0 && max <= 1 ? max : 0.75,
  };
}

// ─── Provider definitions (2 cheap + 1 premium) ───────────

interface ProviderDef {
  name: 'deepseek' | 'openai' | 'gemini';
  model: string;
  weight: number; // weighted aggregation weight
  pricePerMtokUsd: number;
}

// Keep in sync with PRICING_USD_PER_MTOK in callLLM.ts.
const PROVIDERS: ProviderDef[] = [
  { name: 'deepseek', model: 'deepseek-chat',      weight: 1.0, pricePerMtokUsd: 0.21 },
  { name: 'openai',   model: 'gpt-4o-mini',        weight: 1.0, pricePerMtokUsd: 0.375 },
  // NOTE: gemini-1.5-pro was retired from v1beta (404 NOT_FOUND 2026-04-20).
  // Switched to gemini-2.5-flash — same responseMimeType JSON output, lower
  // cost (~10× cheaper), latency ~1.1s. Weight dropped 1.5 → 1.0 because
  // flash is no longer "premium tier"; all 3 providers now equal-weighted.
  { name: 'gemini',   model: 'gemini-2.5-flash',   weight: 1.0, pricePerMtokUsd: 0.40 },
];

// ─── Types ──────────────────────────────────────────────────

export type VoteSide = 'LONG' | 'SHORT' | 'SKIP';

export interface ConsensusInput {
  symbol: string;
  proposedDirection: 'LONG' | 'SHORT';
  primaryConfidence: number; // 0..1 — used for sample gate
  regime?: string | null;
  indicators: {
    rsi?: number;
    vwapDeviation?: number;
    volumeZ?: number;
    fundingRate?: number;
    sentimentScore?: number;
    momentumScore?: number;
  };
}

export interface ProviderVote {
  provider: ProviderDef['name'];
  model: string;
  weight: number;
  vote: VoteSide | null; // null = parse/timeout/error
  confidence: number;    // 0..1
  reason: string;        // <80 chars
  latencyMs: number;
  tokens: number;        // for cost accounting
  costUsd: number;
  status: 'ok' | 'parse_fail' | 'timeout' | 'error' | 'circuit_open' | 'no_key';
}

export interface ConsensusResult {
  bypass: boolean; // true → caller should ignore this (sample/rate/budget/mode)
  bypassReason?: 'mode_off' | 'sample_out_of_range' | 'rate_limit' | 'budget_hit' | 'all_providers_down';
  mode: ConsensusMode;
  vote: VoteSide;            // aggregated vote (SKIP if undecided)
  score: number;             // -1..1 aggregated score
  agreementRatio: number;    // fraction of valid votes agreeing with aggregate direction
  validVotes: number;        // providers that produced a parseable vote
  votes: ProviderVote[];
  divergesFromPrimary: boolean; // aggregate vote != proposed direction
  totalLatencyMs: number;
  totalCostUsd: number;
  promptVersion: string;
}

interface ConsensusTelemetry {
  totalCalls: number;
  skippedByMode: number;
  skippedBySample: number;
  skippedByRateLimit: number;
  skippedByBudget: number;
  executed: number;           // actually fanned out to providers
  validDebates: number;       // ≥2 providers returned parseable vote
  votesByDirection: Record<VoteSide, number>;
  fullAgreement: number;      // all 3 same direction
  divergenceFromPrimary: number;
  perProvider: Record<ProviderDef['name'], {
    calls: number;
    ok: number;
    parseFail: number;
    timeout: number;
    error: number;
    circuitOpen: number;
    avgLatencyMs: number;
    sumLatencyMs: number;
    costUsdToday: number;
    consecFailures: number;
    circuitOpenedAt?: string;
  }>;
  costRunningUsdToday: number;
  budgetHitAt?: string;
  lastExecutedAt?: string;
  resetAt: string;
  promptVersion: string;
}

// ─── Telemetry state (in-memory, resets on cold start + daily) ─────

function newTelemetry(): ConsensusTelemetry {
  const perProvider = {} as ConsensusTelemetry['perProvider'];
  for (const p of PROVIDERS) {
    perProvider[p.name] = {
      calls: 0, ok: 0, parseFail: 0, timeout: 0, error: 0, circuitOpen: 0,
      avgLatencyMs: 0, sumLatencyMs: 0, costUsdToday: 0, consecFailures: 0,
    };
  }
  return {
    totalCalls: 0,
    skippedByMode: 0,
    skippedBySample: 0,
    skippedByRateLimit: 0,
    skippedByBudget: 0,
    executed: 0,
    validDebates: 0,
    votesByDirection: { LONG: 0, SHORT: 0, SKIP: 0 },
    fullAgreement: 0,
    divergenceFromPrimary: 0,
    perProvider,
    costRunningUsdToday: 0,
    resetAt: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
  };
}

let _telemetry: ConsensusTelemetry = newTelemetry();
let _lastConsensusAt = 0;

function currentUtcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function ensureDailyRollover() {
  const today = currentUtcDay();
  if (_telemetry.resetAt.slice(0, 10) !== today) {
    _telemetry = newTelemetry();
  }
}

// ─── Prompt ─────────────────────────────────────────────────

function buildConsensusPrompt(input: ConsensusInput): string {
  const ind = input.indicators;
  // Prompt optimized for: (a) strict JSON output, (b) short reason,
  // (c) explicit SKIP option so model doesn't feel forced to pick.
  return `You are an independent crypto trading judge. Given the data below, vote LONG, SHORT, or SKIP.

Symbol: ${input.symbol}
Proposed direction (from primary signal): ${input.proposedDirection}
Primary signal confidence: ${(input.primaryConfidence * 100).toFixed(0)}%
Regime: ${input.regime || 'unknown'}
RSI: ${ind.rsi ?? 'N/A'}
VWAP deviation: ${ind.vwapDeviation ?? 'N/A'}
Volume Z-score: ${ind.volumeZ ?? 'N/A'}
Funding rate: ${ind.fundingRate ?? 'N/A'}
Sentiment: ${ind.sentimentScore ?? 'N/A'}
Momentum: ${ind.momentumScore ?? 'N/A'}

Rules:
- Vote SKIP if the signal is unclear, contradictory, or risk exceeds expected value.
- Vote LONG only if the data supports going long.
- Vote SHORT only if the data supports going short.
- Disagreeing with the proposed direction is acceptable and encouraged when data supports it.
- Reason must be concise (<80 chars).

Respond with ONLY this JSON:
{"vote": "LONG|SHORT|SKIP", "confidence": 0.0-1.0, "reason": "..."}`;
}

// ─── Parse ──────────────────────────────────────────────────

function parseVote(raw: string | null): { vote: VoteSide | null; confidence: number; reason: string } {
  if (!raw) return { vote: null, confidence: 0, reason: '' };
  try {
    const parsed = JSON.parse(raw);
    const voteRaw = String(parsed.vote ?? '').toUpperCase();
    const vote: VoteSide | null =
      voteRaw === 'LONG' || voteRaw === 'SHORT' || voteRaw === 'SKIP' ? voteRaw : null;
    const confRaw = Number(parsed.confidence);
    const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : 0.5;
    const reason = String(parsed.reason ?? '').slice(0, 80);
    return { vote, confidence, reason };
  } catch {
    return { vote: null, confidence: 0, reason: '' };
  }
}

// ─── Provider calls (parallel, not fallback) ────────────────

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message));
}

async function callDeepseek(prompt: string, timeoutMs: number): Promise<{ text: string | null; tokens: number; status: 'ok' | 'timeout' | 'error' | 'no_key' }> {
  if (!process.env.DEEPSEEK_API_KEY) return { text: null, tokens: 0, status: 'no_key' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 200,
        temperature: 0.3,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { text: null, tokens: 0, status: 'error' };
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? null;
    const tokens = Number(data.usage?.total_tokens ?? 0);
    return { text, tokens, status: 'ok' };
  } catch (e) {
    clearTimeout(timer);
    return { text: null, tokens: 0, status: isAbortError(e) ? 'timeout' : 'error' };
  }
}

async function callOpenai(prompt: string, timeoutMs: number): Promise<{ text: string | null; tokens: number; status: 'ok' | 'timeout' | 'error' | 'no_key' }> {
  if (!process.env.OPENAI_API_KEY) return { text: null, tokens: 0, status: 'no_key' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 200,
        temperature: 0.3,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { text: null, tokens: 0, status: 'error' };
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? null;
    const tokens = Number(data.usage?.total_tokens ?? 0);
    return { text, tokens, status: 'ok' };
  } catch (e) {
    clearTimeout(timer);
    return { text: null, tokens: 0, status: isAbortError(e) ? 'timeout' : 'error' };
  }
}

async function callGemini(prompt: string, timeoutMs: number): Promise<{ text: string | null; tokens: number; status: 'ok' | 'timeout' | 'error' | 'no_key' }> {
  if (!process.env.GEMINI_API_KEY) return { text: null, tokens: 0, status: 'no_key' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      // Model kept in sync with PROVIDERS[2].model. If you change one, change both.
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 200,
            temperature: 0.3,
            responseMimeType: 'application/json',
            // thinkingBudget=0 disables chain-of-thought for gemini-2.5-flash.
            // Without this, 189+ tokens get burned on hidden reasoning and
            // the real JSON output is truncated at MAX_TOKENS (parse_fail).
            // Tested: usageMetadata.thoughtsTokenCount drops from 189 → 0.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: ctrl.signal,
      }
    );
    clearTimeout(timer);
    if (!res.ok) return { text: null, tokens: 0, status: 'error' };
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    const tokens = Number(data.usageMetadata?.totalTokenCount ?? 0);
    return { text, tokens, status: 'ok' };
  } catch (e) {
    clearTimeout(timer);
    return { text: null, tokens: 0, status: isAbortError(e) ? 'timeout' : 'error' };
  }
}

function costFor(provider: ProviderDef, tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return (tokens / 1_000_000) * provider.pricePerMtokUsd;
}

// ─── Circuit breaker (per provider, 5 consecutive failures) ─────

const CIRCUIT_BREAK_THRESHOLD = 5;

function isCircuitOpen(name: ProviderDef['name']): boolean {
  const state = _telemetry.perProvider[name];
  if (state.consecFailures < CIRCUIT_BREAK_THRESHOLD) return false;
  // Circuit stays open until UTC rollover (handled by ensureDailyRollover).
  return true;
}

function noteProviderFailure(name: ProviderDef['name']) {
  const state = _telemetry.perProvider[name];
  state.consecFailures++;
  if (state.consecFailures === CIRCUIT_BREAK_THRESHOLD) {
    state.circuitOpenedAt = new Date().toISOString();
    log.warn(`[Consensus] Circuit open on ${name} after ${CIRCUIT_BREAK_THRESHOLD} consecutive failures`);
  }
}

function noteProviderSuccess(name: ProviderDef['name']) {
  _telemetry.perProvider[name].consecFailures = 0;
}

// ─── Aggregation ────────────────────────────────────────────

function aggregateVotes(votes: ProviderVote[]): { vote: VoteSide; score: number; agreementRatio: number } {
  const valid = votes.filter((v) => v.vote !== null);
  if (valid.length === 0) return { vote: 'SKIP', score: 0, agreementRatio: 0 };

  // Map votes to numeric: LONG=+1, SHORT=-1, SKIP=0.
  // Weighted sum normalized by sum of active weights.
  let weightedSum = 0;
  let activeWeight = 0;
  for (const v of valid) {
    const num = v.vote === 'LONG' ? 1 : v.vote === 'SHORT' ? -1 : 0;
    weightedSum += num * v.weight * v.confidence;
    activeWeight += v.weight;
  }
  const score = activeWeight > 0 ? weightedSum / activeWeight : 0;

  // Threshold for direction. Below threshold → SKIP (indecisive).
  // 0.3 = a 2-vote plurality over 3 weighted, confidence-adjusted.
  let aggregate: VoteSide;
  if (score > 0.3) aggregate = 'LONG';
  else if (score < -0.3) aggregate = 'SHORT';
  else aggregate = 'SKIP';

  const sameAsAggregate = valid.filter((v) => v.vote === aggregate).length;
  const agreementRatio = sameAsAggregate / valid.length;

  return { vote: aggregate, score, agreementRatio };
}

// ─── Prometheus hooks (fail-soft) ──────────────────────────

const METRIC_BASE = { caller: 'multiLlmConsensus' };

function emitMetrics(result: ConsensusResult) {
  try {
    // Reuse llmCalls/llmCostDollars counters from callLLM — consistent with
    // existing Prometheus pipeline. Labels: provider, model, status.
    for (const v of result.votes) {
      safeInc(metrics.llmCalls, { provider: v.provider, model: v.model, status: v.status }, 1);
      if (v.costUsd > 0) {
        safeInc(metrics.llmCostDollars, { provider: v.provider, model: v.model }, v.costUsd);
      }
    }
  } catch {
    // swallow — telemetry is best-effort
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ = METRIC_BASE; // keep the constant referenced
}

// ─── Main public API ────────────────────────────────────────

export async function runConsensus(input: ConsensusInput): Promise<ConsensusResult> {
  ensureDailyRollover();
  _telemetry.totalCalls++;

  const mode = readMode();
  const sampleBounds = readSampleBounds();
  const budgetUsd = readDailyBudgetUsd();
  const timeoutMs = readTimeoutMs();
  const rateLimitSec = readRateLimitSec();

  // Bypass: mode off.
  if (mode === 'off') {
    _telemetry.skippedByMode++;
    return bypassResult('mode_off', mode);
  }

  // Bypass: sample gate.
  const conf = input.primaryConfidence;
  if (!(conf >= sampleBounds.min && conf <= sampleBounds.max)) {
    _telemetry.skippedBySample++;
    return bypassResult('sample_out_of_range', mode);
  }

  // Bypass: budget.
  if (_telemetry.costRunningUsdToday >= budgetUsd) {
    if (!_telemetry.budgetHitAt) {
      _telemetry.budgetHitAt = new Date().toISOString();
      log.warn(`[Consensus] Daily budget $${budgetUsd} hit at ${_telemetry.budgetHitAt} — bypass until 00:00 UTC`);
    }
    _telemetry.skippedByBudget++;
    return bypassResult('budget_hit', mode);
  }

  // Bypass: rate limit.
  const now = Date.now();
  if (now - _lastConsensusAt < rateLimitSec * 1000) {
    _telemetry.skippedByRateLimit++;
    return bypassResult('rate_limit', mode);
  }
  _lastConsensusAt = now;

  _telemetry.executed++;
  _telemetry.lastExecutedAt = new Date().toISOString();

  // Fire providers in parallel (NOT fallback — we want 3 independent votes).
  const prompt = buildConsensusPrompt(input);
  const start = Date.now();

  const calls = PROVIDERS.map(async (p): Promise<ProviderVote> => {
    const tStart = Date.now();
    const state = _telemetry.perProvider[p.name];
    state.calls++;

    if (isCircuitOpen(p.name)) {
      state.circuitOpen++;
      return {
        provider: p.name, model: p.model, weight: p.weight,
        vote: null, confidence: 0, reason: 'circuit_open',
        latencyMs: 0, tokens: 0, costUsd: 0, status: 'circuit_open',
      };
    }

    let result: { text: string | null; tokens: number; status: 'ok' | 'timeout' | 'error' | 'no_key' };
    if (p.name === 'deepseek') result = await callDeepseek(prompt, timeoutMs);
    else if (p.name === 'openai') result = await callOpenai(prompt, timeoutMs);
    else result = await callGemini(prompt, timeoutMs);

    const latency = Date.now() - tStart;
    state.sumLatencyMs += latency;
    state.avgLatencyMs = state.sumLatencyMs / state.calls;

    const cost = costFor(p, result.tokens);
    state.costUsdToday += cost;

    if (result.status === 'timeout') { state.timeout++; noteProviderFailure(p.name); }
    else if (result.status === 'error') { state.error++; noteProviderFailure(p.name); }
    else if (result.status === 'no_key') { state.error++; /* treat as permanent fail but don't open circuit */ }

    if (result.status !== 'ok') {
      return {
        provider: p.name, model: p.model, weight: p.weight,
        vote: null, confidence: 0, reason: result.status,
        latencyMs: latency, tokens: result.tokens, costUsd: cost, status: result.status,
      };
    }

    const parsed = parseVote(result.text);
    if (parsed.vote === null) {
      state.parseFail++;
      noteProviderFailure(p.name);
      return {
        provider: p.name, model: p.model, weight: p.weight,
        vote: null, confidence: parsed.confidence, reason: parsed.reason || 'parse_fail',
        latencyMs: latency, tokens: result.tokens, costUsd: cost, status: 'parse_fail',
      };
    }

    state.ok++;
    noteProviderSuccess(p.name);
    return {
      provider: p.name, model: p.model, weight: p.weight,
      vote: parsed.vote, confidence: parsed.confidence, reason: parsed.reason,
      latencyMs: latency, tokens: result.tokens, costUsd: cost, status: 'ok',
    };
  });

  const votes = await Promise.all(calls);
  const totalLatency = Date.now() - start;
  const totalCost = votes.reduce((s, v) => s + v.costUsd, 0);
  _telemetry.costRunningUsdToday += totalCost;

  const validVotes = votes.filter((v) => v.vote !== null).length;
  if (validVotes < 2) {
    // Can't form a meaningful consensus from 0-1 valid votes.
    _telemetry.votesByDirection.SKIP++;
    const empty: ConsensusResult = {
      bypass: true,
      bypassReason: 'all_providers_down',
      mode,
      vote: 'SKIP',
      score: 0,
      agreementRatio: 0,
      validVotes,
      votes,
      divergesFromPrimary: false,
      totalLatencyMs: totalLatency,
      totalCostUsd: totalCost,
      promptVersion: PROMPT_VERSION,
    };
    emitMetrics(empty);
    // Pas 5: persist degraded run (validVotes<2) — diagnostically important
    // for detecting provider billing / circuit breaker cascades.
    void persistConsensusAudit(input, empty).catch(() => { /* swallow */ });
    return empty;
  }

  _telemetry.validDebates++;
  const agg = aggregateVotes(votes);
  _telemetry.votesByDirection[agg.vote]++;

  // Full agreement = all valid voters agree on aggregate direction.
  if (agg.agreementRatio === 1) _telemetry.fullAgreement++;

  const divergesFromPrimary =
    agg.vote !== 'SKIP' && agg.vote !== input.proposedDirection;
  if (divergesFromPrimary) _telemetry.divergenceFromPrimary++;

  const finalResult: ConsensusResult = {
    bypass: false,
    mode,
    vote: agg.vote,
    score: agg.score,
    agreementRatio: agg.agreementRatio,
    validVotes,
    votes,
    divergesFromPrimary,
    totalLatencyMs: totalLatency,
    totalCostUsd: totalCost,
    promptVersion: PROMPT_VERSION,
  };

  emitMetrics(finalResult);
  // Pas 5: persist executed consensus run. Primary research dataset for
  // divergenceFromPrimary × loss-cluster correlation studies. Fire-and-forget.
  void persistConsensusAudit(input, finalResult).catch(() => { /* swallow */ });
  log.info(
    `[Consensus] ${input.symbol} ${input.proposedDirection} conf=${conf.toFixed(2)} → ${agg.vote} ` +
    `(score=${agg.score.toFixed(2)}, agree=${agg.agreementRatio.toFixed(2)}, ` +
    `valid=${validVotes}/3, ${totalLatency}ms, $${totalCost.toFixed(4)})`
  );

  return finalResult;
}

function bypassResult(reason: ConsensusResult['bypassReason'], mode: ConsensusMode): ConsensusResult {
  return {
    bypass: true,
    bypassReason: reason,
    mode,
    vote: 'SKIP',
    score: 0,
    agreementRatio: 0,
    validVotes: 0,
    votes: [],
    divergesFromPrimary: false,
    totalLatencyMs: 0,
    totalCostUsd: 0,
    promptVersion: PROMPT_VERSION,
  };
}

// ─── Public accessors ───────────────────────────────────────

export function getConsensusTelemetry(): ConsensusTelemetry & { config: Record<string, unknown> } {
  ensureDailyRollover();
  return {
    ..._telemetry,
    config: {
      mode: readMode(),
      dailyBudgetUsd: readDailyBudgetUsd(),
      timeoutMs: readTimeoutMs(),
      rateLimitSec: readRateLimitSec(),
      sampleBounds: readSampleBounds(),
      providers: PROVIDERS.map((p) => ({
        name: p.name, model: p.model, weight: p.weight, pricePerMtokUsd: p.pricePerMtokUsd,
        keyPresent:
          p.name === 'deepseek' ? !!process.env.DEEPSEEK_API_KEY :
          p.name === 'openai' ? !!process.env.OPENAI_API_KEY :
          !!process.env.GEMINI_API_KEY,
      })),
      promptVersion: PROMPT_VERSION,
    },
  };
}

// Exposed for diag endpoint manual test convenience.
export { PROMPT_VERSION, PROVIDERS };
