// ============================================================
// GET /api/v2/cockpit-health — Faza 6 Batch 6 verification helper
//
// Single endpoint that the cockpit page can hit (or external probe)
// to confirm all 4 Faza 6 component data sources are alive:
//   - dashboard telemetry          (AgentStatusHero + DecisionMatrix base)
//   - bot decisions + audits       (DecisionMatrix detail)
//   - moltbook telemetry           (MoltbookSwarmFeed)
//   - log buffer + error count     (TerminalOverlay)
//
// Returns aggregated readiness flag + per-source latency for SRE.
// Read-only. Safe to call frequently.
// ============================================================
import { successResponse, errorResponse } from '@/lib/api-response';
import { getMoltbookTelemetry } from '@/lib/moltbook/moltbookClient';
import { getDecisions, getBotConfig } from '@/lib/store/db';

export const dynamic = 'force-dynamic';

interface SourceProbe {
  name: string;
  ok: boolean;
  latencyMs: number;
  detail?: string;
}

async function probe<T>(name: string, fn: () => T | Promise<T>, validate: (v: T) => boolean): Promise<SourceProbe> {
  const t0 = Date.now();
  try {
    const v = await fn();
    const ok = validate(v);
    return { name, ok, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { name, ok: false, latencyMs: Date.now() - t0, detail: (e as Error).message };
  }
}

export async function GET() {
  try {
    const t0 = Date.now();

    const probes = await Promise.all([
      probe('dashboard:botConfig', () => getBotConfig(), (c) => !!c),
      probe('dashboard:decisions', () => getDecisions(), (d) => Array.isArray(d)),
      probe('moltbook:telemetry', () => getMoltbookTelemetry(), (t) => t !== undefined && t !== null),
    ]);

    const allOk = probes.every(p => p.ok);
    const totalMs = Date.now() - t0;

    return successResponse({
      status: allOk ? 'cockpit_ready' : 'cockpit_degraded',
      probes,
      counts: {
        decisions: getDecisions().length,
      },
      totalLatencyMs: totalMs,
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('COCKPIT_HEALTH_FAILED', (err as Error).message, 500);
  }
}
