// ============================================================
// Health Check Endpoint — System Status Dashboard
// GET /api/v2/health — complete system readiness report
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { successResponse, errorResponse } from '@/lib/api-response';
import { getTradingModeSummary } from '@/lib/core/tradingMode';
import { createLogger } from '@/lib/core/logger';
const log = createLogger('Health');
import { polyWsClient } from '@/lib/polymarket/polyWsClient';
import { WsStreamManager } from '@/lib/providers/wsStreams';
import { getWatchdogState } from '@/lib/core/watchdog';
import { getFreshHealthSnapshot } from '@/lib/core/heartbeat';
import { getKillSwitchState } from '@/lib/core/killSwitch';

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
    const res = await fetch('https://gamma-api.polymarket.com/markets?limit=1', {
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
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    // AUDIT FIX T5.4: Removed diagnostic logs that leaked key metadata

    if (!url || !key) {
      const latency = Date.now() - start;
      return {
        name: 'Supabase (json_store)',
        status: 'ERROR',
        latency_ms: latency,
        error: `Missing env vars: url=${!!url}, key=${!!key}`,
        timestamp: new Date().toISOString()
      };
    }

    const supabase = createClient(url, key);
    log.debug('Supabase client created, querying json_store...');

    const { error } = await supabase.from('json_store').select('id').limit(1);
    const latency = Date.now() - start;

    if (error) {
      log.warn('Supabase query error', { error: error.message });
      return { name: 'Supabase (json_store)', status: 'ERROR', latency_ms: latency, error: error.message, timestamp: new Date().toISOString() };
    }

    log.debug('Supabase query success');
    return { name: 'Supabase (json_store)', status: 'OK', latency_ms: latency, timestamp: new Date().toISOString() };
  } catch (err) {
    const latency = Date.now() - start;
    log.error('Supabase check exception', { error: (err as Error).message });
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

    // C17 fix (2026-04-19): expose heartbeat/watchdog/killSwitch here too so that
    // dashboard polling fallback (`health.coreMonitor.*`) has real values when
    // SSE briefly drops. Previously only live-stream SSE carried these fields
    // → poll-fallback showed "UNKNOWN" for 5+ seconds per reconnect.
    const watchdog = getWatchdogState();
    const heartbeat = getFreshHealthSnapshot();
    const killSwitch = getKillSwitchState();
    const trading_mode_raw = getTradingModeSummary();

    const response: HealthResponse & {
      trading_mode?: ReturnType<typeof getTradingModeSummary> & { killSwitchEngaged?: boolean };
      feeds?: { polymarketWs: unknown; mexcWs: unknown };
      coreMonitor?: {
        heartbeat: string;
        watchdog: string;
        killSwitch: string;
        scanRunning: boolean;
        lastScanAt: string | null;
      };
      systemMode?: string;
    } = {
      timestamp,
      overall_status,
      systems,
      summary: {
        healthy: statusCounts.OK,
        degraded: statusCounts.UNKNOWN,
        critical: statusCounts.ERROR,
      },
      trading_mode: {
        ...trading_mode_raw,
        killSwitchEngaged: killSwitch.engaged,
      },
      coreMonitor: {
        heartbeat: heartbeat?.status || 'UNKNOWN',
        watchdog: watchdog.status || 'UNKNOWN',
        killSwitch: killSwitch.engaged ? 'ENGAGED' : 'OFF',
        scanRunning: heartbeat?.scanLoop?.running ?? false,
        lastScanAt: heartbeat?.scanLoop?.lastScanAt || null,
      },
      systemMode: trading_mode_raw.mode,
      feeds: {
        polymarketWs: polyWsClient.getFeedHealth(),
        mexcWs: WsStreamManager.getInstance().getFeedHealth(),
      },
    };

    const statusCode = overall_status === 'HEALTHY' ? 200 : overall_status === 'DEGRADED' ? 206 : 503;
    return successResponse(response, statusCode);
  } catch (err) {
    return errorResponse('HEALTH_CHECK_FAILED', (err as Error).message, 503);
  }
}
