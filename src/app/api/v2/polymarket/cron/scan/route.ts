// GET /api/v2/polymarket/cron/scan — Auto scan + evaluate + phantom bet placement
import { NextResponse } from 'next/server';
import { PolyDivision } from '@/lib/polymarket/polyTypes';
import { scanDivision } from '@/lib/polymarket/marketScanner';
import { evaluateMarket } from '@/lib/polymarket/polyGladiators';
import { openPosition } from '@/lib/polymarket/polyWallet';
import { correlateDecision } from '@/lib/polymarket/correlationLayer';
import { logDecision } from '@/lib/polymarket/decisionLog';
import { startScanRun, finishScanRun } from '@/lib/polymarket/scanHistory';
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
import { createLogger } from '@/lib/core/logger';
import { requireCronAuth } from '@/lib/core/cronAuth';

const log = createLogger('PolymarketCronScan');

export const dynamic = 'force-dynamic';

// ── Threshold knobs (env-configurable; safe restore via env change) ──
// Rationale: with defaults 50/50 and current markets, 12 scans in 45min produced 0 phantom bets.
// Lowering lets training loop start. Risk bounded: PAPER wallet + phantomBets don't touch capital
// unless gladiator.isLive === true, which requires WR>55 + readiness>70 + ≥20 bets.
// Kill/restore: unset POLY_EDGE_MIN / POLY_CONF_MIN → defaults to historical 50/50.
const EDGE_MIN = Number.parseInt(process.env.POLY_EDGE_MIN ?? '50', 10);
const CONF_MIN = Number.parseInt(process.env.POLY_CONF_MIN ?? '50', 10);

export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    ensureInitialized();
    await waitForInit();

    const wallet = getWallet();
    const gladiators = getGladiators();
    const lastScans = getLastScans();

    // Pick 3 priority divisions, rotating through others
    const priorityDivisions = [PolyDivision.TRENDING, PolyDivision.CRYPTO, PolyDivision.POLITICS];

    let betsPlaced = 0;
    let opportunitiesFound = 0;
    let decisionsLogged = 0;
    const scannedDivisions: string[] = [];
    const scanErrors: Array<{ division: string; error: string }> = [];

    // FAZA 3.4 — open scan-history run for audit trail + drill-down
    const envSnapshot = {
      EDGE_MIN,
      CONF_MIN,
      ACT_THRESHOLD: process.env.POLY_FINAL_ACT_THRESHOLD ?? '45',
      CORRELATION_ENABLED: process.env.POLYMARKET_CORRELATION_ENABLED !== '0',
      GOLDSKY_CORRELATION: process.env.POLYMARKET_GOLDSKY_CORRELATION !== '0',
    };
    const { runId, startedAt } = await startScanRun(envSnapshot);

    // Scan the 3 priority divisions
    for (const division of priorityDivisions) {
      try {
        log.info('Scanning division', { division });
        const result = await scanDivision(division, 15);
        scannedDivisions.push(division);
        lastScans[division] = result;

        opportunitiesFound += result.opportunities.length;

        // Find gladiator for this division
        const gladiator = gladiators.find(g => g.division === division);
        if (!gladiator) {
          log.warn('No gladiator found for division', { division });
          continue;
        }

        // Evaluate each opportunity and place phantom bets
        for (const opportunity of result.opportunities) {
          if (opportunity.edgeScore < EDGE_MIN) continue; // Skip low edge scores (env POLY_EDGE_MIN)

          const evaluation = evaluateMarket(gladiator, opportunity.market, opportunity);

          // FAZA 3.3: Correlate decision cross-source (edge × goldsky × karma × liquidity).
          // Runs async (may hit Goldsky subgraph) but is budget-bounded: only
          // calls Goldsky when evaluation edge >= MIN_EDGE_FOR_GOLDSKY (default 40).
          // Graceful degradation: any source unavailable → multiplier=1.0 (neutru).
          const correlated = await correlateDecision(gladiator, opportunity.market, evaluation, opportunity);

          // Always log decision (acted or not). Best-effort persist — never blocks.
          // This row is the audit trail for FAZA 3.4 drill-down. runId links
          // the decision to its scan-history row (nullable — scan history is soft).
          // FAZA 3.7: AWAIT logDecision to capture decisionId (uuid is generated
          // locally even if INSERT fails, so threading is safe regardless of DB
          // state). decisionId is attached to the wallet position so resolve
          // cron can call settleDecision() with realized PnL.
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

          // Place phantom bet if correlation says so (replaces old plain CONF_MIN gate).
          // Back-compat: if correlation is disabled, correlated.shouldAct falls back to
          // the classic (direction!=SKIP && confidence>=50) condition.
          // NOTE: explicit `direction !== 'SKIP'` is redundant with shouldAct but
          // restores TypeScript flow-narrowing for the openPosition() call below,
          // which requires direction ∈ {BUY_YES, BUY_NO}.
          if (correlated.shouldAct && evaluation.direction !== 'SKIP' && evaluation.confidence >= CONF_MIN) {
            // Create phantom bet on gladiator.
            // Outcome resolution: prefer literal YES/NO match, fallback to
            // positional [0]=YES/[1]=NO for markets with arbitrary labels
            // (NBA teams, candidate names). Sync cu paper-seed pickOutcomeId.
            const outcomes = opportunity.market.outcomes || [];
            let resolvedOutcomeId = outcomes.find(
                o => (evaluation.direction === 'BUY_YES' && o.name.toUpperCase() === 'YES') ||
                     (evaluation.direction === 'BUY_NO' && o.name.toUpperCase() === 'NO'),
              )?.id;
            if (!resolvedOutcomeId) {
              const idx = evaluation.direction === 'BUY_YES' ? 0 : 1;
              resolvedOutcomeId = outcomes[idx]?.id;
            }
            if (!resolvedOutcomeId) continue; // Skip if outcome not found — prevents phantom/live bets with invalid ID

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

            // If gladiator is live, actually open position on wallet
            if (gladiator.isLive && bet.outcomeId) {
              const position = openPosition(
                wallet,
                opportunity.marketId,
                division,
                bet.outcomeId,
                evaluation.direction,
                bet.entryPrice,
                evaluation.confidence,
                opportunity.edgeScore,
                decisionId, // FAZA 3.7 — thread uuid so resolve can settle pnl
              );

              if (position) {
                log.info('Opened live position', {
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

    return NextResponse.json({
      status: 'ok',
      runId,
      divisionsScanned: scannedDivisions,
      opportunitiesFound,
      betsPlaced,
      decisionsLogged,
      gladiatorsActive: gladiators.filter(g => g.isLive).length,
      walletBalance: wallet.totalBalance,
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
