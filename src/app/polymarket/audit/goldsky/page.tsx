/**
 * /polymarket/audit/goldsky — Goldsky pipeline health (server component).
 *
 * FAZA 3.5. Shows webhook ingest stats (events per pipeline, last event age,
 * lag) plus subgraph client status. One-screen truth of upstream data flow.
 */
import { getEventsHealth } from '@/lib/polymarket/eventsStore';
import { getGoldskyStatus } from '@/lib/polymarket/goldskyClient';
import { ExplainCard } from '@/components/explain/ExplainCard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface HealthData {
  ok: boolean;
  configured: boolean;
  writeEnabled: boolean;
  lastEventAt: string | null;
  lagSeconds: number | null;
  eventsLast5min: number;
  eventsLast1h: number;
  eventsLast24h: number;
  perPipeline: Array<{ pipeline: string; eventsLast1h: number; lastEventAt: string | null }>;
}

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

function fmtLag(s: number | null): string {
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function lagColor(s: number | null): string {
  if (s == null) return C.muted;
  if (s < 300) return C.green;
  if (s < 1800) return C.orange;
  return C.red;
}

export default async function GoldskyHealthPage() {
  const health = (await getEventsHealth()) as HealthData;
  const subgraph = getGoldskyStatus();

  const ingestHealthy = health.configured && health.writeEnabled && health.eventsLast1h > 0;

  return (
    <div>
      <h1 style={{ fontSize: 20, letterSpacing: '0.1em', fontWeight: 800, marginBottom: 24, color: C.text }}>
        GOLDSKY · UPSTREAM
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 28 }}>
        <ExplainCard
          label="INGEST"
          value={ingestHealthy ? 'HEALTHY' : 'DEGRADED'}
          color={ingestHealthy ? C.green : C.orange}
          layer="L1"
          source={{ label: 'goldsky', query: 'polymarket_events pipeline' }}
          rationale={ingestHealthy
            ? 'Webhook writing + events flowing in last 60min.'
            : 'Degraded: check supabase config, write-through flag, or webhook secret mismatch.'}
          timestamp={health.lastEventAt ? new Date(health.lastEventAt).getTime() : null}
          staleMs={1800_000}
          freshMs={300_000}
        />
        <ExplainCard
          label="LAG"
          value={fmtLag(health.lagSeconds)}
          color={lagColor(health.lagSeconds)}
          layer="L1"
          source={{ label: 'derived', query: 'now - max(events.ingested_at)' }}
          rationale="Time since last event. <5min=healthy · 5-30min=aging · >30min=stale."
        />
        <ExplainCard
          label="5 MIN"
          value={String(health.eventsLast5min)}
          layer="L1"
          source={{ label: 'supabase', query: "count(*) where ingested_at > now()-'5m'" }}
          rationale="Short-window throughput. Zero = dead feed."
        />
        <ExplainCard
          label="1 HOUR"
          value={String(health.eventsLast1h)}
          layer="L1"
          source={{ label: 'supabase', query: "count(*) where ingested_at > now()-'1h'" }}
          rationale="Sustained throughput. Benchmark ≥ daily-avg/24."
        />
        <ExplainCard
          label="24 HOURS"
          value={String(health.eventsLast24h)}
          layer="L1"
          source={{ label: 'supabase', query: "count(*) where ingested_at > now()-'24h'" }}
          rationale="Daily volume. Sudden drop = pipeline regression."
        />
      </div>

      <Section title="CONFIGURATION">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <ConfigCell k="Supabase configured" v={health.configured ? 'yes' : 'no'} good={health.configured} />
          <ConfigCell k="Write-through enabled" v={health.writeEnabled ? 'yes' : 'log-only'} good={health.writeEnabled} />
          <ConfigCell k="Subgraph configured" v={subgraph.configured ? 'yes' : 'no'} good={subgraph.configured} />
          <ConfigCell k="Subgraph enabled" v={subgraph.enabled ? 'yes' : 'no'} good={subgraph.enabled} />
          <ConfigCell k="Subgraph cache entries" v={String(subgraph.cacheSize ?? 0)} />
          <ConfigCell k="Last event" v={health.lastEventAt ?? '—'} />
        </div>
      </Section>

      <Section title={`PIPELINES · ${health.perPipeline.length}`}>
        {health.perPipeline.length === 0 ? (
          <div style={{ padding: 24, color: C.muted, fontSize: 12, textAlign: 'center', border: `1px dashed ${C.border}`, borderRadius: 8 }}>
            No pipelines have delivered events yet. Goldsky may be unconfigured, or webhook secret mismatch.
          </div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
              <thead style={{ background: C.headerBg }}>
                <tr>
                  <Th>PIPELINE</Th>
                  <Th align="right">EVENTS 1H</Th>
                  <Th>LAST EVENT</Th>
                </tr>
              </thead>
              <tbody>
                {health.perPipeline.map((p) => (
                  <tr key={p.pipeline} style={{ borderTop: `1px solid ${C.border}` }}>
                    <Td>{p.pipeline}</Td>
                    <Td align="right" style={{ color: p.eventsLast1h > 0 ? C.green : C.muted }}>{p.eventsLast1h}</Td>
                    <Td style={{ color: C.mutedLight }}>{p.lastEventAt ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <p style={{ marginTop: 16, fontSize: 10, color: C.muted, fontFamily: 'monospace', textAlign: 'right' }}>
        polymarket_events · eventsStore · {new Date().toISOString()}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 11, letterSpacing: '0.2em', color: C.mutedLight, fontWeight: 700, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}


function ConfigCell({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <div style={{ padding: 12, border: `1px solid ${C.border}`, borderRadius: 6, background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ fontSize: 10, color: C.mutedLight, letterSpacing: '0.1em', marginBottom: 4 }}>{k}</div>
      <div style={{
        fontSize: 12,
        fontFamily: 'monospace',
        color: good === undefined ? C.text : good ? C.green : C.orange,
        wordBreak: 'break-all',
      }}>
        {v}
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align,
      padding: '10px 12px',
      fontSize: 9,
      letterSpacing: '0.15em',
      color: C.mutedLight,
      fontWeight: 700,
      borderBottom: `1px solid ${C.border}`,
    }}>
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  style,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  style?: React.CSSProperties;
}) {
  return (
    <td style={{
      textAlign: align,
      padding: '10px 12px',
      color: C.text,
      verticalAlign: 'middle',
      ...style,
    }}>
      {children}
    </td>
  );
}
