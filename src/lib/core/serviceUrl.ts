// ============================================================
// Service URL resolver — works on Cloud Run, Vercel, and local dev
// Eliminates localhost:3000 fallbacks that break in production
// ============================================================

/**
 * Returns the base URL of this service.
 * Priority: SERVICE_URL > NEXT_PUBLIC_APP_URL > APP_URL > request headers > localhost fallback
 * On Cloud Run, set SERVICE_URL to the service URL (e.g., https://antigravity-trade-XXX.run.app)
 */
export function getServiceUrl(requestHeaders?: Headers): string {
  // Explicit env vars (most reliable)
  if (process.env.SERVICE_URL) return process.env.SERVICE_URL.replace(/\/$/, '');
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');

  // Derive from request headers (works on Cloud Run without env config)
  if (requestHeaders) {
    const host = requestHeaders.get('host') || requestHeaders.get('x-forwarded-host');
    if (host && !host.includes('localhost')) {
      const proto = requestHeaders.get('x-forwarded-proto') || 'https';
      return `${proto}://${host}`;
    }
  }

  // Last resort — only valid in local dev
  return 'http://localhost:3000';
}
