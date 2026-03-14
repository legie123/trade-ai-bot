// ============================================================
// Alerts Engine — evaluate live conditions against rules
// ============================================================
import { NormalizedToken, AlertEvent, AlertType } from '@/lib/types';

let alertCounter = 0;

function makeAlert(
  type: AlertType,
  token: NormalizedToken,
  message: string,
  severity: AlertEvent['severity'],
  data?: Record<string, unknown>
): AlertEvent {
  return {
    id: `alert_${++alertCounter}_${Date.now()}`,
    type,
    tokenAddress: token.tokenAddress,
    tokenSymbol: token.symbol,
    message,
    severity,
    timestamp: new Date().toISOString(),
    data,
  };
}

/**
 * Evaluate a list of tokens and generate alerts.
 */
export function evaluateAlerts(tokens: NormalizedToken[]): AlertEvent[] {
  const alerts: AlertEvent[] = [];

  for (const token of tokens) {
    // High-conviction launch (conviction >= 70 and age < 30 min)
    if (token.convictionScore >= 70 && token.launchedAt) {
      const ageMin = (Date.now() - new Date(token.launchedAt).getTime()) / 60_000;
      if (ageMin < 30) {
        alerts.push(
          makeAlert(
            'high_conviction_launch',
            token,
            `${token.symbol} — New high-conviction launch (score: ${token.convictionScore})`,
            'critical',
            { convictionScore: token.convictionScore, ageMinutes: Math.round(ageMin) }
          )
        );
      }
    }

    // Sudden volume spike (5m volume > $5k and volume acceleration high)
    if (token.volume5m !== null && token.volume1h !== null && token.volume1h > 0) {
      const ratio = (token.volume5m * 12) / token.volume1h;
      if (ratio > 3 && token.volume5m > 5000) {
        alerts.push(
          makeAlert(
            'volume_spike',
            token,
            `${token.symbol} — Volume spike detected (5m: $${token.volume5m.toLocaleString()})`,
            'warning',
            { volume5m: token.volume5m, ratio }
          )
        );
      }
    }

    // Fresh wallet cluster
    if (token.freshWalletSignal) {
      alerts.push(
        makeAlert(
          'fresh_wallet_cluster',
          token,
          `${token.symbol} — Fresh wallet interest detected`,
          'info'
        )
      );
    }

    // Risk spike (risk > 70)
    if (token.riskScore >= 70) {
      alerts.push(
        makeAlert(
          'risk_spike',
          token,
          `${token.symbol} — High risk detected (score: ${token.riskScore})`,
          'critical',
          { riskScore: token.riskScore, warnings: token.rugWarnings }
        )
      );
    }

    // Boost with real liquidity
    if (
      token.boostLevel !== null &&
      token.boostLevel > 0 &&
      token.liquidity !== null &&
      token.liquidity > 10_000
    ) {
      alerts.push(
        makeAlert(
          'boost_with_liquidity',
          token,
          `${token.symbol} — Boosted with real liquidity ($${token.liquidity.toLocaleString()})`,
          'info',
          { boostLevel: token.boostLevel, liquidity: token.liquidity }
        )
      );
    }
  }

  // Sort by severity: critical > warning > info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}
