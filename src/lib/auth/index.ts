// ============================================================
// Auth Middleware — Simple JWT-based dashboard protection
// ============================================================
import crypto from 'crypto';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('Auth');

// AUDIT FIX: No fallback defaults — fail-closed if env vars missing
const AUTH_SECRET = process.env.AUTH_SECRET || '';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';

// ─── ADDITIVE SAFETY: refuse weak defaults in non-dev environments ───
// Logs loudly at module init. Does not crash dev. In production, throws on first use.
const IS_PROD = (process.env.NODE_ENV || '').toLowerCase() === 'production';
// OWNER EXCEPTION 2026-04-19: explicit allowlist for short passwords per user directive.
// All other values still require length >= 12. Keeps global guard strong.
const OWNER_ALLOWED_SHORT: ReadonlySet<string> = new Set(['dss33']);
const WEAK_PASSWORD =
  !DASHBOARD_PASSWORD ||
  DASHBOARD_PASSWORD === 'admin123' ||
  (!OWNER_ALLOWED_SHORT.has(DASHBOARD_PASSWORD) && DASHBOARD_PASSWORD.length < 12);
const WEAK_SECRET = !AUTH_SECRET || AUTH_SECRET === 'trading-ai-secret-2026' || AUTH_SECRET.length < 24;

if (WEAK_PASSWORD) {
  log.warn(
    'DASHBOARD_PASSWORD is weak or default. Set a strong value (>= 12 chars, no "admin123").' +
      (IS_PROD ? ' Production refuses auth with weak password.' : ' Development mode tolerates it.')
  );
}
if (WEAK_SECRET) {
  log.warn('AUTH_SECRET is weak or default. Set a strong random value (>= 24 chars).');
}

function assertStrongCredentials(): void {
  if (IS_PROD && WEAK_PASSWORD) {
    throw new Error(
      '[AUTH] Refusing to operate in production with weak/default DASHBOARD_PASSWORD. Set DASHBOARD_PASSWORD env var.'
    );
  }
  if (IS_PROD && WEAK_SECRET) {
    throw new Error(
      '[AUTH] Refusing to operate in production with weak/default AUTH_SECRET. Set AUTH_SECRET env var (>= 24 chars).'
    );
  }
}

// Simple JWT-like token (HMAC SHA256)
function createToken(payload: Record<string, unknown>): string {
  assertStrongCredentials();
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function isAuthenticated(request: Request): boolean {
  // In production with weak creds, refuse silently. Login route will still fail via createToken.
  if (IS_PROD && (WEAK_PASSWORD || WEAK_SECRET)) return false;
  // Check cookie
  const cookies = request.headers.get('cookie') || '';
  const tokenMatch = cookies.match(/auth_token=([^;]+)/);
  if (tokenMatch) {
    const payload = verifyToken(tokenMatch[1]);
    if (payload) return true;
  }
  // Check header
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const payload = verifyToken(authHeader.slice(7));
    if (payload) return true;
  }
  return false;
}

// POST /api/auth — login
// GET /api/auth — check status
export { createToken, verifyToken, DASHBOARD_PASSWORD };
