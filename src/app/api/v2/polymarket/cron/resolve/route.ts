// GET /api/v2/polymarket/cron/resolve — Check market resolutions + close positions
// Two settlement paths run per tick:
//   (A) Legacy: iterate gladiator.phantomBets (in-memory) — fast, but volatile
//       on cold start (json_store persistence broken → phantomBets reset).
//   (B) DB-driven (NEW 2026-05-03): query polymarket_decisions for acted=true
//       AND settled_at IS NULL — decoupled from in-memory state, survives
//       pod restarts. Source of truth = DB.
// Both run in same cron tick. (B) handles the 10K+ historical backlog.
import { NextResponse } from 'next/server';
import { getMarket } from '@/lib/polymarket/polyClient';
import { recordPolyOutcome, promoteToLive, retireUnderperformer } from '@/lib/polymarket/polyGladiators';
import { closePosition } from '@/lib/polymarket/polyWallet';
import { settleDecision } from '@/lib/polymarket/settlementHook';
import { probeSettlementHealth } from '@/lib/polymarket/settlementHealth';
import {
  ensureInitialized,
  getWallet,
  getGladiators,
  persistWallet,
  persistGladiators,
  waitForInit,
} from '@/lib/polymarket/polyState';
import { supabase } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import { requireCronAuth } from '@/lib/core/cronAuth';

const log = createLogger('PolymarketCronResolve');

export const dynamic = 'force-dynamic';

// Hard cap per cron tick — prevents Gamma rate-limiting + cron timeouts.
// At cadence 10min and N=200, max throughput = 1200 settlements/hour.
// 10K backlog → ~9h to drain. Tune via env if needed.
const DB_SETTLE_BATCH = Math.max(1, Number.parseInt(
  process.env.POLY_DB_SETTLE_BATCH ?? '200', 10) || 200);

/** Determine outcome from market.closed + resolvedOutcome + price heuristic. */
function extractOutcome(
  market: { closed?: boolean; outcomes: Array<{ name: string; price: number }> } & Record<string, unknown>,
): 'YES' | 'NO' | 'CANCEL' | null {
  if (!market.closed) return null;

  const ro = market.resolvedOutcome ?? market.resolution;
  if (typeof ro === 'string') {
    const upper = ro.toUpperCase();
    if (upper === 'YES' || upper === 'NO') return upper;
    if (upper === 'CANCEL' || upper === 'N/A') return 'CANCEL';
  }

  // Fallback: price heuristic on highly decisive prices only.
  const yes = market.outcomes.find((o) => o.name?.toUpperCase() === 'YES');
  const no = market.outcomes.find((o) => o.name?.toUpperCase() === 'NO');
  if (yes && no) {
    if (yes.price > 0.95) return 'YES';
    if (yes.price < 0.05) return 'NO';
  }
  return null; // ambiguous — defer
}

/**
 * NEW 2026-05-03 — DB-driven settlement path.
 * Queries polymarket_decisions for acted=true AND settled_at IS NULL.
 * Decouples settlement from in-memory gladiator.phantomBets (volatile on
 * cold start). Required because json_store persistence is broken — every
 * pod restart wipes phantomBets, but DB rows persist.
 * Hard cap DB_SETTLE_BATCH per tick. Dedups by market_id (1 Gamma fetch
 * covers all decisions on same market).
 */
async function settleFromDecisionTable(): Promise<{
  processed: number;
  settled: number;
  skippedOpen: number;
  skippedAmbiguous: number;
  errors: number;
}> {
  const result = { processed: 0, settled: 0, skippedOpen: 0, skippedAmbiguous: 0, errors: 0 };

  try {
    const { data: rows, error } = await supabase
      .from('polymarket_decisions')
      .select('decision_id, market_id, division, direction, decided_at, raw_opportunity')
      .eq('acted', true)
      .is('settled_at', null)
      .order('decided_at', { ascending: true })
      .limit(DB_SETTLE_BATCH);

    if (error) {
      log.warn('[DB-SETTLE] query failed (non-blocking)', { error: String(error) });
      return result;
    }
    if (!rows || rows.length === 0) return result;

    // Group by market_id — single Gamma fetch covers all decisions on same market.
    const byMarket = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byMarket.get(r.market_id) ?? [];
      list.push(r);
      byMarket.set(r.market_id, list);
    }

    for (const [marketId, decisionsForMarket] of byMarket.entries()) {
      result.processed++;
      try {
        const market = await getMarket(marketId);
        if (!market) { result.errors++; continue; }

        // Skip if market has not yet expired.
        const endMs = new Date(market.endDate).getTime();
        if (!Number.isFinite(endMs) || endMs > Date.now()) {
          result.skippedOpen += decisionsForMarket.length;
          continue;
        }

        const outcome = extractOutcome(market as never);
        if (!outcome) {
          result.skippedAmbiguous += decisionsForMarket.length;
          continue;
        }

        // Settle every decision row pointing at this market.
        for (const row of decisionsForMarket) {
          const direction = (row.direction as string) || 'SKIP';
          if (direction !== 'BUY_YES' && direction !== 'BUY_NO') {
            // SKIP / null direction — still mark settled (with null pnl) so we don't re-process.
            await settleDecision({
              decisionId: row.decision_id,
              pnlPercent: 0,
              pnlUsd: 0,
              outcome,
              horizonMs: Date.now() - new Date(row.decided_at).getTime(),
            });
            result.settled++;
            continue;
          }

          // PnL math: buyPrice differs by direction (BUY_NO buys at 1-yesPrice).
          // Without wallet position lookup we can't compute USD PnL exactly,
          // so we report % only — sufficient for WR/PF/learning loop stats.
          // pnlUsd=0 here is intentional: real USD impact is captured by the
          // legacy phantomBets path when in-memory state is alive.
          const yesPrice = (row.raw_opportunity?.market?.outcomes?.[0]?.price as number)
            ?? (row.raw_opportunity?.entryPrice as number)
            ?? 0.5;
          const buyPrice = direction === 'BUY_YES' ? yesPrice : Math.max(0.0001, 1 - yesPrice);
          const isWin =
            (outcome === 'YES' && direction === 'BUY_YES') ||
            (outcome === 'NO' && direction === 'BUY_NO');
          const pnlPercent =
            outcome === 'CANCEL' ? 0
            : isWin ? ((1 - buyPrice) / buyPrice) * 100
            : -100;
          const horizonMs = Date.now() - new Date(row.decided_at).getTime();

          try {
            await settleDecision({
              decisionId: row.decision_id,
              pnlPercent,
              pnlUsd: 0,
              outcome,
              horizonMs: Math.max(0, horizonMs),
            });
            result.settled++;
          } catch (e) {
            log.warn('[DB-SETTLE] settleDecision failed', {
              decisionId: row.decision_id, error: String(e),
            });
            result.errors++;
          }
        }
      } catch (e) {
        log.warn('[DB-SETTLE] market processing failed', { marketId, error: String(e) });
        result.errors++;
      }
    }
  } catch (e) {
    log.warn('[DB-SETTLE] outer error (non-blocking)', { error: String(e) });
  }

  if (result.settled > 0 || result.processed > 0) {
    log.warn('[DB-SETTLE] tick complete', result);
  }
  return result;
}

export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    ensureInitialized();
    await waitForInit();

    const wallet = getWallet();
    const gladiators = getGladiators();

    let betsResolved = 0;
    let positionsClosed = 0;
    let promotions = 0;
    let retirements = 0;

    // (A) Legacy phantomBets path — still useful when in-memory state alive.
    for (const gladiator of gladiators) {
      const unresolvedBets = gladiator.phantomBets.filter(b => !b.resolvedAt);

      for (const bet of unresolvedBets) {
        try {
          const market = await getMarket(bet.marketId);
          if (!market) {
            log.warn('Market not found for bet', { marketId: bet.marketId });
            continue;
          }

          const endDate = new Date(market.endDate).getTime();
          if (endDate > Date.now()) continue;

          let outcome: 'YES' | 'NO' | 'CANCEL' = 'CANCEL';
          if (market.closed) {
            const resolvedOutcome = (market as unknown as Record<string, unknown>).resolvedOutcome
              ?? (market as unknown as Record<string, unknown>).resolution;
            if (typeof resolvedOutcome === 'string') {
              const upper = resolvedOutcome.toUpperCase();
              if (upper === 'YES' || upper === 'NO') outcome = upper;
              else if (upper === 'CANCEL' || upper === 'N/A') outcome = 'CANCEL';
              else {
                log.warn('Unknown resolved outcome, skipping', { marketId: bet.marketId, resolvedOutcome });
                continue;
              }
            } else {
              const yesOutcome = market.outcomes.find(o => o.name.toUpperCase() === 'YES');
              const noOutcome = market.outcomes.find(o => o.name.toUpperCase() === 'NO');
              if (yesOutcome && noOutcome) {
                if (yesOutcome.price > 0.95) outcome = 'YES';
                else if (yesOutcome.price < 0.05) outcome = 'NO';
                else {
                  log.warn('Market closed but price ambiguous, deferring resolution', {
                    marketId: bet.marketId, yesPrice: yesOutcome.price,
                  });
                  continue;
                }
              }
            }
          }

          recordPolyOutcome(gladiator, bet.marketId, outcome);
          betsResolved++;
          log.info('Bet resolved (phantomBets path)', { gladiator: gladiator.id, marketId: bet.marketId, outcome });

          if (gladiator.isLive) {
            const divBalance = wallet.divisionBalances.get(gladiator.division);
            if (divBalance) {
              const position = divBalance.positions.find(p => p.marketId === bet.marketId);
              if (position) {
                const isWin =
                  (outcome === 'YES' && position.direction === 'BUY_YES') ||
                  (outcome === 'NO' && position.direction === 'BUY_NO');
                const exitPrice =
                  outcome === 'CANCEL' ? position.entryPrice
                  : isWin ? 1.00
                  : 0.00;
                const capital = position.capitalAllocated;
                const decisionId = position.decisionId;
                const enteredAtMs = new Date(position.enteredAt).getTime();
                const netPnL = closePosition(wallet, position, exitPrice);
                positionsClosed++;
                if (decisionId) {
                  const pnlPct = capital > 0 ? (netPnL / capital) * 100 : 0;
                  const horizonMs = Math.max(0, Date.now() - enteredAtMs);
                  void settleDecision({ decisionId, pnlPercent: pnlPct, pnlUsd: netPnL, outcome, horizonMs });
                }
                log.info('Position closed', {
                  gladiator: gladiator.id, marketId: bet.marketId, outcome,
                  netPnL: netPnL.toFixed(2), hasDecisionId: !!decisionId,
                });
              }
            }
          }
        } catch (err) {
          log.error('Error resolving bet (phantomBets path)', {
            marketId: bet.marketId, gladiator: gladiator.id, error: String(err),
          });
        }
      }

      const beforePromotion = gladiator.isLive;
      promoteToLive(gladiator);
      if (!beforePromotion && gladiator.isLive) {
        promotions++;
        log.info('Gladiator promoted to live', { id: gladiator.id, readiness: gladiator.readinessScore });
      }

      const beforeRetirement = gladiator.status;
      retireUnderperformer(gladiator);
      if (beforeRetirement !== 'RETIRED' && gladiator.status === 'RETIRED') {
        retirements++;
        log.info('Gladiator retired', { id: gladiator.id, winRate: gladiator.stats.winRate });
      }
    }

    // (B) DB-driven settlement — the new path. Drains polymarket_decisions backlog.
    const dbSettlement = await settleFromDecisionTable();

    await persistWallet();
    await persistGladiators();

    void probeSettlementHealth().catch(() => {});

    return NextResponse.json({
      status: 'ok',
      // Legacy phantomBets path stats:
      betsResolved,
      positionsClosed,
      promotions,
      retirements,
      gladiatorsActive: gladiators.filter(g => g.isLive).length,
      walletBalance: wallet.totalBalance,
      // DB-driven settlement path stats:
      dbSettlement,
      timestamp: Date.now(),
    });
  } catch (err) {
    log.error('Resolve cron error', { error: String(err) });
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 },
    );
  }
}
