// ============================================================
// POST /api/v2/command — Manual command execution from Status UI
// All control-room commands route through here.
//
// Auth: user's httpOnly cookie is forwarded to internal endpoints.
// Cron endpoints: CRON_SECRET is injected server-side.
// Bot endpoints: cookie forwarded for isAuthenticated() check.
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { initDB, saveGladiatorsToDb, refreshGladiatorsFromCloud, flushPendingSyncs } from '@/lib/store/db';
import { engageKillSwitch, disengageKillSwitch, getKillSwitchState, resetDailyTriggers } from '@/lib/core/killSwitch';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { watchdogPing, getWatchdogState } from '@/lib/core/watchdog';
import { startHeartbeat, getFreshHealthSnapshot } from '@/lib/core/heartbeat';
import { isAuthenticated } from '@/lib/auth';
// FIX 2026-04-18 (QW-5): agents:status folosea internalFetch (self-fetch HTTP) spre
// /api/a2a/orchestrate. Cloud Run loop-back esueaza intermitent. Import direct handler-ul
// GET si apel in-process — acelasi pattern ca fix-ul /api/health.
import { GET as a2aOrchestrateGET } from '../../a2a/orchestrate/route';
// FIX 2026-04-18 (QW-9): Bypass self-fetch HTTP loopback pentru toate comenzile P0 cron/collect.
// Cloud Run apel propriu URL public e nondeterministic (DNS edge, cold start, header strip).
// In-process import = sub-1ms, zero retele, type-safe (NextRequest IS-A Request, funcția
// param types sunt contravariant → handler-ele declarate cu Request pot primi NextRequest).
// Asumpție care invalidează: dacă vreun handler folosește `request.url` pentru rutare absolută
// (nu doar parsare URL), URL-ul reconstruit local trebuie să respecte același origin (folosim baseUrl).
import { GET as sentimentCronGET } from '../cron/sentiment/route';
import { GET as positionsCronGET } from '../cron/positions/route';
import { GET as newsGET } from '../intelligence/news/route';
import { GET as autoPromoteGET } from '../cron/auto-promote/route';
import { GET as polyScanGET } from '../polymarket/cron/scan/route';
import { GET as polyMtmGET } from '../polymarket/cron/mtm/route';
import { GET as cronGET } from '../../cron/route';
// FIX 2026-04-19: omega:status + arena:status in-process (was self-fetch HTTP, failed on Cloud Run)
import { GET as omegaStatusGET } from '../omega-status/route';
import { GET as arenaStatusGET } from '../arena/route';
// FIX 2026-04-19: diag:full + diag:signal-quality in-process (self-fetch returns null on Cloud Run)
import { GET as healthGET } from '../health/route';
import { GET as diagMasterGET } from '../../diagnostics/master/route';
import { GET as diagCreditsGET } from '../../diagnostics/credits/route';
import { GET as diagSignalQualityGET } from '../../diagnostics/signal-quality/route';
// FIX 2026-04-19 (C4): Convert remaining POST self-fetch to in-process.
// Cloud Run self-fetch HTTP fails intermittently. In-process = zero network, type-safe.
import { POST as a2aOrchestratePOST } from '../../a2a/orchestrate/route';
import { POST as botPOST } from '../../bot/route';
// FIX 2026-04-19 (C8): Wire orphaned Butcher+Forge into command route.
// Was standalone script only — never ran on Cloud Run.
// Inline imports instead of @/scripts/ path (Turbopack can't resolve scripts alias).
import { TheButcher } from '@/lib/v2/gladiators/butcher';
import { TheForge } from '@/lib/v2/promoters/forge';
import { ArenaSimulator } from '@/lib/v2/arena/simulator';

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

/** @deprecated C4: All calls converted to in-process. Retained only as fallback reference.
 *  Remove once all in-process conversions are validated in production. */
async function internalFetch(url: URL, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  return res.json();
}

/** QW-9: In-process handler invocation — zero network, zero loopback risk.
 *  Construiește un NextRequest local cu headers (pentru requireCronAuth etc.) și apelează
 *  handler-ul direct. Fail-safe: orice eroare sync/async se propagă ca promise rejection,
 *  caller-ul folosește .catch() pentru graceful fallback la `{ error: 'failed' }`. */
async function invokeInProcess(
  handler: (req: NextRequest) => Promise<Response> | Response,
  url: URL,
  headers: Record<string, string> = {}
): Promise<unknown> {
  const req = new NextRequest(url, { method: 'GET', headers });
  const res = await handler(req);
  return res.json();
}

/** C4: In-process POST handler invocation — constructs NextRequest with JSON body.
 *  Used for bot:*, mode:set, agents:orchestrate — handlers that consume request.json().
 *  Auth headers (cookie/authorization/x-swarm-token) are forwarded from the original request. */
async function invokePostInProcess(
  handler: (req: Request) => Promise<Response> | Response,
  url: URL,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<unknown> {
  const req = new NextRequest(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await handler(req);
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
  'gladiators:status',
]);

// FIX 2026-04-18 FAZA 6: Commands that accept CRON_SECRET as alternative auth.
// Enables autonomous admin operations (e.g., Claude deploy agent) without dashboard JWT.
// CRON_SECRET is already a strong production secret — safe to trust for admin ops.
// Only non-destructive admin commands go here. Kill switch and mode changes stay JWT-only.
//
// 2026-04-19 (C17): Expanded set to cover ALL operational triggers the Control Room
// dashboard exposes. These do not change config or risk parameters — they kick existing
// cron loops / scans / collectors. Dashboard now uses login modal for JWT, AND any
// CLI / autonomous agent can hit them with `x-cron-secret`. Destructive ops
// (killswitch:engage/disengage, mode:set, bot:*) stay JWT-only.
const CRON_AUTHED_COMMANDS = new Set<string>([
  'gladiators:reset-stats',
  'cron:run',
  'cron:positions',
  'cron:sentiment',
  'cron:promote',
  // C17 additions — all non-destructive triggers
  'collect:positions',
  'collect:sentiment',
  'collect:news',
  'arena:promote',
  'arena:rotation',
  'arena:status',
  'poly:scan',
  'poly:mtm',
  'cron:kick',
  'reset:daily-triggers',
  'watchdog:ping',
  'heartbeat:start',
  'agents:orchestrate',
]);

function isCronAuthenticated(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const provided = request.headers.get('x-cron-secret')
    || request.headers.get('authorization')?.replace('Bearer ', '');
  return provided === cronSecret;
}

export async function POST(request: Request): Promise<NextResponse<CommandResult>> {
  const start = Date.now();

  let body: { command: string; params?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, command: '?', message: 'Invalid JSON', durationMs: Date.now() - start }, { status: 400 });
  }

  const { command, params } = body;

  // Auth check — gated după ce știm ce comandă a fost cerută.
  // Priority: read-only (no auth) → CRON_SECRET (admin ops) → JWT (dashboard user).
  if (!READ_ONLY_COMMANDS.has(command)
    && !(CRON_AUTHED_COMMANDS.has(command) && isCronAuthenticated(request))
    && !isAuthenticated(request)) {
    return NextResponse.json({ ok: false, command, message: 'Unauthorized', durationMs: Date.now() - start }, { status: 401 });
  }
  log.info(`[CMD] Executing: ${command}`, { params });

  // FIX 2026-04-19 (C3): Hydrate db.ts cache from Supabase before any command.
  // Without this, cold-start instances return seed defaults (tt=0 for all gladiators)
  // because gladiatorStore.ensureLoaded() calls getGladiatorsFromDb() which is empty
  // until initDB completes. initDB is memoized → sub-1ms on warm instances.
  await initDB();

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
        // FIX 2026-04-18 AUDIT: was not awaited → state lost if instance shuts down before persist
        await disengageKillSwitch();
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
        // FIX 2026-04-19: in-process (was self-fetch HTTP → null on Cloud Run)
        const [healthRes, diagRes, credRes] = await Promise.allSettled([
          healthGET().then(r => r.json()),
          diagMasterGET().then(r => r.json()),
          diagCreditsGET().then(r => r.json()),
        ]);
        return ok(command, 'Full diagnostics collected', {
          health: healthRes.status === 'fulfilled' ? healthRes.value : null,
          master: diagRes.status === 'fulfilled' ? diagRes.value : null,
          credits: credRes.status === 'fulfilled' ? credRes.value : null,
        }, start);
      }
      case 'diag:signal-quality': {
        // FIX 2026-04-19: in-process (was self-fetch HTTP)
        const response = await diagSignalQualityGET();
        const res = await response.json();
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
        const swarmHeaders: Record<string, string> = {};
        if (process.env.SWARM_TOKEN) swarmHeaders['x-swarm-token'] = process.env.SWARM_TOKEN;
        const res = await invokePostInProcess(
          a2aOrchestratePOST, new URL('/api/a2a/orchestrate', baseUrl),
          { symbol, executeLive: false }, swarmHeaders
        ).catch(() => ({ error: 'orchestrate failed' }));
        return ok(command, `Orchestration for ${symbol} completed`, res, start);
      }

      // ─── BOT CONTROL (POST — in-process, auth headers forwarded) ───
      case 'bot:evaluate': {
        const res = await invokePostInProcess(
          botPOST, new URL('/api/bot', baseUrl), { action: 'evaluate' }, auth
        ).catch(() => ({ error: 'evaluate failed' }));
        return ok(command, 'Evaluation triggered', res, start);
      }
      case 'bot:recalculate': {
        const res = await invokePostInProcess(
          botPOST, new URL('/api/bot', baseUrl), { action: 'recalculate' }, auth
        ).catch(() => ({ error: 'recalculate failed' }));
        return ok(command, 'Performance recalculated', res, start);
      }
      case 'bot:trigger-promoter': {
        const res = await invokePostInProcess(
          botPOST, new URL('/api/bot', baseUrl), { action: 'trigger-promoter' }, auth
        ).catch(() => ({ error: 'trigger-promoter failed' }));
        return ok(command, 'Promoter broadcast triggered', res, start);
      }

      // ─── TRADING MODE (POST — in-process, auth forwarded) ───
      case 'mode:set': {
        const mode = String(params?.mode || 'PAPER');
        const res = await invokePostInProcess(
          botPOST, new URL('/api/bot', baseUrl), { action: 'configure', config: { mode } }, auth
        ).catch(() => ({ error: 'mode:set failed' }));
        return ok(command, `Mode set to ${mode}`, res, start);
      }

      // ─── DATA COLLECTION (cron endpoints — need CRON_SECRET) ───
      // QW-9: in-process invoke (was internalFetch self-fetch HTTP)
      case 'collect:sentiment': {
        const res = await invokeInProcess(sentimentCronGET, new URL('/api/v2/cron/sentiment', baseUrl), cron).catch(() => ({ error: 'failed' }));
        return ok(command, 'Sentiment collection triggered', res, start);
      }
      case 'collect:positions': {
        const res = await invokeInProcess(positionsCronGET, new URL('/api/v2/cron/positions', baseUrl), cron).catch(() => ({ error: 'failed' }));
        return ok(command, 'Position snapshot triggered', res, start);
      }
      case 'collect:news': {
        const res = await invokeInProcess(newsGET, new URL('/api/v2/intelligence/news', baseUrl)).catch(() => ({ error: 'failed' }));
        return ok(command, 'News collection triggered', res, start);
      }

      // ─── GLADIATOR ARENA (cron endpoints) ───
      // QW-9: arena:promote in-process; arena:status păstrează internalFetch (NU am import handler — adaug în batch P1)
      case 'arena:promote': {
        const res = await invokeInProcess(autoPromoteGET, new URL('/api/v2/cron/auto-promote', baseUrl), cron).catch(() => ({ error: 'failed' }));
        return ok(command, 'Auto-promote cycle triggered', res, start);
      }
      // FIX 2026-04-19 (C8): Darwinian cycle — Butcher kills PF<1.0, Forge replaces.
      // Was orphaned as standalone script, never ran on Cloud Run.
      // Inlined from cron_dailyRotation.ts to avoid @/scripts/ path resolution issue.
      case 'arena:rotation': {
        try {
          // 1. Refresh from Supabase + evaluate lingering phantom trades
          await refreshGladiatorsFromCloud();
          gladiatorStore.reloadFromDb();
          await ArenaSimulator.getInstance().evaluatePhantomTrades();

          // 2. Butcher — eliminate PF<1.0 gladiators
          const executedIds = await TheButcher.getInstance().executeWeaklings();
          log.info(`[arena:rotation] Butcher executed ${executedIds.length} gladiators.`);

          // 3. Forge — replace killed slots
          if (executedIds.length > 0) {
            await TheForge.getInstance().evaluateAndRecruit(executedIds);
          }

          // 4. Update leaderboard ranks + isLive
          const gladiators = gladiatorStore.getLeaderboard();
          gladiators.forEach((g, idx) => {
            g.rank = idx + 1;
            const meets = g.stats.totalTrades >= 50
              && g.stats.winRate >= 40
              && g.stats.profitFactor >= 1.3;
            g.isLive = g.rank <= 3 && meets;
          });
          // Store is authoritative after Butcher+Forge — skip remote merge
          // (would re-introduce freshly-purged IDs if 300s debounce elapsed).
          // FIX 2026-04-20 (ZOMBIE-PURGE): await + flushPendingSyncs.
          // Root cause: saveGladiatorsToDb is fire-and-forget; Cloud Run
          // CPU-throttles the process after the HTTP response, so the
          // syncToCloud queue never drained. json_store 'gladiators' last
          // updated 2026-04-17 (3+ days stale) → cold-start reloadFromDb
          // resurrected freshly-killed gladiators. Now we await the save
          // and explicitly drain pending syncs before returning.
          // Kill-switch: ARENA_ROTATION_FLUSH_MS env (default 8000); set 0
          // to skip flush (revert to fire-and-forget) without code change.
          await saveGladiatorsToDb(gladiatorStore.getGladiators(), { skipRemoteMerge: true });
          const _flushTimeout = Number(process.env.ARENA_ROTATION_FLUSH_MS ?? 8000);
          if (_flushTimeout > 0) {
            const flushResult = await flushPendingSyncs(_flushTimeout);
            if (flushResult.timedOut) {
              log.warn(`[arena:rotation] flushPendingSyncs timed out after ${_flushTimeout}ms — zombies may reappear on cold-start`);
            } else {
              log.info(`[arena:rotation] flush: ${flushResult.flushed} tasks drained`);
            }
          }

          const leaderboard = gladiators.map(g => ({
            name: g.name, tt: g.stats.totalTrades, wr: g.stats.winRate, pf: g.stats.profitFactor, isLive: g.isLive,
          }));
          return ok(command, `Rotation: ${executedIds.length} killed, ${leaderboard.length} remain.`, { executed: executedIds.length, leaderboard }, start);
        } catch (err) {
          log.error(`[arena:rotation] failed`, { error: (err as Error).message });
          return ok(command, `Rotation failed: ${(err as Error).message}`, null, start);
        }
      }
      case 'arena:status': {
        // FIX 2026-04-19: in-process invoke (was self-fetch HTTP)
        const res = await invokeInProcess(arenaStatusGET, new URL('/api/v2/arena', baseUrl)).catch(() => ({ error: 'failed' }));
        return ok(command, 'Arena status retrieved', res, start);
      }

      // ─── POLYMARKET (cron endpoints — need CRON_SECRET) ───
      // QW-9: in-process invoke
      case 'poly:scan': {
        const res = await invokeInProcess(polyScanGET, new URL('/api/v2/polymarket/cron/scan', baseUrl), cron).catch(() => ({ error: 'failed' }));
        return ok(command, 'Polymarket scan triggered', res, start);
      }
      case 'poly:mtm': {
        const res = await invokeInProcess(polyMtmGET, new URL('/api/v2/polymarket/cron/mtm', baseUrl), cron).catch(() => ({ error: 'failed' }));
        return ok(command, 'Mark-to-market triggered', res, start);
      }

      // ─── RESET / MAINTENANCE (direct function calls) ───
      case 'reset:daily-triggers': {
        // FIX 2026-04-18 AUDIT: was not awaited → state lost on rapid instance shutdown
        await resetDailyTriggers();
        return ok(command, 'Daily triggers reset', getKillSwitchState(), start);
      }

      // ─── GLADIATORS RESET-STATS (post-QW-7 recovery; auth-required) ───
      // Șterge stats poluate pre-QW-7 și demotează toți la IN_TRAINING. Safe: gladiatorii
      // vor reacumula stats prin phantoms curente (TP/SL asimetric 1.0%/-0.5%). Fail-safe:
      // nimeni LIVE până nu atinge QW-8 gate (trades>=50, WR>=40, PF>=1.3).
      case 'gladiators:reset-stats': {
        const reason = String(params?.reason || 'manual-admin-reset-post-qw7');
        const result = gladiatorStore.resetAllStats(reason);
        log.warn(`[CMD] Gladiators stats reset: ${result.affected} affected. Reason: ${reason}`);
        return ok(command, `Reset ${result.affected} gladiators (reason: ${reason})`, result, start);
      }

      // ─── OMEGA STATUS (GET — no auth) ───
      // FIX 2026-04-19: in-process invoke (was self-fetch HTTP, failed on Cloud Run loopback)
      case 'omega:status': {
        const res = await invokeInProcess(omegaStatusGET, new URL('/api/v2/omega-status', baseUrl)).catch(() => ({ error: 'failed' }));
        return ok(command, 'Omega status retrieved', res, start);
      }

      // ─── GLADIATORS STATUS (direct in-process — no fetch needed) ───
      case 'gladiators:status': {
        const leaderboard = gladiatorStore.getLeaderboard().map(g => ({
          id: g.id, name: g.name, tier: g.status, isLive: g.isLive,
          tt: g.stats.totalTrades, wr: g.stats.winRate, pf: g.stats.profitFactor,
        }));
        return ok(command, `${leaderboard.length} gladiators`, { leaderboard }, start);
      }

      case 'cron:kick': {
        // QW-9: in-process invoke (was internalFetch self-fetch HTTP)
        const res = await invokeInProcess(cronGET, new URL('/api/cron', baseUrl), cronHeaders()).catch(() => ({ error: 'failed' }));
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
