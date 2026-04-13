'use client';

import { useState, useEffect, useCallback } from 'react';

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

  useEffect(() => { fetchData(); }, [fetchData]);

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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#0a0a0f', color: '#8b5cf6' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔮</div>
          <div style={{ fontSize: 18 }}>Loading Polymarket Sector...</div>
        </div>
      </div>
    );
  }

  const conn = status?.connection || {};

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#e2e8f0', fontFamily: 'system-ui, -apple-system, sans-serif', padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#8b5cf6', margin: 0 }}>
            🔮 Polymarket Sector
          </h1>
          <p style={{ color: '#64748b', margin: '4px 0 0' }}>
            {status?.divisions || 16} Divisions • {gladiators.length} Gladiators • v{status?.version || '1.0.0'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ padding: '4px 12px', borderRadius: 12, fontSize: 13, background: conn.clob ? '#064e3b' : '#7f1d1d', color: conn.clob ? '#34d399' : '#fca5a5' }}>
            CLOB {conn.clob ? '✓' : '✗'}
          </span>
          <span style={{ padding: '4px 12px', borderRadius: 12, fontSize: 13, background: conn.gamma ? '#064e3b' : '#7f1d1d', color: conn.gamma ? '#34d399' : '#fca5a5' }}>
            Gamma {conn.gamma ? '✓' : '✗'}
          </span>
        </div>
      </div>

      {error && (
        <div style={{ background: '#7f1d1d', border: '1px solid #991b1b', borderRadius: 8, padding: 12, marginBottom: 16, color: '#fca5a5' }}>
          {error}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid #1e293b', paddingBottom: 8 }}>
        {(['overview', 'scanner', 'gladiators', 'wallet'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 20px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              background: activeTab === tab ? '#8b5cf6' : 'transparent',
              color: activeTab === tab ? '#fff' : '#64748b',
              textTransform: 'uppercase',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
            <StatCard label="Total Balance" value={`$${wallet?.totalBalance?.toLocaleString() || '0'}`} color="#8b5cf6" />
            <StatCard label="Invested" value={`$${wallet?.totalInvested?.toLocaleString() || '0'}`} color="#3b82f6" />
            <StatCard label="Realized P&L" value={`$${wallet?.realizedPnL || 0}`} color={wallet?.realizedPnL && wallet.realizedPnL >= 0 ? '#34d399' : '#ef4444'} />
            <StatCard label="Positions" value={String(wallet?.positionCount || 0)} color="#f59e0b" />
            <StatCard label="Gladiators" value={String(gladiators.length)} color="#8b5cf6" />
            <StatCard label="Live" value={String(status?.gladiators?.live || 0)} color="#34d399" />
          </div>

          <h3 style={{ color: '#94a3b8', fontSize: 16, marginBottom: 12 }}>Division List</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
            {(status?.divisionList || []).map((div: string) => (
              <div key={div} style={{ background: '#1e1e2e', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#cbd5e1', border: '1px solid #2d2d3f' }}>
                {div}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scanner Tab */}
      {activeTab === 'scanner' && (
        <div>
          <button
            onClick={runScan}
            disabled={scanning}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              cursor: scanning ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 600,
              background: scanning ? '#374151' : '#8b5cf6',
              color: '#fff',
              marginBottom: 20,
            }}
          >
            {scanning ? '⏳ Scanning...' : '🔍 Scan Markets'}
          </button>

          {scans.length === 0 && !scanning && (
            <p style={{ color: '#64748b' }}>No scans yet. Click scan to find opportunities.</p>
          )}

          {scans.map((scan, i) => (
            <div key={i} style={{ background: '#1e1e2e', borderRadius: 12, padding: 20, marginBottom: 16, border: '1px solid #2d2d3f' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ color: '#8b5cf6', margin: 0 }}>{scan.division}</h3>
                <span style={{ color: '#64748b', fontSize: 13 }}>{scan.totalMarkets} markets scanned</span>
              </div>
              {scan.opportunities.length === 0 ? (
                <p style={{ color: '#475569', fontSize: 14 }}>No opportunities above threshold.</p>
              ) : (
                scan.opportunities.slice(0, 5).map((opp, j) => (
                  <div key={j} style={{ background: '#0f0f1a', borderRadius: 8, padding: 12, marginBottom: 8, borderLeft: `3px solid ${opp.edgeScore >= 60 ? '#34d399' : opp.edgeScore >= 45 ? '#f59e0b' : '#64748b'}` }}>
                    <div style={{ fontSize: 14, color: '#e2e8f0', marginBottom: 4 }}>{opp.market?.title?.slice(0, 80)}</div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#94a3b8' }}>
                      <span>Edge: <b style={{ color: '#8b5cf6' }}>{opp.edgeScore}</b></span>
                      <span>Mispricing: {opp.mispricingScore}</span>
                      <span>Momentum: {opp.momentumScore}</span>
                      <span style={{ color: opp.riskLevel === 'LOW' ? '#34d399' : opp.riskLevel === 'HIGH' ? '#ef4444' : '#f59e0b' }}>
                        Risk: {opp.riskLevel}
                      </span>
                      <span>→ {opp.recommendation}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}

      {/* Gladiators Tab */}
      {activeTab === 'gladiators' && (
        <div>
          {gladiators.length === 0 ? (
            <p style={{ color: '#64748b' }}>No gladiators spawned yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {gladiators.map(g => (
                <div key={g.id} style={{ background: '#1e1e2e', borderRadius: 12, padding: 16, border: '1px solid #2d2d3f', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 15 }}>{g.division}</div>
                    <div style={{ color: '#64748b', fontSize: 13 }}>{g.name}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#94a3b8' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ color: '#8b5cf6', fontWeight: 700, fontSize: 18 }}>{g.readinessScore}</div>
                      <div>Readiness</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontWeight: 600 }}>{g.winRate}</div>
                      <div>Win Rate</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontWeight: 600 }}>{g.totalBets}</div>
                      <div>Bets</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontWeight: 600 }}>{g.divisionExpertise}</div>
                      <div>Expertise</div>
                    </div>
                    <span style={{
                      padding: '4px 10px',
                      borderRadius: 8,
                      fontSize: 11,
                      fontWeight: 600,
                      background: g.isLive ? '#064e3b' : '#1e1b4b',
                      color: g.isLive ? '#34d399' : '#a78bfa',
                      alignSelf: 'center',
                    }}>
                      {g.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wallet Tab */}
      {activeTab === 'wallet' && wallet && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
            <StatCard label="Total Balance" value={`$${wallet.totalBalance.toLocaleString()}`} color="#8b5cf6" />
            <StatCard label="Total Invested" value={`$${wallet.totalInvested}`} color="#3b82f6" />
            <StatCard label="Realized P&L" value={`$${wallet.realizedPnL}`} color={wallet.realizedPnL >= 0 ? '#34d399' : '#ef4444'} />
            <StatCard label="Unrealized P&L" value={`$${wallet.unrealizedPnL}`} color={wallet.unrealizedPnL >= 0 ? '#34d399' : '#ef4444'} />
            <StatCard label="ROI" value={`${wallet.roi}%`} color={wallet.roi >= 0 ? '#34d399' : '#ef4444'} />
            <StatCard label="Positions" value={String(wallet.positionCount)} color="#f59e0b" />
          </div>

          <h3 style={{ color: '#94a3b8', fontSize: 16, marginBottom: 12 }}>Division Balances</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {(wallet.divisionStats || []).map((d: DivisionStat) => (
              <div key={d.division} style={{ background: '#1e1e2e', borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #2d2d3f' }}>
                <span style={{ color: '#cbd5e1', fontWeight: 600, fontSize: 14 }}>{d.division}</span>
                <div style={{ display: 'flex', gap: 20, fontSize: 13, color: '#94a3b8' }}>
                  <span>Bal: ${d.balance}</span>
                  <span>Inv: ${d.invested}</span>
                  <span style={{ color: d.realizedPnL >= 0 ? '#34d399' : '#ef4444' }}>P&L: ${d.realizedPnL}</span>
                  <span>Pos: {d.positionCount}</span>
                  <span>DD: {d.maxDrawdown}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#1e1e2e', borderRadius: 12, padding: 16, border: '1px solid #2d2d3f' }}>
      <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontSize: 22, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
