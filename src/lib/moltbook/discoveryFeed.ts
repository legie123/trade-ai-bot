import { fetchHomeFeed, postActivity } from './moltbookClient';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('MoltbookDiscovery');

/**
 * Analyzes the latest Moltbook discussions to extract valuable trading or coding insights,
 * and actively posts to multiple communities while solving Captcha networks.
 */
const ACTIVE_SUBMOLTS = ['quant', 'crypto', 'ai', 'trading', 'web3'];

interface MoltbookPost {
    id: string;
    agent_name: string;
    content: string;
    submolt_name?: string;
}

// FIX 2026-04-18: Graceful disable când MOLTBOOK_API_KEY lipsește.
// Anterior: fiecare cron tick (every 30 min) arunca excepție, spamming logs cu acelaşi mesaj.
// Acum: short-circuit early, log o singură dată per process lifecycle, return clean skip status.
// Reactivare: setezi MOLTBOOK_API_KEY în Cloud Run env → next tick reia activitatea fără re-deploy.
let _moltbookSkipNotified = false;

export async function runMoltbookDailySweep(forgeStats?: { progressPercent: number, totalWinsAssimilated: number }) {
    if (!process.env.MOLTBOOK_API_KEY) {
        if (!_moltbookSkipNotified) {
            log.info('Moltbook integration disabled: MOLTBOOK_API_KEY not set. Sweep skipped silently going forward.');
            _moltbookSkipNotified = true;
        }
        return { success: true, skipped: true, reason: 'MOLTBOOK_API_KEY not configured', forgeStats: forgeStats ?? null };
    }
    log.info('Starting Advanced Moltbook sweep across multiple submolts...');
    const results = [];

    try {
        const feedData = await fetchHomeFeed(40);
        const discussions = (feedData?.data || []).map((item: MoltbookPost) => `[${item.agent_name}]: ${item.content}`).join('\n');
        
        const randomSubmolt = ACTIVE_SUBMOLTS[Math.floor(Math.random() * ACTIVE_SUBMOLTS.length)];
        log.info(`Rate limit aware: System randomly selected [${randomSubmolt}] for this sweep.`);
        
        const insightText = await extractInsightsWithLLM(discussions, randomSubmolt, forgeStats);
        
        if (insightText && insightText.length > 20) {
           log.info(`Generated insight for [${randomSubmolt}]: ${insightText.substring(0, 80)}...`);
           const postResult = await tryPostingToMoltbook(insightText, randomSubmolt);
           results.push({ submolt: randomSubmolt, success: postResult, insight: insightText });
        } else {
           results.push({ submolt: randomSubmolt, success: false, reason: 'Low quality insight' });
        }

        // 🤖 [NEW] INTERACTIVE ENGAGEMENT PHASE
        const engagementResults = await engageWithFeed(feedData?.data || []);
        
        return { 
            success: true, 
            sweeps: results, 
            engagement: engagementResults 
        };
    } catch (err) {
        log.error('Failed to run Moltbook sweep', { error: String(err) });
        return { success: false, error: String(err) };
    }
}

async function extractInsightsWithLLM(rawText: string, contextTarget: string, forgeStats?: { progressPercent: number, totalWinsAssimilated: number }): Promise<string> {
    const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_KEY) return '';

    const forgeMsg = forgeStats ? `Also mention that the Trading AI system is at ${forgeStats.progressPercent}% completion with ${forgeStats.totalWinsAssimilated} winning trades assimilated.` : '';

    const prompt = `
You are the Trade AI Syndicate, an autonomous trading intelligence system on Moltbook.
Analyze the following discussions from other AI agents. If the DISCUSSIONS are empty or missing, generate a highly technical "Market Update" from your own internal logic.

Technical Analysis: Focuses on code, math, and data efficiency.
Sentiment Analysis: Focuses on market sentiment and human psychology.

Synthesize exactly 1 professional insight tailored for the '${contextTarget}' community.
Maximum 3 sentences. No hashtags.
${forgeMsg}

DISCUSSIONS:
${rawText.substring(0, 3000)}

YOUR INSIGHT:`;

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
            'HTTP-Referer': 'https://antigravity.tech',
            'X-Title': 'Trade AI'
        },
        body: JSON.stringify({
            model: 'meta-llama/llama-3.3-70b-instruct',
            messages: [
                { role: 'system', content: 'You are a quantitative trading AI agent.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.8,
            max_tokens: 150
        })
    });

    if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || '';
    }
    return '';
}

async function solveMathChallenge(challengeText: string): Promise<string> {
    const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_KEY) throw new Error("Missing OPENROUTER_KEY for Math Challenge Solver");

    log.info(`Attempting to solve math challenge: ${challengeText}`);
    const prompt = `
You are a math problem solver.
You will receive a math word problem.
Figure out the final numeric answer.
RESTRICTION: Output ONLY the final numeric answer formatted to exactly 2 decimal places (e.g. "30.00"). Absolutely no other text, words, or explanation.

PROBLEM:
${challengeText}`;

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
            'HTTP-Referer': 'https://antigravity.tech',
            'X-Title': 'Trade AI'
        },
        body: JSON.stringify({
            model: 'meta-llama/llama-3.3-70b-instruct',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 20
        })
    });

    if (res.ok) {
        const data = await res.json();
        const rawAns = data.choices?.[0]?.message?.content?.trim();
        if (rawAns) {
           log.info(`Auto-Solver deduced answer: ${rawAns}`);
           return rawAns;
        }
    }
    throw new Error("LLM Math Solver HTTP Error on OpenRouter");
}

import { verifyPost } from './moltbookClient';

async function tryPostingToMoltbook(insightText: string, submolt: string, replyToId?: string) {
    try {
        const isReply = !!replyToId;
        const postContent = isReply
            ? insightText
            : `Daily Core Sweep [${submolt.toUpperCase()}] 📡:\n${insightText}`;
            
        const res = await postActivity(postContent, replyToId, submolt);
        
        if (res.verificationStatus === 'pending' && res.verification) {
             const code = res.verification.verification_code;
             const challenge = res.verification.challenge_text;
             const answer = await solveMathChallenge(challenge);
             
             log.info(`Submitting verification code with answer: ${answer}...`);
             const vRes = await verifyPost(code, answer);
             if (vRes.success) {
                 log.info(`Successfully bypassed Captcha and posted ${isReply ? 'reply' : 'thread'} to [${submolt}].`);
                 return true;
             } else {
                 log.warn(`Verification failed for [${submolt}]`, vRes);
                 return false;
             }
        }
        
        log.info(`Successfully posted natively without Captcha to [${submolt}].`);
        return true;
    } catch (e) {
        log.warn(`Could not post to [${submolt}]`, { error: String(e) });
        return false;
    }
}

/**
 * Iterates through the feed and proactively replies to other agents to build Karma.
 */
async function engageWithFeed(posts: MoltbookPost[]) {
    log.info(`[Engagement] Evaluating ${posts.length} posts for potential interaction...`);
    const engagementCount = 2; // Reply to 2 posts per sweep to avoid spam flags
    let successfulReplies = 0;
    
    // Filter out our own bot posts
    const othersPosts = posts.filter(p => !p.agent_name.includes('antigravity'));
    
    for (const post of othersPosts.slice(0, 5)) { // Look at top 5 active discussions
        if (successfulReplies >= engagementCount) break;
        
        log.info(`[Engagement] Drafting reply for ${post.agent_name}'s post: "${post.content.substring(0, 40)}..."`);
        
        const reply = await generateSmartReplyLLM(post.content, post.agent_name);
        if (reply) {
            const success = await tryPostingToMoltbook(reply, post.submolt_name || 'crypto', post.id);
            if (success) successfulReplies++;
        }
    }
    
    return { successfulReplies };
}

async function generateSmartReplyLLM(postContent: string, author: string): Promise<string> {
    const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_KEY) return '';

    const prompt = `
You are a Trading AI agent.
Author "${author}" posted: "${postContent}"
Provide a smart, concise, and slightly opinionated reply as a fellow AI agent.
If it's technical, provide a small logic improvement or validation.
If it's sentiment-based, provide a contrasting analytical perspective.
Maximum 2 sentences. No hashtags. Be respectful but direct.

YOUR REPLY:`;

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
            'HTTP-Referer': 'https://antigravity.tech',
            'X-Title': 'Trade AI'
        },
        body: JSON.stringify({
            model: 'meta-llama/llama-3.3-70b-instruct',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 100
        })
    });

    if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || '';
    }
    return '';
}

