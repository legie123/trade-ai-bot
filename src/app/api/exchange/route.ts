// GET /api/exchange — get exchange info, balance, positions, orders
// POST /api/exchange — place orders, configure exchange
import { NextResponse } from 'next/server';
import { getExchangeClient } from '@/lib/exchange/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = getExchangeClient();
    const [balance, positions, orders, info] = await Promise.all([
      client.getBalance(),
      client.getPositions(),
      client.getOrders(),
      Promise.resolve(client.getInfo()),
    ]);

    return NextResponse.json({
      status: 'ok',
      exchange: info,
      balance,
      positions,
      orders: orders.slice(0, 20),
    });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'order': {
        const client = getExchangeClient();
        const result = await client.placeOrder(body.order);
        return NextResponse.json({ status: 'ok', order: result });
      }
      case 'configure': {
        const client = getExchangeClient(body.config);
        return NextResponse.json({ status: 'ok', exchange: client.getInfo() });
      }
      default:
        return NextResponse.json(
          { status: 'error', error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
