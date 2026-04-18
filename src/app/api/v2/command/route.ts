// ============================================================
// POST /api/v2/command — Manual command execution from Status UI
// All control-room commands route through here.
//
// Auth: user's httpOnly cookie is forwarded to internal endpoints.
// Cron endpoints: CRON_SECRET is injected server-side.
// Bot endpoints: cookie forwarded for isAuthenticated() check.
// ============================================================
import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { engageKillSwitch, disengageKillSwitch, getKillSwitchState, resetDailyTriggers } from '@/lib/core/killSwitch';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { watchdogPing, getWatchdogState } from '@/lib/core/watchdog';
import { startHeartbeat, getFreshHealthSnapshot } from '@/lib/core/heartbeat';
import { isAuthenticated } from '@/lib/auth';
// FIX 2026-04-18 (QW-5): agents:status folosea internalFetch (self-fetch HTTP) spre
// /api/a2a/orchestrate. Cloud Run loop-back esueaza intermitent. Import direct handler-ul
// GET si apel in-process — acelasi pattern ca fix-ul /api/health.
import { GET as a2aOrchestrateGET } from '../../a2a/orchestrate/route';

export const dynamic = 'force-dynamic';
const log = createLogger('CommandCenter');

interface CommandResult {
  ok: boolean;
  command: string;
  message: string;
  data?: unknown;
  durationMs: number;
}

/** Build headers that forward the user's auth cookie to internal endpoints */
function authHeaders(request: Request): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const cookie = request.headers.get('cookie');
  if (cookie) h['cookie'] = cookie;
  const authHeader = request.headers.get('authorization');
  if (authHeader) h['authorization'] = authHeader;
  return h;
}

/** Build headers for cron endpoints — use CRON_SECRET via both header styles.
 * Some cron routes check `x-cron-secret`, others check `Authorization: Bearer`. Send both. */
function cronHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = process.env.CRON_SECRET;
  if (secret) {
    h['x-cron-secret'] = secret;
    h['authorization'] = `Bearer ${secret}`;
  }
  return h;
}

/** Safe internal fetch with timeout */
async function internalFetch(url: URL, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  return res.json();
}

// FIX 2026-04-18: Comenzile read-only (status/diag) sunt exceptate de auth cookie pentru ca UI-ul
// să poată afișa diagnostic chiar când sesiunea user a expirat. Mutațiile (engage/set/evaluate) rămân auth-ed.
// Motiv: UI raporta FAIL Unauthorized pe omega:status / diag:full / diag:signal-quality după expirarea sesiunii.
const READ_ONLY_COMMANDS = new Set<string>([
  'omega:status',
  'diag:full',
  'diag:signal-quality',
  'arena:status',
  'agents:status',
  'killswitch:status',
  'heartbeat:status',
]);

export async function POST(request: Request): Promise<NextResponse<CommandResult>> {
  const start = Date.now();

  let body: { command: string; params?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, command: '?', message: 'Invalid JSON', durationMs: Date.now() - start }, { status: 400 });
  }

  const { command, params } = body;

  // Auth check — gated după ce știm ce comandă a fost cerută; read-only poate trece fără cookie.
  if (!READ_ONLY_COMMANDS.has(command) && !isAuthenticated(request)) {
    return NextResponse.json({ ok: false, command, message: 'Unauthorized', durationMs: Date.now() - start }, { status: 401 });
  }
  log.info(`[CMD] Executing: ${command}`, { params });

  const baseUrl = new URL(request.url).origin;
  const auth = authHeaders(request);
  const cron = cronHeaders();

  try {
    switch (command) {
      // ─── KILL SWITCH (direct function calls — no fetch needed) ───
      case 'killswitch:engage': {
        const reason = String(params?.reason || 'Manual kill switch from Control Room');
        await engageKillSwitch(reason, false);
        return ok(command, 'Kill switch ENGAGED. All positions being liquidated.', getKillSwitchState(), start);
      }
      case 'killswitch:disengage': {
        disengageKillSwitch();
        return ok(command, 'Kill switch disengaged. Trading can resume.', getKillSwitchState(), start);
      }
      case 'killswitch:status': {
        return ok(command, 'Kill switch state retrieved', getKillSwitchState(), start);
      }

      // ─── WATCHDOG / HEARTBEAT (direct function calls) ───
      case 'watchdog:ping': {
        watchdogPing();
        return ok(command, 'Watchdog pinged', getWatchdogState(), start);
      }
      case 'heartbeat:start': {
        startHeartbeat();
        return ok(command, 'Heartbeat started', getFreshHealthSnapshot(), start);
      }
      case 'heartbeat:status': {
        return ok(command, 'Heartbeat snapshot', getFreshHealthSnapshot(), start);
      }

      // ─── DIAGNOSTICS (GET endpoints — no auth required) ───
      case 'diag:full': {
        const [healthRes, diagRes, credRes] = await Promise.allSettled([
          internalFetch(new URL('/api/v2/health', baseUrl)),
          internalFetch(new URL('/api/diagnostics/master', baseUrl)),
          internalFetch(new URL('/api/diagnostics/credits', baseUrl)),
        ]);
        return ok(command, 'Full diagnostics collected', {
          health: healthRes.status === 'fulfilled' ? healthRes.value : null,
          master: diagRes.status === 'fulfilled' ? diagRes.value : null,
          credits: credRes.status === 'fulfilled' ? credRes.value : null,
        }, start);
      }
      case 'diag:signal-quality': {
        const res = await internalFetch(new URL('/api/diagnostics/signal-quality', baseUrl));
        return ok(command, 'Signal quality report', res, start);
      }

      // ─── AGENT ORCHESTRATION (no auth on GET, swarm token on POST) ───
      case 'agents:status': {
        // FIX 2026-04-18 (QW-5): in-process call vs self-fetch HTTP.
        const response = await a2aOrchestrateGET();
        const res = await response.json();
        return ok(command, 'Swarm orchestrator status', res, start);
      }
      case 'agents:orchestrate': {
        const symbol = String(params?.symbol || 'BTCUSDT');
        const swarmHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (process.env.SWARM_TOKEN) swarmHeaders['x-swarm-token'] = process.env.SWARM_TOKEN;
        const res = await internalFetch(new URL('/api/a2a/orchestrate', baseUrl), {
          method: 'POST',
          headers: swarmHeaders,
          body: JSON.stringify({ symbol, executeLive: false }),
        });
        return ok(command, `Orchestration for ${symbol} completed`, res, start);
      }

      // ─── BOT CONTROL (POST — needs auth cookie forwarded) ───
      case 'bot:evaluate': {
        const res = await internalFetch(new URL('/api/bot', baseUrl), {
          method: 'POST', headers: auth,
          body: JSON.stringify({ action: 'evaluate' }),
        });
        return ok(command, 'Evaluation triggered', res, start);
      }
      case 'bot:recalculate': {
        const res = await internalFetch(new URL('/api/bot', baseUrl), {
          method: 'POST', headers: auth,
          body: JSON.stringify({ action: 'recalculate' }),
        });
        return ok(command, 'Performance recalculated', res, start);
      }
      case 'bot:trigger-promoter': {
        const res = await internalFetch(new URL('/api/bot', baseUrl), {
          method: 'POST', headers: auth,
          body: JSON.stringify({ action: 'trigger-promoter' }),
        });
        return ok(command, 'Promoter broadcast triggered', res, start);
      }

      // ─── TRADING MODE (POST — needs auth) ───
      case 'mode:set': {
        const mode = String(params?.mode || 'PAPER');
        const res = await internalFetch(new URL('/api/bot', baseUrl), {
          method: 'POST', headers: auth,
          body: JSON.stringify({ action: 'configure', config: { mode } }),
        });
        return ok(command, `Mode set to ${mode}`, res, start);
      }

      // ─── DATA COLLECTION (cron endpoints — need CRON_SECRET) ───
      case 'collect:sentiment': {
        const res = await internalFetch(new URL('/api/v2/cron/sentiment', baseUrl), { headers: cron }).catch(() => ({ error: 'failed' }));
        return ok(command, 'Sentiment collection triggered', res, start);
      }
      case 'collect:positions': {
        const res = await internalFetch(new URL('/api/v2/cron/positions', baseUrl), { headers: cron }).catch(() => ({ error: 'failed' }));
        return ok(command, 'Position snapshot triggered', res, start);
      }
      case 'collect:news': {
        const res = await internalFetch(new URL('/api/v2/intelligence/news', baseUrl)).catch(() => ({ error: 'failed' }));
        return ok(command, 'News collection triggered', res, start);
      }

      // ─── GLADIATOR ARENA (cron endpoints) ───
      case 'arena:promote': {
        const res = await internalFetch(new URL('/api/v2/cron/auto-promote', baseUrl), { headers: cron }).catch(() => ({ error: 'failed' }));
        return ok(command, 'Auto-promote cycle triggered', res, start);
      }
      case 'arena:status': {
        const res = await internalFetch(new URL('/api/v2/arena', baseUrl)).catch(() => ({ error: 'failed' }));
        return ok(command, 'Arena status retrieved', res, start);
      }

      // ─── POLYMARKET (cron endpoints — need CRON_SECRET) ───
      case 'poly:scan': {
        const res = await internalFetch(new URL('/api/v2/polymarket/cron/scan', baseUrl), { headers: cron }).catch(() => ({ error: 'failed' }));
        return ok(command, 'Polymarket scan triggered', res, start);
      }
      case 'poly:mtm': {
        const res = await internalFetch(new URL('/api/v2/polymarket/cron/mtm', baseUrl), { headers: cron }).catch(() => ({ error: 'failed' }));
        return ok(command, 'Mark-to-market triggered', res, start);
      }

      // ─── RESET / MAINTENANCE (direct function calls) ───
      case 'reset:daily-triggers': {
        resetDailyTriggers();
        return ok(command, 'Daily triggers reset', getKillSwitchState(), start);
      }

      // ─── GLADIATORS RESET-STATS (post-QW-7 recovery; auth-required) ───
      // Șterge stats poluate pre-QW-7 și demotează toți la IN_TRAINING. Safe: gladiatorii
      // vor reacumula stats prin phantoms curente (TP/SL simetric). Fail-safe: nimeni LIVE
      // până nu atinge din nou threshold-ul institutional (trades>=20, WR>=45, PF>=1.1).
      case 'gladiators:reset-stats': {
        const reason = String(params?.reason || 'manual-admin-reset-post-qw7');
        const result = gladiatorStore.resetAllStats(reason);
        log.warn(`[CMD] Gladiators stats reset: ${result.affected} affected. Reason: ${reason}`);
        return ok(command, `Reset ${result.affected} gladiators (reason: ${reason})`, result, start);
      }

      // ─── OMEGA STATUS (GET — no auth) ───
      case 'omega:status': {
        const res = await internalFetch(new URL('/api/v2/omega-status', baseUrl)).catch(() => ({ error: 'failed' }));
        return ok(command, 'Omega status retrieved', res, start);
      }

      case 'cron:kick': {
        const res = await internalFetch(new URL('/api/cron', baseUrl), { headers: cronHeaders() }).catch(() => ({ error: 'failed' }));
        return ok(command, 'Cron loop kicked', res, start);
      }

      default:
        return NextResponse.json({ ok: false, command, message: `Unknown command: ${command}`, durationMs: Date.now() - start }, { status: 400 });
    }
  } catch (err) {
    log.error(`[CMD] Failed: ${command}`, { error: (err as Error).message });
    return NextResponse.json({ ok: false, command, message: (err as Error).message, durationMs: Date.now() - start }, { status: 500 });
  }
}

function ok(command: string, message: string, data: unknown, start: number): NextResponse<CommandResult> {
  return NextResponse.json({ ok: true, command, message, data, durationMs: Date.now() - start });
}
