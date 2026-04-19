// ============================================================
// FAZA 3/5 BATCH 3/4 (2026-04-20) — Cross-Gladiator Wash Guard types
// Shared by: src/lib/store/db.ts (computer), src/app/api/v2/cron/auto-promote/route.ts
// (caller), src/app/api/v2/diag/wash/route.ts (telemetry).
// ============================================================

export type WashMode = 'off' | 'shadow' | 'on';

export interface CrossGladiatorWashScore {
  /** [0,1]; ratio of (bucket|symbol) keys candidate shares with peer / min(candKeys, peerKeys). */
  maxOverlapRatio: number;
  /** [-1,1]; Pearson on signed pnl (SHORT inverted) of shared keys. Use |corr| at gate. */
  washPeerPnlCorr: number;
  /** Peer id with highest |corr|. '__fetch_error__' on FAIL_CLOSED — caller MUST hard-reject. */
  washPeerId: string | null;
  /** Candidate's unique (bucket|symbol) count in window. */
  totalCandidateKeys: number;
}

export interface WashConfig {
  mode: WashMode;
  /** Block threshold: maxOverlapRatio strictly greater. */
  maxOverlap: number;
  /** Block threshold: |washPeerPnlCorr| strictly greater. */
  pnlCorrThreshold: number;
  /** Bucket width in ms. Default 1_800_000 (30min). */
  bucketMs: number;
  /** Per-gladiator newest-N rows considered. Default 200. */
  lookbackTrades: number;
  /** Cap peer set; live first then phantom. Default 15. */
  maxPeers: number;
  /** Minimum shared (cand,peer) keys before computing Pearson. Default 30. */
  minSharedTrades: number;
}

export interface WashShadowEntry {
  ts: number;
  gladiatorId: string;
  gladiatorName: string;
  washPeerId: string | null;
  overlap: number;
  corr: number;
  blocked: boolean; // would-have-blocked under current thresholds
  reason: string;
}
