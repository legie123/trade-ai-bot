// ============================================================
// Auth Middleware — Simple JWT-based dashboard protection
// ============================================================
import { NextResponse } from 'next/server';
import crypto from 'crypto';

const AUTH_SECRET = process.env.AUTH_SECRET || 'trading-ai-secret-2026';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin123';

// Simple JWT-like token (HMAC SHA256)
function createToken(payload: Record<string, unknown>): string {
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
