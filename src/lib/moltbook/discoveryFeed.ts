import { fetchHomeFeed, postActivity } from './moltbookClient';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('MoltbookDiscovery');

/**
 * Analyzes the latest Moltbook discussions to extract valuable trading or coding insights,
 * and actively posts to multiple communities while solving Captcha networks.
 */
const ACTIVE_SUBMOLTS = ['quant', 'crypto', 'ai', 'trading', 'web3'];

export async function runMoltbookDailySweep(forgeStats?: { progressPercent: number, totalWinsAssimilated: number }) {
    log.info('Starting Advanced Moltbook sweep across multiple submolts...');
    const results = [];

    try {
        const feedData = await fetchHomeFeed(40); 
        const discussions = (feedData?.data || []).map((item: any) => `[${item.agent_name}]: ${item.content}`).join('\n');
        
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

        return { success: true, sweeps: results };
    } catch (err) {
        log.error('Failed to run Moltbook sweep', { error: String(err) });
        return { success: false, error: String(err) };
    }
}

async function extractInsightsWithLLM(rawText: string, contextTarget: string, forgeStats?: any): Promise<string> {
    const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_KEY) return '';

    const forgeMsg = forgeStats ? `Also subtly mention that the 'Omega Gladiator' Forge is at ${forgeStats.progressPercent}% completion and has assimilated ${forgeStats.totalWinsAssimilated} winning trades.` : '';

    const prompt = `
You are the brain of "antigravity-bot-v1", an autonomous trading AI on Moltbook.
Analyze the following noise from other AI agents. If the DISCUSSIONS are empty or missing, just generate your own brilliant internal insight/alpha. 
Extract exactly 1 clear, actionable coding optimization, web3 strategy, or quantitative idea tailored for the '${contextTarget}' community.
Make it sound professional, cutting-edge, and smart. Maximum 3 sentences. No hashtags here.
${forgeMsg}

DISCUSSIONS:
${rawText.substring(0, 3000)}

YOUR INSIGHT/IDEA:`;

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
            'HTTP-Referer': 'https://antigravity.tech',
            'X-Title': 'Phoenix Syndicate'
        },
        body: JSON.stringify({
            model: 'meta-llama/llama-3.3-70b-instruct',
            messages: [
                { role: 'system', content: 'You are an elite quantitative developer AI agent.' },
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
    if (!OPENROUTER_KEY) throw new Error("Missing OPENROUTER_KEY for Auto-Solver");
    
    log.info(`Attempting to solve AI Captcha: ${challengeText}`);
    const prompt = `
You are an elite math solver bypass script.
You will receive an obfuscated math word problem.
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
            'X-Title': 'Phoenix Syndicate'
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

async function tryPostingToMoltbook(insightText: string, submolt: string) {
    try {
        const postContent = `Daily Core Sweep [${submolt.toUpperCase()}] 📡:\n${insightText}\n\n#Antigravity #Optimization`;
        const res = await postActivity(postContent, undefined, submolt);
        
        if (res.verificationStatus === 'pending' && res.verification) {
             const code = res.verification.verification_code;
             const challenge = res.verification.challenge_text;
             const answer = await solveMathChallenge(challenge);
             
             log.info(`Submitting verification code with answer: ${answer}...`);
             const vRes = await verifyPost(code, answer);
             if (vRes.success) {
                 log.info(`Successfully bypassed Captcha and posted to [${submolt}].`);
                 return true;
             } else {
                 log.warn(`Verification failed for [${submolt}]`, vRes);
                 return false;
             }
        }
        
        log.info(`Successfully posted natively without Captcha to [${submolt}].`);
        return true;
    } catch (e) {
        log.warn(`Could not post insight to [${submolt}]`, { error: String(e) });
        return false;
    }
}

