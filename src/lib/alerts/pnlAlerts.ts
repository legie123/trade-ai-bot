// ============================================================
// PnL Alert System — Automated Telegram notifications
// Daily reports, stop-loss alerts, milestone celebrations
// ============================================================
import { getDecisions, getBotConfig } from '@/lib/store/db';
import { getPortfolio } from '@/lib/engine/portfolio';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PnLAlerts');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

async function sendAlert(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' }),
    });
  } catch (err) {
    log.error('Failed to send PnL alert', { error: (err as Error).message });
  }
}

// ─── Daily Report ─────────────────────────────────
export async function sendDailyReport(): Promise<void> {
  const decisions = getDecisions();
  const portfolio = await getPortfolio();
  const today = new Date().toISOString().slice(0, 10);
  const todayDecisions = decisions.filter(d => d.timestamp.startsWith(today));

  const wins = todayDecisions.filter(d => d.outcome === 'WIN').length;
  const losses = todayDecisions.filter(d => d.outcome === 'LOSS').length;
  const winRate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;

  const config = getBotConfig() as { paperBalance?: number };
  const pnlPercent = ((portfolio.totalBalance - (config.paperBalance || 1000)) / (config.paperBalance || 1000)) * 100;
  const pnlEmoji = pnlPercent >= 0 ? '📈' : '📉';

  const msg = `📊 *Daily Report — ${today}*\n\n` +
    `${pnlEmoji} PnL: ${pnlPercent.toFixed(2)}% ($${portfolio.totalPnl.toFixed(2)})\n` +
    `💰 Balance: $${portfolio.totalBalance.toFixed(2)} / $${config.paperBalance || 1000}\n` +
    `📋 Today: ${todayDecisions.length} decisions\n` +
    `✅ Wins: ${wins} | ❌ Losses: ${losses} | WR: ${winRate}%\n` +
    `📊 Positions: ${portfolio.positions.length}\n\n` +
    `🤖 Bot: ${process.env.AUTO_TRADE_ENABLED === 'true' ? 'ACTIVE' : 'PAUSED'}`;

  await sendAlert(msg);
}

// ─── Stop-Loss Alert ──────────────────────────────
export async function checkStopLossAlert(): Promise<boolean> {
  const portfolio = await getPortfolio();
  const config = getBotConfig() as { paperBalance?: number };
  const pnlPercent = ((portfolio.totalBalance - (config.paperBalance || 1000)) / (config.paperBalance || 1000)) * 100;
  const maxLoss = parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '3');

  if (pnlPercent <= -maxLoss) {
    await sendAlert(
      `🚨 *STOP-LOSS ALERT*\n\n` +
      `Daily loss limit reached: ${pnlPercent.toFixed(2)}%\n` +
      `Max allowed: -${maxLoss}%\n` +
      `Balance: $${portfolio.totalBalance.toFixed(2)}\n\n` +
      `⚠️ Auto-trading paused until tomorrow`
    );
    return true;
  }
  return false;
}

// ─── Trade Executed Alert ─────────────────────────
export async function sendTradeAlert(
  action: 'BUY' | 'SELL',
  symbol: string,
  price: number,
  amount: number,
  exchange: string
): Promise<void> {
  const emoji = action === 'BUY' ? '🟢' : '🔴';
  await sendAlert(
    `${emoji} *Trade Executed*\n\n` +
    `${action} ${symbol}\n` +
    `Price: $${price.toLocaleString()}\n` +
    `Amount: $${amount.toFixed(2)}\n` +
    `Exchange: ${exchange}\n` +
    `Time: ${new Date().toLocaleTimeString()}`
  );
}

// ─── Milestone Alert ──────────────────────────────
export async function checkMilestones(): Promise<void> {
  const portfolio = await getPortfolio();
  const config = getBotConfig() as { paperBalance?: number };
  const pnlPercent = ((portfolio.totalBalance - (config.paperBalance || 1000)) / (config.paperBalance || 1000)) * 100;
  const decisions = getDecisions();

  // Profit milestones
  const milestones = [1, 2, 5, 10, 20, 50];
  for (const m of milestones) {
    if (pnlPercent >= m && pnlPercent < m + 1) {
      await sendAlert(`🎉 *Milestone!* Portfolio up +${m}%! Balance: $${portfolio.totalBalance.toFixed(2)}`);
      break;
    }
  }

  // Decision count milestones
  const decisionMilestones = [100, 500, 1000, 5000];
  for (const m of decisionMilestones) {
    if (decisions.length === m) {
      await sendAlert(`📊 *${m} Decisions!* Trading AI has made ${m} trading decisions.`);
      break;
    }
  }
}

// ─── Run All Checks ───────────────────────────────
export async function runPnlAlertChecks(): Promise<{
  stopLossTriggered: boolean;
  dailyReportSent: boolean;
}> {
  const stopLossTriggered = await checkStopLossAlert();
  await checkMilestones();

  // Send daily report at ~20:00
  const hour = new Date().getUTCHours();
  let dailyReportSent = false;
  if (hour === 18) { // 20:00 UTC+2
    await sendDailyReport();
    dailyReportSent = true;
  }

  return { stopLossTriggered, dailyReportSent };
}
