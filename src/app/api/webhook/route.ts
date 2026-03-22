// ============================================================
// Webhook Receiver — Accept external signals from TradingView
// POST /api/webhook — receives TradingView alert JSON
// ============================================================
import { NextResponse } from 'next/server';
import { addDecision } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('WebhookRoute');

export const dynamic = 'force-dynamic';

interface WebhookPayload {
  // TradingView format
  ticker?: string;
  exchange?: string;
  action?: 'BUY' | 'SELL' | 'buy' | 'sell';
  price?: number;
  close?: number;
  volume?: number;
  interval?: string;
  // Custom fields
  signal?: string;
  symbol?: string;
  confidence?: number;
  source?: string;
  message?: string;
}

// Simple auth via query param or header
function isAuthorized(request: Request): boolean {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || request.headers.get('x-webhook-token');
  const expected = process.env.WEBHOOK_SECRET || 'trading-ai-webhook-2026';
  return token === expected;
}

export async function POST(request: Request) {
  try {
    // Auth check
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: WebhookPayload = await request.json();

    // Normalize fields
    const symbol = (body.symbol || body.ticker || 'UNKNOWN').toUpperCase();
    const action = (body.action || body.signal || 'BUY').toUpperCase() as 'BUY' | 'SELL';
    const price = body.price || body.close || 0;
    const confidence = body.confidence || 75;
    const source = body.source || 'TradingView Webhook';

    // Validate
    if (!symbol || !price) {
      return NextResponse.json({ error: 'Missing symbol or price' }, { status: 400 });
    }

    // Store as decision
    const decision = {
      id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      signalId: `webhook_${symbol}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      symbol,
      signal: action,
      price,
      source,
      confidence,
      mlScore: confidence,
      outcome: 'PENDING' as const,
      pnlPercent: 0,
      evaluatedAt: null,
      direction: action === 'BUY' ? 'BULLISH' as const : 'BEARISH' as const,
      action: action === 'BUY' ? 'ENTRY' as const : 'EXIT' as const,
      ema50: 0, ema200: 0, ema800: 0,
      psychHigh: 0, psychLow: 0, dailyOpen: price,
      priceAfter5m: null, priceAfter15m: null, priceAfter1h: null, priceAfter4h: null,
    };

    addDecision(decision);

    // Send Telegram alert if configured
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (botToken && chatId) {
        const emoji = action === 'BUY' ? '🟢' : '🔴';
        const msg = `${emoji} *Webhook Signal*\n${action} ${symbol} @ $${price}\nSource: ${source}\nConfidence: ${confidence}%`;
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' }),
        });
      }
    } catch { /* Telegram optional */ }

    log.info(`${action} ${symbol} @ $${price} from ${source}`);

    return NextResponse.json({
      status: 'received',
      decision: { id: decision.id, symbol, action, price, source },
      timestamp: decision.timestamp,
    });

  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// GET — webhook info
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/webhook',
    method: 'POST',
    auth: 'Query param ?token=YOUR_SECRET or header x-webhook-token',
    format: {
      required: { symbol: 'string', price: 'number', action: 'BUY|SELL' },
      optional: { confidence: 'number (0-100)', source: 'string', volume: 'number' },
    },
    tradingview_example: {
      ticker: '{{ticker}}',
      action: '{{strategy.order.action}}',
      close: '{{close}}',
      volume: '{{volume}}',
      interval: '{{interval}}',
    },
    status: 'ready',
  });
}
