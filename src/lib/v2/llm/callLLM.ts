/**
 * Shared LLM call helper — DeepSeek → OpenAI → Gemini fallback chain.
 *
 * Extracted 2026-04-19 from debateEngine.ts + forge.ts (identical ~90-line blocks).
 * Callers pass config (maxTokens, temperature, model preferences) to customize behavior.
 *
 * Kill-switch: If all 3 providers fail, returns null. Callers must handle gracefully.
 *
 * FAZA A Batch 4 (2026-04-19): Prometheus instrumentation.
 * Every provider outcome emits llmCalls{provider,model,status} and — if usage tokens
 * are parseable — llmCostDollars{provider,model}. Fail-soft via safeInc.
 */

import { createLogger } from '@/lib/core/logger';
import { metrics, safeInc } from '@/lib/observability/metrics';

const log = createLogger('LLM');

export interface LLMCallOptions {
  /** Max output tokens (default: 300) */
  maxTokens?: number;
  /** Temperature — lower = more deterministic (default: 0.4) */
  temperature?: number;
  /** Timeout in ms (default: 12000) */
  timeoutMs?: number;
  /** Minimum response length to accept (default: 10) */
  minResponseLength?: number;
  /** OpenAI model override (default: gpt-4o-mini) */
  openaiModel?: string;
  /** Gemini model override (default: gemini-2.0-flash) */
  geminiModel?: string;
  /** Caller tag for logs */
  caller?: string;
}

const DEFAULTS: Required<LLMCallOptions> = {
  maxTokens: 300,
  temperature: 0.4,
  timeoutMs: 12_000,
  minResponseLength: 10,
  openaiModel: 'gpt-4o-mini',
  geminiModel: 'gemini-2.0-flash',
  caller: 'LLM',
};

// ── Cost accounting (USD per 1M tokens, blended input+output avg) ──────────
// Update when vendor prices drift. Unknown models fall back to DEFAULT_RATE.
// As of 2026-04-19.
const PRICING_USD_PER_MTOK: Record<string, number> = {
  // DeepSeek
  'deepseek-chat': 0.21,
  'deepseek-reasoner': 1.10,
  // OpenAI
  'gpt-4o-mini': 0.375,
  'gpt-4o': 7.50,
  'gpt-4-turbo': 15.00,
  'o1-mini': 4.50,
  'o1': 30.00,
  // Gemini
  'gemini-2.0-flash': 0.15,
  'gemini-1.5-flash': 0.15,
  'gemini-1.5-pro': 3.75,
};
const DEFAULT_RATE_USD_PER_MTOK = 1.00;

function priceFor(model: string): number {
  return PRICING_USD_PER_MTOK[model] ?? DEFAULT_RATE_USD_PER_MTOK;
}

function costUsd(model: string, tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return (tokens / 1_000_000) * priceFor(model);
}

type CallStatus = 'ok' | 'error' | 'timeout';

function recordCall(provider: string, model: string, status: CallStatus, tokens = 0) {
  safeInc(metrics.llmCalls, { provider, model, status });
  if (status === 'ok' && tokens > 0) {
    const dollars = costUsd(model, tokens);
    if (dollars > 0) safeInc(metrics.llmCostDollars, { provider, model }, dollars);
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message));
}

// ── Provider definitions ─────────────────────────────────────
// Each provider specifies how to build request, parse response.
// DeepSeek + OpenAI share the OpenAI-compatible API shape.

interface ProviderDef {
  name: string;
  envKey: string;
  getModel: (cfg: Required<LLMCallOptions>) => string;
  buildRequest: (prompt: string, model: string, cfg: Required<LLMCallOptions>) => { url: string; init: RequestInit };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extractText: (data: any) => string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extractTokens: (data: any) => number;
}

/** Shared request builder for OpenAI-compatible APIs (DeepSeek, OpenAI). */
function openaiCompatRequest(url: string, apiKey: string, prompt: string, model: string, cfg: Required<LLMCallOptions>) {
  return {
    url,
    init: {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
      }),
    } as RequestInit,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function openaiExtractText(data: any): string | undefined { return data.choices?.[0]?.message?.content; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function openaiExtractTokens(data: any): number { return Number(data.usage?.total_tokens ?? 0); }

const PROVIDERS: ProviderDef[] = [
  {
    name: 'deepseek',
    envKey: 'DEEPSEEK_API_KEY',
    getModel: () => 'deepseek-chat',
    buildRequest: (prompt, model, cfg) =>
      openaiCompatRequest('https://api.deepseek.com/chat/completions', process.env.DEEPSEEK_API_KEY!, prompt, model, cfg),
    extractText: openaiExtractText,
    extractTokens: openaiExtractTokens,
  },
  {
    name: 'openai',
    envKey: 'OPENAI_API_KEY',
    getModel: (cfg) => cfg.openaiModel,
    buildRequest: (prompt, model, cfg) =>
      openaiCompatRequest('https://api.openai.com/v1/chat/completions', process.env.OPENAI_API_KEY!, prompt, model, cfg),
    extractText: openaiExtractText,
    extractTokens: openaiExtractTokens,
  },
  {
    name: 'gemini',
    envKey: 'GEMINI_API_KEY',
    getModel: (cfg) => cfg.geminiModel,
    buildRequest: (prompt, model, cfg) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: cfg.maxTokens, temperature: cfg.temperature },
        }),
      } as RequestInit,
    }),
    extractText: (data) => data.candidates?.[0]?.content?.parts?.[0]?.text,
    extractTokens: (data) => Number(data.usageMetadata?.totalTokenCount ?? 0),
  },
];

/**
 * Call LLM with automatic fallback chain: DeepSeek → OpenAI → Gemini.
 * Returns raw text response or null if all providers fail.
 */
export async function callLLM(prompt: string, opts?: LLMCallOptions): Promise<string | null> {
  const cfg = { ...DEFAULTS, ...opts };

  for (let i = 0; i < PROVIDERS.length; i++) {
    const prov = PROVIDERS[i];
    if (!process.env[prov.envKey]) continue;

    const model = prov.getModel(cfg);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
      const { url, init } = prov.buildRequest(prompt, model, cfg);
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const text = prov.extractText(data);
        const tokens = prov.extractTokens(data);
        if (text && text.length >= cfg.minResponseLength) {
          recordCall(prov.name, model, 'ok', tokens);
          return text;
        }
        recordCall(prov.name, model, 'error', tokens);
      } else {
        recordCall(prov.name, model, 'error');
      }
    } catch (e) {
      recordCall(prov.name, model, isAbortError(e) ? 'timeout' : 'error');
      const isLast = i === PROVIDERS.length - 1;
      const nextName = isLast ? null : PROVIDERS[i + 1]?.name;
      log.warn(`[${cfg.caller}] ${prov.name} unavailable${nextName ? `, trying ${nextName}...` : ' — all LLM providers failed'}`);
    }
  }

  return null;
}
