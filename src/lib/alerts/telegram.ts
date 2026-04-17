// ============================================================
// Telegram Bot — Alerts with Accept/Reject buttons
// Uses Telegram Bot API (no external deps)
// ============================================================

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = () => process.env.TELEGRAM_CHAT_ID || '';
const BASE_URL = () => `https://api.telegram.org/bot${BOT_TOKEN()}`;

export interface TelegramAlert {
  symbol: string;
  signal: string;
  price: number;
  confidence: number;
  mlScore?: number;
  mlVerdict?: string;
  stopLoss?: number;
  takeProfit?: number;
  source: string;
  rsiValue?: number;
  rsiZone?: string;
  fearGreed?: number;
  fearGreedLabel?: string;
  regime?: string;
  bbSignal?: string;
}

// ─── Send message with inline keyboard ─────────────
export async function sendAlert(alert: TelegramAlert): Promise<boolean> {
  if (!BOT_TOKEN() || !CHAT_ID()) {
    console.log('[Telegram] Bot token or chat ID not configured');
    return false;
  }

  const emoji = alert.signal === 'BUY' || alert.signal === 'LONG' ? '🟢' : '🔴';
  const mlBadge = alert.mlVerdict ? `\n🤖 ML: ${alert.mlVerdict} (${alert.mlScore}%)` : '';
  const rsiBadge = alert.rsiValue ? `\n📈 RSI: ${alert.rsiValue} (${alert.rsiZone || ''})` : '';
  const fgBadge = alert.fearGreed !== undefined ? `\n😱 Fear/Greed: ${alert.fearGreed} (${alert.fearGreedLabel || ''})` : '';
  const regimeBadge = alert.regime ? `\n🌊 Regime: ${alert.regime}` : '';
  const bbBadge = alert.bbSignal && alert.bbSignal !== 'NONE' ? `\n📊 BB: ${alert.bbSignal}` : '';

  const text = [
    `${emoji} *${alert.signal}* — ${alert.symbol}`,
    `💰 Price: \`$${alert.price}\``,
    `📊 Confidence: ${alert.confidence}%${mlBadge}${rsiBadge}`,
    alert.stopLoss ? `🛑 SL: \`$${alert.stopLoss}\`` : '',
    alert.takeProfit ? `🎯 TP: \`$${alert.takeProfit}\`` : '',
    `${fgBadge}${regimeBadge}${bbBadge}`,
    `📡 Source: ${alert.source}`,
    `⏰ ${new Date().toLocaleTimeString()}`,
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch(`${BASE_URL()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        chat_id: CHAT_ID(),
        text,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Accept Trade', callback_data: `accept_${alert.symbol}_${alert.signal}` },
              { text: '❌ Reject', callback_data: `reject_${alert.symbol}_${alert.signal}` },
            ],
            [
              { text: '📊 Details', callback_data: `details_${alert.symbol}` },
              { text: '⏸️ Pause Bot', callback_data: 'pause_bot' },
            ],
          ],
        },
      }),
    });

    const data = await res.json();
    return data.ok === true;
  } catch (err) {
    console.warn('[Telegram] Send error:', err);
    return false;
  }
}

// ─── Send simple text message ──────────────────────
export async function sendMessage(text: string): Promise<boolean> {
  if (!BOT_TOKEN() || !CHAT_ID()) return false;

  try {
    const res = await fetch(`${BASE_URL()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        chat_id: CHAT_ID(),
        text,
        parse_mode: 'Markdown',
      }),
    });
    const data = await res.json();
    return data.ok === true;
  } catch (err) {
    // AUDIT FIX BUG-10: Log Telegram failures instead of silently swallowing
    console.error(`[Telegram] Failed to send message: ${(err as Error).message}`);
    return false;
  }
}

// ─── Send daily summary ────────────────────────────
export async function sendDailySummary(stats: {
  totalTrades: number;
  wins: number;
  losses: number;
  pnl: number;
  balance: number;
}): Promise<boolean> {
  const text = [
    '📊 *Daily Trading Summary*',
    `Trades: ${stats.totalTrades} (${stats.wins}W / ${stats.losses}L)`,
    `PnL: ${stats.pnl >= 0 ? '+' : ''}${stats.pnl}%`,
    `Balance: $${stats.balance.toLocaleString()}`,
    `Win Rate: ${stats.totalTrades > 0 ? Math.round((stats.wins / stats.totalTrades) * 100) : 0}%`,
  ].join('\n');

  return sendMessage(text);
}

// ─── Test connection ───────────────────────────────
export async function testTelegram(): Promise<{ ok: boolean; botName?: string; error?: string }> {
  if (!BOT_TOKEN()) return { ok: false, error: 'Bot token not set' };

  try {
    const res = await fetch(`${BASE_URL()}/getMe`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data.ok) {
      return { ok: true, botName: data.result?.username };
    }
    return { ok: false, error: data.description };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
