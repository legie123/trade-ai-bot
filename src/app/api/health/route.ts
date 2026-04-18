/**
 * GET /api/health
 * Top-level health endpoint — thin wrapper over /api/v2/health handler.
 * Exists because Cloud Scheduler and external monitors may ping this URL.
 *
 * FIX 2026-04-18 (v2): Self-fetch HTTP pe Cloud Run e nefiabil (container → propriul URL public
 * loop-back eșuează intermitent cu "fetch failed", indiferent de headere). În loc de self-fetch,
 * importăm direct handler-ul v2/health și îl invocăm in-process. Zero round-trip, zero HTTP.
 */

import { GET as v2HealthGET } from '../v2/health/route';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Invoca direct handler-ul v2/health în proces — nu self-fetch.
  return v2HealthGET();
}
// Build trigger: 1776474131
