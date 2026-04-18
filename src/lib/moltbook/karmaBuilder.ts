/**
 * Moltbook Karma Builder v2
 * ---------------------------------------------------
 * Active-but-safe learning agent for Moltbook.
 * Focus: crypto + polymarket + trading AI insights.
 *
 * Safety guarantees (cannot be bypassed without code change):
 *  - Reads only via /search (not the buggy /home endpoint).
 *  - Writes gated by MOLTBOOK_ACTIVE_MODE env (default: read-only).
 *  - Daily caps enforced: max 12 replies/day + 6 original posts/day (50/day API limit).
 *  - Quality filter: upvotes>=3, upvote/downvote ratio>=2, keyword whitelist, blacklist terms.
 *  - Dedupe: in-memory cache of replied post IDs (resets on cold start; safe: duplicate reply caught by Moltbook server-side).
 *  - No code execution from post content; content is text-only.
 *  - No secrets ever written to posts (only forgeStats + generic commentary).
 *
 * Assumptions (break any → INVALID):
 *  - Moltbook /search returns posts with shape MoltbookSearchResult (verified 2026-04-19).
 *  - OPENAI_API_KEY is set (we have it in .env); fallback to DEEPSEEK if missing.
 *  - Rate limit 50 POST/day on Moltbook side (documented 2026-04-18).
 */

import {
  searchPosts,
  postActivity,
  verifyPost,
  MoltbookSearchResult,
} from './moltbookClient';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('MoltbookKarma');

// --- CONFIG (hardcoded on purpose; env overrides require code review) --------

// Topic whitelist — only these queries get polled. Tight focus = higher signal.
const SEARCH_QUERIES = [
  'crypto trading',
  'polymarket',
  'prediction markets',
  'backtest overfitting',
  'slippage execution',
  'autonomous agent trading',
  'risk management drawdown',
  'market sentiment bot',
];

// Minimum quality bar a post must clear to be engaged with.
const QUALITY_GATE = {
  MIN_UPVOTES: 3,
  MAX_DOWNVOTES_RATIO: 0.5, // downvotes/upvotes < 0.5
  MAX_AGE_HOURS: 7 * 24, // one week
};

// Content blacklist — skip posts matching these (religion, politics, spam, NSFW, known noise authors).
const CONTENT_BLACKLIST = [
  'lord rayel', '144,000', 'messiah', 'kingdom of heaven',
  'trump', 'biden', 'election',
  'nsfw', 'adult content',
  'telegram link', 't.me/', 'pump.fun airdrop',
];

// Daily caps (conservative: Moltbook limit is 50 POST/day).
const DAILY_CAPS = {
  REPLIES: 12,
  ORIGINAL_POSTS: 6,
};

// Throttle (in-memory; resets on cold start — acceptable because Moltbook will also reject spam).
const THROTTLE = {
  MIN_MS_BETWEEN_REPLIES: 60 * 60 * 1000, // 1 hour
  MIN_MS_BETWEEN_ORIGINALS: 2 * 60 * 60 * 1000, // 2 hours
};

// --- RUNTIME STATE (per-instance; ephemeral) ---------------------------------

interface KarmaState {
  repliesToday: number;
  originalsToday: number;
  lastReplyAt: number;
  lastOriginalAt: number;
  dateKey: string; // YYYY-MM-DD (UTC) — resets counters on rollover
  repliedPostIds: Set<string>;
}

let _state: KarmaState = newState();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function newState(): KarmaState {
  return {
    repliesToday: 0,
    originalsToday: 0,
    lastReplyAt: 0,
    lastOriginalAt: 0,
    dateKey: todayKey(),
    repliedPostIds: new Set(),
  };
}

function ensureDailyRollover() {
  const today = todayKey();
  if (_state.dateKey !== today) {
    log.info(`[Karma] Daily rollover ${_state.dateKey} -> ${today}; resetting counters.`);
    _state = newState();
  }
}

// --- QUALITY GATES -----------------------------------------------------------

function passesQualityGate(post: MoltbookSearchResult): { ok: boolean; reason?: string } {
  if (post.upvotes < QUALITY_GATE.MIN_UPVOTES) {
    return { ok: false, reason: `low_upvotes (${post.upvotes})` };
  }
  if (post.upvotes > 0 && (post.downvotes / post.upvotes) > QUALITY_GATE.MAX_DOWNVOTES_RATIO) {
    return { ok: false, reason: `downvote_ratio (${post.downvotes}/${post.upvotes})` };
  }
  const ageHours = (Date.now() - new Date(post.created_at).getTime()) / 3_600_000;
  if (ageHours > QUALITY_GATE.MAX_AGE_HOURS) {
    return { ok: false, reason: `stale (${ageHours.toFixed(1)}h)` };
  }
  const haystack = `${post.title || ''} ${post.content || ''}`.toLowerCase();
  for (const bad of CONTENT_BLACKLIST) {
    if (haystack.includes(bad)) {
      return { ok: false, reason: `blacklisted:${bad}` };
    }
  }
  // Don't reply to our own posts
  if (post.author?.name && /antigravity/i.test(post.author.name)) {
    return { ok: false, reason: 'self_post' };
  }
  return { ok: true };
}

// --- CONTENT GENERATION (OpenAI, fallback DeepSeek) --------------------------

async function generateReply(post: MoltbookSearchResult): Promise<string | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  const contextSnippet = (post.content || '').slice(0, 1500);
  const title = post.title || '(untitled)';
  const prompt = `You are a quant trading AI agent on Moltbook (a social network for AI agents). Your name is antigravity-bot-v1. You focus on crypto trading, Polymarket leading-indicator use, backtest→live degradation, risk management, and multi-agent systems.

Post by @${post.author?.name || 'unknown'} titled "${title}":
${contextSnippet}

Write a reply that:
- Adds one concrete insight or small correction (not agreement padding).
- Cites a number or mechanism when possible.
- 2 sentences max. No hashtags. No emojis. No claim of access to the other agent's system.
- Absolutely no links, no credentials, no code unless trivially short.
- Be respectful but direct. Disagree if you have a reason.

Reply:`;

  // Try OpenAI first
  if (openaiKey) {
    const r = await callChat(
      'https://api.openai.com/v1/chat/completions',
      openaiKey,
      { model: 'gpt-4o-mini', temperature: 0.7, max_tokens: 120 },
      prompt,
    );
    if (r) return r;
  }
  // Fallback DeepSeek
  if (deepseekKey) {
    const r = await callChat(
      'https://api.deepseek.com/v1/chat/completions',
      deepseekKey,
      { model: 'deepseek-chat', temperature: 0.7, max_tokens: 120 },
      prompt,
    );
    if (r) return r;
  }
  return null;
}

async function generateOriginalPost(
  submolt: string,
  forgeStats?: { progressPercent: number; totalWinsAssimilated: number },
): Promise<string | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  const forgeLine = forgeStats
    ? `My own Forge is at ${forgeStats.progressPercent}% progress with ${forgeStats.totalWinsAssimilated} winning trades assimilated.`
    : '';

  const topicFocus =
    submolt === 'crypto'
      ? 'a practical crypto trading insight (order book, slippage on MEXC, timeframe selection, or risk sizing)'
      : submolt === 'web3'
      ? 'a Polymarket or prediction market observation (leading indicator vs spot, probability drift)'
      : 'an autonomous agent operations insight (cron reliability, multi-agent coordination, or failure mode)';

  const prompt = `You are antigravity-bot-v1, a quant trading AI on Moltbook. Write a short original post for the "${submolt}" submolt about ${topicFocus}.

Rules:
- 3-4 sentences max, no hashtags, no emojis.
- State something non-obvious with a concrete number or mechanism.
- No claims of guaranteed profit. No financial advice tone.
- No links, no internal endpoints, no secrets, no file paths.
${forgeLine}

Post:`;

  if (openaiKey) {
    const r = await callChat(
      'https://api.openai.com/v1/chat/completions',
      openaiKey,
      { model: 'gpt-4o-mini', temperature: 0.8, max_tokens: 180 },
      prompt,
    );
    if (r) return r;
  }
  if (deepseekKey) {
    const r = await callChat(
      'https://api.deepseek.com/v1/chat/completions',
      deepseekKey,
      { model: 'deepseek-chat', temperature: 0.8, max_tokens: 180 },
      prompt,
    );
    if (r) return r;
  }
  return null;
}

async function callChat(
  url: string,
  key: string,
  cfg: { model: string; temperature: number; max_tokens: number },
  prompt: string,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: cfg.temperature,
        max_tokens: cfg.max_tokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      log.warn(`[Karma] LLM HTTP ${res.status} from ${url}`);
      return null;
    }
    const data = await res.json();
    const txt = data?.choices?.[0]?.message?.content?.trim();
    if (!txt || txt.length < 20) return null;
    // Final safety: strip anything that looks like a URL or bearer token.
    if (/https?:\/\/|sk-[A-Za-z0-9_-]{10,}|Bearer\s+\w+/.test(txt)) {
      log.warn('[Karma] LLM output contained URL/token; rejected.');
      return null;
    }
    return txt;
  } catch (e) {
    log.warn(`[Karma] LLM call failed: ${String(e)}`);
    return null;
  }
}

// --- POSTING WITH CAPTCHA HANDLING -------------------------------------------

async function solveCaptcha(challengeText: string): Promise<string | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;
  const prompt = `Solve this math problem. Output ONLY the final numeric answer to exactly 2 decimal places. No words, no explanation.

PROBLEM: ${challengeText}`;
  const r = await callChat(
    'https://api.openai.com/v1/chat/completions',
    openaiKey,
    { model: 'gpt-4o-mini', temperature: 0, max_tokens: 10 },
    prompt,
  );
  return r;
}

async function safePost(
  content: string,
  submolt: string,
  replyToId?: string,
): Promise<boolean> {
  try {
    const res = await postActivity(content, replyToId, submolt);
    if (res?.verificationStatus === 'pending' && res?.verification) {
      const code = res.verification.verification_code;
      const answer = await solveCaptcha(res.verification.challenge_text);
      if (!answer) return false;
      const v = await verifyPost(code, answer);
      return !!v?.success;
    }
    return true;
  } catch (e) {
    log.warn(`[Karma] Post failed: ${String(e)}`);
    return false;
  }
}

// --- MAIN ENTRY POINTS -------------------------------------------------------

/**
 * Read-only sweep: discover + log relevant posts for later review.
 * Always safe to call — never writes to Moltbook.
 */
export async function runKarmaRead(): Promise<{
  success: boolean;
  discovered: number;
  qualified: number;
  samples: Array<{ id: string; title: string; upvotes: number; query: string }>;
}> {
  if (!process.env.MOLTBOOK_API_KEY) {
    return { success: false, discovered: 0, qualified: 0, samples: [] };
  }
  const discovered: MoltbookSearchResult[] = [];
  const qualified: Array<MoltbookSearchResult & { _query: string }> = [];
  for (const q of SEARCH_QUERIES) {
    try {
      const posts = await searchPosts(q, 10);
      discovered.push(...posts);
      for (const p of posts) {
        const gate = passesQualityGate(p);
        if (gate.ok) qualified.push({ ...p, _query: q });
      }
    } catch (e) {
      log.warn(`[KarmaRead] search "${q}" failed: ${String(e)}`);
    }
  }
  // Dedupe by id, keep highest upvotes
  const byId = new Map<string, MoltbookSearchResult & { _query: string }>();
  for (const p of qualified) {
    const prev = byId.get(p.id);
    if (!prev || p.upvotes > prev.upvotes) byId.set(p.id, p);
  }
  const top = Array.from(byId.values())
    .sort((a, b) => b.upvotes - a.upvotes)
    .slice(0, 15);

  return {
    success: true,
    discovered: discovered.length,
    qualified: qualified.length,
    samples: top.map((p) => ({
      id: p.id,
      title: (p.title || '').slice(0, 100),
      upvotes: p.upvotes,
      query: p._query,
    })),
  };
}

/**
 * Active karma-building sweep: discovers high-quality posts on crypto/polymarket topics,
 * replies to at most 1 (respecting throttle + daily cap), optionally posts 1 original.
 * Writes ONLY if MOLTBOOK_ACTIVE_MODE === 'karma'.
 */
export async function runKarmaActive(forgeStats?: {
  progressPercent: number;
  totalWinsAssimilated: number;
}): Promise<{
  success: boolean;
  mode: 'read' | 'karma' | 'disabled';
  reply?: { posted: boolean; postId?: string; reason?: string };
  original?: { posted: boolean; submolt?: string; reason?: string };
  discovery: { discovered: number; qualified: number };
}> {
  if (!process.env.MOLTBOOK_API_KEY) {
    return { success: false, mode: 'disabled', discovery: { discovered: 0, qualified: 0 } };
  }
  const mode = (process.env.MOLTBOOK_ACTIVE_MODE || 'read').toLowerCase();
  ensureDailyRollover();

  // Phase 1: always read (even in read-mode this gives us discovery)
  const readResult = await runKarmaRead();
  const discovery = { discovered: readResult.discovered, qualified: readResult.qualified };

  if (mode !== 'karma') {
    log.info(`[Karma] Mode=${mode}; discovered ${discovery.qualified}/${discovery.discovered} qualified. Skipping writes.`);
    return { success: true, mode: 'read', discovery };
  }

  // Phase 2: reply (throttled, capped)
  const replyResult = await tryOneReply(readResult.samples);
  // Phase 3: original post (throttled, capped)
  const originalResult = await tryOriginalPost(forgeStats);

  return {
    success: true,
    mode: 'karma',
    reply: replyResult,
    original: originalResult,
    discovery,
  };
}

async function tryOneReply(
  samples: Array<{ id: string; title: string; upvotes: number; query: string }>,
): Promise<{ posted: boolean; postId?: string; reason?: string }> {
  if (_state.repliesToday >= DAILY_CAPS.REPLIES) {
    return { posted: false, reason: `daily_cap (${_state.repliesToday}/${DAILY_CAPS.REPLIES})` };
  }
  const sinceLast = Date.now() - _state.lastReplyAt;
  if (sinceLast < THROTTLE.MIN_MS_BETWEEN_REPLIES) {
    return { posted: false, reason: `throttled (${Math.round((THROTTLE.MIN_MS_BETWEEN_REPLIES - sinceLast) / 60000)}m left)` };
  }
  // Find first eligible sample (not already replied to)
  for (const s of samples) {
    if (_state.repliedPostIds.has(s.id)) continue;
    // Re-fetch full post for content (samples only have title)
    const full = await searchPosts(s.query, 10).catch(() => [] as MoltbookSearchResult[]);
    const post = full.find((p) => p.id === s.id);
    if (!post) continue;
    const reply = await generateReply(post);
    if (!reply) continue;
    const submolt = post.submolt?.name || 'crypto';
    const posted = await safePost(reply, submolt, post.id);
    if (posted) {
      _state.repliesToday += 1;
      _state.lastReplyAt = Date.now();
      _state.repliedPostIds.add(post.id);
      log.info(`[Karma] Reply posted to ${post.id} (${post.upvotes}↑) in ${submolt}. RepliesToday=${_state.repliesToday}`);
      return { posted: true, postId: post.id };
    }
  }
  return { posted: false, reason: 'no_eligible_or_generation_failed' };
}

async function tryOriginalPost(
  forgeStats?: { progressPercent: number; totalWinsAssimilated: number },
): Promise<{ posted: boolean; submolt?: string; reason?: string }> {
  if (_state.originalsToday >= DAILY_CAPS.ORIGINAL_POSTS) {
    return { posted: false, reason: `daily_cap (${_state.originalsToday}/${DAILY_CAPS.ORIGINAL_POSTS})` };
  }
  const sinceLast = Date.now() - _state.lastOriginalAt;
  if (sinceLast < THROTTLE.MIN_MS_BETWEEN_ORIGINALS) {
    return { posted: false, reason: `throttled (${Math.round((THROTTLE.MIN_MS_BETWEEN_ORIGINALS - sinceLast) / 60000)}m left)` };
  }
  // Rotate submolt: crypto > web3 > ai by weight.
  const submolts = ['crypto', 'crypto', 'web3', 'ai'];
  const submolt = submolts[_state.originalsToday % submolts.length];
  const content = await generateOriginalPost(submolt, forgeStats);
  if (!content) {
    return { posted: false, reason: 'generation_failed' };
  }
  const posted = await safePost(content, submolt);
  if (posted) {
    _state.originalsToday += 1;
    _state.lastOriginalAt = Date.now();
    log.info(`[Karma] Original posted to ${submolt}. OriginalsToday=${_state.originalsToday}`);
    return { posted: true, submolt };
  }
  return { posted: false, reason: 'post_failed' };
}

export function getKarmaTelemetry() {
  ensureDailyRollover();
  return {
    mode: process.env.MOLTBOOK_ACTIVE_MODE || 'read',
    dateKey: _state.dateKey,
    repliesToday: _state.repliesToday,
    originalsToday: _state.originalsToday,
    caps: DAILY_CAPS,
    lastReplyAt: _state.lastReplyAt ? new Date(_state.lastReplyAt).toISOString() : null,
    lastOriginalAt: _state.lastOriginalAt ? new Date(_state.lastOriginalAt).toISOString() : null,
    repliedPostIdsCount: _state.repliedPostIds.size,
  };
}
