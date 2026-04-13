// GET /api/v2/polymarket/cron/scan — Auto scan + evaluate + phantom bet placement
import { NextResponse } from 'next/server';
import { PolyDivision } from '@/lib/polymarket/polyTypes';
import { scanDivision } from '@/lib/polymarket/marketScanner';
import { evaluateMarket, recordPolyOutcome } from '@/lib/polymarket/polyGladiators';
import { openPosition } from '@/lib/polymarket/polyWallet';
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

const log = createLogger('PolymarketCronScan');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
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
    const scannedDivisions: string[] = [];

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
          if (opportunity.edgeScore < 50) continue; // Skip low edge scores

          const evaluation = evaluateMarket(gladiator, opportunity.market, opportunity);

          // Place phantom bet if direction is clear
          if (evaluation.direction !== 'SKIP' && evaluation.confidence >= 50) {
            // Create phantom bet on gladiator
            const bet = {
              id: `bet-${opportunity.marketId}-${Date.now()}`,
              marketId: opportunity.marketId,
              direction: evaluation.direction,
              outcomeId: opportunity.market.outcomes.find(
                o => (evaluation.direction === 'BUY_YES' && o.name.toUpperCase() === 'YES') ||
                     (evaluation.direction === 'BUY_NO' && o.name.toUpperCase() === 'NO'),
              )?.id || '',
              entryPrice: opportunity.market.outcomes[0]?.price || 0.5,
              shares: 0,
              confidence: evaluation.confidence,
              reasoning: evaluation.reasoning,
              placedAt: new Date().toISOString(),
            };

            gladiator.phantomBets.push(bet);

            // If gladiator is live, actually open position on wallet
            if (gladiator.isLive) {
              const position = openPosition(
                wallet,
                opportunity.marketId,
                division,
                bet.outcomeId,
                evaluation.direction,
                bet.entryPrice,
                evaluation.confidence,
                opportunity.edgeScore,
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
        log.error('Error scanning division', { division, error: String(err) });
      }
    }

    setLastScans(lastScans);
    await persistWallet();
    await persistGladiators();

    return NextResponse.json({
      status: 'ok',
      divisionsScanned: scannedDivisions,
      opportunitiesFound,
      betsPlaced,
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
