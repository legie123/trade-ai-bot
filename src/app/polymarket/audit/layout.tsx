/**
 * /polymarket/audit — institutional audit layout (server component).
 *
 * FAZA 3.5 non-destructive UI namespace. Separate from main command
 * center so operators can drill into scan history + goldsky state
 * without touching the live dashboard.
 *
 * Auth: cookie-based (auth_token). Unauthenticated viewers see a
 * minimal unauthorized page — no scan data leaks.
 */
import { cookies } from 'next/headers';
import Link from 'next/link';
import { verifyToken } from '@/lib/auth';
import { FeedHeartbeatStrip } from '@/components/polymarket/FeedHeartbeatStrip';
import { BrainStatusPill } from '@/components/polymarket/BrainStatusPill';

export const dynamic = 'force-dynamic';

async function isAuthed(): Promise<boolean> {
  const c = await cookies();
  const tok = c.get('auth_token')?.value;
  if (!tok) return false;
  return verifyToken(tok) != null;
}

const C = {
  bg: '#0a0a0a',
  text: '#f3f0e8',
  muted: '#6a5f52',
  blue: '#DAA520',
  border: 'rgba(218,165,32,0.15)',
};

export default async function AuditLayout({ children }: { children: React.ReactNode }) {
  const authed = await isAuthed();
  if (!authed) {
    return (
      <div style={{ background: C.bg, color: C.text, minHeight: '100vh', padding: 40, fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 16, letterSpacing: '0.2em', color: C.muted }}>POLYMARKET / AUDIT</h1>
        <p style={{ marginTop: 16, color: C.muted }}>401 — restricted. Sign in at <Link href="/login" style={{ color: C.blue }}>/login</Link>.</p>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: 'system-ui' }}>
      <nav style={{ borderBottom: `1px solid ${C.border}`, padding: '16px 24px', display: 'flex', gap: 24, alignItems: 'center' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.25em', color: C.muted, fontWeight: 700 }}>POLYMARKET · AUDIT</div>
        <Link href="/polymarket/audit" style={{ color: C.text, fontSize: 12, textDecoration: 'none', fontWeight: 600 }}>Scans</Link>
        <Link href="/polymarket/audit/goldsky" style={{ color: C.text, fontSize: 12, textDecoration: 'none', fontWeight: 600 }}>Goldsky</Link>
        <Link href="/polymarket/audit/learning" style={{ color: C.text, fontSize: 12, textDecoration: 'none', fontWeight: 600 }}>Learning</Link>
        <Link href="/polymarket/audit/llm-cost" style={{ color: C.text, fontSize: 12, textDecoration: 'none', fontWeight: 600 }}>LLM $</Link>
        <Link href="/polymarket/audit/flags" style={{ color: C.text, fontSize: 12, textDecoration: 'none', fontWeight: 600 }}>Flags</Link>
        <div style={{ flex: 1 }} />
        <BrainStatusPill />
        <FeedHeartbeatStrip />
        <Link href="/polymarket" style={{ color: C.muted, fontSize: 11, textDecoration: 'none', marginLeft: 16 }}>← back to command</Link>
      </nav>
      <main style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>{children}</main>
    </div>
  );
}
