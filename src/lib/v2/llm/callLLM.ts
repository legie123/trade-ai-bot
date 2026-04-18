/**
 * Shared LLM call helper — DeepSeek → OpenAI → Gemini fallback chain.
 *
 * Extracted 2026-04-19 from debateEngine.ts + forge.ts (identical ~90-line blocks).
 * Callers pass config (maxTokens, temperature, model preferences) to customize behavior.
 *
 * Kill-switch: If all 3 providers fail, returns null. Callers must handle gracefully.
 */

import { createLogger } from '@/lib/core/logger';

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

/**
 * Call LLM with automatic fallback chain: DeepSeek → OpenAI → Gemini.
 * Returns raw text response or null if all providers fail.
 */
export async function callLLM(prompt: string, opts?: LLMCallOptions): Promise<string | null> {
  const cfg = { ...DEFAULTS, ...opts };

  // 1. DeepSeek (cheapest)
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
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
          max_tokens: cfg.maxTokens,
          temperature: cfg.temperature,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text && text.length >= cfg.minResponseLength) return text;
      }
    } catch {
      log.warn(`[${cfg.caller}] DeepSeek unavailable, trying OpenAI...`);
    }
  }

  // 2. OpenAI
  if (process.env.OPENAI_API_KEY) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: cfg.openaiModel,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          max_tokens: cfg.maxTokens,
          temperature: cfg.temperature,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text && text.length >= cfg.minResponseLength) return text;
      }
    } catch {
      log.warn(`[${cfg.caller}] OpenAI unavailable, trying Gemini...`);
    }
  }

  // 3. Gemini (final fallback)
  if (process.env.GEMINI_API_KEY) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: cfg.maxTokens, temperature: cfg.temperature },
          }),
          signal: ctrl.signal,
        }
      );
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.length >= cfg.minResponseLength) return text;
      }
    } catch {
      log.warn(`[${cfg.caller}] Gemini also unavailable — all LLM providers failed`);
    }
  }

  return null;
}
