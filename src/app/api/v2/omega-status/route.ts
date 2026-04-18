/**
 * GET /api/v2/omega-status — FAZA 7 item 4
 *
 * Comparație WR Omega agregat vs WR mediu gladiatori individuali.
 * Expune synthesis curentă + market regime (via OmegaEngine).
 * Read-only. Safe to call oricând.
 */
import { successResponse, errorResponse } from '@/lib/api-response';
import { omegaExtractor } from '@/lib/v2/superai/omegaExtractor';
import { omegaEngine } from '@/lib/v2/superai/omegaEngine';
import { gladiatorStore } from '@/lib/store/gladiatorStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // ── Omega synthesis (cached from last cron) ──
    const synthesis = omegaExtractor.getCurrentSynthesis();

    // ── Individual gladiator stats ──
    const gladiators = gladiatorStore.getGladiators().filter(g => !g.isOmega);
    const withTrades = gladiators.filter(g => g.stats.totalTrades >= 10);
    const avgIndividualWR =
      withTrades.length > 0
        ? parseFloat(
            (withTrades.reduce((s, g) => s + g.stats.winRate, 0) / withTrades.length).toFixed(2),
          )
        : null;
    const avgIndividualPF =
      withTrades.length > 0
        ? parseFloat(
            (withTrades.reduce((s, g) => s + g.stats.profitFactor, 0) / withTrades.length).toFixed(3),
          )
        : null;

    // ── Comparison delta ──
    const omegaVsIndividual =
      synthesis && avgIndividualWR !== null
        ? {
            wrDelta: parseFloat((synthesis.aggregatedWR - avgIndividualWR).toFixed(2)),
            pfDelta: avgIndividualPF !== null
              ? parseFloat((synthesis.aggregatedPF - avgIndividualPF).toFixed(3))
              : null,
            omegaBeatsAverage: synthesis.aggregatedWR > avgIndividualWR,
          }
        : null;

    // ── Market regime (live, non-blocking) ──
    let regime = null;
    try {
      regime = omegaEngine.getRegime();
    } catch {
      // omegaEngine not yet analyzed — return null
    }

    // ── Top 3 gladiators used in last synthesis ──
    const top3 = gladiators
      .filter(g => g.stats.totalTrades >= 10)
      .sort(
        (a, b) =>
          (b.stats.winRate / 100) * b.stats.profitFactor * Math.min(b.stats.totalTrades / 50, 1) -
          (a.stats.winRate / 100) * a.stats.profitFactor * Math.min(a.stats.totalTrades / 50, 1),
      )
      .slice(0, 3)
      .map(g => ({
        id: g.id,
        name: g.name,
        winRate: g.stats.winRate,
        profitFactor: g.stats.profitFactor,
        totalTrades: g.stats.totalTrades,
        isLive: g.isLive,
      }));

    // ── Data-integrity warnings (sanity gates pentru leaderboard) ──
    // Motivație: post-QW-7 (TP/SL simetric), statisticile pre-fix rămân poluate. Un
    // avgWinRate > 80% cu sample mic ESTE aproape sigur artefact — semnalează-l explicit
    // ca să nu influențeze decizii de promovare LIVE. Nu mascăm datele, le etichetăm.
    const warnings: Array<{ code: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; message: string }> = [];
    const maxTrades = withTrades.reduce((m, g) => Math.max(m, g.stats.totalTrades), 0);
    if (avgIndividualWR !== null && avgIndividualWR > 80 && maxTrades < 200) {
      warnings.push({
        code: 'SUSPICIOUS_HIGH_WIN_RATE',
        severity: 'HIGH',
        message: `avgWinRate=${avgIndividualWR}% cu sample max ${maxTrades}. Probabil artefact pre-QW-7. Recomandare: gladiators:reset-stats.`,
      });
    }
    if (withTrades.length > 0 && maxTrades < 30) {
      warnings.push({
        code: 'LOW_SAMPLE_SIZE',
        severity: 'MEDIUM',
        message: `Max ${maxTrades} trades per gladiator. Statistic nesemnificativ (target ≥30).`,
      });
    }
    if (regime && typeof regime.allGladiatorWinRate === 'number' && avgIndividualWR !== null) {
      const regimeWRPercent = regime.allGladiatorWinRate * 100;
      if (Math.abs(regimeWRPercent - avgIndividualWR) > 20) {
        warnings.push({
          code: 'DATA_SOURCE_DIVERGENCE',
          severity: 'HIGH',
          message: `individuals.avgWinRate=${avgIndividualWR}% vs regime.allGladiatorWinRate=${regimeWRPercent.toFixed(1)}%. Două surse, valori diferite — una e falsă.`,
        });
      }
    }

    return successResponse({
      omega: synthesis
        ? {
            aggregatedWR: synthesis.aggregatedWR,
            aggregatedPF: synthesis.aggregatedPF,
            globalModifier: synthesis.globalModifier,
            directionBias: synthesis.directionBias,
            strongSymbols: synthesis.strongSymbols,
            weakSymbols: synthesis.weakSymbols,
            gladiatorsUsed: synthesis.gladiatorsUsed,
            synthesizedAt: synthesis.synthesizedAt,
            summary: omegaExtractor.getSummary(),
          }
        : null,
      individuals: {
        total: gladiators.length,
        withMinTrades: withTrades.length,
        avgWinRate: avgIndividualWR,
        avgProfitFactor: avgIndividualPF,
        top3,
      },
      comparison: omegaVsIndividual,
      regime: regime
        ? {
            type: regime.regime,
            confidence: regime.confidence,
            allGladiatorWinRate: regime.allGladiatorWinRate,
            volatilityScore: regime.volatilityScore,
            bullSignals: regime.bullSignals,
            bearSignals: regime.bearSignals,
          }
        : null,
      warnings,
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('OMEGA_STATUS_FAILED', (err as Error).message, 500);
  }
}
