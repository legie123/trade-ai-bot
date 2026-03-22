// ============================================================
// Scoring Engine — unified entry point
// ============================================================
import { NormalizedToken } from '@/lib/types';
import { calculateDealScore } from './dealScore';
import { calculateRiskScore } from './riskScore';

/**
 * Score a single token with all three calculators.
 */
export function scoreToken(token: NormalizedToken): NormalizedToken {
  const dealScore = calculateDealScore(token);
  const riskScore = calculateRiskScore(token);
  const scored = { ...token, dealScore, riskScore };

  // Conviction score from deal/risk combo (conviction engine used separately in trading pipeline)
  const convictionScore = Math.max(0, Math.min(100, Math.round(dealScore - riskScore + 50)));

  // Set risk level
  let rugRisk = token.rugRisk;
  if (rugRisk === 'unknown') {
    if (riskScore >= 75) rugRisk = 'critical';
    else if (riskScore >= 50) rugRisk = 'high';
    else if (riskScore >= 25) rugRisk = 'medium';
    else rugRisk = 'low';
  }

  return { ...scored, convictionScore, rugRisk };
}

/**
 * Score an array of tokens.
 */
export function scoreTokens(tokens: NormalizedToken[]): NormalizedToken[] {
  return tokens.map(scoreToken);
}
