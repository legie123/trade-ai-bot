// ============================================================
// Confidence Aggregator — Unifies signals from all sources
// Weights them by historical reliability and confluence
// ============================================================
import { DecisionSnapshot } from '@/lib/types/radar';
import { scoreSignal } from '@/lib/engine/mlFilter';

export interface ConfidenceResult {
  symbol: string;
  finalConfidence: number; // 0-100
  baseConfidence: number;
  sourceBreakdown: {
    source: string;
    weight: number;
    contribution: number;
  }[];
  confluenceBoost: number;
  mlBonus: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
}

const SOURCE_RELIABILITY: Record<string, number> = {
  'BTC Engine': 1.2,
  'Solana Engine': 1.0,
  'DexScreener': 0.8,
  'TradingView': 1.1,
  'Unknown': 0.5,
};

export function aggregateConfidence(
  decisions: DecisionSnapshot[],
  targetSymbol: string
): ConfidenceResult {
  const symbolDecisions = decisions.filter((d) => d.symbol === targetSymbol);

  if (symbolDecisions.length === 0) {
    return {
      symbol: targetSymbol,
      finalConfidence: 0,
      baseConfidence: 0,
      sourceBreakdown: [],
      confluenceBoost: 0,
      mlBonus: 0,
      grade: 'F',
    };
  }

  // Find the primary decision (most recent or highest base confidence)
  const primary = symbolDecisions.sort((a, b) => b.confidence - a.confidence)[0];
  const ml = scoreSignal(primary);

  // Calculate base from primary
  const baseConfidence = primary.confidence;

  // Breakdown across all matching signals in the last hour
  const recentSignals = symbolDecisions.filter(
    (d) => Date.now() - new Date(d.timestamp).getTime() < 60 * 60_000
  );

  const breakdown = recentSignals.map((d) => {
    // Determine source weight
    let weight = 0.5;
    for (const [key, val] of Object.entries(SOURCE_RELIABILITY)) {
      if (d.source.includes(key)) {
        weight = val;
        break;
      }
    }

    // Time decay: 100% weight now, 50% at 1 hour old
    const ageMs = Date.now() - new Date(d.timestamp).getTime();
    const ageFactor = Math.max(0.5, 1 - (ageMs / (60 * 60_000)) * 0.5);
    const contribution = d.confidence * weight * ageFactor;

    return {
      source: d.source || 'Unknown',
      weight: parseFloat(weight.toFixed(2)),
      contribution: parseFloat(contribution.toFixed(1)),
    };
  });

  // Confluence boost: if multiple sources agree
  const uniqueSourcesConflicting = new Set(recentSignals.map((d) => d.source));
  let confluenceBoost = 0;
  if (uniqueSourcesConflicting.size >= 3) confluenceBoost = 15;
  else if (uniqueSourcesConflicting.size === 2) confluenceBoost = 5;

  // ML Bonus: strong ML score adds confidence
  let mlBonus = 0;
  if (ml.score >= 80) mlBonus = 10;
  else if (ml.score >= 70) mlBonus = 5;
  else if (ml.score < 40) mlBonus = -15; // Penalty for bad pattern

  // Calculate final
  let unifiedSum = baseConfidence;
  
  // Combine contributions
  const additionalContributions = breakdown
    .filter(b => b.contribution !== (baseConfidence * SOURCE_RELIABILITY['Unknown'] || baseConfidence * 1.0)) // Rough check to exclude primary from adding twice
    .map(b => b.contribution)
    .reduce((a, b) => a + b, 0);

  // We cap base + source harmony at 90. Boosts take it to 100.
  unifiedSum = Math.min(90, baseConfidence + (additionalContributions * 0.1));

  const finalConfidence = Math.min(100, Math.max(0, unifiedSum + confluenceBoost + mlBonus));

  const grade: ConfidenceResult['grade'] =
    finalConfidence >= 90 ? 'A+' :
    finalConfidence >= 80 ? 'A' :
    finalConfidence >= 70 ? 'B' :
    finalConfidence >= 55 ? 'C' :
    finalConfidence >= 40 ? 'D' : 'F';

  return {
    symbol: targetSymbol,
    finalConfidence: Math.round(finalConfidence),
    baseConfidence: Math.round(baseConfidence),
    sourceBreakdown: breakdown,
    confluenceBoost: Math.round(confluenceBoost),
    mlBonus: Math.round(mlBonus),
    grade,
  };
}
