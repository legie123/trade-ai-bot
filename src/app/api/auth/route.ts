// ============================================================
// Auth API — Login / Logout / Status
// POST /api/auth — login with password
// GET /api/auth — check auth status
// DELETE /api/auth — logout
// ============================================================
import { NextResponse } from 'next/server';
import { createToken, verifyToken, DASHBOARD_PASSWORD, isAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password } = body;

    if (password !== DASHBOARD_PASSWORD) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    const token = createToken({ user: 'admin', role: 'admin' });

    const response = NextResponse.json({
      status: 'authenticated',
      token,
      expiresIn: '24h',
    });

    // Set cookie
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 86400, // 24h
      path: '/',
    });

    return response;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const authed = isAuthenticated(request);
  return NextResponse.json({
    authenticated: authed,
    message: authed ? 'Logged in' : 'Not authenticated',
  });
}

export async function DELETE() {
  const response = NextResponse.json({ status: 'logged out' });
  response.cookies.set('auth_token', '', { maxAge: 0, path: '/' });
  return response;
}
