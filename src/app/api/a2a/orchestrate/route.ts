/**
 * Swarm Orchestrator
 * POST /api/a2a/orchestrate
 *
 * Central coordination endpoint. Fan-out to all 4 arenas in parallel,
 * aggregates consensus, applies Omega modifier, returns final decision.
 *
 * GET /api/a2a/orchestrate — returns Omega synthesis + swarm status
 */
import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { omegaExtractor } from '@/lib/v2/superai/omegaExtractor';
import { swarmOrchestrator } from '@/lib/v2/swarm/swarmOrchestrator';

export const dynamic = 'force-dynamic';

const log = createLogger('Arena:Orchestrate');

interface OrchestrateRequest {
  symbol: string;
  /** Optional context to pass to sub-arenas */
  indicators?: Record<string, unknown>;
  posts?: Array<{ content: string; timestamp: string; sentiment?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' }>;
  currentEquity?: number;
  openPositions?: number;
  dailyLossCount?: number;
  currentWinRate?: number;
  currentLossStreak?: number;
  /** If true, execution arena will attempt LIVE order if risk approves */
  executeLive?: boolean;
  gladiatorId?: string;
}

function verifyToken(request: Request): boolean {
  const token = process.env.SWARM_TOKEN;
  if (!token) { console.warn('[A2A] SWARM_TOKEN not set — allowing internal calls'); return true; }
  return request.headers.get('x-swarm-token') === token;
}

export async function POST(request: Request) {
  if (!verifyToken(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: OrchestrateRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { symbol } = body;
  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }

  log.info(`[Orchestrate] Swarm activation for ${symbol}`);

  try {
    const result = await swarmOrchestrator.orchestrate(symbol, body, request);
    return NextResponse.json(result);
  } catch (err) {
    log.error('[Orchestrate] Swarm failed', { error: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET() {
  const synthesis = omegaExtractor.getCurrentSynthesis();
  const summary = omegaExtractor.getSummary();

  return NextResponse.json({
    swarm: 'Trade AI Phoenix V2',
    status: 'ready',
    arenas: [
      { id: 'alpha-quant', endpoint: '/api/a2a/alpha-quant', status: 'ready' },
      { id: 'sentiment',   endpoint: '/api/a2a/sentiment',   status: 'ready' },
      { id: 'risk',        endpoint: '/api/a2a/risk',        status: 'ready' },
      { id: 'execution',   endpoint: '/api/a2a/execution',   status: 'ready' },
    ],
    omega: synthesis
      ? {
          globalModifier: synthesis.globalModifier,
          directionBias: synthesis.directionBias,
          aggregatedWR: synthesis.aggregatedWR,
          aggregatedPF: synthesis.aggregatedPF,
          strongSymbols: synthesis.strongSymbols,
          weakSymbols: synthesis.weakSymbols,
          gladiatorsUsed: synthesis.gladiatorsUsed,
          summary,
        }
      : { status: 'dormant', summary },
    accepts: 'POST { symbol, indicators?, posts?, currentEquity?, openPositions?, dailyLossCount?, executeLive? }',
  });
}
