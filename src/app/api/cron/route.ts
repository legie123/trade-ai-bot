// GET /api/cron — Trading loop trigger (kicks BTC engine + watchdog ping)
import { NextRequest, NextResponse } from 'next/server';
import { watchdogPing } from '@/lib/core/watchdog';
import { startHeartbeat } from '@/lib/core/heartbeat';
import { createLogger } from '@/lib/core/logger';
import { ArenaSimulator } from '@/lib/v2/arena/simulator';
import { DNAExtractor, BattleRecord } from '@/lib/v2/superai/dnaExtractor';
import { OmegaEngine } from '@/lib/v2/superai/omegaEngine';
import { netPnlFromGross } from '@/lib/v2/fees/feeModel';
import { initDB, tryAcquireTaskLease, releaseTaskLease, getInstanceId } from '@/lib/store/db';
// A1 (2026-04-18) — Shadow stats unifier. Shadow decisions log to DNA (gladiator_battles)
// via DNAExtractor.logBattle() but were NOT incrementing gladiator.stats (totalTrades/winRate/PF).
// That created 76% battle-vs-stats gap + reported WR biased ~30pp HIGH over empirical.
// Fix: mirror simulator.ts:277 pattern — invoke updateGladiatorStats on WIN/LOSS only (skip NEUTRAL).
// ASUMPȚIE: NEUTRAL label (|pnl| ≤ WIN_THRESHOLD=0.3%) nu e trade închis — phantom simulator
// tratează analog (isNeutral → continue fără stats update). Consistent cu convenția existentă.
import { gladiatorStore } from '@/lib/store/gladiatorStore';
// FAZA 3/5 BATCH 1/4 (2026-04-19) — Shadow pnl sanity + clamp.
// Shadow MTM path at horizon eval was writing RAW pnl to DNA+stats, bypassing QW-11 clamp.
// Two guards:
//  (a) Sanity reject: |raw| > 20% → skip write + emit SHADOW_PNL_ANOMALY (price cache corruption).
//  (b) Soft clamp: pnl ∈ [-0.5, +1.0] for stats/DNA writes (aligned w/ simulator TP/SL convention).
//      horizonOutcomes keep RAW value (informational metric, not a trade outcome).
// ASUMPȚIE: în crypto 15m, move real >20% e extrem rar — pierderea unui sample acceptabilă.
// Dacă asumpția se rupe (flash pump real 25% in 15m), vedem SHADOW_PNL_ANOMALY event și re-calibrăm.
import { emitEvent } from '@/lib/v2/alerts/eventHub';
const SHADOW_PNL_SANITY_ABS = 20.0; // %
const SHADOW_TP_CLAMP = 1.0;         // %
const SHADOW_SL_CLAMP = -0.5;        // %

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

    // R5-lite (2026-04-18): Cross-instance cron idempotence.
    // `loopStarted` is module-scoped → NOT shared across Cloud Run instances.
    // When the service scales to >1 instance OR a new instance cold-starts while
    // the old one is still warm, BOTH received the same cron tick → duplicate
    // WS connects, duplicate scanners, duplicate DNA logs, duplicate trade attempts.
    // TTL=50s is tuned just below the 60s scheduler cadence: one instance wins
    // per tick; if it stalls >50s, the next instance can take over (desired).
    // ASSUMPTION: Cron scheduler fires ~every 60s. If cadence becomes faster,
    // lower TTL proportionally. On lease-held we return 200 (NOT 4xx) so the
    // scheduler does not escalate retries / alerts.
    // ORDER: lease BEFORE gladiator refresh — skip tick entirely if not leader
    // (saves a Supabase read per non-leader instance).
    const LEASE_TTL_MS = Number(process.env.CRON_LEASE_TTL_MS) || 50_000;
    const lease = await tryAcquireTaskLease('cron:main-tick', LEASE_TTL_MS);
    if (!lease.acquired) {
      return NextResponse.json({
        status: 'skipped',
        reason: 'lease-held-by-other-instance',
        holder: lease.holder,
        ownInstance: getInstanceId(),
        timestamp: new Date().toISOString(),
      });
    }
    const leaseDegraded = lease.degraded === true;

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 1: PARALLEL INIT (2026-04-18 perf)
    // Gladiator refresh, WS health, safety gates are independent — run together.
    // Saves ~1-2s vs sequential on every tick.
    // ═══════════════════════════════════════════════════════════════════

    // Ensure heartbeat + WS feeds on first tick (synchronous, fast)
    if (!loopStarted) {
      startHeartbeat();
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

    await Promise.allSettled([
      // (A) Refresh gladiators from Supabase
      (async () => {
        const { refreshGladiatorsFromCloud } = await import('@/lib/store/db');
        const { gladiatorStore } = await import('@/lib/store/gladiatorStore');
        await refreshGladiatorsFromCloud();
        gladiatorStore.reloadFromDb();
      })().catch(err => log.warn('Failed to refresh gladiators from cloud', { error: String(err) })),

      // (B) WS health checks (AUDIT FIX C6b — reconnect dead feeds)
      (async () => {
        const { WsStreamManager } = await import('@/lib/providers/wsStreams');
        const mexcHealth = WsStreamManager.getInstance().getFeedHealth();
        if (!mexcHealth.connected) {
          log.warn(`[WS Health] MEXC disconnected — forcing reconnect. stale=${mexcHealth.stale}, lastMsgAgo=${mexcHealth.lastMessageAgoMs}`);
          WsStreamManager.getInstance().connect();
        }
        const { polyWsClient } = await import('@/lib/polymarket/polyWsClient');
        polyWsClient.connect();
      })().catch(err => log.warn('WS health check failed', { error: String(err) })),

      // (C) Safety gates (AUDIT FIX C1 — daily reset + loss watchdog)
      // Also runs PAPER-mode observer (monitorPaperSafetyGates) when
      // SAFETY_GATES_PAPER_SIMULATE=true — pure logging, zero engage, for
      // pre-LIVE dry-run validation of the threshold chain.
      (async () => {
        const { ensureDailyReset, computeDailyLossPercent, monitorPaperSafetyGates } = await import('@/lib/core/safetyGates');
        const { checkDailyLossLimit } = await import('@/lib/core/killSwitch');
        await ensureDailyReset();
        const dailyLoss = computeDailyLossPercent();
        if (dailyLoss > 0) {
          const DAILY_LIMIT = parseFloat(process.env.KILL_SWITCH_DAILY_LOSS_PCT || '5');
          checkDailyLossLimit(dailyLoss, DAILY_LIMIT).catch(() => { /* ignore */ });
        }
        // PAPER-only observer. No-op unless SAFETY_GATES_PAPER_SIMULATE=true.
        monitorPaperSafetyGates();
      })().catch(err => log.warn('Safety gate tick check failed', { error: String(err) })),
    ]);

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

    // ─── PRE-PHASE 2: Decision eval setup (sync imports + in-memory reads) ───
    const {
      getPendingDecisions, getDecisionsWithOpenHorizons, updateDecision, setHorizonOutcome,
      recalculatePerformance, appendToEquityCurve, getLivePositions, updateLivePosition
    } = await import('@/lib/store/db');

    const isPaper = (process.env.TRADING_MODE || 'PAPER').toUpperCase() === 'PAPER';
    const HORIZONS = [5, 15, 60, 240];
    // F1 (2026-04-19) — Timescale alignment. Scouts emit timeframe:'4h' signals
    // (btcEngine.ts:439, solanaEngine.ts:327). Previous 15min eval forced premature
    // labeling — empirical LONG WR 2.4% last 4h in BTC 89% DOWN regime because
    // 4h bearish thesis was captured as 15min noise. 60min = compromise aligned with
    // EMA50/200 1h trend filter in btcEngine.ts. Decisions now labeled at 1h.
    // ASUMPȚIE: Orizont [5,15,60,240] rămâne — 60 devine primary; 5/15/240 sunt
    // multi-horizon secondary slots. appendToEquityCurve, shadow logBattle, A1
    // updateGladiatorStats TOATE se mută pe 1h. Stats necesită reset (F4) pentru
    // a evita mixed 15m-vechi + 60m-nou.
    const PRIMARY_HORIZON = 60;
    // FAZA 3/BATCH 2 (2026-04-19) — WR threshold unification (F2 fix).
    // PRIOR BUG: horizon label used ±0.3% flat → mismatch with simulator TP=1.0%/SL=-0.5%
    // AND with BATCH 1 net-profit stats semantic. Dashboard mixed two WR truths → incoherent.
    // NOW: WIN = pnlPercentNet > 0 (money made after fees, matches BATCH 1 updateGladiatorStats).
    //      NEUTRAL = |pnlPercent| < 0.25% (matches simulator NEUTRAL_ZONE).
    //      LOSS = otherwise.
    // Rollback: WR_THRESHOLD_UNIFY=0 → legacy ±0.3% flat label.
    // ASSUMPTION: NEUTRAL_BAND=0.25% reflects crypto noise floor over 60m horizon.
    // If realized volatility compresses below 0.25% per hour (dead regime), most signals
    // become NEUTRAL → slow stats accumulation (acceptable: slow-accurate beats fast-garbage).
    const WR_UNIFY = process.env.WR_THRESHOLD_UNIFY !== '0';
    const LEGACY_WIN_THRESHOLD = 0.3;
    const NEUTRAL_BAND = 0.25;
    const WIN_THRESHOLD = LEGACY_WIN_THRESHOLD; // kept for comment ref at line 15
    const envKey = isPaper ? 'PAPER_PENDING_MIN_AGE_MIN' : 'LIVE_PENDING_MIN_AGE_MIN';
    const minAgeMin = Number(process.env[envKey]) || Math.min(...HORIZONS);

    const pending = getPendingDecisions();
    const openHorizonDecisions = getDecisionsWithOpenHorizons(HORIZONS);
    const eligibleDecisions = openHorizonDecisions.filter((dec) => {
      const elapsedMin = (Date.now() - new Date(dec.timestamp).getTime()) / 60000;
      return elapsedMin >= minAgeMin;
    });

    // Shared state — populated by task (D) in Phase 2, consumed by response JSON.
    // Safe: JS single-threaded event loop, no true parallel mutation.
    let mainDecisionsEvaluated = 0;
    let horizonSlotsFilled = 0;
    let livePositionsUpdated = 0;
    const priceCache: Record<string, number> = {};

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 2: PARALLEL MAIN WORK (2026-04-18 perf)
    // Phantom eval, live positions, scanners, and autoDebug are independent.
    // Previously sequential: phantom(2-3s) → live(0.5s) → autoDebug → scanners(8-12s)
    // Now parallel: max(phantom+live, scanners) ≈ scanners ≈ 8-12s.
    // Saves ~3-5s per tick.
    //
    // WHY THIS IS SAFE:
    //  - evaluatePhantomTrades snapshots getPhantomTrades() at start — new phantoms
    //    created by scanners this tick won't be in that snapshot.
    //  - evaluateLivePositions reads existing open positions — scanners don't modify these.
    //  - autoDebug is read-only diagnostics.
    //  - All use JS single-threaded event loop — no true parallel memory corruption.
    // ═══════════════════════════════════════════════════════════════════

    const _p2Start = Date.now();
    const _p2Timing: Record<string, number> = {};

    await Promise.allSettled([
      // (A) Phantom + Live position evaluation (sequential within — live depends on phantom stats)
      (async () => {
        const _t = Date.now();
        await ArenaSimulator.getInstance().evaluatePhantomTrades();
        const { positionManager } = await import('@/lib/v2/manager/positionManager');
        await positionManager.evaluateLivePositions();
        _p2Timing.phantomEval = Date.now() - _t;
      })(),

      // (B) Market Scanners — THE BOTTLENECK
      (async () => {
        const _t = Date.now();
        const { GET: runBtc } = await import('@/app/api/btc-signals/route');
        const { GET: runSolana } = await import('@/app/api/solana-signals/route');
        const { GET: runMeme } = await import('@/app/api/meme-signals/route');
        // CRITICAL: await scanners — Cloud Run freezes process after response.
        const _st = Date.now();
        const _tBtc = Date.now();
        const pBtc = runBtc().finally(() => { _p2Timing.scanBtc = Date.now() - _tBtc; });
        const _tSol = Date.now();
        const pSol = runSolana().finally(() => { _p2Timing.scanSol = Date.now() - _tSol; });
        const _tMeme = Date.now();
        const pMeme = runMeme().finally(() => { _p2Timing.scanMeme = Date.now() - _tMeme; });
        const scanResults = await Promise.allSettled([pBtc, pSol, pMeme]);
        _p2Timing.scanners = Date.now() - _st;
        _p2Timing.scannersWithImport = Date.now() - _t;
        log.info(`[Market Scanners] completed`, { btc: scanResults[0].status, sol: scanResults[1].status, meme: scanResults[2].status, ms: _p2Timing.scanners });
      })().catch(e => log.error('Failed to trigger background scanners', { error: String(e) })),

      // (C) AutoDebug diagnostics (non-blocking, ~100ms)
      (async () => {
        const _t = Date.now();
        const { autoDebugEngine } = await import('@/lib/v2/safety/autoDebugEngine');
        await autoDebugEngine.runDeterministicDiagnostics();
        _p2Timing.autoDebug = Date.now() - _t;
      })().catch(e => log.warn('autoDebug diagnostics failed', { error: String(e) })),

      // (D) Decision eval + MEXC price fetch + live position updates
      (async () => {
        const _t = Date.now();
        // C10 (2026-04-19) — Collect shadow DNA records for batch insert at end of task (D).
        const _shadowBattleRecords: BattleRecord[] = [];
        const uniqueSymbols = [...new Set(eligibleDecisions.map(d => d.symbol))];
        const livePos = getLivePositions().filter(p => p.status === 'OPEN');
        const allSymbols = [...new Set([...uniqueSymbols, ...livePos.map(p => p.symbol)])];
        const toMexc = (s: string) => s.endsWith('USDT') ? s : s + 'USDT';
        const mexcSymbols = allSymbols.map(toMexc);

        // Parallel price fetch from MEXC (batches of 8, 5s timeout each)
        const rawPriceCache: Record<string, number> = {};
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
                recordPrice(sym, p);
              }
            }
          } catch { /* missing price → decision stays pending */ }
        };
        // C7 FIX #7: 8 → 20. ~12 symbols fit in 1 batch, saves ~500ms/tick.
        const CONCURRENCY = 20;
        for (let i = 0; i < mexcSymbols.length; i += CONCURRENCY) {
          await Promise.allSettled(mexcSymbols.slice(i, i + CONCURRENCY).map(fetchOne));
        }

        // Build dual-key cache (BTCUSDT + BTC → same price)
        for (const [mexcSym, price] of Object.entries(rawPriceCache)) {
          priceCache[mexcSym] = price;
          const base = mexcSym.endsWith('USDT') ? mexcSym.slice(0, -4) : mexcSym;
          priceCache[base] = price;
        }

        // MULTI-HORIZON EVAL LOOP
        for (const dec of eligibleDecisions) {
          const currentPrice = priceCache[dec.symbol];
          if (!currentPrice || !dec.price) continue;

          const elapsedMin = (Date.now() - new Date(dec.timestamp).getTime()) / 60000;
          const ho = dec.horizonOutcomes || {};

          for (const H of HORIZONS) {
            if (elapsedMin < H) continue;
            if (ho[String(H)]) continue;

            const pnlDiff = (currentPrice - dec.price) / dec.price;
            const rawPnlPercent = (dec.action === 'LONG' || dec.action === 'BUY')
              ? pnlDiff * 100 : -pnlDiff * 100;

            // FAZA 3/5 BATCH 1/4 — Sanity guard: reject cache-corruption values (|raw| > 20%).
            if (Math.abs(rawPnlPercent) > SHADOW_PNL_SANITY_ABS) {
              log.error(`[SHADOW_ANOMALY] decId=${dec.id} symbol=${dec.symbol} H=${H}m raw=${rawPnlPercent.toFixed(2)}% entry=${dec.price} exit=${currentPrice} — SKIP horizon write`);
              try {
                await emitEvent({
                  category: 'SHADOW_PNL_ANOMALY',
                  severity: 'CRITICAL',
                  title: `Shadow pnl ${rawPnlPercent.toFixed(2)}% exceeds sanity ${SHADOW_PNL_SANITY_ABS}%`,
                  details: {
                    decId: dec.id,
                    symbol: dec.symbol,
                    action: dec.action,
                    entryPrice: dec.price,
                    exitPrice: currentPrice,
                    horizon: H,
                    rawPnlPercent: parseFloat(rawPnlPercent.toFixed(4)),
                    reason: 'likely price cache corruption or delisted symbol'
                  }
                });
              } catch { /* non-fatal */ }
              continue; // skip this horizon for this decision — do NOT pollute stats/DNA
            }

            // Horizon metric keeps RAW value (informational, may reflect real sharp moves <20%).
            const pnlPercent = rawPnlPercent;
            // FAZA 3/BATCH 2 — unified label. WR_UNIFY=1 (default): WIN iff net>0.
            // Rollback: WR_THRESHOLD_UNIFY=0 → legacy ±0.3% flat.
            let label: 'WIN' | 'LOSS' | 'NEUTRAL';
            if (WR_UNIFY) {
              // netPnlFromGross already imported at top for shadow DNA path (BATCH 1).
              const _netCheck = netPnlFromGross(pnlPercent);
              label = Math.abs(pnlPercent) < NEUTRAL_BAND ? 'NEUTRAL'
                    : _netCheck.pnlPercentNet > 0 ? 'WIN'
                    : 'LOSS';
            } else {
              label = pnlPercent > WIN_THRESHOLD ? 'WIN'
                    : pnlPercent < -WIN_THRESHOLD ? 'LOSS'
                    : 'NEUTRAL';
            }

            // Execution-convention pnl: clamped to simulator TP/SL bandwidth.
            // Used ONLY for DNA logBattle + gladiator stats (aligned w/ QW-11 simulator clamp).
            const execPnlPercent = Math.max(SHADOW_SL_CLAMP, Math.min(SHADOW_TP_CLAMP, rawPnlPercent));

            setHorizonOutcome(dec.id, H, {
              price: currentPrice,
              pnlPercent: parseFloat(pnlPercent.toFixed(4)),
              label,
              evaluatedAt: new Date().toISOString(),
            });
            horizonSlotsFilled++;

            const legacyPriceField =
              H === 5 ? 'priceAfter5m' : H === 15 ? 'priceAfter15m'
              : H === 60 ? 'priceAfter1h' : H === 240 ? 'priceAfter4h' : null;
            if (legacyPriceField) updateDecision(dec.id, { [legacyPriceField]: currentPrice });

            if (H === PRIMARY_HORIZON) {
              // FAZA 3/5 BATCH 1/4 — decision.pnl + equity curve use execPnlPercent
              // (clamped TP/SL) for consistency with DNA + gladiator stats.
              // recalculatePerformance() consumes this → performance metrics aligned with
              // simulator convention (no phantom inflation from price spikes beyond TP).
              updateDecision(dec.id, {
                pnlPercent: parseFloat(execPnlPercent.toFixed(4)),
                outcome: label,
                evaluatedAt: new Date().toISOString(),
              });
              appendToEquityCurve({ ...dec, outcome: label }, execPnlPercent);
              mainDecisionsEvaluated++;

              // DNA LEARNING — one shadow → one DNA row
              if (dec.source.includes('Shadow')) {
                const gladiatorIdMatch = dec.source.match(/\(([A-Za-z0-9_-]+)\)/);
                if (gladiatorIdMatch && gladiatorIdMatch[1]) {
                  try {
                    // C10 (2026-04-19) — Collect record for batch insert (was: await logBattle per decision).
                    const _omega = OmegaEngine.getInstance();
                    const _r = _omega.getRegime();
                    const _feeCalc = netPnlFromGross(parseFloat(execPnlPercent.toFixed(4)));
                    _shadowBattleRecords.push({
                      id: `shadow_${dec.id}`,
                      gladiatorId: gladiatorIdMatch[1],
                      symbol: dec.symbol,
                      decision: dec.action as 'LONG' | 'SHORT' | 'FLAT',
                      entryPrice: dec.price,
                      outcomePrice: currentPrice,
                      pnlPercent: parseFloat(execPnlPercent.toFixed(4)),
                      isWin: label === 'WIN',
                      timestamp: Date.now(),
                      marketContext: {
                        exitType: 'SHADOW_TIME_BASED',
                        holdTimeSec: elapsedMin * 60,
                        regime: _r.regime,
                        regimeConfidence: parseFloat(_r.confidence.toFixed(4)),
                        regimeVolatilityScore: _r.volatilityScore,
                        regimeIsFallback: !_omega.hasLiveRegime(),
                        feeRoundTrip: _feeCalc.feeRoundTrip,
                        marketType: _feeCalc.marketType,
                        pnlPercentGross: parseFloat(execPnlPercent.toFixed(4)),
                        pnlPercentNet: _feeCalc.pnlPercentNet,
                        isWinNet: _feeCalc.isWinNet,
                        rawHorizonPnlGross: parseFloat(rawPnlPercent.toFixed(4)),
                        wasClamped: rawPnlPercent !== execPnlPercent,
                      }
                    });

                    // A1 — Stats unifier: increment gladiator.stats for shadow WIN/LOSS (sync, in-memory).
                    if (label !== 'NEUTRAL') {
                      try {
                        const _useNet = process.env.FEE_NET_V2 !== '0';
                        const _statsPnl = _useNet ? _feeCalc.pnlPercentNet : parseFloat(execPnlPercent.toFixed(4));
                        const _statsWin = _useNet ? _feeCalc.isWinNet : (label === 'WIN');
                        gladiatorStore.updateGladiatorStats(gladiatorIdMatch[1], {
                          pnlPercent: _statsPnl,
                          isWin: _statsWin
                        });
                      } catch (statsErr) {
                        log.error(`[A1] updateGladiatorStats failed for shadow ${dec.id}`, { error: String(statsErr) });
                      }
                    }
                  } catch (err) {
                    log.error(`Failed to collect shadow DNA for ${dec.id}`, { error: String(err) });
                  }
                }
              }
            }
          }
        }

        // C10 (2026-04-19) — Batch shadow DNA write (replaces N sequential awaits).
        if (_shadowBattleRecords.length > 0) {
          await DNAExtractor.getInstance().logBattleBatch(_shadowBattleRecords);
        }

        // Update floating PnL for live positions
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
        _p2Timing.decisionEval = Date.now() - _t;
      })().catch(e => log.error('Decision eval / price fetch failed', { error: String(e) })),
    ]);
    _p2Timing.phase2Total = Date.now() - _p2Start;

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
    const _flushStart = Date.now();
    const { flushPendingSyncs } = await import('@/lib/store/db');
    const flushResult = await flushPendingSyncs(4000);
    _p2Timing.flush = Date.now() - _flushStart;
    if (flushResult.timedOut) {
      log.warn('flushPendingSyncs timed out — some data may not have persisted');
    }

    // AUDIT-R3.1 AUTO-RECONCILE — rebuild per-gladiator stats from battles ledger.
    // Runs POST-flush so just-persisted writes are visible. Gates (all must hold):
    //   - process.env.AUTO_RECONCILE_ENABLED !== '0'   → full kill-switch
    //   - horizonSlotsFilled > 0                       → only when new data arrived
    //   - tryAcquireTaskLease('reconcile-stats', 300_000) (5min) → max 1 reconcile/5min
    //     across all Cloud Run instances; prevents thrashing on multi-instance scale-up.
    // Wrapped in try/catch → MUST NOT block cron response. TTL cleans lease on crash.
    // ASSUMPTION: reconcileStatsFromBattles is idempotent + bounded (<3s typical on 14 gladiators).
    // Kill-switch: AUTO_RECONCILE_ENABLED=0 disables entire block.
    if (process.env.AUTO_RECONCILE_ENABLED !== '0' && horizonSlotsFilled > 0) {
      try {
        const reconcileLease = await tryAcquireTaskLease('reconcile-stats', 300_000);
        if (reconcileLease.acquired && !reconcileLease.degraded) {
          const { gladiatorStore } = await import('@/lib/store/gladiatorStore');
          const _recStart = Date.now();
          const reconcileResult = await gladiatorStore.reconcileStatsFromBattles();
          log.info(`[CRON] auto-reconcile: ${reconcileResult.reconciled} reconciled, ${reconcileResult.skipped} skipped in ${Date.now() - _recStart}ms`);
          await releaseTaskLease('reconcile-stats').catch(() => { /* TTL fallback */ });
        }
      } catch (recErr) {
        log.warn(`[CRON] auto-reconcile failed (non-fatal): ${(recErr as Error).message}`);
      }
    }

    // R5-lite: release lease proactively so the NEXT scheduler tick isn't
    // blocked waiting for TTL expiry. On crash/timeout, TTL handles cleanup.
    releaseTaskLease('cron:main-tick').catch(() => { /* TTL will clean up */ });

    return NextResponse.json({
      status: 'ok',
      message: 'Cron tick processed',
      scanCount: gScan.__autoScan.scanCount,
      durationMs: Date.now() - scanStart,
      mainDecisionsEvaluated,
      horizonSlotsFilled,
      openHorizonsEligible: eligibleDecisions.length,
      livePositionsUpdated,
      pricesFetched: Object.keys(priceCache).length,
      // Observability — helps diagnose "why is pending stuck?" fast
      pendingTotal: pending.length,
      pendingEligible: eligibleDecisions.length,
      minAgeMin,
      horizons: HORIZONS,
      primaryHorizon: PRIMARY_HORIZON,
      mode: isPaper ? 'PAPER' : 'LIVE',
      forgeProgress: forgeStats.progressPercent,
      leaseOwner: getInstanceId(),
      leaseDegraded,
      timing: _p2Timing,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // Always reset running flag, even on error
    const gScanErr = globalThis as unknown as {
      __autoScan?: { running: boolean };
    };
    if (gScanErr.__autoScan) gScanErr.__autoScan.running = false;
    // Release lease on error too so next tick doesn't stall behind dead work.
    releaseTaskLease('cron:main-tick').catch(() => { /* TTL fallback */ });
    log.error('Cron loop error', { error: (err as Error).message });
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
