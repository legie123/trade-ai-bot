// GET /api/tokens — aggregated scored token list
import { NextRequest, NextResponse } from 'next/server';
import { getAggregatedTokens } from '@/lib/providers/providerManager';
import { TokenFilters, RiskLevel } from '@/lib/types';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('TokensRoute');

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    // Parse filters
    const filters: TokenFilters = {};
    if (searchParams.get('ecosystem')) filters.ecosystem = searchParams.get('ecosystem') as 'pump' | 'all';
    if (searchParams.get('maxAgeMinutes')) filters.maxAgeMinutes = parseInt(searchParams.get('maxAgeMinutes')!);
    if (searchParams.get('minLiquidity')) filters.minLiquidity = parseFloat(searchParams.get('minLiquidity')!);
    if (searchParams.get('minVolume')) filters.minVolume = parseFloat(searchParams.get('minVolume')!);
    if (searchParams.get('maxRisk')) filters.maxRisk = searchParams.get('maxRisk') as RiskLevel;
    if (searchParams.get('boostedOnly') === 'true') filters.boostedOnly = true;
    if (searchParams.get('freshWalletsOnly') === 'true') filters.freshWalletsOnly = true;
    if (searchParams.get('graduatedOnly') === 'true') filters.graduatedOnly = true;
    if (searchParams.get('minProviderAgreement')) filters.minProviderAgreement = parseInt(searchParams.get('minProviderAgreement')!);

    let tokens = await getAggregatedTokens();

    // Apply filters in a single O(N) pass
    const cutoff = filters.maxAgeMinutes ? Date.now() - filters.maxAgeMinutes * 60_000 : null;
    const riskOrder = { low: 0, medium: 1, high: 2, critical: 3, unknown: 4 };
    const maxRiskVal = filters.maxRisk ? riskOrder[filters.maxRisk as keyof typeof riskOrder] : 4;

    tokens = tokens.filter((t) => {
      if (filters.ecosystem === 'pump' && t.launchSource !== 'pump') return false;
      if (cutoff && (!t.launchedAt || new Date(t.launchedAt).getTime() <= cutoff)) return false;
      if (filters.minLiquidity && (t.liquidity === null || t.liquidity < filters.minLiquidity)) return false;
      if (filters.minVolume && ((t.volume5m ?? 0) < filters.minVolume && (t.volume1h ?? 0) < filters.minVolume)) return false;
      if (filters.maxRisk && riskOrder[t.rugRisk as keyof typeof riskOrder] > maxRiskVal) return false;
      if (filters.boostedOnly && (t.boostLevel === null || t.boostLevel <= 0)) return false;
      if (filters.freshWalletsOnly && !t.freshWalletSignal) return false;
      if (filters.graduatedOnly && t.graduationStatus !== 'graduated') return false;
      if (filters.minProviderAgreement && t.sourceOrigin.length < filters.minProviderAgreement) return false;
      return true;
    });

    return NextResponse.json({
      tokens,
      count: tokens.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error('Token fetch error', { error: (err as Error).message });
    return NextResponse.json(
      { error: 'Failed to fetch tokens', detail: (err as Error).message },
      { status: 500 }
    );
  }
}
