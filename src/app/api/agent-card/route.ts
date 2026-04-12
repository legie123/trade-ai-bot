/**
 * GET /api/agent-card
 * Dynamic Agent Card — serves Google A2A spec at runtime with live service URL.
 * The static version lives at /public/.well-known/agent-card.json
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const baseUrl = process.env.SERVICE_URL
    ?? `${new URL(request.url).origin}`;

  const card = {
    name: 'Trade AI Phoenix V2',
    description:
      'Autonomous crypto trading agent powered by Darwinian Gladiator evolution, ' +
      'DualMasterConsciousness (GPT-4o + DeepSeek), and Omega meta-learning. ' +
      'Runs 4 specialized trading arenas with real-time execution on MEXC.',
    url: baseUrl,
    provider: { organization: 'Trade AI', url: baseUrl },
    version: '2.0.0',
    documentationUrl: `${baseUrl}/arena`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [
      {
        id: 'alpha-quant',
        name: 'Alpha Quant Arena',
        description: 'Technical analysis and quantitative signals for LONG/SHORT/FLAT decisions.',
        tags: ['trading', 'technical-analysis', 'quantitative', 'crypto'],
        endpoint: `${baseUrl}/api/a2a/alpha-quant`,
      },
      {
        id: 'sentiment',
        name: 'Sentiment Arena',
        description: 'Social sentiment from Moltbook swarm and on-chain flow analysis.',
        tags: ['sentiment', 'social', 'moltbook', 'swarm-intelligence'],
        endpoint: `${baseUrl}/api/a2a/sentiment`,
      },
      {
        id: 'risk',
        name: 'Risk Arena',
        description: 'Position sizing, drawdown management, and SentinelGuard kill-switch.',
        tags: ['risk-management', 'position-sizing', 'sentinel'],
        endpoint: `${baseUrl}/api/a2a/risk`,
      },
      {
        id: 'execution',
        name: 'Execution Arena',
        description: 'Order placement and management on MEXC (live + phantom).',
        tags: ['execution', 'mexc', 'orders'],
        endpoint: `${baseUrl}/api/a2a/execution`,
      },
      {
        id: 'omega-synthesis',
        name: 'Omega Meta-Learning',
        description: 'Global confidence modifier (0.7–1.3) from top-3 gladiator synthesis.',
        tags: ['meta-learning', 'omega', 'confidence'],
        endpoint: `${baseUrl}/api/a2a/orchestrate`,
      },
    ],
  };

  return NextResponse.json(card, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
