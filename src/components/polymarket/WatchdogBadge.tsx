/**
 * WatchdogBadge — FAZA 3.13 Edge Watchdog compact badge for /polymarket/audit.
 *
 * Server component, zero-JS. Renders a single strip with:
 *   - Verdict pill (UNKNOWN/HEALTHY/DEGRADED/UNHEALTHY) color-coded.
 *   - Mode tag ([SHADOW] vs [ENFORCE]).
 *   - Inline reasons (short) + shadow-block counter if enforce=off.
 *
 * Mounts alongside BrainScorecard. Soft-fails on error.
 */
import { getEdgeWatchdogState, EdgeVerdict } from '@/lib/polymarket/edgeWatchdog';

const C = {
  text: '#f3f0e8',
  muted: '#6a5f52',
  mutedLight: '#a89a8a',
  green: '#4ade80',
  red: '#ef4444',
  orange: '#fb923c',
  blue: '#DAA520',
  border: 'rgba(218,165,32,0.15)',
};

function verdictColor(v: EdgeVerdict): string {
  switch (v) {
    case 'HEALTHY':   return C.green;
    case 'DEGRADED':  return C.orange;
    case 'UNHEALTHY': return C.red;
    default:          return C.mutedLight;
  }
}

function verdictBg(v: EdgeVerdict): string {
  return `${verdictColor(v)}11`;
}

export async function WatchdogBadge() {
  let st;
  try {
    st = await getEdgeWatchdogState();
  } catch (err) {
    return (
      <div style={{
        padding: '8px 12px',
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        color: C.muted,
        fontSize: 11,
        fontFamily: 'monospace',
        marginBottom: 16,
      }}>
        EDGE WATCHDOG — unavailable ({err instanceof Error ? err.message : 'error'})
      </div>
    );
  }

  if (!st.enabled) {
    return (
      <div style={{
        padding: '8px 12px',
        border: `1px solid ${C.orange}`,
        borderRadius: 6,
        color: C.orange,
        fontSize: 11,
        fontFamily: 'monospace',
        background: `${C.orange}11`,
        marginBottom: 16,
      }}>
        EDGE WATCHDOG · DISABLED (EDGE_WATCHDOG_ENABLED=0)
      </div>
    );
  }

  const vColor = verdictColor(st.verdict);
  const vBg = verdictBg(st.verdict);
  const modeTag = st.enforce ? 'ENFORCE' : 'SHADOW';
  const modeColor = st.enforce ? C.red : C.mutedLight;
  const pf = st.stats?.profitFactor;
  const wr = st.stats?.winRate;
  const nD = st.stats?.nDecisive ?? 0;

  return (
    <div style={{
      padding: '10px 14px',
      border: `1px solid ${vColor}`,
      borderRadius: 6,
      background: vBg,
      fontFamily: 'monospace',
      fontSize: 12,
      color: C.text,
      marginBottom: 16,
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      flexWrap: 'wrap',
    }}>
      <span style={{
        fontWeight: 800,
        fontSize: 10,
        letterSpacing: '0.2em',
        color: vColor,
      }}>
        EDGE WATCHDOG
      </span>
      <span style={{
        padding: '3px 10px',
        borderRadius: 4,
        background: vColor,
        color: '#0a0a0a',
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: '0.15em',
      }}>
        {st.verdict}
      </span>
      <span style={{
        padding: '2px 8px',
        borderRadius: 4,
        border: `1px solid ${modeColor}`,
        color: modeColor,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.15em',
      }}>
        {modeTag}
      </span>

      <span style={{ color: C.mutedLight, fontSize: 11 }}>
        PF {pf == null ? '—' : pf.toFixed(2)} ·
        WR {wr == null ? '—' : `${(wr * 100).toFixed(1)}%`} ·
        n={nD}/{st.thresholds.nMin}
      </span>

      {st.windowDays != null && (
        <span style={{ color: C.muted, fontSize: 10 }}>
          window={st.windowDays}d
        </span>
      )}

      {!st.enforce && st.shadowBlockCount > 0 && (
        <span style={{
          marginLeft: 'auto',
          color: C.orange,
          fontSize: 10,
          fontWeight: 700,
        }}>
          SHADOW BLOCKS · {st.shadowBlockCount}
        </span>
      )}

      {st.reasons.length > 0 && (
        <span style={{
          flexBasis: '100%',
          color: C.muted,
          fontSize: 10,
          marginTop: 2,
        }}>
          {st.reasons.join(' · ')}
        </span>
      )}
    </div>
  );
}
