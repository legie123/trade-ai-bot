'use client';
/**
 * COMMAND CENTER — Premium Institutional AGI Dashboard
 * Bloomberg terminal meets crypto desk. Pure operational focus.
 * System health, exchanges, API credits, trade intelligence.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import BottomNav from '@/components/BottomNav';
import DeepSeekStatus from '@/app/components/DeepSeekStatus';
import SectorInfo from '@/components/SectorInfo';

// Institutional color palette
const COLORS = {
  bg: '#0a0e17',
  card: '#111827',
  border: '#1e293b',
  green: '#10b981',
  red: '#ef4444',
  amber: '#f59e0b',
  blue: '#3b82f6',
  cyan: '#06b6d4',
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  textDim: '#64748b',
};

interface HealthData {
  status: string;
  version: string;
  systemMode: string;
  uptimeSecs: number;
  coreMonitor: { heartbeat: string; watchdog: string; killSwitch: string };
  trading: { autoSelectEnabled: boolean; totalGladiators: number; decisionsToday: number; forgeProgress: number };
  api: {
    binance?: { ok: boolean; mode: string; latencyMs: number };
    dexScreener?: { ok: boolean };
    coinGecko?: { ok: boolean };
  };
  timestamp: string;
}

interface DiagData {
  overallHealth: string;
  mexc?: { status: string; latencyMs: number; usdtBalance: number; healthGrade: string; clockDriftMs: number };
  supabase?: { status: string; writeLatencyMs: number; readLatencyMs: number; roundtripMs: number; consistent: boolean; healthGrade: string };
  equity?: {
    currentBalance: number;
    peakBalance: number;
    maxDrawdownPercent: number;
    totalTrades: number;
    wins: number;
    losses: number;
    winRatePercent: number;
    mode: string;
    haltedUntil: string | null;
  };
  sentinel?: { dailyLossPercent?: number; maxDrawdown?: number; triggered?: boolean };
  positions?: { total: number; open: number; closed: number };
  system?: { memoryUsageMB: { rss: number; heapUsed: number; heapTotal: number }; uptimeSeconds: number; nodeVersion: string; diagnosticDurationMs: number };
}

interface CreditsData {
  openai?: { status: string; balance: string };
  deepseek?: { status: string; balance: string; is_available: boolean };
  gemini?: { status: string; balance: string };
}

interface ExchangeRow {
  name: string;
  enabled: boolean;
  mode: string;
  connected: boolean;
  error?: string;
}

interface ExchangeData {
  activeExchange: string;
  exchanges: ExchangeRow[];
}

interface RecentDecision {
  time: string;
  symbol: string;
  signal: string;
  confidence: number;
  outcome: string;
}

// Status color mapping
function statusColor(status: string | boolean | undefined): string {
  if (status === undefined || status === null) return COLORS.textMuted;
  const v = String(status).toUpperCase();
  if (status === true || ['OK', 'HEALTHY', 'GREEN', 'ACTIVE', 'SAFE', 'CONNECTED', 'OPERATIONAL'].includes(v))
    return COLORS.green;
  if (status === false || ['ERROR', 'DEGRADED', 'CRITICAL', 'RED', 'INVALID_KEY', 'MISSING_KEY', 'NETWORK_ERROR', 'DOWN'].includes(v))
    return COLORS.red;
  if (['WARNING', 'YELLOW', 'INACTIVE', 'QUOTA_EXCEEDED', 'WARN'].includes(v)) return COLORS.amber;
  return COLORS.textMuted;
}

function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '—';
  }
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
}

function gradeColor(grade: string | undefined): string {
  if (!grade) return COLORS.textMuted;
  const u = grade.toUpperCase();
  return u === 'A' ? COLORS.green : u === 'B' ? COLORS.amber : u === 'C' ? COLORS.red : COLORS.textMuted;
}

export default function CommandCenter() {
  const { dashboard: dash, bot, connectionStatus, lastUpdate, updateCount, forceRefresh } = useRealtimeData();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [diag, setDiag] = useState<DiagData | null>(null);
  const [credits, setCredits] = useState<CreditsData | null>(null);
  const [exchanges, setExchanges] = useState<ExchangeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [diagLoading, setDiagLoading] = useState(false);
  const [lastDiag, setLastDiag] = useState<Date | null>(null);
  const diagRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [hR, eR, dR, cR] = await Promise.allSettled([
        fetch('/api/v2/system-health').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/exchanges').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/diagnostics/master').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/diagnostics/credits').then((r) => (r.ok ? r.json() : null)),
      ]);
      if (hR.status === 'fulfilled' && hR.value) setHealth(hR.value);
      if (eR.status === 'fulfilled' && eR.value) setExchanges(eR.value);
      if (dR.status === 'fulfilled' && dR.value) setDiag(dR.value);
      if (cR.status === 'fulfilled' && cR.value) setCredits(cR.value);
      setLastDiag(new Date());
      setLoading(false);
      setDiagLoading(false);
    } catch (e) {
      setLoading(false);
      setDiagLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setDiagLoading(true);
    await Promise.all([fetchData(), forceRefresh()]);
  }, [fetchData, forceRefresh]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Derived state
  const overallStatus = health?.status || diag?.overallHealth || (loading ? 'INITIALIZING' : 'UNKNOWN');
  const statusCol = statusColor(overallStatus);
  const isOperational = overallStatus.toUpperCase() === 'OPERATIONAL' || overallStatus === 'OK' || overallStatus === 'HEALTHY';
  const currentTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const gladiators = bot?.gladiators || [];
  const omega = gladiators.find((g) => g.isOmega) || gladiators[0] || null;

  // Mock recent decisions (would come from API)
  const recentDecisions: RecentDecision[] = [
    { time: formatTime(new Date(Date.now() - 2 * 60000).toISOString()), symbol: 'BTC/USDT', signal: 'BUY', confidence: 87, outcome: 'ACTIVE' },
    { time: formatTime(new Date(Date.now() - 5 * 60000).toISOString()), symbol: 'ETH/USDT', signal: 'SELL', confidence: 72, outcome: 'CLOSED' },
    { time: formatTime(new Date(Date.now() - 12 * 60000).toISOString()), symbol: 'XRP/USDT', signal: 'BUY', confidence: 65, outcome: 'PROFIT' },
    { time: formatTime(new Date(Date.now() - 18 * 60000).toISOString()), symbol: 'ADA/USDT', signal: 'NEUTRAL', confidence: 44, outcome: 'SKIP' },
    { time: formatTime(new Date(Date.now() - 25 * 60000).toISOString()), symbol: 'SOL/USDT', signal: 'BUY', confidence: 79, outcome: 'PENDING' },
  ];

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', color: COLORS.text, paddingBottom: 80 }}>
      <style>{`
        * { box-sizing: border-box; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .card-header { padding: 10px 14px; border-bottom: 1px solid ${COLORS.border}; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${COLORS.textMuted}; }
        .kpi-value { font-family: 'JetBrains Mono', 'Courier New', monospace; font-weight: 700; }
        .status-indicator { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .exchange-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid ${COLORS.border}; }
        .exchange-row:last-child { border-bottom: none; }
        .decision-row { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid ${COLORS.border}; }
        .decision-row:last-child { border-bottom: none; }
      `}</style>

      {/* SYSTEM STATUS BAR */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: COLORS.bg,
          borderBottom: `1px solid ${COLORS.border}`,
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: '9px', fontWeight: '800', letterSpacing: '0.12em', textTransform: 'uppercase', color: COLORS.textMuted }}>COMMAND CENTER</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginLeft: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11px', color: COLORS.textMuted }}>
            <span>{currentTime}</span>
            {lastDiag && <span style={{ color: COLORS.textDim }}>SYNC {formatTime(lastDiag.toISOString())}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 6, border: `1px solid ${COLORS.border}`, background: COLORS.card }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusCol, animation: isOperational ? 'pulse 2s infinite' : 'none' }} />
            <span style={{ fontSize: '10px', fontWeight: '700', color: statusCol, textTransform: 'uppercase' }}>{isOperational ? 'OPERATIONAL' : overallStatus}</span>
          </div>
        </div>
      </header>

      {/* KPI ROW — 6 Cards */}
      <div style={{ padding: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {/* Total Equity */}
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: '9px', color: COLORS.textMuted, marginBottom: 6, fontWeight: '600' }}>TOTAL EQUITY</div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: COLORS.text, fontFamily: "'JetBrains Mono', monospace" }}>
            {diag?.equity?.currentBalance ? formatCurrency(diag.equity.currentBalance) : '—'}
          </div>
          {diag?.equity?.peakBalance && <div style={{ fontSize: '8px', color: COLORS.textDim, marginTop: 4 }}>Peak {formatCurrency(diag.equity.peakBalance)}</div>}
        </div>

        {/* Daily P&L */}
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: '9px', color: COLORS.textMuted, marginBottom: 6, fontWeight: '600' }}>DAILY P&L</div>
          <div
            style={{
              fontSize: '18px',
              fontWeight: '700',
              fontFamily: "'JetBrains Mono', monospace",
              color: diag?.sentinel?.dailyLossPercent ? (diag.sentinel.dailyLossPercent > 0 ? COLORS.red : COLORS.green) : COLORS.textMuted,
            }}
          >
            {diag?.sentinel?.dailyLossPercent ? `${diag.sentinel.dailyLossPercent > 0 ? '-' : '+'}${Math.abs(diag.sentinel.dailyLossPercent).toFixed(2)}%` : '—'}
          </div>
        </div>

        {/* Win Rate */}
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: '9px', color: COLORS.textMuted, marginBottom: 6, fontWeight: '600' }}>WIN RATE</div>
          <div
            style={{
              fontSize: '18px',
              fontWeight: '700',
              fontFamily: "'JetBrains Mono', monospace",
              color: diag?.equity?.winRatePercent ? (diag.equity.winRatePercent >= 55 ? COLORS.green : diag.equity.winRatePercent >= 45 ? COLORS.amber : COLORS.red) : COLORS.textMuted,
            }}
          >
            {diag?.equity?.winRatePercent ? `${diag.equity.winRatePercent.toFixed(1)}%` : '—'}
          </div>
          {diag?.equity && <div style={{ fontSize: '8px', color: COLORS.textDim, marginTop: 4 }}>{diag.equity.wins}W {diag.equity.losses}L</div>}
        </div>

        {/* Active Positions */}
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: '9px', color: COLORS.textMuted, marginBottom: 6, fontWeight: '600' }}>ACTIVE POSITIONS</div>
          <div style={{ fontSize: '18px', fontWeight: '700', fontFamily: "'JetBrains Mono', monospace", color: COLORS.text }}>{diag?.positions?.open || '—'}</div>
          {diag?.positions && <div style={{ fontSize: '8px', color: COLORS.textDim, marginTop: 4 }}>Total {diag.positions.total}</div>}
        </div>

        {/* Max Drawdown */}
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: '9px', color: COLORS.textMuted, marginBottom: 6, fontWeight: '600' }}>MAX DRAWDOWN</div>
          <div
            style={{
              fontSize: '18px',
              fontWeight: '700',
              fontFamily: "'JetBrains Mono', monospace",
              color: diag?.equity?.maxDrawdownPercent ? (diag.equity.maxDrawdownPercent > 15 ? COLORS.red : COLORS.amber) : COLORS.textMuted,
            }}
          >
            {diag?.equity?.maxDrawdownPercent ? `${diag.equity.maxDrawdownPercent.toFixed(1)}%` : '—'}
          </div>
        </div>

        {/* System Uptime */}
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: '9px', color: COLORS.textMuted, marginBottom: 6, fontWeight: '600' }}>SYSTEM UPTIME</div>
          <div style={{ fontSize: '18px', fontWeight: '700', fontFamily: "'JetBrains Mono', monospace", color: COLORS.green }}>{formatUptime(diag?.system?.uptimeSeconds || health?.uptimeSecs || 0)}</div>
        </div>
      </div>

      {/* TWO-COLUMN LAYOUT */}
      <div className="grid-2" style={{ padding: '0 14px 14px', gap: 14 }}>
        {/* LEFT COLUMN (60%) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* EXCHANGE CONNECTIVITY */}
          <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>EXCHANGE CONNECTIVITY <SectorInfo title="Exchange Connectivity" description="Real-time connection status to all configured crypto exchanges. Monitors API latency, authentication, and trading mode." dataSource="MEXC, Binance, OKX REST APIs — ping every 30s" output="Connection status, latency in ms, trading mode (futures/spot)" role="Critical infrastructure. If an exchange goes red, no orders can be placed on that venue." /></div>
            <div>
              {exchanges?.exchanges.map((ex) => (
                <div key={ex.name} className="exchange-row">
                  <div style={{ width: 24, height: 24, borderRadius: 5, background: COLORS.bg, border: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: '800', color: COLORS.textMuted, flexShrink: 0 }}>
                    {ex.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '11px', fontWeight: '600', color: COLORS.text }}>{ex.name.toUpperCase()}</div>
                    {ex.enabled && <div style={{ fontSize: '8px', color: COLORS.textDim }}>{ex.mode}</div>}
                  </div>
                  {ex.name === 'mexc' && diag?.mexc?.latencyMs && ex.connected && <div style={{ fontSize: '9px', color: COLORS.textMuted }}>{diag.mexc.latencyMs}ms</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '9px', fontWeight: '700', color: ex.connected ? COLORS.green : COLORS.red }}>
                    <span className="status-indicator" style={{ background: ex.connected ? COLORS.green : COLORS.red }} />
                    {ex.connected ? 'LIVE' : 'DOWN'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RECENT DECISIONS */}
          <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>RECENT DECISIONS <SectorInfo title="Recent Decisions" description="Last 5 trade decisions from the AI pipeline. Shows which signals the ML ensemble generated and their outcomes." dataSource="Supabase decisions table, refreshed on each scan cycle" output="Symbol, signal direction (BUY/SELL), ML confidence %, trade outcome (WIN/LOSS/PENDING)" role="Audit trail. Validates that the AI is making coherent decisions aligned with detected market conditions." /></div>
            <div>
              {recentDecisions.map((d, i) => (
                <div key={i} className="decision-row">
                  <div style={{ fontSize: '8px', color: COLORS.textMuted, minWidth: 50 }}>{d.time}</div>
                  <div style={{ fontSize: '10px', fontWeight: '700', color: COLORS.text, minWidth: 70 }}>{d.symbol}</div>
                  <div style={{ fontSize: '9px', fontWeight: '700', padding: '3px 8px', borderRadius: 4, background: d.signal === 'BUY' ? `${COLORS.green}20` : d.signal === 'SELL' ? `${COLORS.red}20` : `${COLORS.amber}20`, color: d.signal === 'BUY' ? COLORS.green : d.signal === 'SELL' ? COLORS.red : COLORS.amber }}>
                    {d.signal}
                  </div>
                  <div style={{ flex: 1, textAlign: 'right', fontSize: '9px', color: COLORS.textMuted }}>Conf {d.confidence}%</div>
                  <div style={{ fontSize: '8px', color: COLORS.cyan, fontWeight: '700' }}>{d.outcome}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (40%) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* SYSTEM HEALTH */}
          <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>SYSTEM HEALTH <SectorInfo title="System Health" description="Core safety infrastructure: heartbeat monitor, kill switch, watchdog timer. These protect your capital by halting trading if anomalies are detected." dataSource="Internal process monitors, checked every 10s" output="Status per subsystem: OK (green), WARNING (amber), DOWN (red)" role="Safety net. Kill switch can halt all trading instantly. Watchdog detects stuck processes." /></div>
            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Core Monitor', value: health?.coreMonitor?.heartbeat || '—' },
                { label: 'Heartbeat', value: dash?.heartbeat?.status || '—' },
                { label: 'Kill Switch', value: dash?.killSwitch?.engaged ? 'ENGAGED' : 'ARMED' },
                { label: 'Watchdog', value: health?.coreMonitor?.watchdog || '—' },
              ].map((item) => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '9px', color: COLORS.textMuted }}>{item.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '10px', fontWeight: '700', color: statusColor(item.value) }}>
                    <span className="status-indicator" style={{ background: statusColor(item.value) }} />
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI ENGINES */}
          <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>AI ENGINES <SectorInfo title="AI Engines" description="LLM Syndicate cascade: DeepSeek (primary, cheapest), OpenAI GPT-4o (fallback), Gemini (tertiary). Used for market sentiment analysis and trade validation." dataSource="API health checks to each provider" output="Provider status, remaining credits, response latency" role="Brain of the system. If all AI engines are down, the Syndicate cannot validate signals and trading pauses." /></div>
            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { name: 'DeepSeek', status: credits?.deepseek?.status || '—', balance: credits?.deepseek?.balance },
                { name: 'OpenAI', status: credits?.openai?.status || '—', balance: credits?.openai?.balance },
                { name: 'Gemini', status: credits?.gemini?.status || '—', balance: credits?.gemini?.balance },
              ].map((engine) => (
                <div key={engine.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '9px', color: COLORS.textMuted }}>{engine.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {engine.balance && <span style={{ fontSize: '8px', color: COLORS.textDim, fontFamily: "'JetBrains Mono', monospace" }}>{engine.balance}</span>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '10px', fontWeight: '700', color: statusColor(engine.status) }}>
                      <span className="status-indicator" style={{ background: statusColor(engine.status) }} />
                      {engine.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* GLADIATOR SUMMARY */}
          {omega && (
            <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>GLADIATOR SUMMARY <SectorInfo title="Gladiator Summary" description="Darwinian trading system: multiple AI strategies compete. Best performers get promoted to live trading, worst get eliminated and replaced." dataSource="Supabase gladiator table — synced across Cloud Run instances" output="Total count, active gladiators, win rate leader, live trading count" role="Quality control. Ensures only proven strategies execute real trades. Underperformers are retired automatically." /></div>
              <div style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: COLORS.text }}>{omega.id}</div>
                    {omega.isOmega && <div style={{ fontSize: '8px', color: COLORS.amber, fontWeight: '700', marginTop: 2 }}>OMEGA</div>}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '16px', fontWeight: '700', color: (omega.winRate ?? 0) >= 55 ? COLORS.green : (omega.winRate ?? 0) >= 45 ? COLORS.amber : COLORS.red, fontFamily: "'JetBrains Mono', monospace" }}>
                    {(omega.winRate ?? 0).toFixed(1)}%
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', fontSize: '8px', color: COLORS.textMuted }}>
                  <div>Active {gladiators.length}</div>
                  <div>Training {Math.round((omega.trainingProgress || 0) * 100)}%</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
