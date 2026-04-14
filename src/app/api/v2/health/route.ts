// ============================================================
// Health Check Endpoint — System Status Dashboard
// GET /api/v2/health — complete system readiness report
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { successResponse, errorResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

interface SystemStatus {
  name: string;
  status: 'OK' | 'ERROR' | 'UNKNOWN';
  latency_ms: number;
  error?: string;
  timestamp: string;
}

interface HealthResponse {
  timestamp: string;
  overall_status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  systems: Record<string, SystemStatus>;
  summary: {
    healthy: number;
    degraded: number;
    critical: number;
  };
}

// Test Polymarket sector
async function checkPolymarket(): Promise<SystemStatus> {
  const start = Date.now();
  try {
    const res = await fetch('https://api.gamma.reservoir.tools/markets', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - start;
    if (res.ok) {
      return { name: 'Polymarket (Gamma API)', status: 'OK', latency_ms: latency, timestamp: new Date().toISOString() };
    } else {
      return { name: 'Polymarket (Gamma API)', status: 'ERROR', latency_ms: latency, error: `HTTP ${res.status}`, timestamp: new Date().toISOString() };
    }
  } catch (err) {
    const latency = Date.now() - start;
    return { name: 'Polymarket (Gamma API)', status: 'ERROR', latency_ms: latency, error: (err as Error).message, timestamp: new Date().toISOString() };
  }
}

// Test Supabase connectivity
async function checkSupabase(): Promise<SystemStatus> {
  const start = Date.now();
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    );
    const { data, error } = await supabase.from('json_store').select('id').limit(1);
    const latency = Date.now() - start;
    if (error) {
      return { name: 'Supabase (json_store)', status: 'ERROR', latency_ms: latency, error: error.message, timestamp: new Date().toISOString() };
    }
    return { name: 'Supabase (json_store)', status: 'OK', latency_ms: latency, timestamp: new Date().toISOString() };
  } catch (err) {
    const latency = Date.now() - start;
    return { name: 'Supabase (json_store)', status: 'ERROR', latency_ms: latency, error: (err as Error).message, timestamp: new Date().toISOString() };
  }
}

// Test Binance WebSocket (lightweight check)
async function checkBinance(): Promise<SystemStatus> {
  const start = Date.now();
  try {
    const res = await fetch('https://api.binance.com/api/v3/ping', {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - start;
    if (res.ok) {
      return { name: 'Binance (REST API)', status: 'OK', latency_ms: latency, timestamp: new Date().toISOString() };
    } else {
      return { name: 'Binance (REST API)', status: 'ERROR', latency_ms: latency, error: `HTTP ${res.status}`, timestamp: new Date().toISOString() };
    }
  } catch (err) {
    const latency = Date.now() - start;
    return { name: 'Binance (REST API)', status: 'ERROR', latency_ms: latency, error: (err as Error).message, timestamp: new Date().toISOString() };
  }
}

// Test DeepSeek API
async function checkDeepSeek(): Promise<SystemStatus> {
  const start = Date.now();
  try {
    if (!process.env.DEEPSEEK_API_KEY) {
      const latency = Date.now() - start;
      return { name: 'DeepSeek LLM', status: 'UNKNOWN', latency_ms: latency, error: 'API key not configured', timestamp: new Date().toISOString() };
    }
    // Just check if key format is valid (don't waste API credits on health checks)
    const hasValidKey = (process.env.DEEPSEEK_API_KEY || '').length > 10;
    const latency = Date.now() - start;
    return { name: 'DeepSeek LLM', status: hasValidKey ? 'OK' : 'ERROR', latency_ms: latency, error: hasValidKey ? undefined : 'Invalid API key format', timestamp: new Date().toISOString() };
  } catch (err) {
    const latency = Date.now() - start;
    return { name: 'DeepSeek LLM', status: 'ERROR', latency_ms: latency, error: (err as Error).message, timestamp: new Date().toISOString() };
  }
}

// Test Telegram Bot
async function checkTelegram(): Promise<SystemStatus> {
  const start = Date.now();
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      const latency = Date.now() - start;
      return { name: 'Telegram Bot', status: 'UNKNOWN', latency_ms: latency, error: 'Bot token or chat ID not configured', timestamp: new Date().toISOString() };
    }
    // Just verify bot token format
    const isValidToken = (process.env.TELEGRAM_BOT_TOKEN || '').includes(':');
    const latency = Date.now() - start;
    return { name: 'Telegram Bot', status: isValidToken ? 'OK' : 'ERROR', latency_ms: latency, error: isValidToken ? undefined : 'Invalid bot token format', timestamp: new Date().toISOString() };
  } catch (err) {
    const latency = Date.now() - start;
    return { name: 'Telegram Bot', status: 'ERROR', latency_ms: latency, error: (err as Error).message, timestamp: new Date().toISOString() };
  }
}

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    // Run all checks in parallel
    const [polymarket, supabase, binance, deepseek, telegram] = await Promise.all([
      checkPolymarket(),
      checkSupabase(),
      checkBinance(),
      checkDeepSeek(),
      checkTelegram(),
    ]);

    const systems = {
      polymarket,
      supabase,
      binance,
      deepseek,
      telegram,
    };

    // Calculate overall status
    const statusCounts = {
      OK: Object.values(systems).filter(s => s.status === 'OK').length,
      ERROR: Object.values(systems).filter(s => s.status === 'ERROR').length,
      UNKNOWN: Object.values(systems).filter(s => s.status === 'UNKNOWN').length,
    };

    let overall_status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = 'HEALTHY';
    if (statusCounts.ERROR > 0) {
      overall_status = statusCounts.ERROR >= 2 ? 'CRITICAL' : 'DEGRADED';
    }

    const response: HealthResponse = {
      timestamp,
      overall_status,
      systems,
      summary: {
        healthy: statusCounts.OK,
        degraded: statusCounts.UNKNOWN,
        critical: statusCounts.ERROR,
      },
    };

    const statusCode = overall_status === 'HEALTHY' ? 200 : overall_status === 'DEGRADED' ? 206 : 503;
    return successResponse(response, statusCode);
  } catch (err) {
    return errorResponse('HEALTH_CHECK_FAILED', (err as Error).message, 503);
  }
}
