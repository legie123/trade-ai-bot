/**
 * /polymarket/audit/graveyard — Gladiators Graveyard browser.
 *
 * Closes blueprint §5 #3 gap "Graveyard browser UI". Surfaces the
 * forensic record written by TheButcher (Batch 5/9) so operators can
 * audit kill reasons and population stats without raw Supabase access.
 *
 * Data source: graveyard.ts (gladiators_graveyard table). Server-side
 * direct calls — same fail-soft contract as the diag endpoint:
 *   - mode=off                       → empty entries, banner "shadow OFF"
 *   - SUPABASE not configured        → empty entries, banner "supabase-unconfigured"
 *   - table missing (PGRST205/42P01) → empty entries, banner "table-missing"
 *   - mode=shadow + 0 kills          → empty entries, banner "no kills yet"
 *
 * Layer: L4 AUDIT · grain=per-gladiator-kill.
 *
 * NOTE: domain is arena/gladiators (NOT polymarket markets), but URL sits
 * under /polymarket/audit because that's the institutional audit center
 * shared by both arena and polymarket — matches existing convention
 * (brain-history, flags, llm-cost all inhabit this prefix).
 */
import Link from 'next/link';
import {
  getGraveyardConfig,
  getGraveyardEntries,
  getPopulationStats,
  type GraveyardEntry,
  type PopulationStats,
} from '@/lib/v2/gladiators/graveyard';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { ExplainCard } from '@/components/explain/ExplainCard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const C = {
  text: '#f3f0e8',
  muted: '#6a5f52',
  mutedLight: '#a89a8a',
  blue: '#DAA520',
  green: '#4ade80',
  red: '#ef4444',
  orange: '#fb923c',
  border: 'rgba(218,165,32,0.15)',
  headerBg: 'rgba(218,165,32,0.05)',
};

const ALLOWED_LIMITS = [25, 50, 100, 250, 500, 1000] as const;

function clampLimit(raw: string | undefined): number {
  if (!raw) return 100;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 100;
  return ALLOWED_LIMITS.includes(n as (typeof ALLOWED_LIMITS)[number]) ? n : 100;
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function fmtNum(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return '—';
  return x.toFixed(digits);
}

function fmtAge(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const ageSec = Math.max(0, (Date.now() - t) / 1000);
  if (ageSec < 60) return `${ageSec.toFixed(0)}s ago`;
  if (ageSec < 3600) return `${(ageSec / 60).toFixed(0)}m ago`;
  if (ageSec < 86400) return `${(ageSec / 3600).toFixed(1)}h ago`;
  return `${(ageSec / 86400).toFixed(1)}d ago`;
}

interface LoadResult {
  ok: true;
  config: ReturnType<typeof getGraveyardConfig>;
  popStats: PopulationStats;
  entries: GraveyardEntry[];
  status:
    | 'enabled'
    | 'shadow-off'
    | 'supabase-unconfigured'
    | 'table-missing-or-empty'
    | 'no-kills-yet';
  computeMs: number;
}

async function loadGraveyard(limit: number, reasonFilter: string): Promise<LoadResult> {
  const t0 = Date.now();
  const config = getGraveyardConfig();
  // Always read alive from in-memory gladiatorStore — fast, no DB.
  const alive = gladiatorStore.getGladiators();

  // Even when mode=off we still call popStats: it reads graveyard but
  // returns degraded stats with selectionLift=0 (alive-only baseline).
  // That keeps the banner messaging accurate.
  if (!config.configured) {
    return {
      ok: true,
      config,
      popStats: {
        alive: alive.length,
        killed: 0,
        total: alive.length,
        zombieCount: 0,
        popWeightedWinRate: 0,
        popWeightedProfitFactor: 0,
        aliveAvgWinRate: 0,
        killedAvgWinRate: 0,
        selectionLiftPct: 0,
        sampleTrades: { alive: 0, killed: 0 },
      },
      entries: [],
      status: 'supabase-unconfigured',
      computeMs: Date.now() - t0,
    };
  }

  const [popStats, entriesRaw] = await Promise.all([
    getPopulationStats(alive),
    getGraveyardEntries(limit),
  ]);

  let entries = entriesRaw;
  if (reasonFilter) {
    const f = reasonFilter.toLowerCase();
    entries = entriesRaw.filter((e) => (e.kill_reason || '').toLowerCase().includes(f));
  }

  let status: LoadResult['status'];
  if (config.mode === 'off') status = 'shadow-off';
  else if (popStats.killed === 0 && entriesRaw.length === 0) status = 'table-missing-or-empty';
  else if (popStats.killed === 0) status = 'no-kills-yet';
  else status = 'enabled';

  return {
    ok: true,
    config,
    popStats,
    entries,
    status,
    computeMs: Date.now() - t0,
  };
}

const STATUS_COPY: Record<LoadResult['status'], { color: string; text: string }> = {
  enabled: { color: C.green, text: 'enabled' },
  'shadow-off': { color: C.mutedLight, text: 'mode=off' },
  'supabase-unconfigured': { color: C.mutedLight, text: 'supabase-unconfigured' },
  'table-missing-or-empty': { color: C.orange, text: 'table-missing-or-empty' },
  'no-kills-yet': { color: C.mutedLight, text: 'no-kills-yet' },
};

export default async function GraveyardPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const limit = clampLimit(sp.limit);
  const reasonFilter = (sp.reason || '').trim().slice(0, 64);

  const data = await loadGraveyard(limit, reasonFilter);

  const liftColor =
    data.popStats.selectionLiftPct >= 10
      ? C.red
      : data.popStats.selectionLiftPct >= 5
      ? C.orange
      : data.popStats.killed === 0
      ? C.mutedLight
      : C.green;

  const zombieColor = data.popStats.zombieCount > 0 ? C.red : C.green;
  const statusBadge = STATUS_COPY[data.status];

  return (
    <div>
      <h1
        style={{
          fontSize: 20,
          letterSpacing: '0.1em',
          fontWeight: 800,
          marginBottom: 8,
          color: C.text,
        }}
      >
        GLADIATORS GRAVEYARD
      </h1>
      <p
        style={{
          color: C.muted,
          fontSize: 11,
          fontFamily: 'monospace',
          marginBottom: 24,
        }}
      >
        Forensic record of every gladiator killed by TheButcher. Append-only, mode={data.config.mode}. Population
        stats are computed over alive ∪ killed — selection lift exposes survivorship bias (Batch 5/9).
      </p>

      {/* KPI strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 12,
          marginBottom: 28,
        }}
      >
        <ExplainCard
          label="ALIVE"
          value={String(data.popStats.alive)}
          layer="L4"
          source={{ label: 'gladiatorStore', query: 'in-memory' }}
          rationale="Currently active gladiators (non-omega) in the arena pool. Compare with KILLED to gauge churn."
        />
        <ExplainCard
          label="KILLED"
          value={String(data.popStats.killed)}
          layer="L4"
          source={{ label: 'supabase', query: 'gladiators_graveyard' }}
          rationale="Total entries in graveyard. Append-only, capped at 5000 for stats. If 0 → mode=off, migration not applied, or Butcher hasn't run yet."
        />
        <ExplainCard
          label="ZOMBIES"
          value={String(data.popStats.zombieCount)}
          color={zombieColor}
          layer="L4"
          source={{ label: 'intersect', query: 'alive ∩ graveyard.gladiator_id' }}
          rationale="Steady-state expected = 0. Non-zero means a kill purged graveyard but not the alive store (or vice-versa). >15 sustained = persistence race — see project_zombie_purge_fix memory."
        />
        <ExplainCard
          label="POP WEIGHTED WR"
          value={fmtPct(data.popStats.popWeightedWinRate)}
          layer="L4"
          source={{ label: 'compute', query: 'Σ(WR×trades)/Σ(trades)' }}
          rationale="Trade-weighted win rate over ALIVE ∪ KILLED. Truth-telling baseline — Kelly should derive from THIS, not alive-only."
        />
        <ExplainCard
          label="SELECTION LIFT"
          value={`${fmtNum(data.popStats.selectionLiftPct)}pp`}
          color={liftColor}
          layer="L4"
          source={{ label: 'compute', query: 'aliveAvgWR − popWeighted×100' }}
          rationale="Magnitude of survivorship bias. >10pp = Kelly is over-sizing. >5pp = warning. ~0 = honest selection. Negative = anti-selection (rare)."
        />
      </div>

      {/* Filter bar */}
      <form
        method="GET"
        action="/polymarket/audit/graveyard"
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 20,
          padding: 12,
          border: `1px solid ${C.border}`,
          background: C.headerBg,
          fontFamily: 'monospace',
          fontSize: 11,
        }}
      >
        <span style={{ color: C.muted, letterSpacing: '0.15em' }}>FILTER</span>

        <label style={{ color: C.mutedLight }}>
          reason contains:{' '}
          <input
            type="text"
            name="reason"
            defaultValue={reasonFilter}
            placeholder="(any)"
            maxLength={64}
            style={{
              background: '#1a1a1a',
              color: C.text,
              border: `1px solid ${C.border}`,
              padding: '4px 8px',
              fontFamily: 'monospace',
              fontSize: 11,
              width: 180,
            }}
          />
        </label>

        <label style={{ color: C.mutedLight }}>
          limit:{' '}
          <select
            name="limit"
            defaultValue={String(limit)}
            style={{
              background: '#1a1a1a',
              color: C.text,
              border: `1px solid ${C.border}`,
              padding: '4px 8px',
              fontFamily: 'monospace',
              fontSize: 11,
            }}
          >
            {ALLOWED_LIMITS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          style={{
            background: C.blue,
            color: '#0a0a0a',
            border: 'none',
            padding: '4px 12px',
            fontWeight: 700,
            fontSize: 11,
            cursor: 'pointer',
            letterSpacing: '0.1em',
          }}
        >
          APPLY
        </button>

        <div style={{ flex: 1 }} />

        <span style={{ color: C.muted }}>
          status:{' '}
          <span style={{ color: statusBadge.color, fontWeight: 700 }}>{statusBadge.text}</span>
        </span>
        <span style={{ color: C.muted }}>compute={data.computeMs}ms</span>
      </form>

      {/* Empty states */}
      {data.status === 'shadow-off' && (
        <div
          style={{
            border: `1px dashed ${C.border}`,
            padding: 24,
            background: C.headerBg,
            color: C.mutedLight,
            fontSize: 12,
            fontFamily: 'monospace',
            marginBottom: 24,
          }}
        >
          <div
            style={{
              color: C.blue,
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: '0.15em',
              marginBottom: 8,
            }}
          >
            BUTCHER GRAVEYARD MODE = OFF
          </div>
          <div>
            Set <code style={{ color: C.blue }}>BUTCHER_GRAVEYARD_ENABLED=shadow</code> in Cloud Run env to
            start recording kills. Reader stays 200-OK with empty rows until a kill happens.
          </div>
        </div>
      )}

      {data.status === 'supabase-unconfigured' && (
        <div
          style={{
            border: `1px dashed ${C.border}`,
            padding: 24,
            background: C.headerBg,
            color: C.mutedLight,
            fontSize: 12,
            fontFamily: 'monospace',
            marginBottom: 24,
          }}
        >
          <div
            style={{
              color: C.blue,
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: '0.15em',
              marginBottom: 8,
            }}
          >
            SUPABASE NOT CONFIGURED
          </div>
          <div>
            <code style={{ color: C.blue }}>NEXT_PUBLIC_SUPABASE_URL</code> +{' '}
            <code style={{ color: C.blue }}>SUPABASE_SERVICE_ROLE_KEY</code> required.
          </div>
        </div>
      )}

      {data.status === 'table-missing-or-empty' && (
        <div
          style={{
            border: `1px dashed ${C.border}`,
            padding: 24,
            background: C.headerBg,
            color: C.mutedLight,
            fontSize: 12,
            fontFamily: 'monospace',
            marginBottom: 24,
          }}
        >
          <div
            style={{
              color: C.blue,
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: '0.15em',
              marginBottom: 8,
            }}
          >
            TABLE MISSING OR EMPTY
          </div>
          <div>
            Apply{' '}
            <code style={{ color: C.blue }}>
              supabase/migrations/20260419_gladiators_graveyard.sql
            </code>{' '}
            on Supabase. Reader stays 200-OK with empty rows until the migration lands and TheButcher records
            its first kill.
          </div>
        </div>
      )}

      {data.status === 'no-kills-yet' && (
        <div
          style={{
            border: `1px dashed ${C.border}`,
            padding: 24,
            background: C.headerBg,
            color: C.mutedLight,
            fontSize: 12,
            fontFamily: 'monospace',
            marginBottom: 24,
          }}
        >
          <div
            style={{
              color: C.blue,
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: '0.15em',
              marginBottom: 8,
            }}
          >
            NO KILLS YET
          </div>
          <div>
            Graveyard is wired and writable but TheButcher hasn't culled anyone. Either pool is healthy or
            Butcher hasn't run since cold-boot.
          </div>
        </div>
      )}

      {/* Entries table */}
      {data.entries.length > 0 && (
        <div
          style={{
            border: `1px solid ${C.border}`,
            background: '#0a0a0a',
            overflowX: 'auto',
            marginBottom: 24,
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: 'monospace',
              fontSize: 11,
              color: C.text,
            }}
          >
            <thead>
              <tr style={{ background: C.headerBg, color: C.muted, letterSpacing: '0.1em' }}>
                <th style={{ padding: 8, textAlign: 'left' }}>NAME</th>
                <th style={{ padding: 8, textAlign: 'left' }}>ARENA</th>
                <th style={{ padding: 8, textAlign: 'right' }}>RANK</th>
                <th style={{ padding: 8, textAlign: 'left' }}>KILL REASON</th>
                <th style={{ padding: 8, textAlign: 'right' }}>KILLED</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: 8 }}>
                    <span style={{ color: C.text }}>{e.name}</span>{' '}
                    <span style={{ color: C.muted, fontSize: 10 }}>{e.gladiator_id}</span>
                  </td>
                  <td style={{ padding: 8, color: C.mutedLight }}>{e.arena ?? '—'}</td>
                  <td style={{ padding: 8, textAlign: 'right', color: C.mutedLight }}>
                    {e.rank ?? '—'}
                  </td>
                  <td style={{ padding: 8, color: C.orange, maxWidth: 480, wordBreak: 'break-word' }}>
                    {e.kill_reason}
                  </td>
                  <td style={{ padding: 8, textAlign: 'right', color: C.muted }} title={e.killed_at}>
                    {fmtAge(e.killed_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.entries.length === 0 && data.status !== 'shadow-off' && data.status !== 'supabase-unconfigured' &&
        data.status !== 'table-missing-or-empty' && data.status !== 'no-kills-yet' && (
          <div
            style={{
              border: `1px dashed ${C.border}`,
              padding: 16,
              color: C.mutedLight,
              fontFamily: 'monospace',
              fontSize: 11,
              marginBottom: 24,
            }}
          >
            No entries match the filter <code style={{ color: C.blue }}>{reasonFilter || '(none)'}</code>{' '}
            within the latest {limit} kills.
          </div>
        )}

      <p
        style={{
          color: C.muted,
          fontSize: 10,
          fontFamily: 'monospace',
          marginTop: 16,
        }}
      >
        Source: <code>gladiators_graveyard</code> (Batch 5/9 writer in TheButcher.executeWeaklings). Reader uses
        getGraveyardEntries — fail-soft on missing table or unconfigured Supabase. Population stats merge alive
        (gladiatorStore in-memory) with killed (Supabase, 5000-row cap).{' '}
        <Link href="/api/v2/diag/graveyard" style={{ color: C.blue }}>
          Raw diag endpoint
        </Link>
        .
      </p>
    </div>
  );
}
