// GET /api/ml/predict — ML prediction from current market state
// POST /api/ml/predict — predict with custom input
// GET /api/ml/train — train model and return accuracy
import { NextResponse } from 'next/server';
import { predict, trainModel, PredictionInput } from '@/lib/ml/predictor';
import { getDecisions } from '@/lib/store/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'predict';

    if (action === 'train') {
      const result = trainModel();
      return NextResponse.json({ status: 'ok', action: 'train', ...result });
    }

    // Auto-generate input from recent decisions
    const decisions = getDecisions();
    const recent = decisions.slice(0, 10);
    const wins = recent.filter(d => d.outcome === 'WIN').length;

    const input: PredictionInput = {
      priceChange1h: parseFloat(url.searchParams.get('pc1h') || '0'),
      priceChange24h: parseFloat(url.searchParams.get('pc24h') || '0'),
      volume24h: parseFloat(url.searchParams.get('vol') || '1000000'),
      rsi: parseFloat(url.searchParams.get('rsi') || '50'),
      confidence: parseFloat(url.searchParams.get('conf') || '80'),
      recentWinRate: wins / Math.max(recent.length, 1),
      streak: wins > 5 ? wins : -(10 - wins),
    };

    const prediction = predict(input);
    return NextResponse.json({ status: 'ok', prediction });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prediction = predict(body as PredictionInput);
    return NextResponse.json({ status: 'ok', prediction });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
