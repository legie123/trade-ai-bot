// ============================================================
// GET /api/bot — Bot stats, performance, decisions, and optimizer state
// POST /api/bot — Bot actions (evaluate, optimize, configure)
// ============================================================
import { NextResponse } from 'next/server';
import {
  initDB,
  getDecisions,
  getDecisionsToday,
  getPerformance,
  getOptimizerState,
  getBotConfig,
  saveBotConfig,
  recalculatePerformance,
  getEquityCurve,
  getStrategies,
  getSyndicateAudits,
} from '@/lib/store/db';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { engageKillSwitch, disengageKillSwitch, getKillSwitchState } from '@/lib/core/killSwitch';
import { BotStats } from '@/lib/types/radar';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await initDB();
    const config = getBotConfig();
    const allDecisions = getDecisions();
    const todayDecisions = getDecisionsToday();
    const performance = getPerformance();
    const optimizer = getOptimizerState();

    // Calculate stats
    const evaluated = allDecisions.filter((d) => d.outcome !== 'PENDING');
    const todayEvaluated = todayDecisions.filter((d) => d.outcome !== 'PENDING');
    const wins = evaluated.filter((d) => d.outcome === 'WIN').length;
    const todayWins = todayEvaluated.filter((d) => d.outcome === 'WIN').length;

    // Streak calculation
    let streak = 0;
    let streakType: 'WIN' | 'LOSS' | 'NONE' = 'NONE';
    for (const d of evaluated) {
      if (d.outcome === 'WIN' || d.outcome === 'LOSS') {
        if (streak === 0) {
          streakType = d.outcome;
          streak = 1;
        } else if (d.outcome === streakType) {
          streak++;
        } else {
          break;
        }
      }
    }

    // Max drawdown (simplified: consecutive losses)
    let maxDrawdown = 0;
    let currentDraw = 0;
    for (const d of evaluated) {
      if (d.outcome === 'LOSS') {
        currentDraw += Math.abs(d.pnlPercent || 0);
        maxDrawdown = Math.max(maxDrawdown, currentDraw);
      } else {
        currentDraw = 0;
      }
    }

    // Strategy health
    const recentWinRate = evaluated.length >= 10
      ? (evaluated.slice(0, 10).filter((d) => d.outcome === 'WIN').length / 10) * 100
      : -1;
    let strategyHealth: BotStats['strategyHealth'] = 'GOOD';
    if (recentWinRate >= 60) strategyHealth = 'EXCELLENT';
    else if (recentWinRate >= 45) strategyHealth = 'GOOD';
    else if (recentWinRate >= 30) strategyHealth = 'CAUTION';
    else if (recentWinRate >= 0) strategyHealth = 'CRITICAL';

    const totalPnl = evaluated.reduce((s, d) => s + (d.pnlPercent || 0), 0);
    const todayPnl = todayEvaluated.reduce((s, d) => s + (d.pnlPercent || 0), 0);

    const stats: BotStats = {
      mode: config.mode,
      totalDecisions: allDecisions.length,
      todayDecisions: todayDecisions.length,
      overallWinRate: evaluated.length > 0 ? Math.round((wins / evaluated.length) * 100) : 0,
      todayWinRate: todayEvaluated.length > 0 ? Math.round((todayWins / todayEvaluated.length) * 100) : 0,
      totalPnlPercent: Math.round(totalPnl * 100) / 100,
      todayPnlPercent: Math.round(todayPnl * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      currentStreak: streak,
      streakType,
      strategyHealth,
      optimizerVersion: optimizer.version,
      lastOptimized: optimizer.lastOptimizedAt,
    };

    return NextResponse.json({
      status: 'ok',
      version: 'Phoenix V2 (GTC)',
      stats,
      decisions: allDecisions.slice(0, 50),
      performance,
      strategies: getStrategies(),
      gladiators: gladiatorStore.getGladiators(),
      syndicateAudits: getSyndicateAudits().slice(0, 50),
      v2Entities: {
        masters: [
          { id: 'master_gemini', name: 'Gemini 2.0 Pro', role: 'Master Principal', status: 'ONLINE', power: 100 },
          { id: 'master_fallback', name: 'Claude 3.5 Sonnet', role: 'Elite Fallback', status: 'STANDBY', power: 80 },
          { id: 'master_deepseek', name: 'DeepSeek-R1', role: 'Math Logic', status: 'ACTIVE', power: 85 }
        ],
        manager: {
          name: 'Manager Vizionar',
          role: 'Gatekeeper Tehnic',
          status: 'ORCHESTRATING',
          description: 'Așteaptă 70% consensus de la Oracole.'
        },
        sentinels: {
          riskShield: { name: 'Risk Sentinel', limit: '15% MDD', active: true, triggered: maxDrawdown >= 15 },
          lossDaily: { name: 'Loss Sentinel', limit: '5 Pierderi/Zi', active: true, triggered: todayEvaluated.filter(d => d.outcome === 'LOSS').length >= 5 }
        },
        promoter: {
          name: 'Social Broadcaster',
          role: 'Moltbook Network Hook',
          status: 'AWAITING CRON'
        },
        scouts: {
          name: 'Alpha Scouts',
          role: 'OSINT Gatherer',
          status: 'SCANNING'
        }
      },
      optimizer,
      config,
      equityCurve: getEquityCurve(),
    });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'evaluate': {
        const pendingCount = getDecisions().filter(d => d.outcome === 'PENDING').length;
        return NextResponse.json({ message: `V2 Master Syndicate processing ${pendingCount} pending signals.` });
      }
      case 'optimize': {
        return NextResponse.json({ message: 'V2 optimization runs automatically via Sindicat.' });
      }
      case 'recalculate': {
        const perf = recalculatePerformance();
        return NextResponse.json({ status: 'ok', performance: perf });
      }
      case 'configure': {
        const { config } = body;
        if (config) saveBotConfig(config);
        return NextResponse.json({ status: 'ok', config: getBotConfig() });
      }
      case 'killswitch': {
        const { engage } = body;
        if (engage) {
          engageKillSwitch('Manual kill switch via dashboard', false);
        } else {
          disengageKillSwitch();
        }
        return NextResponse.json({ status: 'ok', killSwitch: getKillSwitchState() });
      }
      default:
        return NextResponse.json(
          { status: 'error', error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
