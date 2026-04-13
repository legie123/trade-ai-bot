// ============================================================
// Polymarket Risk Manager — Position sizing, drawdown tracking, portfolio constraints
// ============================================================

import { PolyWallet, DivisionBalance } from './polyWallet';
import { PolyDivision, PolyMarket, PolyOpportunity } from './polyTypes';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyRiskManager');

export interface RiskCheckResult {
  allowed: boolean;
  reason: string;
  maxBetSize: number;  // max allowed bet in $ for this opportunity
  riskLevel: 'GREEN' | 'YELLOW' | 'RED';
}

export interface RiskConfig {
  maxDrawdownPerDivision: number;   // 0.20 = 20%
  maxPositionsPerDivision: number;  // 5
  maxBetPctOfBalance: number;       // 0.10 = 10%
  minLiquidityUSD: number;          // 5000
  minVolume24h: number;             // 1000
  minTimeToExpiryHours: number;     // 2
  maxTimeToExpiryDays: number;      // 30
  maxCorrelatedPositions: number;   // 3 positions in same theme
  minEdgeScore: number;             // 40
  minConfidence: number;            // 50
  haltedDivisions: Set<PolyDivision>; // divisions that hit drawdown limit
}

export interface PortfolioRiskSummary {
  totalHalted: number;
  greenDivisions: PolyDivision[];
  yellowDivisions: PolyDivision[];
  redDivisions: PolyDivision[];
  portfolioDrawdownPct: number;
  overallRiskLevel: 'GREEN' | 'YELLOW' | 'RED';
  details: Record<PolyDivision, {
    status: 'GREEN' | 'YELLOW' | 'RED';
    drawdownPct: number;
    positionCount: number;
    available: boolean;
  }>;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxDrawdownPerDivision: 0.20,
  maxPositionsPerDivision: 5,
  maxBetPctOfBalance: 0.10,
  minLiquidityUSD: 5000,
  minVolume24h: 1000,
  minTimeToExpiryHours: 2,
  maxTimeToExpiryDays: 30,
  maxCorrelatedPositions: 3,
  minEdgeScore: 40,
  minConfidence: 50,
  haltedDivisions: new Set(),
};

// ─── Main risk check ──────────────────────────────────────
export function checkRisk(
  wallet: PolyWallet,
  opportunity: PolyOpportunity,
  confidence: number,
  edgeScore: number,
  config: RiskConfig = DEFAULT_RISK_CONFIG,
): RiskCheckResult {
  const division = opportunity.division;
  const divBalance = wallet.divisionBalances.get(division);

  if (!divBalance) {
    return {
      allowed: false,
      reason: 'Division not found in wallet',
      maxBetSize: 0,
      riskLevel: 'RED',
    };
  }

  // Check 1: Division halted?
  if (config.haltedDivisions.has(division)) {
    return {
      allowed: false,
      reason: `Division ${division} halted due to drawdown limit exceeded`,
      maxBetSize: 0,
      riskLevel: 'RED',
    };
  }

  // Check 2: Drawdown not exceeded?
  if (checkDrawdown(divBalance, config)) {
    return {
      allowed: false,
      reason: `Division drawdown (${Math.round(divBalance.maxDrawdown * 100)}%) exceeds limit (${Math.round(config.maxDrawdownPerDivision * 100)}%)`,
      maxBetSize: 0,
      riskLevel: 'RED',
    };
  }

  // Check 3: Position limit?
  if (divBalance.positions.length >= config.maxPositionsPerDivision) {
    return {
      allowed: false,
      reason: `Max positions (${config.maxPositionsPerDivision}) reached for ${division}`,
      maxBetSize: 0,
      riskLevel: 'RED',
    };
  }

  // Check 4: Liquidity?
  const liquidity = opportunity.market.liquidityUSD || 0;
  if (liquidity < config.minLiquidityUSD) {
    return {
      allowed: false,
      reason: `Market liquidity ($${liquidity}) below minimum ($${config.minLiquidityUSD})`,
      maxBetSize: 0,
      riskLevel: 'RED',
    };
  }

  // Check 5: Volume?
  const volume = opportunity.market.volume24h || 0;
  if (volume < config.minVolume24h) {
    return {
      allowed: false,
      reason: `Market 24h volume ($${volume}) below minimum ($${config.minVolume24h})`,
      maxBetSize: 0,
      riskLevel: 'YELLOW',
    };
  }

  // Check 6: Time to expiry in range?
  const hoursToExpiry = getHoursToExpiry(opportunity.market.endDate);
  if (hoursToExpiry < config.minTimeToExpiryHours) {
    return {
      allowed: false,
      reason: `Market expires too soon (${hoursToExpiry.toFixed(1)}h < ${config.minTimeToExpiryHours}h)`,
      maxBetSize: 0,
      riskLevel: 'YELLOW',
    };
  }

  if (hoursToExpiry > config.maxTimeToExpiryDays * 24) {
    return {
      allowed: false,
      reason: `Market expires too far in future (${(hoursToExpiry / 24).toFixed(1)}d > ${config.maxTimeToExpiryDays}d)`,
      maxBetSize: 0,
      riskLevel: 'YELLOW',
    };
  }

  // Check 7: Edge score threshold?
  if (edgeScore < config.minEdgeScore) {
    return {
      allowed: false,
      reason: `Edge score (${edgeScore}) below minimum (${config.minEdgeScore})`,
      maxBetSize: 0,
      riskLevel: 'YELLOW',
    };
  }

  // Check 8: Confidence threshold?
  if (confidence < config.minConfidence) {
    return {
      allowed: false,
      reason: `Confidence (${confidence}) below minimum (${config.minConfidence})`,
      maxBetSize: 0,
      riskLevel: 'YELLOW',
    };
  }

  // Calculate max bet size
  const maxBet = divBalance.balance * config.maxBetPctOfBalance;
  const riskLevel = calculateRiskLevel(edgeScore, confidence, hoursToExpiry);

  return {
    allowed: true,
    reason: 'All risk checks passed',
    maxBetSize: Math.round(maxBet),
    riskLevel,
  };
}

// ─── Check if division exceeds drawdown limit ──────────────
export function checkDrawdown(divBalance: DivisionBalance, config: RiskConfig): boolean {
  const ddPct = divBalance.maxDrawdown;
  const limit = config.maxDrawdownPerDivision;
  const exceeded = ddPct > limit;

  if (exceeded) {
    log.warn('Drawdown limit exceeded', {
      division: divBalance.division,
      drawdown: `${(ddPct * 100).toFixed(2)}%`,
      limit: `${(limit * 100).toFixed(2)}%`,
    });
  }

  return exceeded;
}

// ─── Update halt status for all divisions ──────────────────
export function updateHaltStatus(wallet: PolyWallet, config: RiskConfig): void {
  config.haltedDivisions.clear();

  for (const divBalance of wallet.divisionBalances.values()) {
    if (checkDrawdown(divBalance, config)) {
      config.haltedDivisions.add(divBalance.division);
      log.warn('Division halted', {
        division: divBalance.division,
        drawdown: `${(divBalance.maxDrawdown * 100).toFixed(2)}%`,
      });
    }
  }
}

// ─── Get portfolio-level risk summary ──────────────────────
export function getPortfolioRiskSummary(
  wallet: PolyWallet,
  config: RiskConfig,
): PortfolioRiskSummary {
  const greenDivisions: PolyDivision[] = [];
  const yellowDivisions: PolyDivision[] = [];
  const redDivisions: PolyDivision[] = [];
  const details: Record<PolyDivision, {
    status: 'GREEN' | 'YELLOW' | 'RED';
    drawdownPct: number;
    positionCount: number;
    available: boolean;
  }> = {} as Record<PolyDivision, any>;

  let totalDrawdown = 0;
  let divisionCount = 0;

  for (const divBalance of wallet.divisionBalances.values()) {
    const ddPct = divBalance.maxDrawdown;
    const isHalted = config.haltedDivisions.has(divBalance.division);
    let status: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';

    if (isHalted || ddPct > config.maxDrawdownPerDivision) {
      status = 'RED';
      redDivisions.push(divBalance.division);
    } else if (ddPct > config.maxDrawdownPerDivision * 0.7) {
      status = 'YELLOW';
      yellowDivisions.push(divBalance.division);
    } else {
      greenDivisions.push(divBalance.division);
    }

    details[divBalance.division] = {
      status,
      drawdownPct: Math.round(ddPct * 100),
      positionCount: divBalance.positions.length,
      available: !isHalted && status !== 'RED',
    };

    totalDrawdown += ddPct;
    divisionCount++;
  }

  const portfolioDrawdownPct = divisionCount > 0 ? Math.round((totalDrawdown / divisionCount) * 100) : 0;
  const overallRiskLevel =
    redDivisions.length > 0 ? 'RED' : yellowDivisions.length > 0 ? 'YELLOW' : 'GREEN';

  return {
    totalHalted: config.haltedDivisions.size,
    greenDivisions,
    yellowDivisions,
    redDivisions,
    portfolioDrawdownPct,
    overallRiskLevel,
    details,
  };
}

// ─── Helper: Calculate hours until market expiry ────────────
function getHoursToExpiry(endDate: string): number {
  const now = new Date();
  const end = new Date(endDate);
  return (end.getTime() - now.getTime()) / (1000 * 60 * 60);
}

// ─── Helper: Determine risk level ──────────────────────────
function calculateRiskLevel(
  edgeScore: number,
  confidence: number,
  hoursToExpiry: number,
): 'GREEN' | 'YELLOW' | 'RED' {
  // GREEN: edge >= 60, confidence >= 70, not too close to expiry
  if (edgeScore >= 60 && confidence >= 70 && hoursToExpiry > 6) {
    return 'GREEN';
  }

  // RED: edge < 50 or confidence < 60
  if (edgeScore < 50 || confidence < 60) {
    return 'RED';
  }

  // YELLOW: everything else
  return 'YELLOW';
}
