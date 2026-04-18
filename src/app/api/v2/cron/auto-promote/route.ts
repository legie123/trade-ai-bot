// ============================================================
// Auto-LIVE Promotion Cron — Hourly check via Cloud Scheduler
// Evaluates gladiators for PHANTOM → LIVE promotion using pre-live gate
// ============================================================
import { NextResponse } from 'next/server';
import { getGladiatorsFromDb, saveGladiatorsToDb } from '@/lib/store/db';
import { getKillSwitchState } from '@/lib/core/killSwitch';
import { MonteCarloEngine } from '@/lib/v2/superai/monteCarloEngine';
import { sendMessage } from '@/lib/alerts/telegram';
import { requireCronAuth } from '@/lib/core/cronAuth';
import { emitPromotion } from '@/lib/v2/alerts/eventHub';
// AUDIT FIX C3 (2026-04-18): Walk-forward validation gate
import { WalkForwardEngine } from '@/lib/v2/validation/walkForwardEngine';

export const dynamic = 'force-dynamic';

// FIX 2026-04-18 FAZA 5: Aligned with QW-8 gladiatorStore gates (50/58/1.3).
// Previous: 20/45/1.1 — could promote gladiators that gladiatorStore would demote on next
// recalibrate cycle, causing promotion/demotion oscillation.
const PROMO_CRITERIA = {
  minPhantomTrades: 50,       // was 20 — need statistical significance
  minWinRate: 58,             // was 45 — QW-8 institutional standard
  minProfitFactor: 1.3,       // was 1.1 — must prove real edge
  maxRuinProbability: 10,     // Monte Carlo ruin < 10%
  maxRiskPerTrade: 1.0,       // %
  maxLiveGladiators: 3,       // Limit concurrent LIVE gladiators
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

export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  const results: PromotionResult[] = [];

  try {
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

    // 3. Find promotion candidates (PHANTOM with enough trades)
    const candidates = gladiators.filter(g =>
      !g.isLive &&
      g.stats.totalTrades >= PROMO_CRITERIA.minPhantomTrades &&
      g.stats.winRate >= PROMO_CRITERIA.minWinRate &&
      g.stats.profitFactor >= PROMO_CRITERIA.minProfitFactor
    );

    if (candidates.length === 0) {
      return NextResponse.json({
        status: 'NO_CANDIDATES',
        reason: 'No gladiators meet promotion criteria',
        criteria: PROMO_CRITERIA,
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
}
