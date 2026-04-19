// ============================================================
// Auto-LIVE Promotion Cron — Hourly check via Cloud Scheduler
// Evaluates gladiators for PHANTOM → LIVE promotion using pre-live gate
// ============================================================
import { NextResponse } from 'next/server';
import { getGladiatorsFromDb, saveGladiatorsToDb, initDB, getIndependentSampleSize, getCrossGladiatorWashScore } from '@/lib/store/db';
import type { WashConfig, WashMode } from '@/lib/v2/wash/types';
import { washRingPush } from '@/lib/v2/wash/washState';
import { getKillSwitchState } from '@/lib/core/killSwitch';
import { MonteCarloEngine } from '@/lib/v2/superai/monteCarloEngine';
import { sendMessage } from '@/lib/alerts/telegram';
import { requireCronAuth } from '@/lib/core/cronAuth';
import { emitPromotion } from '@/lib/v2/alerts/eventHub';
// AUDIT FIX C3 (2026-04-18): Walk-forward validation gate
import { WalkForwardEngine } from '@/lib/v2/validation/walkForwardEngine';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
// FAZA A BATCH 1: domain metrics hook
import { metrics, safeInc } from '@/lib/observability/metrics';
// FAZA A BATCH 3: cron run/duration instrumentation
import { instrumentCron } from '@/lib/observability/cronInstrument';

export const dynamic = 'force-dynamic';

// RUFLO FAZA 3 Batch 5 (C9) 2026-04-19: Wilson score interval lower bound.
// Symmetric to Butcher C8 kill gate. Prevents promoting gladiators on a
// lucky streak: at WR=58% with n=50, 95% CI spans ~44–72% — promoting at
// raw 58 means we may be promoting a true-WR-45% gladiator.
//
// wilsonLower = (p + z²/2n - z*sqrt((p(1-p)+z²/4n)/n)) / (1 + z²/n)
// z = 1.96 → 95% confidence.
// Example: 29 wins / 50 trades = 58% raw WR
//   wilsonLower ≈ 0.439 → NOT promoted under strict gate (WILSON_WR_FLOOR=0.50)
// Example: 35 wins / 50 trades = 70% raw WR
//   wilsonLower ≈ 0.560 → promoted (confident >50% true WR)
function wilsonLower(successes: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.96;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (center - margin) / denom;
}

// FAZA 3/5 BATCH 3/4 (2026-04-20) — Cross-Gladiator Wash Guard config.
// Mode controlled by WASH_CROSS_GLADIATOR_ENABLED:
//   '0' / 'off'    → disabled (kill-switch full revert)
//   'shadow'       → log + counter only, no rejection (default for first 48-72h)
//   'on'           → enforce hard rejection (after calibration via /api/v2/diag/wash)
// Thresholds default to overlap>0.70 AND |corr|>0.85 (audit suggests start permissive,
// tighten after percentiles surface). bucketMs=1_800_000 (30min) per ACF in audit.
function getWashConfig(): WashConfig {
  const raw = (process.env.WASH_CROSS_GLADIATOR_ENABLED || 'shadow').toLowerCase();
  let mode: WashMode = 'shadow';
  if (raw === '0' || raw === 'off' || raw === 'false') mode = 'off';
  else if (raw === '1' || raw === 'on' || raw === 'true') mode = 'on';
  const num = (k: string, d: number) => {
    const v = parseFloat(process.env[k] || '');
    return Number.isFinite(v) ? v : d;
  };
  return {
    mode,
    maxOverlap: num('WASH_MAX_OVERLAP', 0.70),
    pnlCorrThreshold: num('WASH_CORR_THRESHOLD', 0.85),
    bucketMs: num('WASH_BUCKET_MS', 1_800_000),
    lookbackTrades: num('WASH_LOOKBACK_TRADES', 200),
    maxPeers: num('WASH_MAX_PEERS', 15),
    minSharedTrades: num('WASH_MIN_SHARED_TRADES', 30),
  };
}

// FAZA 3/5 BATCH 2/4 (2026-04-19) — auto-promote criteria aligned with QW-8 gate.
// PRIOR: 20/45/1.1 was dangerously loose — allowed LIVE promotion on 20 wash-contaminated
// phantom rows (potentially = 3-5 independent signals).
// NOW: minPhantomTrades semantic = INDEPENDENT SAMPLES (dedupe per minute+symbol+direction).
// Thresholds match gladiatorStore QW-8: tt>=50, WR>=58%, PF>=1.3.
const PROMO_CRITERIA = {
  minPhantomTrades: 50,      // INDEPENDENT samples, not raw totalTrades
  minWinRate: 58,
  minProfitFactor: 1.3,
  maxRuinProbability: 10,    // Monte Carlo ruin < 10%
  maxRiskPerTrade: 1.0,      // %
  maxLiveGladiators: 3,      // Limit concurrent LIVE gladiators
};

interface PromotionResult {
  gladiatorId: string;
  gladiatorName: string;
  action: 'PROMOTED' | 'SKIPPED' | 'FAILED';
  reason: string;
  stats?: {
    winRate: number;
    profitFactor: number;
    totalTrades: number;
    ruinProbability?: number;
  };
}

export const GET = instrumentCron('auto-promote', async (request: Request) => {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  const results: PromotionResult[] = [];

  try {
    // COLD-START FIX (2026-04-18): Hydrate cache from Supabase before reading gladiators.
    // Without this, cold-start Cloud Run instances read empty/seed state and skip promotions.
    await initDB();

    // 1. Kill switch check — if triggered, no promotions
    const ks = getKillSwitchState();
    if (ks.engaged || ks.velocityTriggered) {
      return NextResponse.json({
        status: 'HALTED',
        reason: 'Kill switch active — no promotions',
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Get all gladiators
    const gladiators = getGladiatorsFromDb();
    if (!gladiators || !Array.isArray(gladiators)) {
      return NextResponse.json({
        status: 'ERROR',
        reason: 'Failed to load gladiators from DB — returned null or invalid',
        timestamp: new Date().toISOString(),
      }, { status: 500 });
    }
    const liveCount = gladiators.filter(g => g.isLive).length;

    if (liveCount >= PROMO_CRITERIA.maxLiveGladiators) {
      return NextResponse.json({
        status: 'FULL',
        reason: `Already ${liveCount}/${PROMO_CRITERIA.maxLiveGladiators} LIVE gladiators`,
        liveGladiators: gladiators.filter(g => g.isLive).map(g => g.name),
        timestamp: new Date().toISOString(),
      });
    }

    // FAZA 3/5 BATCH 2/4 — Refresh global indepSampleCache so gladiatorStore.recalibrateRanks
    // (next 5min tick) uses fresh dedup counts in its own QW-8 gate.
    try {
      await gladiatorStore.refreshIndependentSampleSizes();
    } catch (refreshErr) {
      console.warn(`[AUTO-PROMOTE] refreshIndependentSampleSizes failed: ${String(refreshErr)}`);
    }

    // 3. Find promotion candidates (PHANTOM with enough INDEPENDENT samples).
    // FAZA 3/5 BATCH 2/4 — dedupe-aware: count unique (minute, symbol, direction) decisions.
    // Filtered in 2 steps: first by cheap WR/PF, then by expensive DB query on indep count.
    // ASUMPȚIE: dacă getIndependentSampleSize DB query fails → returnează 0 → gladiator exclus.
    // Fail-closed: mai bine ratăm o promovare legitimă decât să promovăm pe wash.
    const preliminary = gladiators.filter(g =>
      !g.isLive &&
      g.stats.winRate >= PROMO_CRITERIA.minWinRate &&
      g.stats.profitFactor >= PROMO_CRITERIA.minProfitFactor &&
      // cheap upper bound: if raw totalTrades < threshold, indep can't exceed it
      g.stats.totalTrades >= PROMO_CRITERIA.minPhantomTrades
    );
    // RUFLO FAZA 3 Batch 5 (C9) 2026-04-19: Wilson CI floor for promotion.
    // Even after passing raw WR≥58 + indep count ≥50, we demand 95% pessimistic
    // WR estimate to be ≥50%. This symmetrically mirrors Butcher (kill < 0.35).
    // Gate zone: Butcher spares [0.35, 0.50]; Promoter blocks [0.35, 0.50] too
    // → these gladiators stay in PHANTOM until more data resolves ambiguity.
    // Kill-switch: env PROMOTE_USE_WILSON=0 reverts to raw WR gate.
    const useWilsonPromo = process.env.PROMOTE_USE_WILSON !== '0';
    const WILSON_WR_FLOOR = 0.50;

    // FAZA 3/5 BATCH 3/4 — Wash config evaluated ONCE outside the loop (not per-candidate).
    const washCfg = getWashConfig();
    // Peer set = all OTHER gladiators (live + phantom), ordered live-first then phantom,
    // capped at maxPeers. Same set reused for every candidate (cheaper than per-iter recompute).
    const allPeerIds: string[] = [
      ...gladiators.filter((g) => g.isLive).map((g) => g.id),
      ...gladiators.filter((g) => !g.isLive).map((g) => g.id),
    ];

    const candidates: typeof preliminary = [];
    for (const g of preliminary) {
      try {
        const indepCount = await getIndependentSampleSize(g.id);
        if (indepCount < PROMO_CRITERIA.minPhantomTrades) {
          results.push({
            gladiatorId: g.id,
            gladiatorName: g.name,
            action: 'SKIPPED',
            reason: `Insufficient INDEPENDENT samples: ${indepCount} (raw ${g.stats.totalTrades}) < ${PROMO_CRITERIA.minPhantomTrades} — wash-contaminated`,
            stats: { winRate: g.stats.winRate, profitFactor: g.stats.profitFactor, totalTrades: g.stats.totalTrades },
          });
          safeInc(metrics.gladiatorPromotions, { result: 'rejected_sample' });
          continue;
        }
        // Wilson floor — based on INDEPENDENT sample size (indepCount) not raw
        // totalTrades, to avoid overstating confidence from wash trades.
        if (useWilsonPromo) {
          const wins = Math.round((g.stats.winRate / 100) * indepCount);
          const wrLower = wilsonLower(wins, indepCount);
          if (wrLower < WILSON_WR_FLOOR) {
            results.push({
              gladiatorId: g.id,
              gladiatorName: g.name,
              action: 'SKIPPED',
              reason: `Wilson WR lower bound ${(wrLower*100).toFixed(1)}% < ${(WILSON_WR_FLOOR*100).toFixed(0)}% — statistical confidence insufficient (raw WR ${g.stats.winRate}%, indep n=${indepCount})`,
              stats: { winRate: g.stats.winRate, profitFactor: g.stats.profitFactor, totalTrades: g.stats.totalTrades },
            });
            safeInc(metrics.gladiatorPromotions, { result: 'rejected_wilson' });
            continue;
          }
        }

        // FAZA 3/5 BATCH 3/4 — Cross-Gladiator Wash Guard.
        // Goal: block promoting a gladiator whose trades are mostly wash-correlated
        // with an existing peer (live OR phantom). Uses 30-min bucket|symbol keys
        // + Pearson on signed pnl (SHORT inverted) → |corr| catches same-dir wash
        // AND mirror-hedge. Fail-closed on I/O error (sentinel '__fetch_error__').
        if (washCfg.mode !== 'off') {
          const peerSet = allPeerIds.filter((pid) => pid !== g.id).slice(0, washCfg.maxPeers);
          try {
            const wash = await getCrossGladiatorWashScore(g.id, peerSet, {
              bucketMs: washCfg.bucketMs,
              lookbackTrades: washCfg.lookbackTrades,
              minSharedTrades: washCfg.minSharedTrades,
            });
            const absCorr = Math.abs(wash.washPeerPnlCorr);
            const failedClosed = wash.washPeerId === '__fetch_error__';
            const wouldBlock = failedClosed
              || (wash.maxOverlapRatio > washCfg.maxOverlap && absCorr > washCfg.pnlCorrThreshold);
            const reasonText = failedClosed
              ? 'WASH_FAIL_CLOSED: cross-gladiator score fetch failed'
              : `wash overlap=${wash.maxOverlapRatio.toFixed(3)} |corr|=${absCorr.toFixed(3)} peer=${wash.washPeerId ?? 'none'} (thr ovr>${washCfg.maxOverlap}, |corr|>${washCfg.pnlCorrThreshold})`;

            // Always emit telemetry (shadow ring + structured log) regardless of mode.
            washRingPush({
              ts: Date.now(),
              gladiatorId: g.id,
              gladiatorName: g.name,
              washPeerId: wash.washPeerId,
              overlap: wash.maxOverlapRatio,
              corr: wash.washPeerPnlCorr,
              blocked: wouldBlock,
              reason: reasonText,
            });
            console.log(JSON.stringify({
              tag: '[WASH-SHADOW]',
              mode: washCfg.mode,
              candidate: g.id,
              candidateName: g.name,
              overlap: wash.maxOverlapRatio,
              corr: wash.washPeerPnlCorr,
              absCorr,
              peer: wash.washPeerId,
              totalCandidateKeys: wash.totalCandidateKeys,
              wouldBlock,
              reason: reasonText,
              thresholds: { maxOverlap: washCfg.maxOverlap, corr: washCfg.pnlCorrThreshold },
            }));

            if (wouldBlock && washCfg.mode === 'on') {
              results.push({
                gladiatorId: g.id,
                gladiatorName: g.name,
                action: 'SKIPPED',
                reason: reasonText,
                stats: { winRate: g.stats.winRate, profitFactor: g.stats.profitFactor, totalTrades: g.stats.totalTrades },
              });
              safeInc(metrics.gladiatorPromotions, { result: 'rejected_wash_cross' });
              continue;
            }
            if (wouldBlock && washCfg.mode === 'shadow') {
              safeInc(metrics.gladiatorPromotions, { result: 'would_reject_wash_cross' });
              // Shadow = do NOT continue; candidate still pushed below.
            }
          } catch (washErr) {
            // Parity with wfErr: shadow → swallow + warn; on → FAILED + continue (fail-closed).
            if (washCfg.mode === 'on') {
              results.push({
                gladiatorId: g.id,
                gladiatorName: g.name,
                action: 'FAILED',
                reason: `wash guard threw: ${(washErr as Error).message}`,
                stats: { winRate: g.stats.winRate, profitFactor: g.stats.profitFactor, totalTrades: g.stats.totalTrades },
              });
              safeInc(metrics.gladiatorPromotions, { result: 'rejected_wash_cross' });
              continue;
            }
            console.warn(`[WASH-SHADOW] ${g.name} wash guard threw (shadow swallow): ${(washErr as Error).message}`);
          }
        }

        candidates.push(g);
      } catch {
        results.push({
          gladiatorId: g.id,
          gladiatorName: g.name,
          action: 'SKIPPED',
          reason: 'getIndependentSampleSize failed — fail-closed',
        });
      }
    }

    // C5 Batch 3 — Reconciliation runs BEFORE early returns so stats stay fresh
    // regardless of whether any candidates exist for promotion.
    let reconcileResult: { reconciled: number; skipped: number } | null = null;
    if (process.env.RECONCILE_ON_PROMOTE !== '0') {
      try {
        const _recStart = Date.now();
        reconcileResult = await gladiatorStore.reconcileStatsFromBattles();
        const _recMs = Date.now() - _recStart;
        console.log(`[AUTO-PROMOTE] reconcileStatsFromBattles: ${reconcileResult.reconciled} reconciled, ${reconcileResult.skipped} skipped in ${_recMs}ms`);
      } catch (recErr) {
        console.error(`[AUTO-PROMOTE] reconcileStatsFromBattles failed: ${String(recErr)}`);
      }
    }

    if (candidates.length === 0) {
      return NextResponse.json({
        status: 'NO_CANDIDATES',
        reason: 'No gladiators meet promotion criteria',
        criteria: PROMO_CRITERIA,
        reconciliation: reconcileResult ? { reconciled: reconcileResult.reconciled, skipped: reconcileResult.skipped } : 'disabled',
        gladiatorSummary: gladiators.map(g => ({
          name: g.name,
          isLive: g.isLive,
          trades: g.stats.totalTrades,
          winRate: g.stats.winRate,
          pf: g.stats.profitFactor,
        })),
        timestamp: new Date().toISOString(),
      });
    }

    // 4. Evaluate each candidate with Monte Carlo
    const slotsAvailable = PROMO_CRITERIA.maxLiveGladiators - liveCount;
    // AUDIT FIX BUG-3: Use canonical readinessScore for promotion ranking
    candidates.sort((a, b) => {
      const scoreA = (a.stats as unknown as Record<string, number>).readinessScore ?? (a.stats.profitFactor * a.stats.winRate);
      const scoreB = (b.stats as unknown as Record<string, number>).readinessScore ?? (b.stats.profitFactor * b.stats.winRate);
      return scoreB - scoreA;
    });

    let promoted = 0;

    for (const candidate of candidates) {
      if (promoted >= slotsAvailable) {
        results.push({
          gladiatorId: candidate.id,
          gladiatorName: candidate.name,
          action: 'SKIPPED',
          reason: 'No LIVE slots available',
        });
        continue;
      }

      try {
        // Run Monte Carlo simulation
        const mc = await MonteCarloEngine.run(candidate.id, 500);

        if (!mc) {
          results.push({
            gladiatorId: candidate.id,
            gladiatorName: candidate.name,
            action: 'FAILED',
            reason: 'Monte Carlo failed (insufficient data)',
          });
          continue;
        }

        if (mc.ruinProbability > PROMO_CRITERIA.maxRuinProbability) {
          safeInc(metrics.gladiatorPromotions, { result: 'rejected_ruin' });
          results.push({
            gladiatorId: candidate.id,
            gladiatorName: candidate.name,
            action: 'SKIPPED',
            reason: `Ruin probability ${mc.ruinProbability.toFixed(1)}% > ${PROMO_CRITERIA.maxRuinProbability}%`,
            stats: {
              winRate: candidate.stats.winRate,
              profitFactor: candidate.stats.profitFactor,
              totalTrades: candidate.stats.totalTrades,
              ruinProbability: mc.ruinProbability,
            },
          });
          continue;
        }

        // AUDIT FIX C3 (2026-04-18): WALK-FORWARD GATE — detects overfitting
        // by comparing in-sample vs out-of-sample performance across rolling
        // windows. Must pass BEFORE promotion to LIVE capital.
        //
        // ASUMPȚIE: engineul are >= MIN_TRADES (100 post-C9) pentru rezultate
        // robuste. Dacă insufficient data, emptyResult returnează verdict='CLEAN'
        // — nu blocăm pe lack of data (bootstrap-friendly), doar pe OVERFIT explicit.
        //
        // Kill-switch: DISABLE_WALK_FORWARD=true (inherited from engine)
        try {
          const wfResult = await WalkForwardEngine.getInstance().validate(candidate.id);
          if (wfResult.verdict === 'OVERFIT') {
            safeInc(metrics.gladiatorPromotions, { result: 'rejected_overfit' });
            results.push({
              gladiatorId: candidate.id,
              gladiatorName: candidate.name,
              action: 'SKIPPED',
              reason: `Walk-forward OVERFIT: ${(wfResult.overfitScore * 100).toFixed(0)}% of folds degraded (IS WR ${(wfResult.aggregateIS.winRate*100).toFixed(0)}% → OOS ${(wfResult.aggregateOOS.winRate*100).toFixed(0)}%)`,
              stats: {
                winRate: candidate.stats.winRate,
                profitFactor: candidate.stats.profitFactor,
                totalTrades: candidate.stats.totalTrades,
                ruinProbability: mc.ruinProbability,
              },
            });
            continue;
          }
          if (wfResult.verdict === 'SUSPECT') {
            // Log but don't block — suspect is a warning not a veto
            console.warn(`[AUTO-PROMOTE] ${candidate.name} walk-forward SUSPECT (overfit=${(wfResult.overfitScore * 100).toFixed(0)}%) — proceeding with caution`);
          }
        } catch (wfErr) {
          // Walk-forward error → fail closed (block promotion): we cannot
          // verify overfit, so we don't risk live capital.
          results.push({
            gladiatorId: candidate.id,
            gladiatorName: candidate.name,
            action: 'FAILED',
            reason: `Walk-forward validation threw: ${(wfErr as Error).message}`,
          });
          continue;
        }

        // PROMOTE!
        candidate.isLive = true;
        candidate.lastUpdated = Date.now();
        promoted++;
        // FAZA A BATCH 1: promotion metric
        safeInc(metrics.gladiatorPromotions, { result: 'promoted' });

        results.push({
          gladiatorId: candidate.id,
          gladiatorName: candidate.name,
          action: 'PROMOTED',
          reason: `All criteria met — WR ${candidate.stats.winRate}%, PF ${candidate.stats.profitFactor}, Ruin ${mc.ruinProbability.toFixed(1)}%`,
          stats: {
            winRate: candidate.stats.winRate,
            profitFactor: candidate.stats.profitFactor,
            totalTrades: candidate.stats.totalTrades,
            ruinProbability: mc.ruinProbability,
          },
        });

        // EventHub + Telegram notification
        await emitPromotion(candidate.name, {
          arena: candidate.arena,
          winRate: candidate.stats.winRate,
          profitFactor: candidate.stats.profitFactor,
          totalTrades: candidate.stats.totalTrades,
          ruinProbability: mc.ruinProbability,
        });
        await sendMessage(
          `🏆 *GLADIATOR PROMOTED TO LIVE*\n` +
          `Name: ${candidate.name}\n` +
          `Arena: ${candidate.arena}\n` +
          `Win Rate: ${candidate.stats.winRate}%\n` +
          `Profit Factor: ${candidate.stats.profitFactor}\n` +
          `Trades: ${candidate.stats.totalTrades}\n` +
          `Ruin Risk: ${mc.ruinProbability.toFixed(1)}%\n` +
          `⏰ ${new Date().toISOString()}`
        );

      } catch (err) {
        results.push({
          gladiatorId: candidate.id,
          gladiatorName: candidate.name,
          action: 'FAILED',
          reason: `Error: ${(err as Error).message}`,
        });
      }
    }

    // 5. Save if any promotions happened
    if (promoted > 0) {
      try {
        await saveGladiatorsToDb(gladiators);
      } catch (saveErr) {
        return NextResponse.json({
          status: 'SAVE_FAILED',
          error: `Promotions applied in-memory but DB save failed: ${(saveErr as Error).message}`,
          promoted,
          results,
          timestamp: new Date().toISOString(),
        }, { status: 500 });
      }
    }

    return NextResponse.json({
      status: promoted > 0 ? 'PROMOTIONS_MADE' : 'NO_PROMOTIONS',
      promoted,
      slotsAvailable,
      results,
      reconciliation: reconcileResult ? { reconciled: reconcileResult.reconciled, skipped: reconcileResult.skipped } : 'disabled',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    return NextResponse.json({
      status: 'ERROR',
      error: (err as Error).message,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
});
