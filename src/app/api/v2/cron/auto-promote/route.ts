// ============================================================
// Auto-LIVE Promotion Cron — Hourly check via Cloud Scheduler
// Evaluates gladiators for PHANTOM → LIVE promotion using pre-live gate
// ============================================================
import { NextResponse } from 'next/server';
import { getGladiatorsFromDb, saveGladiatorsToDb, getGladiatorBattles } from '@/lib/store/db';
import { getKillSwitchState } from '@/lib/core/killSwitch';
import { MonteCarloEngine } from '@/lib/v2/superai/monteCarloEngine';
import { sendMessage } from '@/lib/alerts/telegram';

export const dynamic = 'force-dynamic';

// Promotion criteria (aligned with pre-live gate)
const PROMO_CRITERIA = {
  minPhantomTrades: 20,
  minWinRate: 45,
  minProfitFactor: 1.1,
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

export async function GET() {
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
      const scoreA = (a.stats as any).readinessScore ?? (a.stats.profitFactor * a.stats.winRate);
      const scoreB = (b.stats as any).readinessScore ?? (b.stats.profitFactor * b.stats.winRate);
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

        // Telegram notification
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
