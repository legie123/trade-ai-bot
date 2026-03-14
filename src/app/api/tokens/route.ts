// GET /api/tokens — aggregated scored token list
import { NextRequest, NextResponse } from 'next/server';
import { getAggregatedTokens } from '@/lib/providers/providerManager';
import { TokenFilters, RiskLevel } from '@/lib/types';

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

    // Apply filters
    if (filters.ecosystem === 'pump') {
      tokens = tokens.filter((t) => t.launchSource === 'pump');
    }
    if (filters.maxAgeMinutes) {
      const cutoff = Date.now() - filters.maxAgeMinutes * 60_000;
      tokens = tokens.filter((t) => t.launchedAt && new Date(t.launchedAt).getTime() > cutoff);
    }
    if (filters.minLiquidity) {
      tokens = tokens.filter((t) => t.liquidity !== null && t.liquidity >= filters.minLiquidity!);
    }
    if (filters.minVolume) {
      tokens = tokens.filter((t) => (t.volume5m ?? 0) >= filters.minVolume! || (t.volume1h ?? 0) >= filters.minVolume!);
    }
    if (filters.maxRisk) {
      const riskOrder = { low: 0, medium: 1, high: 2, critical: 3, unknown: 4 };
      const maxRiskVal = riskOrder[filters.maxRisk];
      tokens = tokens.filter((t) => riskOrder[t.rugRisk] <= maxRiskVal);
    }
    if (filters.boostedOnly) {
      tokens = tokens.filter((t) => t.boostLevel !== null && t.boostLevel > 0);
    }
    if (filters.freshWalletsOnly) {
      tokens = tokens.filter((t) => t.freshWalletSignal);
    }
    if (filters.graduatedOnly) {
      tokens = tokens.filter((t) => t.graduationStatus === 'graduated');
    }
    if (filters.minProviderAgreement) {
      tokens = tokens.filter((t) => t.sourceOrigin.length >= filters.minProviderAgreement!);
    }

    return NextResponse.json({
      tokens,
      count: tokens.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Token fetch error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch tokens', detail: (err as Error).message },
      { status: 500 }
    );
  }
}
