// ============================================================
// Trading Mode — Global paper/live execution gate
//
// ADDITIVE SAFETY LAYER. Does not replace any existing logic.
// Every exchange-order entrypoint should call assertPaperMode()
// before issuing a real order. Default mode = PAPER.
//
// To enable live trading intentionally, TWO env vars must be set:
//   TRADING_MODE=LIVE
//   LIVE_TRADING_CONFIRM=YES_I_UNDERSTAND_RISK
//
// Missing either one → mode collapses to PAPER and order calls throw.
// ============================================================
import { createLogger } from '@/lib/core/logger';
import { isKillSwitchEngaged } from '@/lib/core/killSwitch';

const log = createLogger('TradingMode');

export type TradingMode = 'PAPER' | 'LIVE';

const LIVE_CONFIRM_TOKEN = 'YES_I_UNDERSTAND_RISK';

let warnedLiveButNoConfirm = false;

export function getTradingMode(): TradingMode {
  const raw = (process.env.TRADING_MODE || 'PAPER').toUpperCase().trim();
  if (raw === 'LIVE') {
    const confirm = (process.env.LIVE_TRADING_CONFIRM || '').trim();
    if (confirm !== LIVE_CONFIRM_TOKEN) {
      if (!warnedLiveButNoConfirm) {
        log.warn(
          '[TradingMode] TRADING_MODE=LIVE detected but LIVE_TRADING_CONFIRM is missing or wrong. Collapsing to PAPER.'
        );
        warnedLiveButNoConfirm = true;
      }
      return 'PAPER';
    }
    return 'LIVE';
  }
  return 'PAPER';
}

export function isLiveTradingEnabled(): boolean {
  return getTradingMode() === 'LIVE';
}

export function isPaperMode(): boolean {
  return getTradingMode() === 'PAPER';
}

/**
 * Call at the top of every function that would issue a real exchange order.
 * Throws in PAPER mode, swallowing nothing. Also refuses to execute if the
 * kill switch is engaged, regardless of mode.
 */
export function assertLiveTradingAllowed(context: string): void {
  if (isKillSwitchEngaged()) {
    throw new Error(
      `[TradingMode] Kill switch is engaged. Refusing live order in context="${context}".`
    );
  }
  if (!isLiveTradingEnabled()) {
    throw new Error(
      `[TradingMode] Live trading disabled (mode=PAPER). Refusing real order in context="${context}". ` +
        `To enable live trading set TRADING_MODE=LIVE and LIVE_TRADING_CONFIRM=${LIVE_CONFIRM_TOKEN}.`
    );
  }
}

/**
 * Like assertLiveTradingAllowed but does NOT check the kill switch.
 * Intended ONLY for the emergency-exit liquidation path, which the kill
 * switch itself triggers and therefore must not be blocked by it.
 */
export function assertLiveTradingAllowedForEmergencyExit(context: string): void {
  if (!isLiveTradingEnabled()) {
    throw new Error(
      `[TradingMode] Live trading disabled (mode=PAPER). Refusing emergency exit in context="${context}".`
    );
  }
}

/**
 * Inverse: asserts we are in PAPER. Useful for paper-only code paths that
 * must never be invoked when the operator has intentionally flipped to LIVE.
 */
export function assertPaperMode(context: string): void {
  if (isLiveTradingEnabled()) {
    throw new Error(
      `[TradingMode] Expected PAPER mode in context="${context}" but live trading is enabled.`
    );
  }
}

export function getTradingModeSummary(): {
  mode: TradingMode;
  liveConfirmed: boolean;
  killSwitch: boolean;
} {
  const mode = getTradingMode();
  const confirm = (process.env.LIVE_TRADING_CONFIRM || '').trim() === LIVE_CONFIRM_TOKEN;
  return {
    mode,
    liveConfirmed: mode === 'LIVE' && confirm,
    killSwitch: isKillSwitchEngaged(),
  };
}
