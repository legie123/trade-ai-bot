// ============================================================
// Sentinel → Ranker Floor Coupling — Phase 2 Batch 12
//
// ADDITIVE. Periodic check: if sentinel reports risk stress
// (drawdown approaching threshold, daily losses climbing, halt),
// raise the global runtime floor to throttle new entries.
// Relaxes back when metrics cool.
//
// Guarded by:
//   POLY_EDGE_AUTOPROMOTE=true  (needed by promoteFloor)
//   POLY_SENTINEL_COUPLING=true (opt-in)
//
// Decisions:
//   halted                      → floor = 85 (near-full stop)
//   mdd ≥ 7% OR dailyLosses ≥ 2 → floor = max(current, 70)
//   mdd ≥ 5% OR dailyLosses ≥ 1 → floor = max(current, 60)
//   all clear                   → floor = BASE (50) if currently raised by us
//
// Tag-based: we only revert floors we previously raised (tracked
// in-memory). Operator manual promotions are respected.
// ============================================================
import { SentinelGuard } from '@/lib/v2/safety/sentinelGuard';
import { getActiveConfigSync, refreshActiveConfig, promoteFloor } from './rankerConfig';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('SentinelCoupling');

const BASE_FLOOR = 50;
const ELEVATED_WARN = 60;
const ELEVATED_STRESS = 70;
const ELEVATED_HALT = 85;

interface CoupleState {
  lastDecision: 'BASE' | 'WARN' | 'STRESS' | 'HALT' | 'IDLE';
  lastAppliedFloor: number | null;
  lastAppliedAt: number | null;
  ownFloorActive: boolean; // did we write the current active.global?
}

const state: CoupleState = {
  lastDecision: 'IDLE',
  lastAppliedFloor: null,
  lastAppliedAt: null,
  ownFloorActive: false,
};

function isCouplingEnabled(): boolean {
  return (process.env.POLY_SENTINEL_COUPLING || '').toLowerCase() === 'true';
}

export interface CouplingReport {
  enabled: boolean;
  autopromoteEnabled: boolean;
  metrics: {
    mdd: number;
    dailyLosses: number;
    isHalted: boolean;
    haltedUntil: string | null;
  };
  decision: CoupleState['lastDecision'];
  appliedFloor: number | null;
  activeGlobal: number | null;
  ownFloorActive: boolean;
  lastAppliedAt: number | null;
  timestamp: number;
}

export async function evaluateSentinelCoupling(): Promise<CouplingReport> {
  const autopromote = (process.env.POLY_EDGE_AUTOPROMOTE || '').toLowerCase() === 'true';
  const enabled = isCouplingEnabled();

  let metrics = { mdd: 0, dailyLosses: 0, isHalted: false, haltedUntil: null as string | null };
  try {
    const sentinel = SentinelGuard.getInstance();
    metrics = sentinel.getRiskMetrics();
  } catch (e) {
    log.warn('sentinel metrics unavailable', { error: String(e) });
  }

  // Classify
  let decision: CoupleState['lastDecision'] = 'BASE';
  let targetFloor: number = BASE_FLOOR;
  if (metrics.isHalted) {
    decision = 'HALT';
    targetFloor = ELEVATED_HALT;
  } else if (metrics.mdd >= 0.07 || metrics.dailyLosses >= 2) {
    decision = 'STRESS';
    targetFloor = ELEVATED_STRESS;
  } else if (metrics.mdd >= 0.05 || metrics.dailyLosses >= 1) {
    decision = 'WARN';
    targetFloor = ELEVATED_WARN;
  }

  await refreshActiveConfig();
  const active = getActiveConfigSync();
  const activeGlobal = active?.global ?? null;

  if (!enabled || !autopromote) {
    // Report only, no action
    return {
      enabled,
      autopromoteEnabled: autopromote,
      metrics,
      decision,
      appliedFloor: null,
      activeGlobal,
      ownFloorActive: state.ownFloorActive,
      lastAppliedAt: state.lastAppliedAt,
      timestamp: Date.now(),
    };
  }

  // Decide whether to write
  //  - STRESS/HALT/WARN: apply if target > active (raise) or we previously raised
  //  - BASE: only revert if WE own the current floor (avoid stepping on operator)
  let apply = false;
  if (decision === 'HALT' || decision === 'STRESS' || decision === 'WARN') {
    if (activeGlobal == null || targetFloor > activeGlobal || state.ownFloorActive) {
      apply = true;
    }
  } else {
    // BASE — revert only if we own it
    if (state.ownFloorActive && activeGlobal !== BASE_FLOOR) {
      apply = true;
    }
  }

  let applied: number | null = null;
  if (apply) {
    const res = await promoteFloor({ global: targetFloor, source: `sentinel:${decision}` });
    if (res) {
      applied = targetFloor;
      state.lastDecision = decision;
      state.lastAppliedFloor = targetFloor;
      state.lastAppliedAt = Date.now();
      state.ownFloorActive = decision !== 'BASE' ? true : false;
      log.info('sentinel coupling applied', { decision, floor: targetFloor });
    }
  }

  return {
    enabled,
    autopromoteEnabled: autopromote,
    metrics,
    decision,
    appliedFloor: applied,
    activeGlobal: apply && applied != null ? applied : activeGlobal,
    ownFloorActive: state.ownFloorActive,
    lastAppliedAt: state.lastAppliedAt,
    timestamp: Date.now(),
  };
}

export function lastCouplingState(): CoupleState {
  return { ...state };
}
