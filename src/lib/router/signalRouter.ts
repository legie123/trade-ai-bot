// ============================================================
// Signal Router — normalizes incoming signals from any source
// Maps TradingView BUY/SELL/LONG/SHORT into unified format
//
// CONFIDENCE FIX 2026-04-18 (v3):
// Previous heuristic piled fixed bonuses onto every well-formed signal,
// saturating to 100 for any engine-emitted BUY/SELL with price+timeframe.
// That destroyed signal discrimination and overwhelmed the arena with
// phantom trades against indistinguishable "100% confidence" signals.
//
// New heuristic uses multiplicative-quality factors:
//   - determinism: did we match the raw signal exactly, via fuzzy include, or not at all?
//   - direction clarity: directional signals outrank NEUTRAL/ALERT
//   - timeframe: crypto intraday sweet spot (15m-4h) beats noisy 1m or slow 1w
//   - source tier: internal engines > shadow gladiators > TradingView > other
//   - recency: stale signals are penalized, not rewarded
// Output is clamped to [0, 95]; 100 is reserved as "certainty" which is
// never claimed by heuristic scoring (matches reality, avoids false trust).
// ============================================================
import { Signal, SignalType } from '@/lib/types/radar';

// ---- Direction + Action ----

export type SignalDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type SignalAction = 'ENTRY' | 'EXIT' | 'INFO';

export interface RoutedSignal extends Signal {
  direction: SignalDirection;
  action: SignalAction;
  normalized: SignalType;      // cleaned signal type
  confidence: number;          // 0–95 based on data quality; 0 if price invalid
  routed: true;
}

// ---- Alias map: messy TradingView text → clean SignalType ----

const SIGNAL_ALIASES: Record<string, SignalType> = {
  // Direct
  'BUY': 'BUY',
  'SELL': 'SELL',
  'LONG': 'LONG',
  'SHORT': 'SHORT',
  'ALERT': 'ALERT',
  'NEUTRAL': 'NEUTRAL',

  // Common TradingView variations
  'STRONG BUY': 'BUY',
  'STRONG SELL': 'SELL',
  'STRONG_BUY': 'BUY',
  'STRONG_SELL': 'SELL',
  'ENTER LONG': 'LONG',
  'ENTER SHORT': 'SHORT',
  'ENTER_LONG': 'LONG',
  'ENTER_SHORT': 'SHORT',
  'EXIT LONG': 'SELL',
  'EXIT SHORT': 'BUY',
  'EXIT_LONG': 'SELL',
  'EXIT_SHORT': 'BUY',
  'CLOSE LONG': 'SELL',
  'CLOSE SHORT': 'BUY',
  'CLOSE_LONG': 'SELL',
  'CLOSE_SHORT': 'BUY',
  'OPEN LONG': 'LONG',
  'OPEN SHORT': 'SHORT',
  'OPEN_LONG': 'LONG',
  'OPEN_SHORT': 'SHORT',
  'BULLISH': 'BUY',
  'BEARISH': 'SELL',
  'UP': 'BUY',
  'DOWN': 'SELL',
  'CALL': 'BUY',
  'PUT': 'SELL',
};

// ---- Direction mapping ----

const DIRECTION_MAP: Record<SignalType, SignalDirection> = {
  'BUY': 'BULLISH',
  'LONG': 'BULLISH',
  'SELL': 'BEARISH',
  'SHORT': 'BEARISH',
  'ALERT': 'NEUTRAL',
  'NEUTRAL': 'NEUTRAL',
};

// ---- Action mapping ----

const ACTION_MAP: Record<SignalType, SignalAction> = {
  'BUY': 'ENTRY',
  'LONG': 'ENTRY',
  'SELL': 'EXIT',
  'SHORT': 'ENTRY',
  'ALERT': 'INFO',
  'NEUTRAL': 'INFO',
};

// ---- Determinism classification ----
// Tracks HOW a raw string was mapped — direct vs fuzzy vs unknown.
// Drives base confidence: exact-alias matches are more trustworthy than
// substring inferences like "ENTER_LONG_V2_TEST" → LONG.
type MatchKind = 'direct' | 'fuzzy' | 'unknown';

function classifyMatch(raw: string): { type: SignalType; match: MatchKind } {
  const cleaned = raw.toUpperCase().trim();
  if (SIGNAL_ALIASES[cleaned]) return { type: SIGNAL_ALIASES[cleaned], match: 'direct' };

  // AUDIT FIX T2.10: Check SHORT before SELL to preserve short entry signals
  if (cleaned.includes('SHORT')) return { type: 'SHORT', match: 'fuzzy' };
  if (cleaned.includes('LONG')) return { type: 'LONG', match: 'fuzzy' };
  if (cleaned.includes('BUY')) return { type: 'BUY', match: 'fuzzy' };
  if (cleaned.includes('SELL')) return { type: 'SELL', match: 'fuzzy' };
  if (cleaned.includes('BULL')) return { type: 'BUY', match: 'fuzzy' };
  if (cleaned.includes('BEAR')) return { type: 'SELL', match: 'fuzzy' };

  return { type: 'ALERT', match: 'unknown' };
}

// ---- Router ----

/**
 * Normalize a raw signal string into a known SignalType.
 * Handles aliases, partial matches, and messy TradingView text.
 */
export function normalizeSignalType(raw: string): SignalType {
  return classifyMatch(raw).type;
}

// Crypto-intraday sweet spot — timeframes with enough noise filtering
// but fast enough for retail edge. Based on empirical crypto momentum studies.
const TF_TIER_HIGH = new Set(['15m', '30m', '1h', '2h', '4h']);
const TF_TIER_MID = new Set(['5m', '6h', '8h', '12h', '1d']);
const TF_TIER_LOW = new Set(['1m', '3m', '3d', '1w']);

/**
 * Compute confidence from signal quality factors.
 *
 * ASSUMPTIONS (if any breaks, revisit the scoring):
 *   - signal.price <= 0  → signal is unusable (no entry price) → confidence 0
 *   - raw signal.signal string is the pre-normalization text
 *   - signal.timestamp is an ISO-parseable string representing signal origin time
 *   - source strings follow convention: "BTC Engine", "Solana Engine",
 *     "Meme OSINT Engine", "TradingView", or contain "shadow"/"gladiator"
 *   - symbol length 2–10 chars is the reasonable band (BTC, SOL, DOGE, PEPE etc.)
 */
function computeConfidence(signal: Signal, match: MatchKind, normalized: SignalType): number {
  // Hard gate: no valid price means we cannot enter or evaluate → unreliable.
  if (!signal.price || signal.price <= 0) return 0;

  // Base by determinism — direct alias match is worth more than substring inference.
  let score = match === 'direct' ? 35 : match === 'fuzzy' ? 20 : 10;

  // Direction clarity — directional signals beat informational ones.
  if (normalized === 'BUY' || normalized === 'SELL' || normalized === 'LONG' || normalized === 'SHORT') {
    score += 20;
  } else if (normalized === 'ALERT') {
    score += 5;
  }
  // NEUTRAL adds zero — it's not actionable.

  // Timeframe tier — intraday sweet spot scores highest.
  const tf = (signal.timeframe || '').toLowerCase();
  if (TF_TIER_HIGH.has(tf)) score += 15;
  else if (TF_TIER_MID.has(tf)) score += 10;
  else if (TF_TIER_LOW.has(tf)) score += 5;
  // unknown/empty timeframe → 0

  // Source trust tier — internal TA engines pass multi-stage filters.
  const src = (signal.source || '').toLowerCase();
  if (src.includes('btc engine') || src.includes('solana engine') || src.includes('meme osint')) {
    score += 15;
  } else if (src.includes('shadow') || src.includes('gladiator')) {
    score += 12;
  } else if (src === 'tradingview') {
    score += 10;
  } else if (src.includes('engine')) {
    score += 10; // generic engine fallback
  } else {
    score += 3; // untrusted external
  }

  // Recency — stale signals lose confidence, fresh ones gain.
  try {
    const ageMs = Date.now() - new Date(signal.timestamp).getTime();
    if (!isNaN(ageMs) && ageMs >= 0) {
      if (ageMs < 30_000) score += 10;        // <30s fresh
      else if (ageMs < 120_000) score += 5;   // <2min still relevant
      else if (ageMs < 600_000) score += 0;   // <10min OK
      else score -= 10;                       // stale penalty
    }
  } catch {
    // invalid timestamp — no bonus, no penalty
  }

  // Symbol sanity — reasonable ticker length band.
  const symLen = (signal.symbol || '').length;
  if (symLen >= 2 && symLen <= 10) score += 3;

  // Clamp to [0, 95]. 100 is reserved for certainty which heuristic scoring
  // never honestly produces — leaving headroom signals "not certain".
  return Math.max(0, Math.min(score, 95));
}

/**
 * Route a raw Signal through the normalizer.
 * Adds direction, action, confidence, and cleaned signal type.
 */
export function routeSignal(signal: Signal): RoutedSignal {
  const { type: normalized, match } = classifyMatch(signal.signal);
  const direction = DIRECTION_MAP[normalized];
  const action = determineAction(signal.signal, normalized);
  const confidence = computeConfidence(signal, match, normalized);

  const routed: RoutedSignal = {
    ...signal,
    signal: normalized,   // overwrite with clean type
    normalized,
    direction,
    action,
    confidence,
    routed: true,
  };

  return routed;
}

/**
 * Determine if the signal is an ENTRY, EXIT, or INFO.
 * Checks raw text for explicit exit/close keywords before defaulting.
 */
function determineAction(rawSignal: string, normalized: SignalType): SignalAction {
  const upper = rawSignal.toUpperCase();

  // Explicit exit/close signals
  if (upper.includes('EXIT') || upper.includes('CLOSE') || upper.includes('TP') || upper.includes('STOP')) {
    return 'EXIT';
  }

  // Explicit entry signals
  if (upper.includes('ENTER') || upper.includes('OPEN') || upper.includes('ENTRY')) {
    return 'ENTRY';
  }

  return ACTION_MAP[normalized];
}

/**
 * Batch-route multiple signals.
 */
export function routeSignals(signals: Signal[]): RoutedSignal[] {
  return signals.map(routeSignal);
}
