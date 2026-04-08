import { NextResponse } from 'next/server';

export async function GET() {
  const result: {
    openai: { status: string; balance: string };
    deepseek: { status: string; balance: string; is_available: boolean };
  } = {
    openai: { status: 'UNKNOWN', balance: 'N/A' },
    deepseek: { status: 'UNKNOWN', balance: 'N/A', is_available: false },
  };

  // 1. Check OpenAI Health (Cannot pull balance, only test if key works)
  try {
    if (process.env.OPENAI_API_KEY) {
      const oaiRes = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        // Short timeout for fast dashboard load
        signal: AbortSignal.timeout(3000)
      });
      if (oaiRes.status === 200) result.openai.status = 'ACTIVE';
      else if (oaiRes.status === 429) result.openai.status = 'QUOTA_EXCEEDED';
      else if (oaiRes.status === 401) result.openai.status = 'INVALID_KEY';
      else result.openai.status = `ERROR_${oaiRes.status}`;
    } else {
      result.openai.status = 'MISSING_KEY';
    }
  } catch (e) {
    result.openai.status = 'NETWORK_ERROR';
  }

  // 2. Check DeepSeek Balance
  try {
    if (process.env.DEEPSEEK_API_KEY) {
      const dsRes = await fetch('https://api.deepseek.com/user/balance', {
        headers: { 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
        signal: AbortSignal.timeout(3000)
      });
      if (dsRes.ok) {
        const data = await dsRes.json();
        result.deepseek.is_available = data.is_available;
        result.deepseek.balance = `$${data.balance_infos?.[0]?.total_balance || '0.00'}`;
        result.deepseek.status = data.is_available ? 'ACTIVE' : 'INACTIVE';
      } else {
        result.deepseek.status = `HTTP_${dsRes.status}`;
      }
    } else {
      result.deepseek.status = 'MISSING_KEY';
    }
  } catch (e) {
    result.deepseek.status = 'NETWORK_ERROR';
  }

  return NextResponse.json(result);
}
