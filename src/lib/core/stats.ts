/**
 * Statistical helpers — shared across scoring, ranking, and dashboard paths.
 *
 * Centralizing these prevents drift between "what the dashboard shows" and
 * "what the Butcher/Forge/leaderboard decide". All binomial confidence intervals
 * must go through here.
 */

/**
 * Wilson score interval — 95% CI lower bound on a win-rate estimate.
 *
 * WHY Wilson (not normal approximation):
 *   Normal z-CI collapses for small n or p near 0/1 (returns <0 or >1, widens wrong).
 *   Wilson gives coherent intervals all the way down to n=1 and at extreme p.
 *
 * WHY lower bound (not center, not raw WR):
 *   Raw WR on small samples is a biased optimism — n=10, WR=80% is statistically
 *   indistinguishable from n=10, WR=50%. Using the *lower* bound as a sort key
 *   penalizes small samples automatically: a 10-trade gladiator at 80% WR gets
 *   ~49% Wilson LB; a 200-trade gladiator at 60% WR gets ~53% — the larger
 *   sample correctly wins despite lower observed rate.
 *
 * Inputs:
 *   wins: integer number of observed wins
 *   n:    total observations (trades)
 *   z:    z-score for CI (default 1.96 → 95% two-sided, so 97.5% one-sided LB)
 *
 * Returns: decimal in [0, 1]. n=0 → 0 (fail-closed: no data = worst-case).
 *
 * ASSUMPTION: trades are independent Bernoulli outcomes with a fixed p. Violated
 * under strong regime changes or correlated entries (pyramiding). For TRADE AI
 * this is mostly OK at per-gladiator level, but watch drift when regime flips.
 */
export function wilsonLowerBound(wins: number, n: number, z: number = 1.96): number {
  if (n <= 0) return 0;
  if (wins < 0) wins = 0;
  if (wins > n) wins = n;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return Math.max(0, center - margin);
}

/**
 * Wilson upper bound — mirror of lower bound. Useful for "is this gladiator
 * plausibly bad?" checks (e.g., upper bound < 0.45 → strong evidence of losing edge).
 */
export function wilsonUpperBound(wins: number, n: number, z: number = 1.96): number {
  if (n <= 0) return 1;
  if (wins < 0) wins = 0;
  if (wins > n) wins = n;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return Math.min(1, center + margin);
}
