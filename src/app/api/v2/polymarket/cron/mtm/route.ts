// GET /api/v2/polymarket/cron/mtm — Mark-to-market position updater
import { NextResponse } from 'next/server';
import { getMarket } from '@/lib/polymarket/polyClient';
import { updatePositionPrice, calculateUnrealizedPnL } from '@/lib/polymarket/polyWallet';
import {
  ensureInitialized,
  getWallet,
  persistWallet,
  waitForInit,
} from '@/lib/polymarket/polyState';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolymarketCronMTM');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    ensureInitialized();
    await waitForInit();

    const wallet = getWallet();

    let positionsUpdated = 0;
    let errors = 0;
    const divisionUpdates: Record<string, number> = {};

    // For each division's open positions
    for (const [division, divBalance] of wallet.divisionBalances.entries()) {
      divisionUpdates[division] = 0;

      for (const position of divBalance.positions) {
        try {
          const market = await getMarket(position.marketId);
          if (!market) {
            log.warn('Market not found for position', {
              marketId: position.marketId,
              division,
            });
            errors++;
            continue;
          }

          // Get current market price
          let currentPrice = 0.5; // Default to mid-price

          if (position.direction === 'BUY_YES') {
            // YES outcome price
            const yesOutcome = market.outcomes.find(o => o.name === 'YES');
            if (yesOutcome) {
              currentPrice = yesOutcome.price;
            }
          } else {
            // NO outcome price (which is 1 - YES price)
            const noOutcome = market.outcomes.find(o => o.name === 'NO');
            if (noOutcome) {
              currentPrice = noOutcome.price;
            } else {
              const yesOutcome = market.outcomes.find(o => o.name === 'YES');
              if (yesOutcome) {
                currentPrice = 1 - yesOutcome.price;
              }
            }
          }

          // Update position with current price
          updatePositionPrice(position, currentPrice);
          positionsUpdated++;
          divisionUpdates[division]++;

          log.debug('Position MTM updated', {
            marketId: position.marketId,
            division,
            currentPrice,
            unrealizedPnL: position.unrealizedPnL,
          });
        } catch (err) {
          log.error('Error updating position price', {
            marketId: position.marketId,
            division,
            error: String(err),
          });
          errors++;
        }
      }
    }

    // Recalculate wallet unrealized PnL and totals
    let totalUnrealizedPnL = 0;
    for (const divBalance of wallet.divisionBalances.values()) {
      for (const position of divBalance.positions) {
        totalUnrealizedPnL += position.unrealizedPnL || 0;
        divBalance.unrealizedPnL = (divBalance.unrealizedPnL || 0) + (position.unrealizedPnL || 0);
      }
    }

    // Recalculate total wallet balance including unrealized gains
    wallet.totalBalance = Array.from(wallet.divisionBalances.values()).reduce((sum, db) => {
      return sum + db.balance + db.unrealizedPnL;
    }, 0);

    await persistWallet();

    return NextResponse.json({
      status: 'ok',
      positionsUpdated,
      errors,
      divisionUpdates,
      totalUnrealizedPnL: Math.round(totalUnrealizedPnL),
      walletBalance: Math.round(wallet.totalBalance),
      timestamp: Date.now(),
    });
  } catch (err) {
    log.error('MTM cron error', { error: String(err) });
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 },
    );
  }
}
