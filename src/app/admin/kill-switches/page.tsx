// Admin Kill-Switches Page — Read-only env flag display + gcloud command snippets.
// Actual env mutation must be done via gcloud (not in-app, to avoid auth + audit gaps).

export const dynamic = 'force-dynamic';

interface FlagSpec {
  name: string;
  current: string;
  description: string;
  toggleHint: string;
}

function readFlag(name: string, defaultVal = ''): string {
  return process.env[name] ?? defaultVal;
}

export default function AdminKillSwitchesPage() {
  const flags: FlagSpec[] = [
    {
      name: 'POLY_STRATEGY_MODE',
      current: readFlag('POLY_STRATEGY_MODE', 'momentum'),
      description: 'Polymarket entry logic. momentum=BUY trend; contrarian=BUY against trend; skip-all=halt entries.',
      toggleHint: 'Set to skip-all for emergency stop.',
    },
    {
      name: 'POLY_AUTO_TRADE_TOP_N',
      current: readFlag('POLY_AUTO_TRADE_TOP_N', '0'),
      description: 'Top-N candidates per scan that get auto-traded. 0 = disabled (phantom only).',
      toggleHint: 'Set to 0 to halt auto-trading without touching strategy logic.',
    },
    {
      name: 'POLY_FLAT_BET_USD',
      current: readFlag('POLY_FLAT_BET_USD', '0'),
      description: 'Flat bet size in USD. Bypasses Kelly when >0. Cap = MAX_BET_PCT × division balance.',
      toggleHint: 'Lower flat bet to reduce exposure during volatile period.',
    },
    {
      name: 'POLY_RISK_GATE_ENABLED',
      current: readFlag('POLY_RISK_GATE_ENABLED', '1'),
      description: 'riskManager check before openPosition. 0 = bypass (NOT recommended).',
      toggleHint: 'Keep at 1 always. Setting 0 = cowboy mode.',
    },
    {
      name: 'POLY_SHADOW_SYNDICATE_ENABLED',
      current: readFlag('POLY_SHADOW_SYNDICATE_ENABLED', '0'),
      description: 'Phase 5 shadow LLM eval. 0 = no calls. 1 = calls syndicate per scan opportunity.',
      toggleHint: 'Costs ~$0.005-0.020 per market call. POLY_SHADOW_DAILY_CALL_LIMIT caps daily total.',
    },
    {
      name: 'POLY_SHADOW_DAILY_CALL_LIMIT',
      current: readFlag('POLY_SHADOW_DAILY_CALL_LIMIT', '200'),
      description: 'Max syndicate LLM calls per day for shadow eval.',
      toggleHint: 'Lower to 50 for tight budget. Set to 0 to halt.',
    },
    {
      name: 'POLY_PAPER_FORWARD_FROZEN',
      current: readFlag('POLY_PAPER_FORWARD_FROZEN', '0'),
      description: 'Phase 5 daily-snapshot insert toggle. 1 = endpoint returns 200 but writes nothing.',
      toggleHint: 'Set to 1 if Supabase write quota issue.',
    },
    {
      name: 'POLY_DD_ALARM_THRESHOLD_PCT',
      current: readFlag('POLY_DD_ALARM_THRESHOLD_PCT', '30'),
      description: 'Drawdown alarm threshold for daily snapshot.',
      toggleHint: 'Default 30%. Lower to 20% for tighter monitoring.',
    },
    {
      name: 'POLY_SKIP_EXPIRED',
      current: readFlag('POLY_SKIP_EXPIRED', '1'),
      description: 'Filter expired markets in scanDivision. 1 = skip; 0 = keep (debug only).',
      toggleHint: 'Keep at 1.',
    },
  ];

  return (
    <main style={{ padding: '24px', color: 'var(--fg, #e2e8f0)', maxWidth: '1100px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Admin · Kill Switches</h1>
      <p style={{ marginTop: '4px', color: 'rgb(148 163 184)', fontSize: '13px', marginBottom: '20px' }}>
        Read-only display of POLY_* env flags. Mutations require gcloud (commands shown below).
      </p>

      <div style={{
        marginBottom: '24px', padding: '12px 16px',
        background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)',
        borderRadius: '6px', fontSize: '12px', color: 'rgb(252 211 77)',
      }}>
        Toggle pattern:{' '}
        <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '3px' }}>
          gcloud run services update trade-ai --region europe-west1 --update-env-vars KEY=VALUE
        </code>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {flags.map((f) => (
          <div
            key={f.name}
            style={{
              padding: '14px 16px',
              border: '1px solid rgba(148, 163, 184, 0.15)',
              borderRadius: '6px',
              background: 'rgba(15, 23, 42, 0.4)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <code style={{ fontSize: '14px', fontWeight: 700, color: 'rgb(96 165 250)' }}>
                {f.name}
              </code>
              <code style={{
                fontSize: '13px', padding: '2px 10px',
                background: 'rgba(0, 0, 0, 0.3)', borderRadius: '3px',
                color: 'rgb(74 222 128)', fontWeight: 600,
              }}>
                {f.current || '(unset)'}
              </code>
            </div>
            <p style={{ fontSize: '13px', color: 'rgb(203 213 225)', margin: '0 0 8px 0' }}>
              {f.description}
            </p>
            <p style={{ fontSize: '12px', color: 'rgb(148 163 184)', margin: 0, fontStyle: 'italic' }}>
              Hint: {f.toggleHint}
            </p>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: '24px', padding: '12px 16px',
        background: 'rgba(148, 163, 184, 0.05)', borderRadius: '6px',
        fontSize: '12px', color: 'rgb(148 163 184)',
      }}>
        Note: NEXT_PUBLIC_* env flags are baked at build time. Server-side flags (above) are read at runtime
        from Cloud Run service config. Restart not required for env updates — Cloud Run rolls a new revision.
      </div>
    </main>
  );
}
