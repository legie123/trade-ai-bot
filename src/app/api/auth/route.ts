// ============================================================
// Auth API — Login / Logout / Status
// POST /api/auth — login with password
// GET /api/auth — check auth status
// DELETE /api/auth — logout
// ============================================================
import { NextResponse } from 'next/server';
import { createToken, DASHBOARD_PASSWORD, isAuthenticated } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password } = body;

    if (password !== DASHBOARD_PASSWORD) {
      return errorResponse('INVALID_PASSWORD', 'Invalid password', 401);
    }

    const token = createToken({ user: 'admin', role: 'admin' });

    const response = successResponse({
      status: 'authenticated',
      token,
      expiresIn: '24h',
    });

    // Set cookie
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'development',
      sameSite: 'lax',
      maxAge: 86400, // 24h
      path: '/',
    });

    return response;
  } catch (err) {
    return errorResponse('AUTH_ERROR', (err as Error).message, 500);
  }
}

export async function GET(request: Request) {
  const authed = isAuthenticated(request);
  return successResponse({
    authenticated: authed,
    message: authed ? 'Logged in' : 'Not authenticated',
  });
}

export async function DELETE() {
  const response = successResponse({ status: 'logged out' });
  response.cookies.set('auth_token', '', { maxAge: 0, path: '/' });
  return response;
}
