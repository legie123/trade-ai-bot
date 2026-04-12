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
  getSyndicateAudits,
  getLivePositions,
} from '@/lib/store/db';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { engageKillSwitch, disengageKillSwitch, getKillSwitchState } from '@/lib/core/killSwitch';
import { getWatchdogState } from '@/lib/core/watchdog';
import { BotStats } from '@/lib/types/radar';
import { PromotersAggregator } from '@/lib/v2/promoters/promotersAggregator';
import { SentinelGuard } from '@/lib/v2/safety/sentinelGuard';
import { isAuthenticated } from '@/lib/auth';
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

    // Calculate Real-Time Floating PnL
    const activePositions = getLivePositions().filter(p => p.status === 'OPEN');
    let floatingPnlValue = 0;
    
    for (const pos of activePositions) {
      if (pos.currentPrice && pos.entryPrice) {
        const rawDiff = pos.currentPrice - pos.entryPrice;
        const diffPercent = (rawDiff / pos.entryPrice) * 100;
        const pnlPercent = pos.side === 'LONG' ? diffPercent : -diffPercent;
        
        // Default position size roughly 20%
        const currentBalance = config.paperBalance || 1000;
        const tradeImpact = currentBalance * (20 / 100) * (pnlPercent / 100);
        floatingPnlValue += tradeImpact;
      }
    }

    const baseEquityCurve = getEquityCurve();

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
      activePositions: activePositions.map(p => ({
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        size: 0.20
      })),
      // Filter out pre-v4 zero-data artifacts from public API
      decisions: allDecisions.filter(d => d.price > 0).slice(0, 50),
      performance,
      gladiators: gladiatorStore.getGladiators(),
      syndicateAudits: getSyndicateAudits().slice(0, 50),
      v2Entities: {
        masters: [
          { id: 'master_gemini', name: 'Gemini 1.5 Pro (Architect)', role: 'Master Principal (Architect)', status: process.env.GEMINI_API_KEY ? 'ONLINE' : 'NO_API_KEY', power: 100, reason: process.env.GEMINI_API_KEY ? 'API key configured' : 'Missing GEMINI_API_KEY in env' },
          { id: 'master_fallback', name: 'GPT-4o (Oracle)', role: 'Oracle (Sentiment)', status: process.env.OPENAI_API_KEY ? 'ONLINE' : 'NO_API_KEY', power: 80, reason: process.env.OPENAI_API_KEY ? 'API key configured' : 'Missing OPENAI_API_KEY in env' },
          { id: 'master_deepseek', name: 'DeepSeek-R1', role: 'Math Logic', status: 'ACTIVE', power: 85, reason: 'Built-in heuristic engine — no API required' }
        ],
        manager: {
          name: 'Manager Vizionar',
          role: 'Gatekeeper Tehnic',
          status: todayDecisions.length > 0 ? 'ORCHESTRATING' : 'IDLE',
          description: todayDecisions.length > 0 ? `Processing ${todayDecisions.length} decisions today. Consensus threshold: 70%.` : 'Waiting for market signals to process.'
        },
        sentinels: {
          riskShield: { name: 'Risk Sentinel', limit: '10% MDD', active: true, triggered: maxDrawdown >= 10, currentValue: `${maxDrawdown.toFixed(2)}%`, lastIncident: maxDrawdown >= 10 ? 'MDD threshold breached (10%)' : null },
          lossDaily: { name: 'Loss Sentinel', limit: '5 Pierderi/Zi', active: true, triggered: todayEvaluated.filter(d => d.outcome === 'LOSS').length >= 5, currentValue: `${todayEvaluated.filter(d => d.outcome === 'LOSS').length} losses`, lastIncident: todayEvaluated.filter(d => d.outcome === 'LOSS').length >= 5 ? 'Daily loss limit reached' : null },
          winRateGuard: { name: 'Win Rate Guard', limit: '35% Rolling WR', active: true, triggered: stats.overallWinRate < 35 && evaluated.length >= 10, currentValue: `${stats.overallWinRate}% WR (${evaluated.length} trades)` },
          streakBreaker: { name: 'Streak Breaker', limit: '5 Consecutive Losses', active: true, triggered: streak >= 5 && streakType === 'LOSS', currentValue: `${streak} ${streakType}` },
          watchdog: { name: 'Neural Watchdog', limit: '5min timeout', active: true, triggered: getKillSwitchState().engaged, currentValue: getWatchdogState().status, lastPing: getWatchdogState().lastPing },
          killSwitch: { name: 'Kill Switch', limit: 'Manual Override', active: true, triggered: getKillSwitchState().engaged, currentValue: getKillSwitchState().engaged ? 'ENGAGED' : 'SAFE', reason: getKillSwitchState().reason },
        },
        promoter: {
          name: 'Social Broadcaster',
          role: 'Moltbook Network Hook',
          status: process.env.MOLTBOOK_API_KEY ? 'READY' : 'NO_API_KEY'
        },
        scouts: {
          name: 'Alpha Scouts',
          role: 'OSINT Gatherer',
          status: 'SCANNING'
        }
      },
      optimizer,
      config,
      equityCurve: baseEquityCurve,
      floatingPnl: floatingPnlValue,
      // ═══ AUDIT COHERENCE: Unified execution state machine ═══
      riskGuards: SentinelGuard.getInstance().getRiskMetrics(),
      executionPermitted: {
        allowed: !config.haltedUntil || new Date(config.haltedUntil) < new Date(),
        mode: config.mode,
        haltedUntil: config.haltedUntil || null,
        reason: config.haltedUntil && new Date(config.haltedUntil) > new Date()
          ? `System halted until ${config.haltedUntil}` 
          : stats.overallWinRate < 35 && evaluated.length >= 10 ? 'Win Rate Guard active (WR < 35%)'
          : streak >= 5 && streakType === 'LOSS' ? 'Streak Breaker active (5+ consecutive losses)'
          : maxDrawdown >= 10 ? 'MDD Guard active (DD >= 10%)'
          : null,
        confidenceCap: stats.overallWinRate < 30 ? 0.40 : stats.overallWinRate < 50 ? 0.65 : 1.0,
      },
    });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
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
      case 'trigger-promoter': {
        const promoter = PromotersAggregator.getInstance();
        const message = await promoter.broadcastArenaStatus();
        return NextResponse.json({ status: 'ok', message });
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
