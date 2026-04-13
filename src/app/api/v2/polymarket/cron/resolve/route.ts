// GET /api/v2/polymarket/cron/resolve — Check market resolutions + close positions
import { NextResponse } from 'next/server';
import { getMarket } from '@/lib/polymarket/polyClient';
import { recordPolyOutcome, promoteToLive, retireUnderperformer } from '@/lib/polymarket/polyGladiators';
import { closePosition } from '@/lib/polymarket/polyWallet';
import {
  ensureInitialized,
  getWallet,
  getGladiators,
  persistWallet,
  persistGladiators,
  waitForInit,
} from '@/lib/polymarket/polyState';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolymarketCronResolve');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    ensureInitialized();
    await waitForInit();

    const wallet = getWallet();
    const gladiators = getGladiators();

    let betsResolved = 0;
    let positionsClosed = 0;
    let promotions = 0;
    let retirements = 0;

    // For each gladiator's unresolved phantom bets
    for (const gladiator of gladiators) {
      const unresolvedBets = gladiator.phantomBets.filter(b => !b.resolvedAt);

      for (const bet of unresolvedBets) {
        try {
          const market = await getMarket(bet.marketId);
          if (!market) {
            log.warn('Market not found for bet', { marketId: bet.marketId });
            continue;
          }

          // Check if market has ended
          const endDate = new Date(market.endDate).getTime();
          if (endDate > Date.now()) {
            // Market still open
            continue;
          }

          // Market has ended, determine outcome
          let outcome: 'YES' | 'NO' | 'CANCEL' = 'CANCEL';

          if (market.closed) {
            // Get final prices
            const yesOutcome = market.outcomes.find(o => o.name.toUpperCase() === 'YES');
            const noOutcome = market.outcomes.find(o => o.name.toUpperCase() === 'NO');

            if (yesOutcome && noOutcome) {
              if (yesOutcome.price > 0.95) outcome = 'YES';
              else if (yesOutcome.price < 0.05) outcome = 'NO';
              else if (yesOutcome.price > 0.5) outcome = 'YES';
              else outcome = 'NO';
            }
          }

          // Record outcome on gladiator
          recordPolyOutcome(gladiator, bet.marketId, outcome);
          betsResolved++;

          log.info('Bet resolved', {
            gladiator: gladiator.id,
            marketId: bet.marketId,
            outcome,
          });

          // If gladiator had a live position on this market, close it
          if (gladiator.isLive) {
            const divBalance = wallet.divisionBalances.get(gladiator.division);
            if (divBalance) {
              const position = divBalance.positions.find(p => p.marketId === bet.marketId);
              if (position) {
                // Use outcome to determine exit price
                const exitPrice =
                  (outcome === 'YES' && position.direction === 'BUY_YES') ||
                  (outcome === 'NO' && position.direction === 'BUY_NO')
                    ? 0.98 // Close winning position at near-certainty price
                    : 0.02; // Close losing position at near-zero price

                closePosition(wallet, position, exitPrice);
                positionsClosed++;

                log.info('Position closed', {
                  gladiator: gladiator.id,
                  marketId: bet.marketId,
                  outcome,
                });
              }
            }
          }
        } catch (err) {
          log.error('Error resolving bet', {
            marketId: bet.marketId,
            gladiator: gladiator.id,
            error: String(err),
          });
        }
      }

      // Check promotion criteria
      const beforePromotion = gladiator.isLive;
      promoteToLive(gladiator);
      if (!beforePromotion && gladiator.isLive) {
        promotions++;
        log.info('Gladiator promoted to live', {
          id: gladiator.id,
          readiness: gladiator.readinessScore,
        });
      }

      // Check retirement criteria
      const beforeRetirement = gladiator.status;
      retireUnderperformer(gladiator);
      if (beforeRetirement !== 'RETIRED' && gladiator.status === 'RETIRED') {
        retirements++;
        log.info('Gladiator retired', {
          id: gladiator.id,
          winRate: gladiator.stats.winRate,
        });
      }
    }

    await persistWallet();
    await persistGladiators();

    return NextResponse.json({
      status: 'ok',
      betsResolved,
      positionsClosed,
      promotions,
      retirements,
      gladiatorsActive: gladiators.filter(g => g.isLive).length,
      walletBalance: wallet.totalBalance,
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
