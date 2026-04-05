import { NextResponse } from 'next/server';
import { MasterSyndicate } from '@/lib/v2/master/syndicate';

export async function GET() {
  const syndicate = new MasterSyndicate();
  const mockMarketData = { 
    symbol: "SOL/USDT", 
    price: 145.2, 
    trend: "BULLISH",
    timestamp: Date.now()
  };

  const status = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ? "✅" : "❌",
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ? "✅" : "❌",
    PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY ? "✅" : "❌",
  };

  try {
    const start = Date.now();
    const consensus = await syndicate.getConsensus(mockMarketData, 'SCALPING');
    const end = Date.now();

    return NextResponse.json({
      title: "🏛️ Diagnostic Sindicatul Maeștrilor TRADE AI V2",
      api_keys_in_env: status,
      result: {
        direction: consensus.finalDirection,
        confidence: `${(consensus.weightedConfidence * 100).toFixed(2)}%`,
        latency: `${end - start}ms`
      },
      masters_opinions: consensus.opinions
    });
  } catch (error: any) {
    return NextResponse.json({ 
      error: "Eroare la procesarea consensului", 
      details: error.message 
    }, { status: 500 });
  }
}
