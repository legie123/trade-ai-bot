/**
 * Shared cron auth helper — single source of truth for all cron endpoints.
 * Checks CRON_SECRET via Bearer token or x-cron-secret header.
 *
 * Usage in any cron route:
 *   import { requireCronAuth } from '@/lib/core/cronAuth';
 *   export async function GET(request: Request) {
 *     const authError = requireCronAuth(request);
 *     if (authError) return authError;
 *     // ... handler logic
 *   }
 *
 * AUTO-HEAL: 2026-04-16 daily audit — extracted from sentiment cron pattern,
 * wired into 5 previously unprotected endpoints.
 */
import { NextResponse } from 'next/server';

/**
 * Returns a 401 NextResponse if auth fails, or null if auth passes.
 * In dev mode (CRON_SECRET not set), allows all requests.
 */
export function requireCronAuth(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return null; // Dev mode — no secret configured

  const authHeader = request.headers.get('authorization');
  const secretHeader = request.headers.get('x-cron-secret');

  if (authHeader === `Bearer ${cronSecret}` || secretHeader === cronSecret) {
    return null; // Auth passed
  }

  return NextResponse.json(
    { error: 'Unauthorized — missing or invalid CRON_SECRET' },
    { status: 401 },
  );
}
