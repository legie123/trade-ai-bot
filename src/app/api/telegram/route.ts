// GET /api/telegram — Telegram bot connectivity check
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return NextResponse.json({ ok: false, reason: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set' });
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({ ok: true, bot: data.result?.username, chatId });
    }
    return NextResponse.json({ ok: false, reason: `Telegram API returned ${res.status}` });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: (err as Error).message });
  }
}
