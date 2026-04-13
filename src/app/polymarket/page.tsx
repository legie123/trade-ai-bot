'use client';

import { useState, useEffect, useCallback } from 'react';
import SectorInfo from '@/components/SectorInfo';

interface DivisionStat {
  division: string;
  balance: number;
  invested: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalReturn: number;
  positionCount: number;
  maxDrawdown: number;
}

interface WalletData {
  totalBalance: number;
  totalInvested: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  roi: number;
  positionCount: number;
  divisionStats: DivisionStat[];
}

interface GladiatorData {
  id: string;
  name: string;
  division: string;
  readinessScore: number;
  divisionExpertise: number;
  winRate: string;
  totalBets: number;
  phantomBets: number;
  cumulativeEdge: string;
  status: string;
  isLive: boolean;
}

interface ScanOpportunity {
  marketId: string;
  division: string;
  edgeScore: number;
  mispricingScore: number;
  momentumScore: number;
  riskLevel: string;
  recommendation: string;
  reasoning: string;
  market: { title: string; outcomes: { name: string; price: number }[] };
}

interface ScanResult {
  division: string;
  totalMarkets: number;
  opportunities: ScanOpportunity[];
  topPick: ScanOpportunity | null;
}

const COLORS = {
  bg: '#0a0e17',
  card: '#111827',
  border: '#1e293b',
  green: '#10b981',
  red: '#ef4444',
  amber: '#f59e0b',
  blue: '#3b82f6',
  cyan: '#06b6d4',
  purple: '#8b5cf6',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate600: '#475569',
};

export default function PolymarketPage() {
  const [status, setStatus] = useState<any>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [gladiators, setGladiators] = useState<GladiatorData[]>([]);
  const [scans, setScans] = useState<ScanResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'scanner' | 'gladiators' | 'wallet'>('overview');

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, walletRes, gladRes] = await Promise.all([
        fetch('/api/v2/polymarket?action=status'),
        fetch('/api/v2/polymarket?action=wallet'),
        fetch('/api/v2/polymarket?action=gladiators'),
      ]);

      if (statusRes.ok) setStatus(await statusRes.json());
      if (walletRes.ok) {
        const w = await walletRes.json();
        setWallet(w.wallet);
      }
      if (gladRes.ok) {
        const g = await gladRes.json();
        setGladiators(g.gladiators || []);
      }
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/v2/polymarket?action=scan');
      if (res.ok) {
        const data = await res.json();
        setScans(data.scans || (data.scan ? [data.scan] : []));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: COLORS.bg, color: COLORS.slate400 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, marginBottom: 16, fontFamily: 'JetBrains Mono, monospace' }}>● ■ ◆</div>
          <div style={{ fontSize: 14, letterSpacing: 1 }}>INITIALIZING POLYMARKET</div>
        </div>
      </div>
    );
  }

  const conn = status?.connection || {};

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.slate300, fontFamily: 'system-ui, -apple-system, sans-serif', padding: 24 }}>
      {/* Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32, paddingBottom: 16, borderBottom: `1px solid ${COLORS.border}` }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: COLORS.slate300, margin: 0, letterSpacing: 1 }}>
          POLYMARKET SECTOR <SectorInfo title="Polymarket Sector" description="Prediction market intelligence. Scans 16 divisions across Polymarket for mispriced outcomes. Uses Kelly criterion for bet sizing and gladiator system for strategy selection." dataSource="Polymarket CLOB API (orderbooks) + Gamma API (market metadata)" output="Edge opportunities, wallet state, gladiator rankings per division, P&L tracking" role="Alternative alpha source. Prediction markets reveal crowd intelligence. Mispricing = profit opportunity when our edge score exceeds threshold." />
        </h1>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: conn.clob ? COLORS.green : COLORS.red }}></span>
            <span>CLOB</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: conn.gamma ? COLORS.green : COLORS.red }}></span>
            <span>GAMMA</span>
          </div>
          <span style={{ color: COLORS.slate500 }}>■</span>
          <span>{status?.divisions || 16} DIVISIONS</span>
          <span style={{ color: COLORS.slate500 }}>■</span>
          <span style={{ background: COLORS.card, padding: '4px 8px', borderRadius: 4, border: `1px solid ${COLORS.border}` }}>
            v{status?.version || '1.0.0'}
          </span>
        </div>
      </div>

      {error && (
        <div style={{ background: `${COLORS.red}15`, border: `1px solid ${COLORS.red}40`, borderRadius: 8, padding: 12, marginBottom: 16, color: COLORS.red, fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 32 }}>
        <KpiCard label="TOTAL BALANCE" value={`$${(wallet?.totalBalance || 0).toLocaleString()}`} />
        <KpiCard label="INVESTED" value={`$${(wallet?.totalInvested || 0).toLocaleString()}`} />
        <KpiCard label="REALIZED P&L" value={`$${wallet?.realizedPnL || 0}`} color={wallet?.realizedPnL && wallet.realizedPnL >= 0 ? COLORS.green : COLORS.red} />
        <KpiCard label="UNREALIZED P&L" value={`$${wallet?.unrealizedPnL || 0}`} color={wallet?.unrealizedPnL && wallet.unrealizedPnL >= 0 ? COLORS.green : COLORS.red} />
        <KpiCard label="ROI %" value={`${wallet?.roi || 0}%`} color={wallet?.roi && wallet.roi >= 0 ? COLORS.green : COLORS.red} />
        <KpiCard label="ACTIVE POSITIONS" value={String(wallet?.positionCount || 0)} />
      </div>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
        {(['overview', 'scanner', 'gladiators', 'wallet'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.5,
              background: activeTab === tab ? COLORS.blue : 'transparent',
              color: activeTab === tab ? '#fff' : COLORS.slate500,
              textTransform: 'uppercase',
              transition: 'all 0.2s',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* OVERVIEW Tab */}
      {activeTab === 'overview' && (
        <div>
          <h3 style={{ color: COLORS.slate400, fontSize: 11, fontWeight: 600, letterSpacing: 1, marginBottom: 16, textTransform: 'uppercase' }}>DIVISIONS</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {(status?.divisionList || Array.from({ length: 16 }, (_, i) => `DIV-${i + 1}`)).map((div: string) => {
              const divStat = wallet?.divisionStats?.find(d => d.division === div);
              return (
                <div key={div} style={{ background: COLORS.card, borderRadius: 8, padding: 12, border: `1px solid ${COLORS.border}` }}>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600, color: COLORS.slate300, marginBottom: 8 }}>{div}</div>
                  <div style={{ fontSize: 11, color: COLORS.slate500, lineHeight: 1.6 }}>
                    <div>Bal: <span style={{ color: COLORS.slate300, fontFamily: 'JetBrains Mono, monospace' }}>${(divStat?.balance || 0).toLocaleString()}</span></div>
                    <div>Pos: {divStat?.positionCount || 0}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SCANNER Tab */}
      {activeTab === 'scanner' && (
        <div>
          <button
            onClick={runScan}
            disabled={scanning}
            style={{
              padding: '10px 20px',
              borderRadius: 6,
              border: 'none',
              cursor: scanning ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.5,
              background: scanning ? COLORS.slate600 : COLORS.blue,
              color: '#fff',
              marginBottom: 20,
              textTransform: 'uppercase',
              opacity: scanning ? 0.6 : 1,
            }}
          >
            {scanning ? 'SCANNING...' : 'SCAN MARKETS'}
          </button>

          {scans.length === 0 && !scanning && (
            <p style={{ color: COLORS.slate500, fontSize: 12 }}>No scans yet. Initiate scan to find opportunities.</p>
          )}

          {scans.map((scan, i) => (
            <div key={i} style={{ marginBottom: 20 }}>
              {scan.opportunities.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ color: COLORS.slate500, fontSize: 11, fontWeight: 600, letterSpacing: 1, marginBottom: 12, textTransform: 'uppercase' }}>{scan.division} • {scan.totalMarkets} MARKETS</div>
                  {scan.opportunities.slice(0, 6).map((opp, j) => (
                    <div key={j} style={{ background: COLORS.card, borderRadius: 8, padding: 12, marginBottom: 8, border: `1px solid ${COLORS.border}` }}>
                      <div style={{ fontSize: 12, color: COLORS.slate300, marginBottom: 8, fontWeight: 500 }}>
                        {opp.market?.title?.slice(0, 70)}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 18, fontWeight: 700, color: COLORS.blue }}>
                          {opp.edgeScore}
                        </div>
                        <div style={{ fontSize: 11, color: COLORS.slate400, display: 'flex', gap: 12 }}>
                          <span>Mispricing {opp.mispricingScore}</span>
                          <span>Momentum {opp.momentumScore}</span>
                          <span>Liquidity ●</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, fontSize: 10 }}>
                        <span style={{ background: opp.riskLevel === 'LOW' ? `${COLORS.green}20` : opp.riskLevel === 'HIGH' ? `${COLORS.red}20` : `${COLORS.amber}20`, color: opp.riskLevel === 'LOW' ? COLORS.green : opp.riskLevel === 'HIGH' ? COLORS.red : COLORS.amber, padding: '2px 6px', borderRadius: 3, fontWeight: 600 }}>
                          {opp.riskLevel === 'LOW' ? '▲' : opp.riskLevel === 'HIGH' ? '▼' : '●'} {opp.riskLevel}
                        </span>
                        <span style={{ background: `${COLORS.blue}20`, color: COLORS.blue, padding: '2px 6px', borderRadius: 3, fontWeight: 600, textTransform: 'uppercase' }}>
                          {opp.recommendation}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* GLADIATORS Tab */}
      {activeTab === 'gladiators' && (
        <div>
          {gladiators.length === 0 ? (
            <p style={{ color: COLORS.slate500, fontSize: 12 }}>No gladiators deployed.</p>
          ) : (
            <div>
              <div style={{ overflowX: 'auto', marginBottom: 20 }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${COLORS.border}`, color: COLORS.slate500 }}>
                      <th style={{ padding: '12px 0', textAlign: 'left', fontWeight: 600, letterSpacing: 0.5 }}>DIVISION</th>
                      <th style={{ padding: '12px 0', textAlign: 'left', fontWeight: 600, letterSpacing: 0.5 }}>READINESS</th>
                      <th style={{ padding: '12px 0', textAlign: 'left', fontWeight: 600, letterSpacing: 0.5 }}>WIN RATE</th>
                      <th style={{ padding: '12px 0', textAlign: 'left', fontWeight: 600, letterSpacing: 0.5 }}>TOTAL BETS</th>
                      <th style={{ padding: '12px 0', textAlign: 'left', fontWeight: 600, letterSpacing: 0.5 }}>EXPERTISE</th>
                      <th style={{ padding: '12px 0', textAlign: 'left', fontWeight: 600, letterSpacing: 0.5 }}>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...gladiators].sort((a, b) => b.readinessScore - a.readinessScore).map(g => (
                      <tr key={g.id} style={{ borderBottom: `1px solid ${COLORS.border}`, color: COLORS.slate400 }}>
                        <td style={{ padding: '12px 0' }}>
                          <div style={{ color: COLORS.slate300, fontWeight: 600 }}>{g.division}</div>
                          <div style={{ fontSize: 10, color: COLORS.slate500 }}>{g.name}</div>
                        </td>
                        <td style={{ padding: '12px 0', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
                          <div style={{ marginBottom: 4, color: COLORS.blue }}>{g.readinessScore}</div>
                          <div style={{ width: 40, height: 3, background: COLORS.border, borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(g.readinessScore * 2, 100)}%`, height: '100%', background: COLORS.green }}></div>
                          </div>
                        </td>
                        <td style={{ padding: '12px 0', fontFamily: 'JetBrains Mono, monospace' }}>{g.winRate}</td>
                        <td style={{ padding: '12px 0', fontFamily: 'JetBrains Mono, monospace' }}>{g.totalBets}</td>
                        <td style={{ padding: '12px 0', fontFamily: 'JetBrains Mono, monospace' }}>{g.divisionExpertise}</td>
                        <td style={{ padding: '12px 0' }}>
                          <span style={{ display: 'inline-block', background: g.isLive ? `${COLORS.green}20` : `${COLORS.purple}20`, color: g.isLive ? COLORS.green : COLORS.purple, padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>
                            {g.isLive ? '● LIVE' : '● IDLE'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* WALLET Tab */}
      {activeTab === 'wallet' && wallet && (
        <div>
          <h3 style={{ color: COLORS.slate400, fontSize: 11, fontWeight: 600, letterSpacing: 1, marginBottom: 16, textTransform: 'uppercase' }}>DIVISION BREAKDOWN</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}`, color: COLORS.slate500 }}>
                  <th style={{ padding: '12px 0', textAlign: 'left', fontWeight: 600, letterSpacing: 0.5 }}>DIVISION</th>
                  <th style={{ padding: '12px 0', textAlign: 'right', fontWeight: 600, letterSpacing: 0.5 }}>BALANCE</th>
                  <th style={{ padding: '12px 0', textAlign: 'right', fontWeight: 600, letterSpacing: 0.5 }}>INVESTED</th>
                  <th style={{ padding: '12px 0', textAlign: 'right', fontWeight: 600, letterSpacing: 0.5 }}>P&L</th>
                  <th style={{ padding: '12px 0', textAlign: 'right', fontWeight: 600, letterSpacing: 0.5 }}>POSITIONS</th>
                  <th style={{ padding: '12px 0', textAlign: 'right', fontWeight: 600, letterSpacing: 0.5 }}>MAX DRAWDOWN</th>
                </tr>
              </thead>
              <tbody>
                {(wallet.divisionStats || []).map((d: DivisionStat) => (
                  <tr key={d.division} style={{ borderBottom: `1px solid ${COLORS.border}`, color: COLORS.slate400 }}>
                    <td style={{ padding: '12px 0', fontWeight: 600, color: COLORS.slate300 }}>{d.division}</td>
                    <td style={{ padding: '12px 0', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>${d.balance.toLocaleString()}</td>
                    <td style={{ padding: '12px 0', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>${d.invested.toLocaleString()}</td>
                    <td style={{ padding: '12px 0', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: d.realizedPnL >= 0 ? COLORS.green : COLORS.red }}>
                      ${d.realizedPnL}
                    </td>
                    <td style={{ padding: '12px 0', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{d.positionCount}</td>
                    <td style={{ padding: '12px 0', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{d.maxDrawdown}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, color = COLORS.blue }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: COLORS.card, borderRadius: 8, padding: 12, border: `1px solid ${COLORS.border}` }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: COLORS.slate500, marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 16, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
