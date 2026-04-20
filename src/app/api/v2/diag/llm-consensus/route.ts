// ============================================================
// /api/v2/diag/llm-consensus — FAZA 3 Batch 9/9
// ============================================================
// Diagnostic endpoint for multi-LLM shadow consensus layer.
// PURE READ (GET) / MANUAL TEST (POST). No effect on OMNI-X decisions.
//
// GET   → config + live telemetry (budget, rate-limit, per-provider stats,
//         aggregate vote distribution, divergenceFromPrimary counter).
// POST  → body = ConsensusInput (manual test). Fires 3 providers in
//         parallel, returns ProviderVote[] + aggregate. Subject to the
//         same gates as production callers (mode, sample, budget, rate).
//
// Requires: middleware auth (same pattern as other /api/v2/diag/* routes).
//
// Examples:
//   curl -H "Authorization: Bearer $JWT" .../api/v2/diag/llm-consensus
//
//   curl -X POST .../api/v2/diag/llm-consensus \
//     -H 'content-type: application/json' \
//     -H "Authorization: Bearer $JWT" \
//     -d '{"symbol":"BTCUSDT","proposedDirection":"LONG",
//          "primaryConfidence":0.55,"regime":"trend_up",
//          "indicators":{"rsi":58,"vwapDeviation":0.4,"volumeZ":1.2}}'
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  runConsensus,
  getConsensusTelemetry,
  type ConsensusInput,
} from '@/lib/v2/debate/multiLlmConsensus';
import { createLogger } from '@/lib/core/logger';

export const dynamic = 'force-dynamic';

const log = createLogger('DiagLlmConsensus');

export async function GET() {
  try {
    const telemetry = getConsensusTelemetry();
    // Surface-level sanity flags for the operator.
    const { config, ...rest } = telemetry;
    const sanity = {
      budgetHit: !!rest.budgetHitAt,
      underBudget: rest.costRunningUsdToday < (config.dailyBudgetUsd as number),
      hasKeys: (config.providers as Array<{ keyPresent: boolean }>).every((p) => p.keyPresent),
      anyCircuitOpen: Object.values(rest.perProvider).some(
        (s) => (s as { consecFailures: number }).consecFailures >= 5
      ),
    };
    return NextResponse.json({
      success: true,
      config,
      telemetry: rest,
      sanity,
    });
  } catch (err) {
    log.error('diag/llm-consensus GET failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

function isValidDirection(x: unknown): x is 'LONG' | 'SHORT' {
  return x === 'LONG' || x === 'SHORT';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<ConsensusInput>;

    // Minimal validation — tolerant, since this is a manual diag surface.
    const violations: string[] = [];
    if (!body.symbol || typeof body.symbol !== 'string') {
      violations.push('symbol:required-string');
    }
    if (!isValidDirection(body.proposedDirection)) {
      violations.push('proposedDirection:must-be-LONG-or-SHORT');
    }
    const conf = Number(body.primaryConfidence);
    if (!Number.isFinite(conf) || conf < 0 || conf > 1) {
      violations.push('primaryConfidence:must-be-0..1');
    }
    if (violations.length > 0) {
      return NextResponse.json(
        { success: false, error: 'validation_failed', violations },
        { status: 400 },
      );
    }

    // Coerce to full ConsensusInput (narrow type now that we validated).
    const input: ConsensusInput = {
      symbol: body.symbol as string,
      proposedDirection: body.proposedDirection as 'LONG' | 'SHORT',
      primaryConfidence: conf,
      regime: (body.regime ?? null) as string | null,
      indicators: body.indicators ?? {},
    };

    const result = await runConsensus(input);

    return NextResponse.json({
      success: true,
      input,
      result,
    });
  } catch (err) {
    log.error('diag/llm-consensus POST failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
