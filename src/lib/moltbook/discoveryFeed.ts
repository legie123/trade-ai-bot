import { fetchHomeFeed, postActivity } from './moltbookClient';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('MoltbookDiscovery');
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

/**
 * Analyzes the latest Moltbook discussions to extract valuable trading or coding insights,
 * and occasionally posts to Moltbook to maintain "Premium" status.
 */
export async function runMoltbookDailySweep() {
    log.info('Starting daily Moltbook sweep. Fetching latest AI agent discussions...');
    try {
        const feedData = await fetchHomeFeed(30); // get last 30 activities
        
        if (!feedData || !feedData.data) {
            log.warn('No feed data retrieved from Moltbook.');
            return { success: false, reason: 'Empty feed' };
        }

        const discussions = feedData.data.map((item: any) => `[${item.agent_name}]: ${item.content}`).join('\n');
        
        log.info('Feed fetched. Sending to OpenAI for optimization extraction...');

        const insights = await extractInsightsWithLLM(discussions);
        
        if (insights && insights.length > 50) {
           log.info(`Extracted insights from Moltbook: ${insights.substring(0, 100)}...`);
           
           // Optionally, if the LLM generated a highly valuable response, we can post a fragment back to Moltbook to maintain daily active status
           await tryPostingToMoltbook(insights);
           return { success: true, insights };
        }

        return { success: true, insights: 'No actionable insights found today.' };

    } catch (err) {
        log.error('Failed to run Moltbook sweep', { error: String(err) });
        return { success: false, error: String(err) };
    }
}

async function extractInsightsWithLLM(rawText: string): Promise<string> {
    if (!OPENAI_KEY) return '';

    const prompt = `
You are the brain of "antigravity-bot-v1", an autonomous trading AI on Moltbook.
Analyze the following latest discussions from other AI agents on Moltbook.
Extract exactly 1 clear, actionable coding optimization or quantitative trading idea from the noise.
Make it sound professional, cutting-edge, and smart. Maximum 3 sentences.

DISCUSSIONS:
${rawText.substring(0, 3000)} // safely truncate

YOUR INSIGHT/IDEA:`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_KEY}`
        },
        body: JSON.stringify({
            model: 'gpt-4o',
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
        return data.choices[0].message.content.trim();
    }
    return '';
}

async function tryPostingToMoltbook(insightText: string) {
    try {
        log.info('Posting daily insight to Moltbook to earn Karma/Premium status...');
        const postContent = `Daily Core Sweep 📡:\n${insightText}\n\n#Antigravity #Quant #Optimization`;
        await postActivity(postContent);
        log.info('Successfully posted auto-generated optimization to Moltbook.');
    } catch (e) {
        log.warn('Could not post insight to Moltbook', { error: String(e) });
    }
}
