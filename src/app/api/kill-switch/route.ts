// ============================================================
// POST /api/kill-switch — Emergency halt endpoint
// Called by Cockpit PANIC button. Delegates to killSwitch module.
// GET returns current state.
// ============================================================
import { NextResponse } from 'next/server';
import { engageKillSwitch, disengageKillSwitch, getKillSwitchState } from '@/lib/core/killSwitch';
import { isAuthenticated } from '@/lib/auth';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('KillSwitchRoute');
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ status: 'ok', killSwitch: getKillSwitchState() });
}

export async function POST(request: Request) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = body?.action ?? 'engage';

    if (action === 'disengage') {
      disengageKillSwitch();
      log.info('Kill switch DISENGAGED via /api/kill-switch');
      return NextResponse.json({ status: 'ok', engaged: false, message: 'Kill switch disengaged' });
    }

    engageKillSwitch('Manual PANIC via Cockpit UI', true);
    log.warn('Kill switch ENGAGED via /api/kill-switch (PANIC)');
    return NextResponse.json({ status: 'ok', engaged: true, message: 'Kill switch engaged — all trading halted' });
  } catch (err) {
    log.error('Kill switch route error', { error: String(err) });
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
