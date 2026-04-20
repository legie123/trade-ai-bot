// GET /api/v2/arena — Full gladiator details + Omega progress + real stats
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { getGladiatorDna, initDB } from '@/lib/store/db';
import { successResponse, errorResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // COLD-START FIX (2026-04-18): Hydrate gladiatorStore from Supabase before reading.
    // Without this, cold-booted instances return seed tt=0 leaderboard.
    await initDB();

    const gladiators = gladiatorStore.getLeaderboard();
    const omega = gladiatorStore.getGladiators().find(g => g.isOmega);
    
    // AUDIT FIX CRITIC-7: Progress based on WINS only, not all battles
    const dnaBank = getGladiatorDna() || [];
    const actualWins = dnaBank.filter(d => d.isWin === true).length;
    const targetWins = 100; // Genesis target for Omega to awaken
    const realProgress = Math.min(100, Math.round((actualWins / targetWins) * 100));
    
    // Update Omega in store with real progress based on DNA bank
    if (omega) {
      gladiatorStore.updateOmegaProgress(realProgress, {
        winRate: 0, // Omega doesn't trade yet, it learns
        totalTrades: dnaBank.length, // Extracted DNA traits
        profitFactor: 0,
      });
    }

    // Build detailed leaderboard with rank reasons
    const leaderboard = gladiators.map((g, idx) => {
      const rank = idx + 1;
      let rankReason = '';
      let status: 'LIVE' | 'SHADOW' | 'STANDBY' = 'STANDBY';
      
      // C9 FIX: status must reflect QW-8 gate (isLive), not just rank position.
      // Prior code: rank<=3 → 'LIVE' regardless of thresholds → misleading operator.
      if (g.isLive) {
        status = 'LIVE';
        rankReason = `Top ${rank} — LIVE (QW-8 passed: tt≥50, WR≥40%, PF≥1.3).`;
      } else if (rank <= 3) {
        status = 'SHADOW';
        rankReason = `Top ${rank} — Shadow (rank qualifies but QW-8 gate not passed: WR=${g.stats.winRate.toFixed(1)}%, PF=${g.stats.profitFactor.toFixed(2)}).`;
      } else if (rank <= 6) {
        status = 'SHADOW';
        rankReason = `Shadow rank ${rank} — Paper trading, awaiting promotion if top 3 falters.`;
      } else {
        status = 'STANDBY';
        rankReason = `Standby rank ${rank} — Monitoring only.`;
      }

      return {
        id: g.id,
        name: g.name,
        arena: g.arena,
        rank,
        status,
        isLive: g.isLive,
        winRate: g.stats.winRate.toFixed(2),
        totalTrades: g.stats.totalTrades,
        profitFactor: g.stats.profitFactor.toFixed(2),
        maxDrawdown: g.stats.maxDrawdown.toFixed(2),
        sharpeRatio: g.stats.sharpeRatio.toFixed(2),
        rankReason,
        lastUpdated: new Date(g.lastUpdated).toISOString(),
      };
    });

    return successResponse({
      status: 'ok',
      activeFighters: gladiators.length,
      liveFighters: gladiators.filter(g => g.isLive).length,
      shadowFighters: leaderboard.filter(g => g.status === 'SHADOW').length,
      superAiOmega: omega ? {
        rank: 'God',
        trainingProgress: realProgress,
        winRate: '0.00', // Still learning, doesn't trade yet
        status: realProgress >= 100 ? 'ACTIVE' : 'IN_TRAINING',
        totalWinsAssimilated: actualWins,
        targetWins,
        totalTradesAnalyzed: dnaBank.length,
      } : null,
      leaderboard,
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('ARENA_ERROR', (err as Error).message, 500);
  }
}
