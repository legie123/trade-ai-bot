// ============================================================
// Signal Router — normalizes incoming signals from any source
// Maps TradingView BUY/SELL/LONG/SHORT into unified format
// ============================================================
import { Signal, SignalType } from '@/lib/types/radar';

// ---- Direction + Action ----

export type SignalDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type SignalAction = 'ENTRY' | 'EXIT' | 'INFO';

export interface RoutedSignal extends Signal {
  direction: SignalDirection;
  action: SignalAction;
  normalized: SignalType;      // cleaned signal type
  confidence: number;          // 0–100 based on data completeness
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

// ---- Router ----

/**
 * Normalize a raw signal string into a known SignalType.
 * Handles aliases, partial matches, and messy TradingView text.
 */
export function normalizeSignalType(raw: string): SignalType {
  const cleaned = raw.toUpperCase().trim();

  // Direct match
  if (SIGNAL_ALIASES[cleaned]) return SIGNAL_ALIASES[cleaned];

  // Partial match — check if raw contains a known keyword
  if (cleaned.includes('BUY') || cleaned.includes('LONG')) return 'BUY';
  if (cleaned.includes('SELL') || cleaned.includes('SHORT')) return 'SELL';
  if (cleaned.includes('BULL')) return 'BUY';
  if (cleaned.includes('BEAR')) return 'SELL';

  return 'ALERT';
}

/**
 * Route a raw Signal through the normalizer.
 * Adds direction, action, confidence, and cleaned signal type.
 */
export function routeSignal(signal: Signal): RoutedSignal {
  const normalized = normalizeSignalType(signal.signal);
  const direction = DIRECTION_MAP[normalized];
  const action = determineAction(signal.signal, normalized);

  // Confidence: based on data completeness
  let confidence = 40; // base: we have at least a signal
  if (signal.price > 0) confidence += 20;
  if (signal.timeframe && signal.timeframe !== '—') confidence += 15;
  if (signal.source === 'TradingView') confidence += 15;
  if (signal.symbol.length >= 2) confidence += 10;
  confidence = Math.min(confidence, 100);

  const routed: RoutedSignal = {
    ...signal,
    signal: normalized,   // overwrite with clean type
    normalized,
    direction,
    action,
    confidence,
    routed: true,
  };

  console.log(
    `[Router] ${signal.signal} → ${normalized} | dir:${direction} act:${action} conf:${confidence}% | ${signal.symbol} @ ${signal.price}`
  );

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
