/**
 * POST /api/v2/polymarket/paper-seed — one-shot phantom-bet seeder
 *
 * PROBLEM IT SOLVES
 *   /polymarket UI shows 16 gladiators at readiness=10 with 0 phantom bets.
 *   Scanner filter (edgeScore>=50 + confidence>=50) + empty training set →
 *   chicken-egg: no bets generated → no training data → readiness never rises.
 *
 * WHAT IT DOES
 *   Scans TRENDING/CRYPTO/POLITICS, bypasses the confidence threshold, and
 *   writes up to SEED_PER_DIVISION phantom bets per division onto the
 *   matching gladiator's `phantomBets[]`. Persists both gladiators and
 *   lastScans to Supabase. PAPER-ONLY: never calls wallet.openPosition, never
 *   touches capital — capital stays at $16,000 untouched.
 *
 * WHY PAPER-ONLY IS STRUCTURALLY ENFORCED
 *   We only mutate `gladiator.phantomBets` (training data). The
 *   scan cron at /api/v2/polymarket/cron/scan already gates live position
 *   opening on `if (gladiator.isLive)` — and LIVE requires WR>55 + readiness>70
 *   + >=20 bets. So seeding phantom bets cannot escalate into a live bet.
 *
 * IDEMPOTENT GUARD
 *   If any gladiator has phantomBets.length > 0, returns 200 with
 *   {already_seeded:true} — will not double-seed.
 *
 * AUTH: CRON_SECRET (reuses requireCronAuth).
 *
 * KILL-SWITCH
 *   POLY_SEED_ENABLED=0  → 503 (endpoint dark, no scan, no writes).
 *
 * ASSUMPTIONS (invalidate = endpoint refuses or returns no-op)
 *   (1) scanDivision() returns PolyScanResult with .opportunities[]
 *   (2) Each gladiator is bucketed per division; evaluateMarket returns a
 *       direction we can derive an outcomeId for
 *   (3) phantomBets mutation + persistGladiators() survives cold-start (Supabase
 *       write path already used by scan cron)
 *
 * REVERT
 *   Delete this file OR set POLY_SEED_ENABLED=0. No schema migration, no
 *   external side-effects beyond the phantomBets[] rows inside poly_gladiators.
 */
import { NextResponse } from 'next/server';
import { PolyDivision, PolyMarket, PolyOpportunity } from '@/lib/polymarket/polyTypes';
import { scanDivision } from '@/lib/polymarket/marketScanner';
import { evaluateMarket, PolyBet, PolyGladiator } from '@/lib/polymarket/polyGladiators';
import {
  ensureInitialized,
  waitForInit,
  getGladiators,
  getLastScans,
  setLastScans,
  persistGladiators,
} from '@/lib/polymarket/polyState';
import { createLogger } from '@/lib/core/logger';
import { requireCronAuth } from '@/lib/core/cronAuth';

const log = createLogger('PolymarketPaperSeed');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// How many opportunities per division → phantom bets. Bounded small: we want
// a training kickstart, not a flood. Each bet counts toward the 20-bet threshold
// for LIVE promotion, so 5 per division × 3 divisions = 15 (still under 20).
const SEED_PER_DIVISION = 5;
const SEED_SCAN_LIMIT = 25;
const PRIORITY_DIVISIONS: PolyDivision[] = [
  PolyDivision.TRENDING,
  PolyDivision.CRYPTO,
  PolyDivision.POLITICS,
];

// Gamma returns `outcomes` with either literal YES/NO names or arbitrary
// labels (e.g. team names "Magic"/"Pistons"). When literal YES/NO is
// present we match it; otherwise we fall back to positional [0]=YES, [1]=NO —
// Polymarket's binary convention where outcomes[0] is the "positive" side.
// Asumptie: Gamma's outcomes array is always ordered (YES-equivalent first),
// invalidarea = rare edge-case where teams are order-swapped upstream, which
// would bias the phantom bet's side — training noise only, no capital risk.
function pickOutcomeId(
  market: PolyMarket,
  direction: 'BUY_YES' | 'BUY_NO' | 'SKIP',
): string | undefined {
  if (direction === 'SKIP') return undefined;
  const outcomes = market.outcomes || [];
  const literal = outcomes.find(o =>
    (direction === 'BUY_YES' && o.name?.toUpperCase() === 'YES') ||
    (direction === 'BUY_NO' && o.name?.toUpperCase() === 'NO'),
  );
  if (literal) return literal.id;
  // Fallback: positional mapping for non-binary-named markets
  const idx = direction === 'BUY_YES' ? 0 : 1;
  return outcomes[idx]?.id;
}

function handle(request: Request) {
  // 1. Kill-switch
  if (process.env.POLY_SEED_ENABLED === '0') {
    return NextResponse.json({ ok: false, reason: 'seed_disabled' }, { status: 503 });
  }

  // 2. Auth
  const authError = requireCronAuth(request);
  if (authError) return authError;

  return (async () => {
    try {
      ensureInitialized();
      await waitForInit();

      const gladiators = getGladiators();

      // 3. Idempotency — if training already started, refuse silently.
      const alreadySeeded = gladiators.some(g => Array.isArray(g.phantomBets) && g.phantomBets.length > 0);
      if (alreadySeeded) {
        return NextResponse.json({
          ok: true,
          already_seeded: true,
          note: 'At least one gladiator has phantomBets — seed skipped to avoid duplicate training data.',
        });
      }

      // 4. Scan + seed
      const lastScans = getLastScans();
      let betsWritten = 0;
      let opportunitiesConsidered = 0;
      const perDivision: Record<string, { scanned: number; seeded: number; topEdge: number | null }> = {};

      for (const division of PRIORITY_DIVISIONS) {
        const result = await scanDivision(division, SEED_SCAN_LIMIT);
        lastScans[division] = result;

        const bucket = { scanned: result.opportunities.length, seeded: 0, topEdge: null as number | null };
        if (result.opportunities.length > 0) bucket.topEdge = result.opportunities[0]?.edgeScore ?? null;

        const gladiator = gladiators.find(g => g.division === division);
        if (!gladiator) {
          log.warn('No gladiator for division — skip seed', { division });
          perDivision[division] = bucket;
          continue;
        }

        const slice = result.opportunities.slice(0, SEED_PER_DIVISION);
        for (const opportunity of slice) {
          opportunitiesConsidered++;
          const evaluation = evaluateMarket(gladiator, opportunity.market, opportunity);
          // Force non-SKIP: if evaluateMarket returned SKIP, coerce to BUY_YES so the
          // seed bet records a default direction — we accept the noise for training kick-off.
          const direction = evaluation.direction === 'SKIP' ? 'BUY_YES' : evaluation.direction;
          const outcomeId = pickOutcomeId(opportunity.market, direction);
          if (!outcomeId) continue;

          const bet: PolyBet = {
            id: `seed-${opportunity.marketId}-${Date.now()}-${betsWritten}`,
            marketId: opportunity.marketId,
            direction,
            outcomeId,
            entryPrice: opportunity.market.outcomes[0]?.price || 0.5,
            shares: 0,
            confidence: evaluation.confidence,
            reasoning: `[SEED] ${evaluation.reasoning}`,
            placedAt: new Date().toISOString(),
          };
          (gladiator as PolyGladiator).phantomBets.push(bet);
          betsWritten++;
          bucket.seeded++;
        }
        perDivision[division] = bucket;
      }

      // 5. Persist state to Supabase (both gladiators + lastScans)
      setLastScans(lastScans);
      await persistGladiators();

      log.info('seeded', { betsWritten, opportunitiesConsidered, perDivision });

      return NextResponse.json({
        ok: true,
        already_seeded: false,
        betsWritten,
        opportunitiesConsidered,
        perDivision,
        gladiatorsWithBets: gladiators.filter(g => g.phantomBets.length > 0).length,
        note: 'Training kickstart: phantom bets written, no live positions opened, wallet untouched.',
      });
    } catch (err) {
      log.error('seed failed', { error: String(err) });
      return NextResponse.json(
        { ok: false, reason: 'seed_error', error: (err as Error).message },
        { status: 500 },
      );
    }
  })();
}

export async function POST(request: Request) {
  return handle(request);
}

// Allow GET for easy one-shot invocation (Cloud Scheduler / curl).
export async function GET(request: Request) {
  return handle(request);
}
