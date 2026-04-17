// ============================================================
// AUDIT FIX T2.1: Centralized Auth Middleware
// Protects all /api/* routes except explicitly public ones.
// Routes with their own auth (a2a, cron, tradingview) are excluded.
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// AUDIT FIX T3.6: No fallback default — if AUTH_SECRET is not set, all auth fails (fail-closed)
const AUTH_SECRET = process.env.AUTH_SECRET || '';

// --- Public paths: no auth required ---
const PUBLIC_PREFIXES = [
  '/api/auth',             // Login endpoint
  '/api/v2/health',        // Health check (monitoring)
  '/api/a2a/',             // A2A routes have SWARM_TOKEN auth
  '/api/cron',             // Has CRON_SECRET auth
  '/api/moltbook-cron',    // Has CRON_SECRET auth
  '/api/v2/cron/',         // Has CRON_SECRET auth
  '/api/tradingview',      // Has TV_SECRET_TOKEN auth
  '/api/live-stream',      // SSE stream (auth checked internally or public dashboard)
  '/api/v2/command',       // Has own CRON_SECRET auth
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

function verifyJWT(token: string): boolean {
  if (!AUTH_SECRET) return false; // No secret configured → reject all
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [header, body, sig] = parts;
    const expected = crypto
      .createHmac('sha256', AUTH_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');
    if (sig !== expected) return false;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

function isAuthenticated(request: NextRequest): boolean {
  // Cookie auth
  const authCookie = request.cookies.get('auth_token')?.value;
  if (authCookie && verifyJWT(authCookie)) return true;

  // Bearer token auth
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    if (verifyJWT(authHeader.slice(7))) return true;
  }

  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /api/* routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Skip public/self-authed routes
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Require auth for everything else
  if (!isAuthenticated(request)) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Valid auth token required' },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
