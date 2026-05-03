// GET /api/v2/polymarket/cron/scan — Auto scan + evaluate + phantom bet placement
//                                  + AUTO-TRADE top-N by conviction (2026-05-02)
//                                  + riskManager guard (2026-05-03 Phase 1.3)
import { NextResponse } from 'next/server';
import { PolyDivision, PolyOpportunity } from '@/lib/polymarket/polyTypes';
import { scanDivision } from '@/lib/polymarket/marketScanner';
import { evaluateMarket, PolyGladiator } from '@/lib/polymarket/polyGladiators';
import { openPosition } from '@/lib/polymarket/polyWallet';
import { correlateDecision } from '@/lib/polymarket/correlationLayer';
import { logDecision } from '@/lib/polymarket/decisionLog';
import { startScanRun, finishScanRun } from '@/lib/polymarket/scanHistory';
import { probeSettlementHealth } from '@/lib/polymarket/settlementHealth';
import { checkRisk } from '@/lib/polymarket/riskManager';
import {
  ensureInitialized,
  getWallet,
  getGladiators,
  getLastScans,
  setLastScans,
  persistWallet,
  persistGladiators,
  waitForInit,
} from '@/lib/polymarket/polyState';
import { supabase } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import { requireCronAuth } from '@/lib/core/cronAuth';

const log = createLogger('PolymarketCronScan');

export const dynamic = 'force-dynamic';

const EDGE_MIN = Number.parseInt(process.env.POLY_EDGE_MIN ?? '50', 10);
const CONF_MIN = Number.parseInt(process.env.POLY_CONF_MIN ?? '50', 10);

const ROT_COUNT = Math.max(0, Number.parseInt(process.env.POLY_SCAN_ROTATION_COUNT ?? '3', 10) || 0);
const ROT_PERIOD_MS =
  Math.max(1, Number.parseInt(process.env.POLY_SCAN_ROTATION_PERIOD_MIN ?? '15', 10) || 15) * 60_000;

const AUTO_TRADE_TOP_N = Math.max(0, Number.parseInt(process.env.POLY_AUTO_TRADE_TOP_N ?? '0', 10) || 0);
const RISK_GATE_ENABLED = (process.env.POLY_RISK_GATE_ENABLED ?? '1') !== '0';

interface AutoTradeCandidate {
  gladiator: PolyGladiator;
  opportunity: PolyOpportunity;
  marketId: string;
  division: PolyDivision;
  outcomeId: string;
  direction: 'BUY_YES' | 'BUY_NO';
  entryPrice: number;
  confidence: number;
  edgeScore: number;
  conviction: number;
  decisionId?: string;
}

async function maybeResetGladiators(
  gladiators: ReturnType<typeof getGladiators>,
): Promise<{ applied: boolean; token?: string; reason?: string }> {
  const token = process.env.POLY_RESET_GLADIATORS_TOKEN;
  if (!token) return { applied: false, reason: 'no_token' };

  const STORE_KEY = 'poly_reset_gladiators_token';
  try {
    const { data } = await supabase
      .from('json_store').select('value').eq('key', STORE_KEY).single();
    const lastApplied = (data?.value as string) || null;
    if (lastApplied === token) return { applied: false, reason: 'token_already_applied' };

    log.warn('[ADMIN] Applying gladiator reset', { token, lastApplied, glads: gladiators.length });

    for (const g of gladiators) {
      g.stats = { winRate: 0, profitFactor: 1.0, maxDrawdown: 0, sharpeRatio: 0, totalTrades: 0 };
      g.phantomBets = [];
      g.cumulativeEdge = 0;
      g.readinessScore = 30;
      g.status = 'IN_TRAINING';
      g.isLive = false;
      g.lastUpdated = Date.now();
      delete (g.stats as { grossWins?: number }).grossWins;
      delete (g.stats as { grossLosses?: number }).grossLosses;
    }

    await persistGladiators();
    await supabase
      .from('json_store')
      .upsert({ key: STORE_KEY, value: token }, { onConflict: 'key' });

    log.warn('[ADMIN] Gladiator reset complete', { token, glads: gladiators.length });
    return { applied: true, token };
  } catch (e) {
    log.warn('[ADMIN] Reset attempt failed (non-blocking)', { error: String(e) });
    return { applied: false, reason: 'error' };
  }
}

export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    ensureInitialized();
    await waitForInit();

    const wallet = getWallet();
    const gladiators = getGladiators();
    const lastScans = getLastScans();

    const resetResult = await maybeResetGladiators(gladiators);

    const priorityDivisions = [PolyDivision.TRENDING, PolyDivision.CRYPTO, PolyDivision.POLITICS];
    const allDivisions = Object.values(PolyDivision);
    const nonPriority = allDivisions.filter(d => !priorityDivisions.includes(d));
    let rotated: PolyDivision[] = [];
    if (ROT_COUNT > 0 && nonPriority.length > 0) {
      const bucket = Math.floor(Date.now() / ROT_PERIOD_MS);
      const start = ((bucket * ROT_COUNT) % nonPriority.length + nonPriority.length) % nonPriority.length;
      const take = Math.min(ROT_COUNT, nonPriority.length);
      for (let i = 0; i < take; i++) {
        rotated.push(nonPriority[(start + i) % nonPriority.length]);
      }
    }
    const divisionsToScan: PolyDivision[] = [...priorityDivisions, ...rotated];

    let betsPlaced = 0;
    let opportunitiesFound = 0;
    let decisionsLogged = 0;
    const scannedDivisions: string[] = [];
    const scanErrors: Array<{ division: string; error: string }> = [];

    const autoTradeCandidates: AutoTradeCandidate[] = [];

    const envSnapshot = {
      EDGE_MIN, CONF_MIN, AUTO_TRADE_TOP_N,
      RISK_GATE_ENABLED,
      ACT_THRESHOLD: process.env.POLY_FINAL_ACT_THRESHOLD ?? '45',
      CORRELATION_ENABLED: process.env.POLYMARKET_CORRELATION_ENABLED !== '0',
      GOLDSKY_CORRELATION: process.env.POLYMARKET_GOLDSKY_CORRELATION !== '0',
    };
    const { runId, startedAt } = await startScanRun(envSnapshot);

    for (const division of divisionsToScan) {
      try {
        log.info('Scanning division', { division });
        const result = await scanDivision(division, 15);
        scannedDivisions.push(division);
        lastScans[division] = result;
        opportunitiesFound += result.opportunities.length;

        const gladiator = gladiators.find(g => g.division === division);
        if (!gladiator) {
          log.warn('No gladiator found for division', { division });
          continue;
        }

        for (const opportunity of result.opportunities) {
          if (opportunity.edgeScore < EDGE_MIN) continue;

          const evaluation = evaluateMarket(gladiator, opportunity.market, opportunity);
          const correlated = await correlateDecision(gladiator, opportunity.market, evaluation, opportunity);

          decisionsLogged++;
          const logRes = await logDecision({
            gladiator, market: opportunity.market, decision: correlated,
            opportunity, acted: correlated.shouldAct, runId,
          });
          const decisionId = logRes.decisionId;

          if (correlated.shouldAct && evaluation.direction !== 'SKIP' && evaluation.confidence >= CONF_MIN) {
            const outcomes = opportunity.market.outcomes || [];
            let resolvedOutcomeId = outcomes.find(
                o => (evaluation.direction === 'BUY_YES' && o.name.toUpperCase() === 'YES') ||
                     (evaluation.direction === 'BUY_NO' && o.name.toUpperCase() === 'NO'),
              )?.id;
            if (!resolvedOutcomeId) {
              const idx = evaluation.direction === 'BUY_YES' ? 0 : 1;
              resolvedOutcomeId = outcomes[idx]?.id;
            }
            if (!resolvedOutcomeId) continue;

            const bet = {
              id: `bet-${opportunity.marketId}-${Date.now()}`,
              marketId: opportunity.marketId,
              direction: evaluation.direction,
              outcomeId: resolvedOutcomeId,
              entryPrice: opportunity.market.outcomes[0]?.price || 0.5,
              shares: 0,
              confidence: evaluation.confidence,
              reasoning: `${evaluation.reasoning} | final=${correlated.finalScore.toFixed(1)} [edge×gs×km×liq=${correlated.edgeScore}×${correlated.goldskyConfirm.toFixed(2)}×${correlated.moltbookKarma.toFixed(2)}×${correlated.liquiditySanity.toFixed(2)}]`,
              placedAt: new Date().toISOString(),
            };

            gladiator.phantomBets.push(bet);

            if (AUTO_TRADE_TOP_N > 0) {
              autoTradeCandidates.push({
                gladiator, opportunity,
                marketId: opportunity.marketId, division,
                outcomeId: resolvedOutcomeId,
                direction: evaluation.direction,
                entryPrice: bet.entryPrice,
                confidence: evaluation.confidence,
                edgeScore: opportunity.edgeScore,
                conviction: correlated.finalScore,
                decisionId,
              });
            } else if (gladiator.isLive && bet.outcomeId) {
              const position = openPosition(
                wallet, opportunity.marketId, division, bet.outcomeId,
                evaluation.direction, bet.entryPrice, evaluation.confidence,
                opportunity.edgeScore, decisionId,
              );
              if (position) {
                log.info('Opened live position (legacy)', {
                  marketId: opportunity.marketId, division,
                  gladiator: gladiator.id, capital: position.capitalAllocated,
                });
              }
            }

            betsPlaced++;
          }
        }
      } catch (err) {
        const errStr = String(err);
        log.error('Error scanning division', { division, error: errStr });
        scanErrors.push({ division, error: errStr });
      }
    }

    let autoTradeOpened = 0;
    let autoTradePromoted = 0;
    let autoTradeRiskRejected = 0;
    const autoTradeOpened_details: Array<{
      marketId: string; division: string; conviction: number; capital: number;
    }> = [];
    const riskRejectionReasons: Record<string, number> = {};

    if (AUTO_TRADE_TOP_N > 0 && autoTradeCandidates.length > 0) {
      autoTradeCandidates.sort((a, b) => {
        if (b.conviction !== a.conviction) return b.conviction - a.conviction;
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return b.edgeScore - a.edgeScore;
      });

      const top = autoTradeCandidates.slice(0, AUTO_TRADE_TOP_N);
      log.warn('[AUTO-TRADE] Selecting top-N candidates', {
        N: AUTO_TRADE_TOP_N,
        candidatesTotal: autoTradeCandidates.length,
        topConvictions: top.map(c => c.conviction.toFixed(1)),
        riskGateEnabled: RISK_GATE_ENABLED,
      });

      for (const c of top) {
        if (RISK_GATE_ENABLED) {
          try {
            const risk = checkRisk(wallet, c.opportunity, c.confidence, c.edgeScore);
            if (!risk.allowed) {
              autoTradeRiskRejected++;
              riskRejectionReasons[risk.reason] = (riskRejectionReasons[risk.reason] || 0) + 1;
              log.warn('[AUTO-TRADE] Risk gate REJECTED candidate', {
                marketId: c.marketId, division: c.division,
                reason: risk.reason, riskLevel: risk.riskLevel,
                conviction: c.conviction.toFixed(1),
              });
              continue;
            }
          } catch (e) {
            log.warn('[AUTO-TRADE] Risk check threw, skipping candidate', {
              marketId: c.marketId, error: String(e),
            });
            autoTradeRiskRejected++;
            riskRejectionReasons['risk_check_error'] = (riskRejectionReasons['risk_check_error'] || 0) + 1;
            continue;
          }
        }

        if (!c.gladiator.isLive) {
          c.gladiator.isLive = true;
          c.gladiator.status = 'ACTIVE';
          autoTradePromoted++;
        }

        const position = openPosition(
          wallet, c.marketId, c.division, c.outcomeId, c.direction,
          c.entryPrice, c.confidence, c.edgeScore, c.decisionId,
        );

        if (position) {
          autoTradeOpened++;
          autoTradeOpened_details.push({
            marketId: c.marketId, division: c.division,
            conviction: c.conviction, capital: position.capitalAllocated,
          });
        }
      }
    }

    setLastScans(lastScans);
    await persistWallet();
    await persistGladiators();

    await finishScanRun(runId, startedAt, {
      divisionsScanned: scannedDivisions, opportunitiesFound,
      betsPlaced, decisionsLogged, errors: scanErrors, envSnapshot,
    });

    void probeSettlementHealth().catch(() => {});

    return NextResponse.json({
      status: 'ok', runId,
      divisionsScanned: scannedDivisions, opportunitiesFound, betsPlaced, decisionsLogged,
      gladiatorsActive: gladiators.filter(g => g.isLive).length,
      walletBalance: wallet.totalBalance,
      resetGladiators: resetResult,
      autoTrade: {
        enabled: AUTO_TRADE_TOP_N > 0,
        topN: AUTO_TRADE_TOP_N,
        candidatesQueued: autoTradeCandidates.length,
        positionsOpened: autoTradeOpened,
        gladiatorsPromoted: autoTradePromoted,
        riskRejected: autoTradeRiskRejected,
        riskRejectionReasons,
        details: autoTradeOpened_details,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    log.error('Scan cron error', { error: String(err) });
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 },
    );
  }
}
