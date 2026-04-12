'use client';
/**
 * STATUS — Command Center
 * Operational truth dashboard: health, exchanges, AI credits,
 * logs, gladiator, trading ops, system resources.
 * Data: useRealtimeData (SSE) + /api/health + /api/diagnostics/* + /api/exchanges
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import BottomNav from '@/components/BottomNav';

// ─── Color System ─────────────────────────────────────────────────────────────
const C = {
  bg:          '#07080d',
  surface:     '#0d1018',
  surfaceAlt:  '#111520',
  border:      '#1a2133',
  borderAlt:   '#242d40',
  green:       '#00e676',
  greenBg:     '#00e67614',
  red:         '#ff3d57',
  redBg:       '#ff3d5714',
  yellow:      '#ffd600',
  yellowBg:    '#ffd60014',
  blue:        '#29b6f6',
  blueBg:      '#29b6f614',
  purple:      '#b39ddb',
  purpleBg:    '#b39ddb14',
  muted:       '#3a4558',
  mutedLight:  '#5a6a85',
  text:        '#c8d4e8',
  textDim:     '#8899b0',
  white:       '#edf2fb',
  font:        'system-ui, -apple-system, "Segoe UI", sans-serif',
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface HealthData {
  status: string;
  version: string;
  systemMode: string;
  uptimeSecs: number;
  coreMonitor: { heartbeat: string; watchdog: string; killSwitch: string };
  trading: { autoSelectEnabled: boolean; totalGladiators: number; decisionsToday: number; forgeProgress: number };
  api: {
    binance:     { ok: boolean; mode: string; latencyMs: number };
    dexScreener: { ok: boolean };
    coinGecko:   { ok: boolean };
  };
  timestamp: string;
}

interface DiagData {
  overallHealth: string;
  mexc?: {
    status: string; latencyMs: number; usdtBalance: number;
    healthGrade: string; clockDriftMs: number;
  };
  supabase?: {
    status: string; writeLatencyMs: number; readLatencyMs: number;
    roundtripMs: number; consistent: boolean; healthGrade: string;
  };
  equity?: {
    currentBalance: number; peakBalance: number; maxDrawdownPercent: number;
    totalTrades: number; wins: number; losses: number; winRatePercent: number;
    mode: string; haltedUntil: string | null;
  };
  sentinel?: { dailyLossPercent?: number; maxDrawdown?: number; triggered?: boolean };
  positions?: { total: number; open: number; closed: number };
  system?: {
    memoryUsageMB: { rss: number; heapUsed: number; heapTotal: number };
    uptimeSeconds: number; nodeVersion: string; diagnosticDurationMs: number;
  };
}

interface CreditsData {
  openai:   { status: string; balance: string };
  deepseek: { status: string; balance: string; is_available: boolean };
}

interface ExchangeRow {
  name: string; enabled: boolean; mode: string; connected: boolean; error?: string;
}

interface ExchangeData {
  activeExchange: string;
  exchanges: ExchangeRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function healthColor(s: string | boolean | undefined): string {
  if (s === true  || ['OK','HEALTHY','GREEN','ACTIVE','SAFE','CONNECTED','CONSISTENT'].includes(String(s).toUpperCase())) return C.green;
  if (s === false || ['ERROR','DEGRADED','CRITICAL','RED','DISCONNECTED','INVALID_KEY','MISSING_KEY','NETWORK_ERROR'].includes(String(s).toUpperCase())) return C.red;
  if (['WARNING','YELLOW','INACTIVE','QUOTA_EXCEEDED','DEGRADED'].includes(String(s).toUpperCase())) return C.yellow;
  return C.mutedLight;
}

function healthBg(s: string | boolean | undefined): string {
  const c = healthColor(s);
  if (c === C.green)  return C.greenBg;
  if (c === C.red)    return C.redBg;
  if (c === C.yellow) return C.yellowBg;
  return 'transparent';
}

function formatUptime(secs: number): string {
  if (!secs || secs <= 0) return '—';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${m}m`;
}

function fmtTime(ts: string): string {
  try { return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return '—'; }
}

function logColor(level: string): string {
  const l = level?.toUpperCase();
  if (l === 'ERROR' || l === 'FATAL') return C.red;
  if (l === 'WARN'  || l === 'WARNING') return C.yellow;
  if (l === 'DEBUG') return C.muted;
  return C.mutedLight;
}

function gradeColor(g: string): string {
  if (g === 'A') return C.green;
  if (g === 'B') return C.yellow;
  if (g === 'C') return C.red;
  return C.mutedLight;
}

const EXCHANGE_ICONS: Record<string, string> = {
  binance: 'B', bybit: 'BY', mexc: 'MX', okx: 'OK',
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function StatusPage() {
  const { dashboard: dash, bot, connectionStatus, lastUpdate, updateCount, reconnect, forceRefresh } = useRealtimeData();

  const [health,    setHealth]    = useState<HealthData | null>(null);
  const [diag,      setDiag]      = useState<DiagData | null>(null);
  const [credits,   setCredits]   = useState<CreditsData | null>(null);
  const [exchanges, setExchanges] = useState<ExchangeData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [diagLoading, setDiagLoading] = useState(false);
  const [lastDiag,  setLastDiag]  = useState<Date | null>(null);
  const [activeLog, setActiveLog] = useState<'all' | 'error' | 'warn'>('all');
  const diagTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ── Light fetch: health + exchanges (every 20s) ─────────────────────────────
  const fetchLight = useCallback(async () => {
    try {
      const [hRes, exRes] = await Promise.allSettled([
        fetch('/api/health').then(r => r.ok ? r.json() : null),
        fetch('/api/exchanges').then(r => r.ok ? r.json() : null),
      ]);
      if (hRes.status  === 'fulfilled' && hRes.value)  setHealth(hRes.value);
      if (exRes.status === 'fulfilled' && exRes.value) setExchanges(exRes.value);
    } catch { /* silent */ }
  }, []);

  // ── Heavy fetch: diagnostics + credits (every 90s) ─────────────────────────
  const fetchDiag = useCallback(async () => {
    setDiagLoading(true);
    try {
      const [dRes, cRes] = await Promise.allSettled([
        fetch('/api/diagnostics/master').then(r => r.ok ? r.json() : null),
        fetch('/api/diagnostics/credits').then(r => r.ok ? r.json() : null),
      ]);
      if (dRes.status === 'fulfilled' && dRes.value) setDiag(dRes.value);
      if (cRes.status === 'fulfilled' && cRes.value) setCredits(cRes.value);
      setLastDiag(new Date());
    } catch { /* silent */ }
    finally { setDiagLoading(false); setLoading(false); }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchLight(), fetchDiag(), forceRefresh()]);
  }, [fetchLight, fetchDiag, forceRefresh]);

  useEffect(() => {
    fetchLight();
    fetchDiag();
    const lightTimer = setInterval(fetchLight, 20_000);
    diagTimerRef.current  = setInterval(fetchDiag, 90_000);
    return () => { clearInterval(lightTimer); if (diagTimerRef.current) clearInterval(diagTimerRef.current); };
  }, [fetchLight, fetchDiag]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const overallStatus  = health?.status || diag?.overallHealth || (loading ? 'LOADING' : 'UNKNOWN');
  const statusCol      = healthColor(overallStatus);
  const gladiators     = bot?.gladiators || [];
  const omega          = gladiators.find(g => g.isOmega) || gladiators[0] || null;
  const logs           = dash?.logs?.recent || [];
  const filteredLogs   = logs.filter(l =>
    activeLog === 'all'   ? true :
    activeLog === 'error' ? ['error','fatal'].includes(l.level?.toLowerCase()) :
    ['warn','warning'].includes(l.level?.toLowerCase())
  );
  const errorCount     = logs.filter(l => ['error','fatal'].includes(l.level?.toLowerCase())).length;
  const warnCount      = logs.filter(l => ['warn','warning'].includes(l.level?.toLowerCase())).length;
  const connLabel: Record<string, string> = {
    connected: 'SSE LIVE', connecting: 'CONNECTING', reconnecting: 'RECONNECTING',
    polling: 'POLLING', error: 'ERROR',
  };
  const connColor: Record<string, string> = {
    connected: C.green, connecting: C.yellow, reconnecting: C.yellow, polling: C.blue, error: C.red,
  };

  // ── Styles ───────────────────────────────────────────────────────────────────
  const s = {
    page: {
      background: C.bg, minHeight: '100vh', fontFamily: C.font,
      paddingBottom: 80, color: C.text,
    } as React.CSSProperties,

    header: {
      position: 'sticky' as const, top: 0, zIndex: 50,
      background: C.bg,
      borderBottom: `1px solid ${C.border}`,
      padding: '10px 14px',
      display: 'flex', alignItems: 'center', gap: 10,
    } as React.CSSProperties,

    statusDot: (col: string) => ({
      width: 10, height: 10, borderRadius: '50%',
      background: col, boxShadow: `0 0 8px ${col}`,
      flexShrink: 0,
    } as React.CSSProperties),

    section: {
      margin: '12px 12px 0',
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      overflow: 'hidden',
    } as React.CSSProperties,

    sectionHead: {
      padding: '8px 12px',
      borderBottom: `1px solid ${C.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    } as React.CSSProperties,

    sectionTitle: {
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      color: C.mutedLight, textTransform: 'uppercase' as const,
    } as React.CSSProperties,

    grid2: {
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1,
      background: C.border,
    } as React.CSSProperties,

    cell: {
      background: C.surface, padding: '10px 12px',
    } as React.CSSProperties,

    kpiLabel: {
      fontSize: 9, fontWeight: 600, letterSpacing: '0.08em',
      color: C.mutedLight, textTransform: 'uppercase' as const,
      marginBottom: 4,
    } as React.CSSProperties,

    kpiVal: (col?: string) => ({
      fontSize: 18, fontWeight: 700, color: col || C.white, lineHeight: 1.1,
    } as React.CSSProperties),

    badge: (col: string) => ({
      display: 'inline-flex', alignItems: 'center',
      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
      padding: '2px 6px', borderRadius: 3,
      color: col, background: healthBg(col === C.green ? 'OK' : col === C.red ? 'ERROR' : 'WARNING'),
      border: `1px solid ${col}30`,
    } as React.CSSProperties),

    refreshBtn: {
      marginLeft: 'auto', padding: '4px 10px',
      background: 'transparent', border: `1px solid ${C.borderAlt}`,
      color: C.mutedLight, borderRadius: 5, fontSize: 11,
      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
    } as React.CSSProperties,
  };

  return (
    <div style={s.page}>
      {/* ── CSS Animations ─────────────────────────────────────────────────── */}
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes spin { to{transform:rotate(360deg)} }
        .log-row { border-bottom: 1px solid ${C.border}; padding: 6px 12px; display:flex; gap:8px; align-items:flex-start; }
        .log-row:last-child { border-bottom: none; }
        .log-row:hover { background: ${C.surfaceAlt}; }
        .tab-btn { background:none; border:none; cursor:pointer; padding:4px 8px; border-radius:4px; font-size:10px; font-weight:600; letter-spacing:0.04em; }
        .tab-btn.active { background:${C.borderAlt}; color:${C.white}; }
        .tab-btn:not(.active) { color:${C.mutedLight}; }
        .ex-row { display:flex; align-items:center; gap:8px; padding:9px 12px; border-bottom:1px solid ${C.border}; }
        .ex-row:last-child { border-bottom:none; }
        .service-chip { display:flex; align-items:center; gap:6px; padding:7px 10px; background:${C.surfaceAlt}; border:1px solid ${C.border}; border-radius:7px; flex:1; min-width:0; }
        .gladiator-bar { height:4px; border-radius:2px; background:${C.border}; overflow:hidden; margin-top:5px; }
        .gladiator-fill { height:100%; border-radius:2px; background:${C.green}; }
      `}</style>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header style={s.header}>
        {loading
          ? <div style={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid ${C.yellow}`, borderTopColor: 'transparent', animation: 'spin .8s linear infinite' }} />
          : <div style={s.statusDot(statusCol)} />
        }
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.white, lineHeight: 1 }}>TRADE AI — STATUS</div>
          <div style={{ fontSize: 10, color: C.mutedLight, marginTop: 2 }}>
            {overallStatus}
            {health?.version ? ` · v${health.version.split(' ')[0]}` : ''}
            {health?.uptimeSecs ? ` · up ${formatUptime(health.uptimeSecs)}` : ''}
          </div>
        </div>

        {/* Connection pill */}
        <div style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
          padding: '3px 8px', borderRadius: 5,
          border: `1px solid ${(connColor[connectionStatus] || C.muted)}30`,
          background: healthBg(connectionStatus === 'connected' ? 'OK' : connectionStatus === 'error' ? 'ERROR' : 'WARN'),
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: connColor[connectionStatus] || C.mutedLight,
            animation: connectionStatus === 'connected' ? 'pulse 2s infinite' : 'none',
          }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: connColor[connectionStatus] || C.mutedLight }}>
            {connLabel[connectionStatus] || connectionStatus.toUpperCase()}
          </span>
        </div>

        {/* Refresh */}
        <button style={s.refreshBtn} onClick={refreshAll}>
          <span style={{ animation: loading || diagLoading ? 'spin .8s linear infinite' : 'none', display: 'inline-block' }}>↺</span>
          <span>Refresh</span>
        </button>
      </header>

      {/* ── CORE SERVICES STRIP ────────────────────────────────────────────── */}
      <div style={{ margin: '12px 12px 0', display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2 }}>
        {[
          { label: 'STREAM',     val: connLabel[connectionStatus] || '—',       col: connColor[connectionStatus] || C.mutedLight },
          { label: 'HEARTBEAT',  val: dash?.heartbeat?.status  || health?.coreMonitor?.heartbeat || '—', col: healthColor(dash?.heartbeat?.status || health?.coreMonitor?.heartbeat) },
          { label: 'WATCHDOG',   val: dash?.watchdog?.status   || health?.coreMonitor?.watchdog  || '—', col: healthColor(dash?.watchdog?.status  || health?.coreMonitor?.watchdog) },
          { label: 'KILL SW',    val: dash?.killSwitch?.engaged ? 'ENGAGED' : (health?.coreMonitor?.killSwitch === 'SAFE' ? 'SAFE' : (health?.coreMonitor?.killSwitch || '—')), col: dash?.killSwitch?.engaged ? C.red : C.green },
          { label: 'SUPABASE',   val: diag?.supabase?.status || '—',            col: healthColor(diag?.supabase?.status) },
          { label: 'SYS MODE',   val: health?.systemMode || '—',                col: health?.systemMode === 'AUTO_TRADE' ? C.yellow : C.blue },
        ].map(chip => (
          <div key={chip.label} className="service-chip" style={{ flexShrink: 0 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: chip.col, animation: chip.col === C.green ? 'pulse 2.5s infinite' : 'none', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 8, fontWeight: 700, color: C.mutedLight, letterSpacing: '0.07em' }}>{chip.label}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: chip.col, whiteSpace: 'nowrap' }}>{chip.val}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── EXCHANGE CONNECTIVITY ──────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionHead}>
          <span style={s.sectionTitle}>Exchange Connectivity</span>
          {exchanges?.activeExchange && (
            <span style={{ fontSize: 9, color: C.blue, fontWeight: 600 }}>
              ACTIVE: {exchanges.activeExchange.toUpperCase()}
            </span>
          )}
        </div>
        {/* Row: Binance + DexScreener from /api/health */}
        {health?.api && (() => {
          const rows = [
            { name: 'Binance',    ok: health.api.binance.ok,     latency: health.api.binance.latencyMs, mode: health.api.binance.mode },
            { name: 'DexScreener', ok: health.api.dexScreener.ok, latency: null,                         mode: null },
            { name: 'CoinGecko',  ok: health.api.coinGecko.ok,   latency: null,                         mode: null },
          ];
          return rows.map(row => (
            <div key={row.name} className="ex-row">
              <div style={{
                width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                background: C.surfaceAlt, border: `1px solid ${C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 800, color: C.mutedLight,
              }}>
                {row.name.slice(0,2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>{row.name}</div>
                {row.mode && <div style={{ fontSize: 9, color: C.mutedLight }}>{row.mode}</div>}
              </div>
              {row.latency != null && row.ok && (
                <div style={{ fontSize: 9, color: C.mutedLight, marginRight: 6 }}>{row.latency}ms</div>
              )}
              <div style={{
                fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                color: row.ok ? C.green : C.red,
                background: row.ok ? C.greenBg : C.redBg,
                border: `1px solid ${row.ok ? C.green : C.red}30`,
              }}>
                {row.ok ? '● LIVE' : '○ DOWN'}
              </div>
            </div>
          ));
        })()}
        {/* Additional exchanges from /api/exchanges */}
        {exchanges?.exchanges.map(ex => {
          const isBase = ['binance'].includes(ex.name);
          if (isBase) return null; // already shown from health
          return (
            <div key={ex.name} className="ex-row">
              <div style={{
                width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                background: C.surfaceAlt, border: `1px solid ${C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 800, color: C.mutedLight,
              }}>
                {EXCHANGE_ICONS[ex.name] || ex.name.slice(0,2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: ex.enabled ? C.text : C.mutedLight }}>
                  {ex.name.toUpperCase()}
                </div>
                <div style={{ fontSize: 9, color: C.mutedLight }}>{ex.enabled ? ex.mode : 'NOT CONFIGURED'}</div>
              </div>
              {diag?.mexc?.latencyMs != null && ex.name === 'mexc' && ex.connected && (
                <div style={{ fontSize: 9, color: C.mutedLight, marginRight: 6 }}>{diag.mexc.latencyMs}ms</div>
              )}
              <div style={{
                fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                color: ex.connected ? C.green : (ex.enabled ? C.red : C.muted),
                background: ex.connected ? C.greenBg : (ex.enabled ? C.redBg : 'transparent'),
                border: `1px solid ${ex.connected ? C.green : ex.enabled ? C.red : C.muted}30`,
              }}>
                {ex.connected ? '● LIVE' : ex.enabled ? '○ DOWN' : '— OFF'}
              </div>
            </div>
          );
        })}
        {/* MEXC diagnostics detail if available */}
        {diag?.mexc?.status === 'OK' && (
          <div style={{ padding: '7px 12px', background: C.surfaceAlt, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 16 }}>
            <div>
              <div style={{ fontSize: 8, color: C.mutedLight }}>MEXC USDT</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.green }}>${diag.mexc.usdtBalance.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: C.mutedLight }}>CLOCK DRIFT</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: diag.mexc.clockDriftMs < 500 ? C.green : C.yellow }}>
                {diag.mexc.clockDriftMs}ms
              </div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: C.mutedLight }}>GRADE</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: gradeColor(diag.mexc.healthGrade) }}>
                {diag.mexc.healthGrade}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── AI PROVIDERS + SUPABASE ────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionHead}>
          <span style={s.sectionTitle}>AI Providers & Database</span>
          {diagLoading && <span style={{ fontSize: 9, color: C.yellow }}>◌ checking…</span>}
          {lastDiag && !diagLoading && (
            <span style={{ fontSize: 9, color: C.mutedLight }}>checked {fmtTime(lastDiag.toISOString())}</span>
          )}
        </div>
        <div style={s.grid2}>
          {/* OpenAI */}
          <div style={s.cell}>
            <div style={s.kpiLabel}>OpenAI GPT</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: healthColor(credits?.openai.status) }}>
                {credits ? credits.openai.status : '—'}
              </div>
            </div>
            <div style={{ fontSize: 9, color: C.mutedLight, marginTop: 2 }}>GPT-4 / Analysis</div>
          </div>
          {/* DeepSeek */}
          <div style={s.cell}>
            <div style={s.kpiLabel}>DeepSeek</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: healthColor(credits?.deepseek.status) }}>
                {credits?.deepseek.balance || (credits ? credits.deepseek.status : '—')}
              </div>
            </div>
            <div style={{ fontSize: 9, color: C.mutedLight, marginTop: 2 }}>
              {credits?.deepseek.is_available ? '● Available' : '○ Unavailable'}
            </div>
          </div>
          {/* Supabase */}
          <div style={s.cell}>
            <div style={s.kpiLabel}>Supabase DB</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: healthColor(diag?.supabase?.status) }}>
              {diag?.supabase?.status || '—'}
            </div>
            {diag?.supabase && (
              <div style={{ fontSize: 9, color: C.mutedLight, marginTop: 2 }}>
                RT: {diag.supabase.roundtripMs}ms · Grade: <span style={{ color: gradeColor(diag.supabase.healthGrade) }}>{diag.supabase.healthGrade}</span>
              </div>
            )}
          </div>
          {/* DB R/W Latency */}
          <div style={s.cell}>
            <div style={s.kpiLabel}>DB Latency</div>
            {diag?.supabase ? (
              <>
                <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
                  <div>
                    <div style={{ fontSize: 8, color: C.mutedLight }}>WRITE</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: diag.supabase.writeLatencyMs < 200 ? C.green : C.yellow }}>
                      {diag.supabase.writeLatencyMs}ms
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 8, color: C.mutedLight }}>READ</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: diag.supabase.readLatencyMs < 150 ? C.green : C.yellow }}>
                      {diag.supabase.readLatencyMs}ms
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 9, color: diag.supabase.consistent ? C.green : C.red, marginTop: 2 }}>
                  {diag.supabase.consistent ? '✓ Consistent' : '✗ Inconsistent'}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 14, fontWeight: 700, color: C.mutedLight }}>—</div>
            )}
          </div>
        </div>
      </div>

      {/* ── TRADING OPERATIONS ────────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionHead}>
          <span style={s.sectionTitle}>Trading Operations</span>
          <span style={{ fontSize: 9, color: health?.systemMode === 'AUTO_TRADE' ? C.yellow : C.blue, fontWeight: 700 }}>
            {health?.systemMode || bot?.stats?.mode || 'PAPER'}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: C.border }}>
          {[
            { label: 'Decisions Today', val: (health?.trading?.decisionsToday ?? dash?.trading?.totalSignals ?? '—').toString(), col: C.blue },
            { label: 'Open Positions',  val: (diag?.positions?.open ?? dash?.trading?.openPositions ?? '—').toString(), col: C.white },
            { label: 'Win Rate',        val: bot?.stats?.overallWinRate != null ? `${bot.stats.overallWinRate.toFixed(1)}%` : '—', col: bot?.stats?.overallWinRate != null && bot.stats.overallWinRate >= 55 ? C.green : bot?.stats?.overallWinRate != null && bot.stats.overallWinRate >= 45 ? C.yellow : C.red },
            { label: 'Total Trades',    val: (diag?.equity?.totalTrades ?? bot?.stats?.totalDecisions ?? '—').toString(), col: C.text },
          ].map(k => (
            <div key={k.label} style={{ background: C.surface, padding: '10px 10px 8px' }}>
              <div style={s.kpiLabel}>{k.label}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: k.col }}>{k.val}</div>
            </div>
          ))}
        </div>
        {/* Battle stats bar */}
        {diag?.equity && (
          <div style={{ padding: '9px 12px', display: 'flex', gap: 16, borderTop: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 9, color: C.mutedLight }}>
              W <span style={{ color: C.green, fontWeight: 700 }}>{diag.equity.wins}</span>
              &nbsp;/&nbsp;
              L <span style={{ color: C.red, fontWeight: 700 }}>{diag.equity.losses}</span>
            </div>
            <div style={{ fontSize: 9, color: C.mutedLight }}>
              WR&nbsp;<span style={{ color: diag.equity.winRatePercent >= 55 ? C.green : C.yellow, fontWeight: 700 }}>{diag.equity.winRatePercent.toFixed(1)}%</span>
            </div>
            <div style={{ fontSize: 9, color: C.mutedLight }}>
              Equity&nbsp;<span style={{ color: C.white, fontWeight: 700 }}>${diag.equity.currentBalance.toFixed(0)}</span>
            </div>
            <div style={{ fontSize: 9, color: C.mutedLight }}>
              Peak&nbsp;<span style={{ color: C.blue, fontWeight: 700 }}>${diag.equity.peakBalance.toFixed(0)}</span>
            </div>
            <div style={{ fontSize: 9, color: C.mutedLight }}>
              MaxDD&nbsp;<span style={{ color: diag.equity.maxDrawdownPercent > 15 ? C.red : C.yellow, fontWeight: 700 }}>{diag.equity.maxDrawdownPercent.toFixed(1)}%</span>
            </div>
            {bot?.stats?.streakType && bot.stats.streakType !== 'NONE' && (
              <div style={{ fontSize: 9, color: C.mutedLight }}>
                Streak&nbsp;<span style={{ color: bot.stats.streakType === 'WIN' ? C.green : C.red, fontWeight: 700 }}>
                  {bot.stats.streakType === 'WIN' ? '▲' : '▼'} {Math.abs(bot.stats.currentStreak)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── TOP GLADIATOR ─────────────────────────────────────────────────── */}
      {omega && (
        <div style={s.section}>
          <div style={s.sectionHead}>
            <span style={s.sectionTitle}>Top Gladiator</span>
            <span style={{ fontSize: 9, color: omega.isOmega ? C.yellow : C.mutedLight, fontWeight: 700 }}>
              {omega.isOmega ? '⚡ OMEGA' : 'ACTIVE'}
            </span>
          </div>
          <div style={{ padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.white }}>{omega.id}</div>
                <div style={{ fontSize: 9, color: C.mutedLight, marginTop: 1 }}>{omega.arena || 'MAIN ARENA'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: omega.winRate >= 55 ? C.green : omega.winRate >= 45 ? C.yellow : C.red }}>
                  {omega.winRate.toFixed(1)}%
                </div>
                <div style={{ fontSize: 9, color: C.mutedLight }}>Win Rate</div>
              </div>
            </div>
            {/* Training progress */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 9, color: C.mutedLight }}>Training Progress</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: C.blue }}>{Math.round(omega.trainingProgress * 100)}%</span>
            </div>
            <div className="gladiator-bar">
              <div className="gladiator-fill" style={{ width: `${Math.round(omega.trainingProgress * 100)}%`, background: omega.isOmega ? C.yellow : C.green }} />
            </div>
            <div style={{ marginTop: 7, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={s.badge(healthColor(omega.status))}>{omega.status}</span>
              {gladiators.length > 1 && (
                <span style={{ fontSize: 9, color: C.mutedLight }}>{gladiators.length} gladiators active</span>
              )}
              {(health?.trading?.forgeProgress ?? 0) > 0 && (
                <span style={{ fontSize: 9, color: C.purple }}>Forge: {Math.round((health?.trading?.forgeProgress ?? 0) * 100)}%</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── V2 ENTITIES ────────────────────────────────────────────────────── */}
      {bot?.v2Entities && (() => {
        const v2 = bot.v2Entities!;
        const sentinelTriggered = v2.sentinels?.riskShield?.triggered || v2.sentinels?.lossDaily?.triggered;
        return (
          <div style={s.section}>
            <div style={s.sectionHead}>
              <span style={s.sectionTitle}>V2 Entities</span>
              {sentinelTriggered && (
                <span style={{ fontSize: 9, color: C.red, fontWeight: 700, animation: 'pulse 1s infinite' }}>⚠ SENTINEL TRIGGERED</span>
              )}
            </div>
            <div style={s.grid2}>
              {v2.masters?.slice(0, 4).map(m => (
                <div key={m.id} style={s.cell}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: C.mutedLight, textTransform: 'uppercase' }}>{m.role}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.text, marginTop: 1 }}>{m.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: healthColor(m.status), flexShrink: 0 }} />
                    <span style={{ fontSize: 9, color: healthColor(m.status) }}>{m.status}</span>
                    <span style={{ fontSize: 9, color: C.mutedLight, marginLeft: 'auto' }}>⚡{m.power}%</span>
                  </div>
                </div>
              ))}
            </div>
            {(v2.sentinels?.riskShield || v2.sentinels?.lossDaily) && (
              <div style={{ padding: '8px 12px', background: C.surfaceAlt, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 12 }}>
                {v2.sentinels.riskShield && (
                  <div>
                    <div style={{ fontSize: 8, color: C.mutedLight }}>RISK SHIELD</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: v2.sentinels.riskShield.triggered ? C.red : C.green }}>
                      {v2.sentinels.riskShield.triggered ? '⚠ TRIGGERED' : '● GUARDING'}&nbsp;
                      <span style={{ color: C.mutedLight, fontWeight: 400 }}>{v2.sentinels.riskShield.limit}</span>
                    </div>
                  </div>
                )}
                {v2.sentinels.lossDaily && (
                  <div>
                    <div style={{ fontSize: 8, color: C.mutedLight }}>DAILY LOSS</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: v2.sentinels.lossDaily.triggered ? C.red : C.green }}>
                      {v2.sentinels.lossDaily.triggered ? '⚠ TRIGGERED' : '● OK'}&nbsp;
                      <span style={{ color: C.mutedLight, fontWeight: 400 }}>{v2.sentinels.lossDaily.limit}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── SYSTEM RESOURCES ───────────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionHead}>
          <span style={s.sectionTitle}>System Resources</span>
          {diag?.system && (
            <span style={{ fontSize: 9, color: C.mutedLight }}>
              diag in {diag.system.diagnosticDurationMs}ms
            </span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: C.border }}>
          {[
            { label: 'RSS Memory',  val: diag?.system ? `${diag.system.memoryUsageMB.rss} MB` : (dash?.system?.memoryUsageRssMB ? `${dash.system.memoryUsageRssMB} MB` : '—'), col: diag?.system && diag.system.memoryUsageMB.rss > 400 ? C.yellow : C.text },
            { label: 'Heap Used',   val: diag?.system ? `${diag.system.memoryUsageMB.heapUsed}/${diag.system.memoryUsageMB.heapTotal} MB` : '—', col: C.text },
            { label: 'Uptime',      val: diag?.system ? formatUptime(diag.system.uptimeSeconds) : (dash?.system?.uptime ? formatUptime(dash.system.uptime) : '—'), col: C.green },
            { label: 'Node',        val: diag?.system?.nodeVersion || '—', col: C.mutedLight },
            { label: 'Sync Queue',  val: dash?.system?.syncQueue ? `${dash.system.syncQueue.pending} pending` : '—', col: dash?.system?.syncQueue?.pending ? C.yellow : C.mutedLight },
            { label: 'Updates',     val: updateCount.toString(), col: C.blue },
          ].map(k => (
            <div key={k.label} style={{ background: C.surface, padding: '9px 10px 8px' }}>
              <div style={s.kpiLabel}>{k.label}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: k.col, wordBreak: 'break-all' }}>{k.val}</div>
            </div>
          ))}
        </div>
        {dash?.system?.syncQueue?.lastSyncComplete && (
          <div style={{ padding: '6px 12px', borderTop: `1px solid ${C.border}`, fontSize: 9, color: C.mutedLight }}>
            Last sync: {fmtTime(dash.system.syncQueue.lastSyncComplete)} · Total completed: {dash.system.syncQueue.totalCompleted}
          </div>
        )}
      </div>

      {/* ── LIVE LOGS ──────────────────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionHead}>
          <span style={s.sectionTitle}>Live Console</span>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {errorCount > 0 && (
              <span style={{ fontSize: 9, fontWeight: 700, color: C.red, marginRight: 4 }}>
                {errorCount} ERR
              </span>
            )}
            {warnCount > 0 && (
              <span style={{ fontSize: 9, fontWeight: 700, color: C.yellow, marginRight: 4 }}>
                {warnCount} WARN
              </span>
            )}
            {(['all','error','warn'] as const).map(tab => (
              <button
                key={tab}
                className={`tab-btn${activeLog === tab ? ' active' : ''}`}
                onClick={() => setActiveLog(tab)}
              >
                {tab.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {filteredLogs.length === 0 ? (
            <div style={{ padding: '20px 12px', textAlign: 'center', color: C.mutedLight, fontSize: 12 }}>
              No log entries
            </div>
          ) : (
            filteredLogs.slice(0, 40).map((log, i) => (
              <div key={i} className="log-row">
                <div style={{
                  fontSize: 8, fontWeight: 800, color: logColor(log.level),
                  minWidth: 30, paddingTop: 1, letterSpacing: '0.04em',
                }}>
                  {log.level?.toUpperCase().slice(0,4)}
                </div>
                <div style={{ fontSize: 9, color: C.mutedLight, whiteSpace: 'nowrap', paddingTop: 1 }}>
                  {fmtTime(log.ts)}
                </div>
                <div style={{ fontSize: 10, color: C.textDim, flex: 1, wordBreak: 'break-word', lineHeight: 1.4 }}>
                  {log.msg}
                </div>
              </div>
            ))
          )}
        </div>
        {logs.length > 0 && (
          <div style={{ padding: '5px 12px', borderTop: `1px solid ${C.border}`, fontSize: 9, color: C.mutedLight, display: 'flex', gap: 10 }}>
            <span>{logs.length} total entries</span>
            {dash?.logs?.errorCount1h != null && (
              <span style={{ color: dash.logs.errorCount1h > 0 ? C.red : C.mutedLight }}>
                {dash.logs.errorCount1h} errors/1h
              </span>
            )}
            {lastUpdate && <span>Updated {fmtTime(lastUpdate.toISOString())}</span>}
          </div>
        )}
      </div>

      {/* ── SYNDICATE LAST DECISION ────────────────────────────────────────── */}
      {bot?.syndicateAudits && bot.syndicateAudits.length > 0 && (() => {
        const last = bot.syndicateAudits[0];
        return (
          <div style={s.section}>
            <div style={s.sectionHead}>
              <span style={s.sectionTitle}>Last Syndicate Decision</span>
              <span style={{ fontSize: 9, color: C.mutedLight }}>{fmtTime(last.timestamp)}</span>
            </div>
            <div style={{ padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.white }}>{last.symbol}</div>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                  color: last.decision === 'BUY' ? C.green : last.decision === 'SELL' ? C.red : C.yellow,
                  background: last.decision === 'BUY' ? C.greenBg : last.decision === 'SELL' ? C.redBg : C.yellowBg,
                }}>
                  {last.decision}
                </span>
                <span style={{ fontSize: 9, color: C.blue, marginLeft: 'auto', fontWeight: 700 }}>
                  {Math.round(last.confidence * 100)}% confidence
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { name: 'ARCHITECT', data: last.architect },
                  { name: 'ORACLE',    data: last.oracle },
                ].map(agent => (
                  <div key={agent.name} style={{ background: C.surfaceAlt, borderRadius: 6, padding: '7px 9px', border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: C.mutedLight, marginBottom: 3 }}>{agent.name}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: agent.data.direction === 'BUY' ? C.green : agent.data.direction === 'SELL' ? C.red : C.yellow }}>
                      {agent.data.direction} · {Math.round(agent.data.confidence * 100)}%
                    </div>
                    <div style={{ fontSize: 9, color: C.textDim, marginTop: 3, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {agent.data.reasoning}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── HEARTBEAT PROVIDERS ────────────────────────────────────────────── */}
      {dash?.heartbeat?.providers && Object.keys(dash.heartbeat.providers).length > 0 && (
        <div style={s.section}>
          <div style={s.sectionHead}>
            <span style={s.sectionTitle}>Data Providers</span>
            <span style={{ fontSize: 9, color: healthColor(dash.heartbeat.status) }}>
              {dash.heartbeat.status}
            </span>
          </div>
          <div style={{ padding: '8px 12px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(dash.heartbeat.providers).map(([name, prov]) => (
              <div key={name} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 9px', borderRadius: 6,
                background: C.surfaceAlt, border: `1px solid ${C.border}`,
              }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: prov.ok ? C.green : C.red }} />
                <span style={{ fontSize: 10, color: prov.ok ? C.text : C.mutedLight, fontWeight: 600 }}>{name}</span>
                {prov.lastLatencyMs != null && (
                  <span style={{ fontSize: 9, color: C.mutedLight }}>{prov.lastLatencyMs}ms</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── KILL SWITCH STATUS ─────────────────────────────────────────────── */}
      {dash?.killSwitch?.engaged && (
        <div style={{
          margin: '12px 12px 0',
          background: C.redBg,
          border: `1px solid ${C.red}40`,
          borderRadius: 10, padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.red, animation: 'pulse 1s infinite' }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: C.red, letterSpacing: '0.05em' }}>KILL SWITCH ENGAGED</span>
          </div>
          <div style={{ fontSize: 11, color: C.text, marginTop: 4 }}>
            {dash.killSwitch.reason || 'Bot halted by emergency stop'}
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
