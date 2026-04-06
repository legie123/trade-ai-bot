// GET /api/v2/arena — Full gladiator details + Omega progress + real stats
import { NextResponse } from 'next/server';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { getGladiatorDna } from '@/lib/store/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const gladiators = gladiatorStore.getLeaderboard();
    const omega = gladiatorStore.getGladiators().find(g => g.isOmega);
    
    // Calculate real Omega progress from extracted DNA
    const dnaBank = getGladiatorDna();
    const targetWins = 100; // Genesis target for Omega to awaken
    const realProgress = Math.min(100, Math.round((dnaBank.length / targetWins) * 100));
    
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
      
      if (rank <= 3) {
        status = 'LIVE';
        rankReason = `Top ${rank} — Active in production. Highest win rate in ${g.arena} arena.`;
      } else if (rank <= 6) {
        status = 'SHADOW';
        rankReason = `Shadow rank ${rank} — Paper trading, awaiting promotion if top 3 falters.`;
      } else {
        status = 'STANDBY';
        rankReason = `Standby rank ${rank} — Monitoring only. Needs ${Math.round(70 - g.stats.winRate)}% more WR to enter shadow.`;
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

    return NextResponse.json({
      status: 'ok',
      activeFighters: gladiators.length,
      liveFighters: gladiators.filter(g => g.isLive).length,
      shadowFighters: leaderboard.filter(g => g.status === 'SHADOW').length,
      superAiOmega: omega ? {
        rank: 'God',
        trainingProgress: realProgress,
        winRate: '0.00', // Still learning, doesn't trade yet
        status: realProgress >= 100 ? 'ACTIVE' : 'IN_TRAINING',
        totalWinsAssimilated: dnaBank.length,
        targetWins,
        totalTradesAnalyzed: dnaBank.length,
      } : null,
      leaderboard,
      timestamp: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
