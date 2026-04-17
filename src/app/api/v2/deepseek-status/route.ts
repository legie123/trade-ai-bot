/**
 * GET /api/v2/deepseek-status
 * Fetch DeepSeek API account balance, usage, and credit status
 * Returns: { balance, monthlyExpense, totalTokens, apiRequests, warningLevel, topUpRecommended }
 */

import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
const log = createLogger('DeepSeekStatus');

interface DeepSeekBalance {
  balance: number;
  monthlyExpense: number;
  totalTokens: number;
  apiRequests: number;
  warningLevel: 'OK' | 'WARNING' | 'CRITICAL';
  topUpRecommended: boolean;
  lastChecked: string;
}

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_BASE = 'https://api.deepseek.com';

// Thresholds
const LOW_BALANCE_THRESHOLD = 2.0; // USD
const CRITICAL_BALANCE_THRESHOLD = 1.0; // USD

async function getDeepSeekBalance(): Promise<DeepSeekBalance | null> {
  if (!DEEPSEEK_API_KEY) {
    log.warn('DeepSeekStatus: API key not configured');
    return null;
  }

  try {
    // DeepSeek API v1/user/balance endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${DEEPSEEK_API_BASE}/user/balance`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      log.error(`DeepSeekStatus: API returned ${response.status}`, {
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json();

    // Extract balance info
    const balance = data.available_balance || data.balance || 0;
    const monthlyExpense = data.used_tokens_this_month || 0;
    const totalTokens = data.total_usage || 0;
    const apiRequests = data.total_requests || 0;

    // Determine warning level
    let warningLevel: 'OK' | 'WARNING' | 'CRITICAL' = 'OK';
    if (balance <= CRITICAL_BALANCE_THRESHOLD) {
      warningLevel = 'CRITICAL';
    } else if (balance <= LOW_BALANCE_THRESHOLD) {
      warningLevel = 'WARNING';
    }

    const topUpRecommended = balance <= LOW_BALANCE_THRESHOLD;

    return {
      balance: parseFloat(balance.toFixed(2)),
      monthlyExpense: parseFloat(monthlyExpense.toFixed(2)),
      totalTokens,
      apiRequests,
      warningLevel,
      topUpRecommended,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    log.error('DeepSeekStatus: Failed to fetch balance', { error });
    return null;
  }
}

export async function GET() {
  try {
    // Check if key is configured
    if (!DEEPSEEK_API_KEY) {
      return NextResponse.json(
        {
          status: 'NOT_CONFIGURED',
          message: 'DEEPSEEK_API_KEY not set in environment',
          recommendation: 'Add DEEPSEEK_API_KEY to .env.local',
        },
        { status: 400 }
      );
    }

    const balance = await getDeepSeekBalance();

    if (!balance) {
      return NextResponse.json(
        {
          status: 'ERROR',
          message: 'Failed to fetch DeepSeek balance',
          recommendation: 'Check API key validity and DeepSeek service status',
        },
        { status: 500 }
      );
    }

    // Construct response with formatting
    return NextResponse.json({
      status: 'OK',
      data: {
        ...balance,
        displayBalance: `$${balance.balance.toFixed(2)}`,
        displayExpense: `$${balance.monthlyExpense.toFixed(2)}`,
        percentageUsed: balance.balance > 0
          ? ((balance.monthlyExpense / balance.balance) * 100).toFixed(1)
          : '0',
        estimatedRunwayDays:
          balance.monthlyExpense > 0
            ? Math.floor((balance.balance / balance.monthlyExpense) * 30)
            : null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error('DeepSeekStatus: Endpoint error', { error });
    return NextResponse.json(
      { status: 'ERROR', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
