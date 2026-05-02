// GET /api/v2/polymarket/cron/scan — Auto scan + evaluate + phantom bet placement
//                                  + AUTO-TRADE top-N by conviction (2026-05-02)
import { NextResponse } from 'next/server';
import { PolyDivision } from '@/lib/polymarket/polyTypes';
import { scanDivision } from '@/lib/polymarket/marketScanner';
import { evaluateMarket, PolyGladiator } from '@/lib/polymarket/polyGladiators';
import { openPosition } from '@/lib/polymarket/polyWallet';
import { correlateDecision } from '@/lib/polymarket/correlationLayer';
import { logDecision } from '@/lib/polymarket/decisionLog';
import { startScanRun, finishScanRun } from '@/lib/polymarket/scanHistory';
import { probeSettlementHealth } from '@/lib/polymarket/settlementHealth';
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

// ── Threshold knobs (env-configurable; safe restore via env change) ──
const EDGE_MIN = Number.parseInt(process.env.POLY_EDGE_MIN ?? '50', 10);
const CONF_MIN = Number.parseInt(process.env.POLY_CONF_MIN ?? '50', 10);

// ── FAZA 4.3 — scan rotation knobs ───────────────────────────────────
const ROT_COUNT = Math.max(0, Number.parseInt(process.env.POLY_SCAN_ROTATION_COUNT ?? '3', 10) || 0);
const ROT_PERIOD_MS =
  Math.max(1, Number.parseInt(process.env.POLY_SCAN_ROTATION_PERIOD_MIN ?? '15', 10) || 15) * 60_000;

// ── AUTO-TRADE top-N by conviction (2026-05-02) ──────────────────────
// When >0, scan cron collects ALL qualifying opportunities, sorts by conviction
// (correlated.finalScore DESC), takes top N, and opens positions BYPASSING the
// gladiator.isLive promotion gate. Force-promotes selected gladiators so the
// resolve cron closes their positions on market resolution.
//
// Kill: POLY_AUTO_TRADE_TOP_N=0 → reverts to legacy isLive-gated path.
// Safety net (existing in polyWallet, unchanged):
//   - daily loss limit: -$50 → tradingDisabledReason set, openPosition returns null
//   - per-position loss: -$25 → same
//   - MAX_POSITIONS_PER_DIVISION=5 → openPosition returns null when full
//   - MAX_BET_PCT_OF_DIVISION_BALANCE=10% → caps bet size
const AUTO_TRADE_TOP_N = Math.max(0, Number.parseInt(process.env.POLY_AUTO_TRADE_TOP_N ?? '0', 10) || 0);

// Type for the candidate queue used in AUTO-TRADE mode.
interface AutoTradeCandidate {
  gladiator: PolyGladiator;
  marketId: string;
  division: PolyDivision;
  outcomeId: string;
  direction: 'BUY_YES' | 'BUY_NO';
  entryPrice: number;
  confidence: number;
  edgeScore: number;
  conviction: number; // ranking key (correlated.finalScore)
  decisionId?: string;
}

// ─── ADMIN: One-shot gladiator reset (added 2026-05-02) ─────────────────────
async function maybeResetGladiators(
  gladiators: ReturnType<typeof getGladiators>,
): Promise<{ applied: boolean; token?: string; reason?: string }> {
  const token = process.env.POLY_RESET_GLADIATORS_TOKEN;
  if (!token) return { applied: false, reason: 'no_token' };

  const STORE_KEY = 'poly_reset_gladiators_token';
  try {
    const { data } = await supabase
      .from('json_store')
      .select('value')
      .eq('key', STORE_KEY)
      .single();
    const lastApplied = (data?.value as string) || null;
    if (lastApplied === token) {
      return { applied: false, reason: 'token_already_applied' };
    }

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

    // ADMIN: one-shot reset trigger (token-gated, idempotent)
    const resetResult = await maybeResetGladiators(gladiators);

    // Priority divisions — always scanned every tick (highest liquidity / volume).
    const priorityDivisions = [PolyDivision.TRENDING, PolyDivision.CRYPTO, PolyDivision.POLITICS];

    // FAZA 4.3 — deterministic time-bucket rotation across remaining divisions.
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

    // AUTO-TRADE: candidate queue, populated during loop, processed after.
    const autoTradeCandidates: AutoTradeCandidate[] = [];

    // FAZA 3.4 — open scan-history run for audit trail + drill-down
    const envSnapshot = {
      EDGE_MIN,
      CONF_MIN,
      AUTO_TRADE_TOP_N,
      ACT_THRESHOLD: process.env.POLY_FINAL_ACT_THRESHOLD ?? '45',
      CORRELATION_ENABLED: process.env.POLYMARKET_CORRELATION_ENABLED !== '0',
      GOLDSKY_CORRELATION: process.env.POLYMARKET_GOLDSKY_CORRELATION !== '0',
    };
    const { runId, startedAt } = await startScanRun(envSnapshot);

    // Scan priority + rotated divisions (FAZA 4.3).
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
            gladiator,
            market: opportunity.market,
            decision: correlated,
            opportunity,
            acted: correlated.shouldAct,
            runId,
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

            // AUTO-TRADE mode: queue for ranking, defer position open until after all divisions.
            if (AUTO_TRADE_TOP_N > 0) {
              autoTradeCandidates.push({
                gladiator,
                marketId: opportunity.marketId,
                division,
                outcomeId: resolvedOutcomeId,
                direction: evaluation.direction,
                entryPrice: bet.entryPrice,
                confidence: evaluation.confidence,
                edgeScore: opportunity.edgeScore,
                conviction: correlated.finalScore,
                decisionId,
              });
            } else if (gladiator.isLive && bet.outcomeId) {
              // Legacy path: open immediately when isLive.
              const position = openPosition(
                wallet,
                opportunity.marketId,
                division,
                bet.outcomeId,
                evaluation.direction,
                bet.entryPrice,
                evaluation.confidence,
                opportunity.edgeScore,
                decisionId,
              );
              if (position) {
                log.info('Opened live position (legacy)', {
                  marketId: opportunity.marketId,
                  division,
                  gladiator: gladiator.id,
                  capital: position.capitalAllocated,
                });
              }
            }

            betsPlaced++;
            log.info('Phantom bet placed', {
              gladiator: gladiator.id,
              marketId: opportunity.marketId,
              direction: evaluation.direction,
              confidence: evaluation.confidence,
            });
          }
        }
      } catch (err) {
        const errStr = String(err);
        log.error('Error scanning division', { division, error: errStr });
        scanErrors.push({ division, error: errStr });
      }
    }

    // ─── AUTO-TRADE: rank candidates by conviction, take top N, open positions ───
    let autoTradeOpened = 0;
    let autoTradePromoted = 0;
    const autoTradeOpened_details: Array<{ marketId: string; division: string; conviction: number; capital: number }> = [];
    if (AUTO_TRADE_TOP_N > 0 && autoTradeCandidates.length > 0) {
      // Sort DESC by conviction (correlated.finalScore). Tiebreak: confidence then edgeScore.
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
      });

      for (const c of top) {
        // Force-promote so resolve cron closes positions naturally on market resolution.
        // Side effect retained beyond this tick — gladiator stays ACTIVE.
        if (!c.gladiator.isLive) {
          c.gladiator.isLive = true;
          c.gladiator.status = 'ACTIVE';
          autoTradePromoted++;
          log.warn('[AUTO-TRADE] Force-promoted gladiator', {
            id: c.gladiator.id,
            division: c.division,
            reason: 'top-N AUTO-TRADE selection',
          });
        }

        // openPosition is gated by polyWallet's safety net:
        //   - daily/per-position loss limits
        //   - MAX_POSITIONS_PER_DIVISION cap
        //   - MAX_BET_PCT_OF_DIVISION_BALANCE cap
        // Returns null if any gate trips — we just skip silently.
        const position = openPosition(
          wallet,
          c.marketId,
          c.division,
          c.outcomeId,
          c.direction,
          c.entryPrice,
          c.confidence,
          c.edgeScore,
          c.decisionId,
        );

        if (position) {
          autoTradeOpened++;
          autoTradeOpened_details.push({
            marketId: c.marketId,
            division: c.division,
            conviction: c.conviction,
            capital: position.capitalAllocated,
          });
          log.warn('[AUTO-TRADE] Position opened', {
            marketId: c.marketId,
            division: c.division,
            gladiator: c.gladiator.id,
            conviction: c.conviction.toFixed(1),
            confidence: c.confidence,
            edgeScore: c.edgeScore,
            direction: c.direction,
            capital: position.capitalAllocated,
          });
        } else {
          log.info('[AUTO-TRADE] openPosition skipped (loss limit / max positions / size)', {
            marketId: c.marketId,
            division: c.division,
          });
        }
      }
    }

    setLastScans(lastScans);
    await persistWallet();
    await persistGladiators();

    // FAZA 3.4 — close scan-history run (best-effort; never throws upstream)
    await finishScanRun(runId, startedAt, {
      divisionsScanned: scannedDivisions,
      opportunitiesFound,
      betsPlaced,
      decisionsLogged,
      errors: scanErrors,
      envSnapshot,
    });

    void probeSettlementHealth().catch(() => {});

    return NextResponse.json({
      status: 'ok',
      runId,
      divisionsScanned: scannedDivisions,
      opportunitiesFound,
      betsPlaced,
      decisionsLogged,
      gladiatorsActive: gladiators.filter(g => g.isLive).length,
      walletBalance: wallet.totalBalance,
      resetGladiators: resetResult,
      autoTrade: {
        enabled: AUTO_TRADE_TOP_N > 0,
        topN: AUTO_TRADE_TOP_N,
        candidatesQueued: autoTradeCandidates.length,
        positionsOpened: autoTradeOpened,
        gladiatorsPromoted: autoTradePromoted,
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
