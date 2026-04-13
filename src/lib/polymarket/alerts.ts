// ============================================================
// Polymarket Alert System — Telegram Integration
// Sends alerts to Telegram with priority levels and rate limiting
// ============================================================

import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyAlerts');

const TELEGRAM_BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = () => process.env.TELEGRAM_CHAT_ID || '';

// ─── Rate Limiting ──────────────────────────────────
const RATE_LIMIT_MS = 5000; // Max 1 message per 5 seconds
let lastAlertTime = 0;

function isRateLimited(): boolean {
  const now = Date.now();
  if (now - lastAlertTime < RATE_LIMIT_MS) {
    return true;
  }
  lastAlertTime = now;
  return false;
}

// ─── Send Raw Telegram Message ──────────────────────
export async function sendTelegramAlert(
  message: string,
  priority: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM'
): Promise<boolean> {
  // Config check
  if (!TELEGRAM_BOT_TOKEN() || !TELEGRAM_CHAT_ID()) {
    log.debug('Telegram not configured, skipping alert', {
      hasToken: !!TELEGRAM_BOT_TOKEN(),
      hasChat: !!TELEGRAM_CHAT_ID(),
    });
    return false;
  }

  // Rate limit (HIGH priority bypasses rate limit)
  if (priority !== 'HIGH' && isRateLimited()) {
    log.debug('Alert rate limited', { priority });
    return false;
  }

  // Add emoji prefix
  const emojiMap = {
    LOW: '🟢',
    MEDIUM: '🟡',
    HIGH: '🔴',
  };
  const prefix = emojiMap[priority];
  const fullMessage = `${prefix} ${message}`;

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN()}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID(),
        text: fullMessage,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
      log.warn('Telegram API error', {
        status: response.status,
        error: (errorData.description as string) || 'Unknown error',
      });
      return false;
    }

    const data = await response.json() as Record<string, unknown>;
    if (data.ok !== true) {
      log.warn('Telegram response not OK', { response: data });
      return false;
    }

    log.debug('Alert sent to Telegram', { priority, messageLength: message.length });
    return true;
  } catch (err) {
    log.error('Telegram send failed', {
      error: String(err),
      priority,
    });
    return false;
  }
}

// ─── Alert: Bet Placed ──────────────────────────────
export async function alertBetPlaced(
  division: string | undefined,
  marketTitle: string,
  direction: string,
  amount: number,
  confidence: number
): Promise<boolean> {
  const divisionLabel = division ? ` [${division}]` : '';
  const message = [
    `Bet Placed${divisionLabel}`,
    `Market: ${marketTitle}`,
    `Direction: *${direction}*`,
    `Amount: $${amount.toFixed(2)}`,
    `Confidence: ${confidence}%`,
  ].join('\n');

  return sendTelegramAlert(message, 'MEDIUM');
}

// ─── Alert: Bet Resolved ────────────────────────────
export async function alertBetResolved(
  division: string | undefined,
  marketTitle: string,
  outcome: 'WIN' | 'LOSS' | 'NEUTRAL',
  pnl: number
): Promise<boolean> {
  const divisionLabel = division ? ` [${division}]` : '';
  const outcomeEmoji = outcome === 'WIN' ? '✅' : outcome === 'LOSS' ? '❌' : '⚪';
  const pnlSign = pnl >= 0 ? '+' : '';

  const message = [
    `${outcomeEmoji} Bet Resolved${divisionLabel}`,
    `Market: ${marketTitle}`,
    `Outcome: *${outcome}*`,
    `PnL: *${pnlSign}${pnl.toFixed(2)}%*`,
  ].join('\n');

  return sendTelegramAlert(message, outcome === 'LOSS' ? 'HIGH' : 'MEDIUM');
}

// ─── Alert: Risk Halt (ALWAYS HIGH) ────────────────
export async function alertRiskHalt(
  division: string | undefined,
  reason: string,
  currentDrawdown: number
): Promise<boolean> {
  const divisionLabel = division ? ` [${division}]` : '';

  const message = [
    `🛑 Risk Halt Activated${divisionLabel}`,
    `Reason: *${reason}*`,
    `Current Drawdown: ${currentDrawdown.toFixed(2)}%`,
    `⚠️ Trading paused until drawdown recovers`,
  ].join('\n');

  // ALWAYS HIGH priority — this is critical
  return sendTelegramAlert(message, 'HIGH');
}

// ─── Alert: Daily Digest ────────────────────────────
export async function alertDailyDigest(
  totalBets: number,
  winRate: number,
  totalPnL: number,
  topDivision?: string
): Promise<boolean> {
  const topDivisionLine = topDivision ? `Top Division: *${topDivision}*\n` : '';

  const message = [
    '📊 *Daily Trading Digest*',
    `Total Bets: ${totalBets}`,
    `Win Rate: ${winRate.toFixed(1)}%`,
    `Total PnL: *${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}%*`,
    topDivisionLine,
    `⏰ ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
  ]
    .filter(Boolean)
    .join('\n');

  return sendTelegramAlert(message, 'LOW');
}

// ─── Health Check ──────────────────────────────────
export async function testTelegramConnection(): Promise<{
  ok: boolean;
  message?: string;
}> {
  if (!TELEGRAM_BOT_TOKEN()) {
    return {
      ok: false,
      message: 'TELEGRAM_BOT_TOKEN not configured',
    };
  }

  if (!TELEGRAM_CHAT_ID()) {
    return {
      ok: false,
      message: 'TELEGRAM_CHAT_ID not configured',
    };
  }

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN()}/getMe`;
    const response = await fetch(url);

    if (!response.ok) {
      return {
        ok: false,
        message: `HTTP ${response.status}`,
      };
    }

    const data = await response.json() as Record<string, unknown>;
    if (data.ok !== true) {
      return {
        ok: false,
        message: (data.description as string) || 'Telegram API error',
      };
    }

    const result = data.result as Record<string, unknown> | undefined;
    return {
      ok: true,
      message: `Connected as @${(result?.username as string) || 'unknown'}`,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Connection failed: ${String(err)}`,
    };
  }
}
