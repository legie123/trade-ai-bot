// GET /api/cron — Trading loop trigger (kicks BTC engine + watchdog ping)
import { NextRequest, NextResponse } from 'next/server';
import { watchdogPing } from '@/lib/core/watchdog';
import { startHeartbeat } from '@/lib/core/heartbeat';
import { createLogger } from '@/lib/core/logger';
import { ArenaSimulator } from '@/lib/v2/arena/simulator';
import { DNAExtractor } from '@/lib/v2/superai/dnaExtractor';
import { initDB } from '@/lib/store/db';

const log = createLogger('CronLoop');

export const dynamic = 'force-dynamic';

let loopStarted = false;

export async function GET(request: NextRequest) {
  // Auth: require CRON_SECRET header (Railway/Vercel cron must send it)
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET env var not set — blocking all cron requests');
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const auth = request.headers.get('authorization') || request.headers.get('x-cron-secret') || request.nextUrl.searchParams.get('secret');
  if (auth !== cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized. Set x-cron-secret header.' }, { status: 401 });
  }
  try {
    // CRITICAL: Load Supabase cache (gladiators, decisions, etc.) before anything runs
    await initDB();

    // FIX: Refresh gladiators from Supabase every tick.
    // initDB runs once, but gladiator status (isLive, ACTIVE) may change
    // via Supabase dashboard or external tools between ticks.
    try {
      const { refreshGladiatorsFromCloud } = await import('@/lib/store/db');
      const { gladiatorStore } = await import('@/lib/store/gladiatorStore');
      await refreshGladiatorsFromCloud();
      gladiatorStore.reloadFromDb();
    } catch (err) {
      log.warn('Failed to refresh gladiators from cloud', { error: String(err) });
    }

    // Ensure heartbeat + WS feeds are running
    if (!loopStarted) {
      startHeartbeat();

      // Start WebSocket feeds for real-time price data
      try {
        const { WsStreamManager } = await import('@/lib/providers/wsStreams');
        WsStreamManager.getInstance().connect();
        log.info('MEXC WebSocket feed started');
      } catch (err) { log.warn('MEXC WS start failed', { error: String(err) }); }

      try {
        const { polyWsClient } = await import('@/lib/polymarket/polyWsClient');
        polyWsClient.connect();
        log.info('Polymarket WebSocket feed started');
      } catch (err) { log.warn('Polymarket WS start failed', { error: String(err) }); }

      loopStarted = true;
      log.info('Cron loop initialized — heartbeat + WS feeds started');
    }

    // AUDIT FIX C6b (2026-04-18): Check WS health every tick. If any feed reports
    // disconnected (ws dropped after init, zombie state, Cloud Run cold-start race,
    // container cycle without module re-init), force a reconnect. Closes the
    // "loopStarted=true forever but WS dead" failure mode observed live on 2026-04-18
    // where activeStreams=20 but connected=false for hours.
    // ASSUMPTION: connect() is idempotent (C6a guard cleans zombie refs before reconnect).
    try {
      const { WsStreamManager } = await import('@/lib/providers/wsStreams');
      const mexcHealth = WsStreamManager.getInstance().getFeedHealth();
      if (!mexcHealth.connected) {
        log.warn(`[WS Health] MEXC disconnected — forcing reconnect. stale=${mexcHealth.stale}, lastMsgAgo=${mexcHealth.lastMessageAgoMs}`);
        WsStreamManager.getInstance().connect();
      }
    } catch (err) { log.warn('WS health check (MEXC) failed', { error: String(err) }); }

    try {
      const { polyWsClient } = await import('@/lib/polymarket/polyWsClient');
      // polyWsClient.connect() must be idempotent on its own side
      polyWsClient.connect();
    } catch (err) { log.warn('WS health check (Polymarket) failed', { error: String(err) }); }

    // AUDIT FIX C1 (2026-04-18): Per-tick safety gate orchestration.
    //   - ensureDailyReset: idempotent per-UTC-day reset of dailyLoss/exposure/velocity flags
    //   - Tick-level daily-loss watchdog: even without a new trade opening, if today's
    //     closed positions drag equity below the limit, engage kill switch.
    // Fire-and-forget for the tick-level check — do NOT block the cron loop.
    try {
      const { ensureDailyReset, computeDailyLossPercent } = await import('@/lib/core/safetyGates');
      const { checkDailyLossLimit } = await import('@/lib/core/killSwitch');
      await ensureDailyReset();
      const dailyLoss = computeDailyLossPercent();
      if (dailyLoss > 0) {
        const DAILY_LIMIT = parseFloat(process.env.KILL_SWITCH_DAILY_LOSS_PCT || '5');
        // fire-and-forget — check handles its own state
        checkDailyLossLimit(dailyLoss, DAILY_LIMIT).catch(() => { /* ignore */ });
      }
    } catch (err) { log.warn('Safety gate tick check failed', { error: String(err) }); }

    // Ping watchdog to keep it alive
    watchdogPing();

    // Mark scan loop as active via globalThis
    const gScan = globalThis as unknown as {
      __autoScan?: { running: boolean; lastScanAt: string | null; scanCount: number };
    };
    if (!gScan.__autoScan) {
      gScan.__autoScan = { running: false, lastScanAt: null, scanCount: 0 };
    }
    gScan.__autoScan.running = true;
    gScan.__autoScan.lastScanAt = new Date().toISOString();
    gScan.__autoScan.scanCount++;
    const scanStart = Date.now();

    // Evaluate Phantom Trades for the Arena Combat Engine
    await ArenaSimulator.getInstance().evaluatePhantomTrades();

    // Evaluate Live Positions (Asymmetric TP/SL Engine — supplements Cloud Scheduler)
    const { positionManager } = await import('@/lib/v2/manager/positionManager');
    await positionManager.evaluateLivePositions();

    // SRE Auto-Debug Diagnostics Check (Continuous ML Evaluation)
    try {
      const { autoDebugEngine } = await import('@/lib/v2/safety/autoDebugEngine');
      autoDebugEngine.runDeterministicDiagnostics().catch((e) => log.warn('autoDebug diagnostics failed', { error: String(e) }));
    } catch (e) {
      log.error('Failed to trigger AutoDebugEngine', { error: String(e) });
    }

    // Trigger Market Scanners (so the AI trades even when the user's browser is closed)
    try {
      // Fire directly using V8 internal JS context instead of looping back via Cloud Run HTTP
      const { GET: runBtc } = await import('@/app/api/btc-signals/route');
      const { GET: runSolana } = await import('@/app/api/solana-signals/route');
      const { GET: runMeme } = await import('@/app/api/meme-signals/route');

      // CRITICAL: await scanners — Cloud Run freezes process after response.
      // Fire-and-forget promises never complete on serverless.
      await Promise.allSettled([runBtc(), runSolana(), runMeme()]);
      log.info(`[Market Scanners] TA & Meme sweep completed via direct function calls`);
    } catch (e) {
      log.error('Failed to trigger background scanners', { error: String(e) });
    }

    // Evaluate Real/Shadow Main System Decisions
    const { getPendingDecisions, updateDecision, recalculatePerformance, appendToEquityCurve, getLivePositions, updateLivePosition } = await import('@/lib/store/db');
    // NOTE: getMexcPrices bypassed — see direct fetch loop below.

    const pending = getPendingDecisions();
    let mainDecisionsEvaluated = 0;

    // FIX 2026-04-18: 10min threshold was starving paper mode — freshly-issued
    // signals piled up to 100+ pending, never reaching eligibility. In PAPER
    // we want fast rotation (1min) so the dashboard reflects real evaluation
    // loops; in LIVE keep 10min to let positions prove out before marking.
    // Override with PAPER_PENDING_MIN_AGE_MIN / LIVE_PENDING_MIN_AGE_MIN.
    // ASSUMPTION: if this threshold is set too low and price feed is jittery,
    //             WIN/LOSS/NEUTRAL labels may be dominated by noise. The 0.3%
    //             WIN_THRESHOLD below is the safety floor that absorbs noise.
    const isPaper = (process.env.TRADING_MODE || 'PAPER').toUpperCase() === 'PAPER';
    const defaultMinAge = isPaper ? 1 : 10;
    const envKey = isPaper ? 'PAPER_PENDING_MIN_AGE_MIN' : 'LIVE_PENDING_MIN_AGE_MIN';
    const minAgeMin = Number(process.env[envKey]) || defaultMinAge;

    // Batch: fetch unique symbols once instead of per-decision
    const eligibleDecisions = pending.filter(dec => {
      const elapsedMin = (Date.now() - new Date(dec.timestamp).getTime()) / 60000;
      return elapsedMin > minAgeMin;
    });

    const uniqueSymbols = [...new Set(eligibleDecisions.map(d => d.symbol))];

    // Fetch all unique prices in parallel for decisions and live positions
    const livePos = getLivePositions().filter(p => p.status === 'OPEN');
    const liveSymbols = livePos.map(p => p.symbol);
    const allSymbols = [...new Set([...uniqueSymbols, ...liveSymbols])];

    // FIX: Decisions store 'BTC', MEXC returns 'BTCUSDT'. Normalize to MEXC format.
    const toMexc = (s: string) => s.endsWith('USDT') ? s : s + 'USDT';
    const mexcSymbols = allSymbols.map(toMexc);

    // PARALLEL PRICE FETCH 2026-04-18:
    // Previous implementation was strictly sequential (for-await loop) → ~300ms
    // per symbol × N symbols = multi-second serverless stalls that risked
    // Cloud Run request timeout. MEXC REST allows ~20 req/sec per IP; we keep
    // concurrency conservative at 8 with a 5s per-request budget.
    // ASSUMPTION: dedicated IP 149.174.89.163 is whitelisted (see memory).
    //             If IP rate-limit triggers 429, reduce CONCURRENCY.
    const rawPriceCache: Record<string, number> = {};
    // AUDIT FIX C2 (2026-04-18): Wire priceHistory → correlationGuard.
    // Previously recordPrice() existed but was never called → priceHistory empty
    // → correlation check always returned "no data, allow" → guard was decorative.
    // ASSUMPTION: one tick ≈ one price sample. For 100-sample LOOKBACK_CLOSES this
    // means ~100 ticks (~100 minutes at 1-tick/min cron) before correlation has signal.
    const { recordPrice } = await import('@/lib/v2/safety/correlationGuard');
    const fetchOne = async (sym: string) => {
      try {
        const resp = await fetch(
          'https://api.mexc.com/api/v3/ticker/price?symbol=' + encodeURIComponent(sym),
          { signal: AbortSignal.timeout(5000) }
        );
        const d = await resp.json() as { symbol?: string; price?: string };
        if (d.price) {
          const p = parseFloat(d.price);
          if (!isNaN(p) && p > 0) {
            rawPriceCache[sym] = p;
            recordPrice(sym, p); // feed correlationGuard
          }
        }
      } catch {
        // swallow — missing price means decision stays pending, not a failure
      }
    };
    const CONCURRENCY = 8;
    for (let i = 0; i < mexcSymbols.length; i += CONCURRENCY) {
      const batch = mexcSymbols.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map(fetchOne));
    }

    // Build dual-key cache: both 'BTCUSDT' and 'BTC' point to the same price
    const priceCache: Record<string, number> = {};
    for (const [mexcSym, price] of Object.entries(rawPriceCache)) {
      priceCache[mexcSym] = price;
      // Strip USDT suffix so dec.symbol ('BTC') lookups also work
      const base = mexcSym.endsWith('USDT') ? mexcSym.slice(0, -4) : mexcSym;
      priceCache[base] = price;
    }

    for (const dec of eligibleDecisions) {
      const currentPrice = priceCache[dec.symbol];
      if (!currentPrice || !dec.price) continue;

      const pnlDiff = (currentPrice - dec.price) / dec.price;
      const pnlPercent = (dec.action === 'LONG' || dec.action === 'BUY') ? pnlDiff * 100 : -pnlDiff * 100;

      // BUG FIX: Previous threshold was 0.05% — any micro-movement was a WIN.
      // In crypto, 0.05% moves in seconds → inflated win rates to ~80%+.
      // 0.3% is the minimum meaningful edge after fees (~0.1% MEXC taker).
      const WIN_THRESHOLD = 0.3;
      const outcome = pnlPercent > WIN_THRESHOLD ? 'WIN' : (pnlPercent < -WIN_THRESHOLD ? 'LOSS' : 'NEUTRAL');

      updateDecision(dec.id, {
         priceAfter15m: currentPrice,
         pnlPercent: parseFloat(pnlPercent.toFixed(4)),
         outcome,
         evaluatedAt: new Date().toISOString()
      });

      appendToEquityCurve({ ...dec, outcome }, pnlPercent);

      // DNA LEARNING: Inject pure Shadow mode experience into RL engine
      // Only log if the decision source belongs to a shadow gladiator (V2 Shadow)
      // AUDIT FIX C10d (2026-04-18): regex hardening
      //   - Validate gladiator ID format (alphanumeric + _ + -) to avoid
      //     capturing arbitrary text between parens (e.g. "V2 Shadow (test failed)").
      //   - If a source string accidentally contains multiple parens, only the
      //     first match is relevant. Regex is non-greedy → safe for first-capture.
      if (dec.source.includes('Shadow')) {
        const gladiatorIdMatch = dec.source.match(/\(([A-Za-z0-9_-]+)\)/);
        const elapsedMin = (Date.now() - new Date(dec.timestamp).getTime()) / 60000;
        if (gladiatorIdMatch && gladiatorIdMatch[1]) {
          try {
            await DNAExtractor.getInstance().logBattle({
              id: `shadow_${dec.id}`,
              gladiatorId: gladiatorIdMatch[1],
              symbol: dec.symbol,
              decision: dec.action as 'LONG' | 'SHORT' | 'FLAT',
              entryPrice: dec.price,
              outcomePrice: currentPrice,
              pnlPercent: parseFloat(pnlPercent.toFixed(4)),
              isWin: outcome === 'WIN',
              timestamp: Date.now(),
              marketContext: { exitType: 'SHADOW_TIME_BASED', holdTimeSec: elapsedMin * 60 }
            });
          } catch (err) {
             log.error(`Failed to inject shadow DNA for ${dec.id}`, { error: String(err) });
          }
        }
      }

      mainDecisionsEvaluated++;
    }

    // Update Floating PnL for live positions
    let livePositionsUpdated = 0;
    for (const pos of livePos) {
      if (priceCache[pos.symbol]) {
        updateLivePosition(pos.id, {
          currentPrice: priceCache[pos.symbol],
          highestPriceObserved: Math.max(pos.highestPriceObserved, priceCache[pos.symbol]),
          lowestPriceObserved: Math.min(pos.lowestPriceObserved, priceCache[pos.symbol])
        });
        livePositionsUpdated++;
      }
    }

    if (mainDecisionsEvaluated > 0) {
      recalculatePerformance();
      log.info(`[Trade AI] Resolved ${mainDecisionsEvaluated} main real/paper decisions. PnL recalibrated.`);
    }

    // Extract behaviors to The Forge (Omega Gladiator)
    const { extractWinningBehaviors } = await import('@/lib/v2/forge/dnaExtractor');
    const forgeStats = extractWinningBehaviors();

    // Mark scan as complete so heartbeat doesn't report RED
    gScan.__autoScan.running = false;

    // FIX: Cloud Run freezes process after HTTP response. All fire-and-forget
    // Supabase syncs (gladiator stats, phantom trades, DNA) must complete
    // BEFORE we return — otherwise stats are lost on instance restart/scale-down.
    const { flushPendingSyncs } = await import('@/lib/store/db');
    const flushResult = await flushPendingSyncs(4000);
    if (flushResult.timedOut) {
      log.warn('flushPendingSyncs timed out — some data may not have persisted');
    }

    return NextResponse.json({
      status: 'ok',
      message: 'Cron tick processed',
      scanCount: gScan.__autoScan.scanCount,
      durationMs: Date.now() - scanStart,
      mainDecisionsEvaluated,
      livePositionsUpdated,
      pricesFetched: Object.keys(priceCache).length,
      // Observability — helps diagnose "why is pending stuck?" fast
      pendingTotal: pending.length,
      pendingEligible: eligibleDecisions.length,
      minAgeMin,
      mode: isPaper ? 'PAPER' : 'LIVE',
      forgeProgress: forgeStats.progressPercent,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // Always reset running flag, even on error
    const gScanErr = globalThis as unknown as {
      __autoScan?: { running: boolean };
    };
    if (gScanErr.__autoScan) gScanErr.__autoScan.running = false;
    log.error('Cron loop error', { error: (err as Error).message });
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
