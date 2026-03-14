// ============================================================
// Scoring Engine — unified entry point
// ============================================================
import { NormalizedToken } from '@/lib/types';
import { calculateDealScore } from './dealScore';
import { calculateRiskScore } from './riskScore';
import { calculateConvictionScore } from './convictionScore';

/**
 * Score a single token with all three calculators.
 */
export function scoreToken(token: NormalizedToken): NormalizedToken {
  const dealScore = calculateDealScore(token);
  const riskScore = calculateRiskScore(token);
  const scored = { ...token, dealScore, riskScore };
  const convictionScore = calculateConvictionScore(scored);

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
