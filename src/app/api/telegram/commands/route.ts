// ============================================================
// Telegram Bot Commands — Control bot from phone
// POST /api/telegram/commands — process incoming commands
// Supports: /status /balance /trade /pnl /help
// ============================================================
import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('TelegramCommands');

export const dynamic = 'force-dynamic';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

async function sendTelegramMessage(text: string, chatId?: string): Promise<void> {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId || CHAT_ID,
      text,
      parse_mode: 'Markdown',
    }),
  });
}

async function handleCommand(command: string, chatId: string): Promise<string> {
  const cmd = command.trim().toLowerCase().split(' ');

  switch (cmd[0]) {
    case '/start':
    case '/help':
      return `🤖 *Trading AI Bot*\n\nCommands:\n/status — Bot health & status\n/balance — Paper balance & PnL\n/pnl — Today's performance\n/trades — Recent decisions\n/exchanges — Exchange connections\n/price BTC — Get crypto price\n/help — This message`;

    case '/status': {
      try {
        const { getBotConfig } = await import('@/lib/store/db');
        const config = getBotConfig();
        const uptime = process.uptime();
        const mem = process.memoryUsage();
        return `📊 *Bot Status*\n\nMode: ${(config as { mode?: string }).mode || 'PAPER'}\nAuto-Trade: ${process.env.AUTO_TRADE_ENABLED}\nUptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m\nMemory: ${Math.round(mem.rss / 1048576)}MB\nExchange: ${process.env.ACTIVE_EXCHANGE || 'binance'}`;
      } catch {
        return '❌ Error fetching status';
      }
    }

    case '/balance': {
      try {
        const { getPortfolio } = await import('@/lib/engine/portfolio');
        const portfolio = await getPortfolio();
        const pnlPct = portfolio.totalPnl !== 0 ? ((portfolio.totalPnl / 1000) * 100) : 0;
        return `💰 *Portfolio*\n\nTotal: $${portfolio.totalBalance.toFixed(2)}\nCash: $${portfolio.cashBalance.toFixed(2)}\nInvested: $${portfolio.investedBalance.toFixed(2)}\nPnL: ${pnlPct >= 0 ? '📈' : '📉'} ${pnlPct.toFixed(2)}%\nPositions: ${portfolio.positions.length}`;
      } catch {
        return '❌ Error fetching balance';
      }
    }

    case '/pnl': {
      try {
        const { getDecisions } = await import('@/lib/store/db');
        const decisions = getDecisions();
        const today = new Date().toISOString().slice(0, 10);
        const todayDecisions = decisions.filter(d => d.timestamp.startsWith(today));
        const wins = todayDecisions.filter(d => d.outcome === 'WIN').length;
        const losses = todayDecisions.filter(d => d.outcome === 'LOSS').length;
        const pending = todayDecisions.filter(d => d.outcome === 'PENDING').length;
        return `📈 *Today's PnL*\n\nDecisions: ${todayDecisions.length}\n✅ Wins: ${wins}\n❌ Losses: ${losses}\n⏳ Pending: ${pending}\nWin Rate: ${todayDecisions.length > 0 ? Math.round((wins / (wins + losses || 1)) * 100) : 0}%`;
      } catch {
        return '❌ Error fetching PnL';
      }
    }

    case '/trades': {
      try {
        const { getDecisions } = await import('@/lib/store/db');
        const recent = getDecisions().slice(0, 5);
        if (recent.length === 0) return '📋 No recent trades';
        const lines = recent.map(d => {
          const emoji = d.signal === 'BUY' ? '🟢' : '🔴';
          return `${emoji} ${d.signal} ${d.symbol} @ $${d.price} (${d.outcome})`;
        });
        return `📋 *Recent Trades*\n\n${lines.join('\n')}`;
      } catch {
        return '❌ Error fetching trades';
      }
    }

    case '/exchanges': {
      try {
        const binanceOk = !!process.env.BINANCE_API_KEY;
        const mexcOk = !!process.env.MEXC_API_KEY;
        const bybitOk = !!process.env.BYBIT_API_KEY;
        return `🔄 *Exchanges*\n\nBinance: ${binanceOk ? '✅' : '❌'} ${process.env.BINANCE_TESTNET === 'true' ? '(TESTNET)' : '(LIVE)'}\nMEXC: ${mexcOk ? '✅ (LIVE)' : '❌'}\nBybit: ${bybitOk ? '✅' : '❌'}\nActive: ${process.env.ACTIVE_EXCHANGE || 'binance'}`;
      } catch {
        return '❌ Error';
      }
    }

    case '/price': {
      const symbol = (cmd[1] || 'BTC').toUpperCase() + 'USDT';
      try {
        const { getMexcPrice } = await import('@/lib/exchange/mexcClient');
        const price = await getMexcPrice(symbol);
        return `💲 *${symbol}*: $${price.toLocaleString()}`;
      } catch {
        return `❌ Could not fetch price for ${symbol}`;
      }
    }

    default:
      return `❓ Unknown command: ${cmd[0]}\nType /help for available commands`;
  }
}

// Telegram Webhook handler
export async function POST(request: Request) {
  try {
    const update = await request.json();

    // Handle message
    if (update.message?.text) {
      const chatId = update.message.chat.id.toString();
      const text = update.message.text;

      // Only respond to authorized chat
      if (chatId !== CHAT_ID && CHAT_ID) {
        return NextResponse.json({ ok: true });
      }

      if (text.startsWith('/')) {
        const reply = await handleCommand(text, chatId);
        await sendTelegramMessage(reply, chatId);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('Telegram command error', { error: (err as Error).message });
    return NextResponse.json({ ok: true }); // Always return 200 to Telegram
  }
}

// GET — setup webhook info
export async function GET() {
  const webhookUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/telegram/commands`
    : 'Not configured (set RAILWAY_PUBLIC_DOMAIN)';

  return NextResponse.json({
    status: 'ready',
    commands: ['/status', '/balance', '/pnl', '/trades', '/exchanges', '/price <SYMBOL>', '/help'],
    webhookUrl,
    configured: !!BOT_TOKEN,
  });
}
