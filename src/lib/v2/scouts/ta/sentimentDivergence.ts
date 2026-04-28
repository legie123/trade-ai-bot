// ============================================================
// Sentiment Divergence Flag — FAZA 3.1 Batch 3/9
// ============================================================
// Combines Alternative.me Fear & Greed Index with MEXC funding rate to
// detect divergence setups where retail sentiment and derivatives
// positioning disagree. Pure contrarian layer — orthogonal to ADX regime.
//
// PSEUDO-CODE:
//   1. Fetch F&G (0..100) — daily index, cached 6h
//   2. Reuse getFundingRate(symbol) — returns rate in % (decimal*100)
//   3. Classify divergence:
//        F&G <= PANIC_FNG && |rate| < LOW_LEVERAGE        → PANIC_OFFSET
//          retail panic WITHOUT derivatives flush → contrarian-long bias
//        F&G >= EUPHORIA_FNG && rate >= HIGH_LEVERAGE     → EUPHORIA_TRAP
//          retail euphoria WITH long-side crowding → contrarian-short bias
//        else                                             → NEUTRAL
//   4. multiplier(divergence, signalDir) returns:
//        1.15 if divergence agrees with signalDir (contrarian match)
//        0.85 if divergence disagrees
//        1.00 neutral / unknown
//
// CRITICAL ASSUMPTIONS (if broken → invalidates flag):
//   A1: Alternative.me F&G stays free & stable (no auth, public)
//   A2: Funding rate reflects marginal leverage bias — not just exchange-specific skew
//   A3: Divergence edge is CONTRARIAN on horizon 4h-24h (shorter = noise)
//   A4: F&G is slow-moving (daily) — using it on sub-hour signals is fine
//        because it reframes the MACRO sentiment backdrop, not a timing trigger
//
// FEATURE FLAG: env SENTIMENT_FLAG_ENABLED ('shadow' default | 'active' | 'off')
//   - 'shadow' → telemetry only, no pipeline impact
//   - 'active' → multiplier applied at decision time
//   - 'off'    → bypass entirely
//
// KILL-SWITCH: set SENTIMENT_FLAG_ENABLED=off in Cloud Run env without redeploy.
//
// Magnitude rationale (±0.15): intentionally SMALLER than ADX regime (±0.20/0.30)
// because sentiment divergence is a weaker edge — avoids stacking overconfidence
// if two flags both fire in the same direction by coincidence.
// ============================================================

import { createLogger } from '@/lib/core/logger';
import { getFundingRate } from './fundingRate';

const log = createLogger('SentimentDivergence');

export type DivergenceKind = 'PANIC_OFFSET' | 'EUPHORIA_TRAP' | 'NEUTRAL' | 'UNKNOWN';
export type SignalDir = 'long' | 'short' | 'unknown';
export type SentimentMode = 'shadow' | 'active' | 'off';

export interface SentimentFlagResult {
  fng: number | null;                 // 0..100, null if fetch failed
  fngClassification: string | null;   // e.g. 'Extreme Fear', 'Greed'
  fundingRatePct: number;             // funding rate in percentage (e.g. 0.01 = 0.01%)
  divergence: DivergenceKind;
  multiplier: number;                 // 1.0 baseline; >1 contrarian match; <1 disagreement
  reason: string;
  fngAgeSec: number | null;           // staleness of F&G data
  computedAt: number;
}

// Override via env to tune sentiment gates without redeploy.
const PANIC_FNG = Number(process.env.SENTIMENT_PANIC_FNG) || 25;         // ≤25 = Extreme Fear zone
const EUPHORIA_FNG = Number(process.env.SENTIMENT_EUPHORIA_FNG) || 75;   // ≥75 = Extreme Greed zone
const LOW_LEVERAGE = Number(process.env.SENTIMENT_LOW_LEVERAGE) || 0.005; // |funding| < 0.005% = derivatives NOT flushed
const HIGH_LEVERAGE = Number(process.env.SENTIMENT_HIGH_LEVERAGE) || 0.03; // funding ≥ 0.03% = long-side crowding

const FNG_CACHE_TTL_MS = 6 * 60 * 60_000; // 6h — F&G updates daily

// ─── Module-scoped F&G cache (single value, global) ───
let _fngCache: { value: number; classification: string; timestamp: number; fetchedAt: number } | null = null;

export function getSentimentMode(): SentimentMode {
  const v = (process.env.SENTIMENT_FLAG_ENABLED || 'shadow').toLowerCase();
  if (v === 'active' || v === 'on' || v === 'true') return 'active';
  if (v === 'off' || v === 'false' || v === 'disabled') return 'off';
  return 'shadow';
}

// ─── Fetch Alternative.me F&G ───
// Response shape (public API, no auth):
//   { data: [ { value: "47", value_classification: "Neutral", timestamp: "1713600000", ... } ] }
interface FngApiItem {
  value: string;
  value_classification: string;
  timestamp: string;
}

async function fetchFearGreed(): Promise<{ value: number; classification: string; timestamp: number } | null> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'TradeAI/1.0' },
    });
    if (!res.ok) {
      log.warn(`F&G fetch HTTP ${res.status}`);
      return null;
    }
    const json = await res.json() as { data?: FngApiItem[] };
    const item = json?.data?.[0];
    if (!item || typeof item.value !== 'string') {
      log.warn('F&G response shape invalid');
      return null;
    }
    const value = parseInt(item.value, 10);
    if (isNaN(value) || value < 0 || value > 100) {
      log.warn(`F&G value out of range: ${item.value}`);
      return null;
    }
    return {
      value,
      classification: item.value_classification || 'Unknown',
      timestamp: parseInt(item.timestamp, 10) * 1000, // API returns seconds
    };
  } catch (err) {
    log.warn('F&G fetch failed', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function getFearGreed(): Promise<{ value: number; classification: string; timestamp: number } | null> {
  const now = Date.now();
  if (_fngCache && now - _fngCache.fetchedAt < FNG_CACHE_TTL_MS) {
    return { value: _fngCache.value, classification: _fngCache.classification, timestamp: _fngCache.timestamp };
  }
  const fresh = await fetchFearGreed();
  if (fresh) {
    _fngCache = { ...fresh, fetchedAt: now };
  }
  return fresh || (_fngCache ? { value: _fngCache.value, classification: _fngCache.classification, timestamp: _fngCache.timestamp } : null);
}

// ─── Classify divergence from F&G + funding rate ───
export function classifyDivergence(fng: number | null, fundingRatePct: number): DivergenceKind {
  if (fng === null || isNaN(fundingRatePct)) return 'UNKNOWN';
  if (fng <= PANIC_FNG && Math.abs(fundingRatePct) < LOW_LEVERAGE) {
    // Retail panic without derivatives flush → contrarian long setup
    return 'PANIC_OFFSET';
  }
  if (fng >= EUPHORIA_FNG && fundingRatePct >= HIGH_LEVERAGE) {
    // Retail euphoria + long-side crowding → contrarian short setup
    return 'EUPHORIA_TRAP';
  }
  return 'NEUTRAL';
}

// ─── Multiplier (gate logic) ───
// Contrarian interpretation:
//   PANIC_OFFSET  favors LONG signals (buy the panic)
//   EUPHORIA_TRAP favors SHORT signals (fade the greed)
// Mismatch → 0.85 cut (small, non-destructive)
// Match → 1.15 boost
// Neutral/unknown → 1.00
export function sentimentMultiplier(divergence: DivergenceKind, signalDir: SignalDir): number {
  if (divergence === 'UNKNOWN' || divergence === 'NEUTRAL') return 1.0;
  if (signalDir === 'unknown') return 1.0;
  if (divergence === 'PANIC_OFFSET') return signalDir === 'long' ? 1.15 : 0.85;
  if (divergence === 'EUPHORIA_TRAP') return signalDir === 'short' ? 1.15 : 0.85;
  return 1.0;
}

// ─── Public entry: compute divergence flag ───
export async function computeSentimentDivergence(symbol: string = 'BTCUSDT'): Promise<SentimentFlagResult> {
  const now = Date.now();
  // Fetch F&G + funding in parallel (F&G cached 6h, funding cached 30min upstream)
  const [fngRes, fundingRes] = await Promise.all([
    getFearGreed(),
    getFundingRate(symbol).catch((err) => {
      log.warn('funding fetch threw', { err: err instanceof Error ? err.message : String(err) });
      return { symbol, rate: 0, signal: 'NEUTRAL' as const, strength: 0, reason: 'funding_unavailable', nextFundingTime: '', cached: false };
    }),
  ]);

  const fng = fngRes?.value ?? null;
  const fngClass = fngRes?.classification ?? null;
  const fundingRatePct = fundingRes.rate;
  const fngAgeSec = fngRes ? Math.floor((now - fngRes.timestamp) / 1000) : null;

  const divergence = classifyDivergence(fng, fundingRatePct);
  const reason = fng === null
    ? 'F&G unavailable — divergence UNKNOWN, multiplier=1.0'
    : `F&G=${fng} (${fngClass}), funding=${fundingRatePct.toFixed(4)}% → ${divergence}`;

  const result: SentimentFlagResult = {
    fng,
    fngClassification: fngClass,
    fundingRatePct,
    divergence,
    multiplier: 1.0, // resolved at apply-time with signalDir via sentimentMultiplier()
    reason,
    fngAgeSec,
    computedAt: now,
  };

  if (divergence !== 'NEUTRAL' && divergence !== 'UNKNOWN') {
    log.info(`[sentiment] ${symbol} F&G=${fng} funding=${fundingRatePct.toFixed(4)}% → ${divergence}`);
  }

  return result;
}

// ─── Telemetry ───
export function getSentimentFlagStats(): {
  mode: SentimentMode;
  fngCached: boolean;
  fngCacheAgeSec: number | null;
  fngCacheTtlMs: number;
} {
  const ageSec = _fngCache ? Math.floor((Date.now() - _fngCache.fetchedAt) / 1000) : null;
  return {
    mode: getSentimentMode(),
    fngCached: _fngCache !== null,
    fngCacheAgeSec: ageSec,
    fngCacheTtlMs: FNG_CACHE_TTL_MS,
  };
}
