// ============================================================
// AUDIT FIX T2.1: Centralized Auth Middleware
// Protects all /api/* routes except explicitly public ones.
// Routes with their own auth (a2a, cron, tradingview) are excluded.
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
// FIX 2026-04-19 (C8): Edge Runtime does not support Node.js `crypto` module.
// Replaced with Web Crypto API (crypto.subtle) which IS available in Edge.

// AUDIT FIX T3.6: No fallback default — if AUTH_SECRET is not set, all auth fails (fail-closed)
const AUTH_SECRET = process.env.AUTH_SECRET || '';

// --- Public paths: no auth required ---
const PUBLIC_PREFIXES = [
  '/api/auth',             // Login endpoint
  '/api/health',            // Top-level health proxy (Cloud Scheduler)
  '/api/v2/health',        // Health check (monitoring)
  '/api/v2/diag/',         // FAZA 3 Batch 2: read-only diagnostic endpoints (regime, sentiment-flag, cpcv, graveyard, meta-label, sizing-mult, wash)
  '/api/diagnostics/',     // Health diagnostics (master, credits, signal-quality)
  '/api/a2a/',             // A2A routes have SWARM_TOKEN auth
  '/api/cron',             // Has CRON_SECRET auth
  '/api/moltbook-cron',    // Has CRON_SECRET auth
  '/api/v2/cron/',         // Has CRON_SECRET auth
  '/api/v2/arena',         // Arena status (read-only leaderboard)
  '/api/v2/omega-status',  // Omega status (read-only)
  '/api/v2/cockpit-health',// Cockpit health (read-only)
  '/api/v2/intelligence/', // Intelligence feeds (read-only)
  '/api/v2/polymarket',    // Polymarket status + scan (scan has CRON auth)
  '/api/v2/deepseek-status',// DeepSeek credit check (read-only)
  '/api/v2/events',         // EventHub log (has cronAuth)
  '/api/v2/analytics',      // Performance analytics (has cronAuth)
  '/api/v2/pre-live',       // Pre-live gate check (has cronAuth)
  '/api/btc-signals',      // BTC scanner (triggered by cron internally, read-only externally)
  '/api/solana-signals',   // Solana scanner (same)
  '/api/meme-signals',     // Meme scanner (same)
  '/api/tradingview',      // Has TV_SECRET_TOKEN auth
  '/api/live-stream',      // SSE stream (auth checked internally or public dashboard)
  '/api/v2/command',       // Has own auth check internally
  '/api/dashboard',        // Dashboard data (read-only)
  '/api/telegram',         // Telegram connectivity check (read-only)
  '/api/bot',              // Bot status (read-only)
  '/api/metrics',          // Prometheus scrape — Bearer METRICS_TOKEN checked internally
  '/api/live-metrics',     // Grafana Cloud Prom proxy — read-only KPIs for /crypto-radar
  '/api/polymarket/ingest', // Goldsky webhook — x-trade-auth header checked internally
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

// Edge-safe base64url encode/decode (no Buffer in Edge Runtime)
function base64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function uint8ToBase64url(buf: Uint8Array): string {
  let binary = '';
  for (const b of buf) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function verifyJWT(token: string): Promise<boolean> {
  if (!AUTH_SECRET) return false; // No secret configured → reject all
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [header, body, sig] = parts;
    // HMAC-SHA256 via Web Crypto API (Edge Runtime compatible)
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`));
    const expected = uint8ToBase64url(new Uint8Array(signature));
    if (sig !== expected) return false;
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(body)));
    if (payload.exp && payload.exp < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

async function isAuthenticated(request: NextRequest): Promise<boolean> {
  // Cookie auth
  const authCookie = request.cookies.get('auth_token')?.value;
  if (authCookie && await verifyJWT(authCookie)) return true;

  // Bearer token auth
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    if (await verifyJWT(authHeader.slice(7))) return true;
  }

  return false;
}

// AUDIT FIX T5.3: Security headers applied to ALL responses
const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss://stream.binance.com wss://ws-subscriptions-clob.polymarket.com https://*.supabase.co https://api.binance.com https://min-api.cryptocompare.com https://api.mexc.com https://gamma-api.polymarket.com https://clob.polymarket.com; font-src 'self' data:;",
};

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Non-API routes: just add security headers
  if (!pathname.startsWith('/api/')) {
    return applySecurityHeaders(NextResponse.next());
  }

  // Skip public/self-authed routes
  if (isPublicRoute(pathname)) {
    return applySecurityHeaders(NextResponse.next());
  }

  // Require auth for everything else
  if (!(await isAuthenticated(request))) {
    return applySecurityHeaders(
      NextResponse.json(
        { error: 'Unauthorized', message: 'Valid auth token required' },
        { status: 401 }
      )
    );
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  // Match all routes for security headers, API routes also get auth
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|icons/).*)'],
};
