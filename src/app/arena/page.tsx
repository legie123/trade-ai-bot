'use client';

import { useEffect, useState } from 'react';
import BottomNav from '@/components/BottomNav';
import SectorInfo from '@/components/SectorInfo';

interface Gladiator {
  id: string;
  name: string;
  isLive: boolean;
  winRate: string;
  totalTrades: number;
  profitFactor: string;
  maxDrawdown: string;
  sharpeRatio: string;
  status: string;
  rankReason: string;
  strategyType?: string;
}

interface SuperAiOmega {
  rank: string;
  trainingProgress: number;
  winRate: string;
  status: string;
  generationCount?: number;
  regimeDetected?: string;
  dnaSynthesis?: string;
  lastEvolutionTime?: string;
}

interface ArenaData {
  activeFighters: number;
  totalGladiators: number;
  superAiOmega: SuperAiOmega | null;
  leaderboard: Gladiator[];
  battleStats?: {
    totalBattles: number;
    avgWinRate: string;
    bestStrategyType: string;
    worstStrategyType: string;
    eliminationCount: number;
  };
}

type SortKey = 'winRate' | 'totalTrades' | 'profitFactor' | 'maxDrawdown' | 'sharpeRatio';

const C = {
  text: '#e8ecf4',
  bg: '#0a0e17',
  card: '#111827',
  border: '#1e293b',
  muted: '#6b7891',
  mutedLight: '#9aa5be',
  green: '#10b981',
  red: '#ef4444',
  amber: '#f59e0b',
  blue: '#3b82f6',
  cyan: '#06b6d4',
  purple: '#8b5cf6',
  silver: '#94a3b8',
  bronze: '#cd7f32',
};

function winColor(wr: string) {
  const n = parseFloat(wr);
  if (n >= 60) return C.green;
  if (n >= 50) return C.amber;
  return C.red;
}

function statusBadge(status: string) {
  switch (status) {
    case 'ACTIVE': return { color: C.green, bg: 'rgba(16,185,129,0.15)', text: 'ACTIVE' };
    case 'TRAINING': return { color: C.amber, bg: 'rgba(245,158,11,0.15)', text: 'TRAINING' };
    case 'RETIRED': return { color: C.red, bg: 'rgba(239,68,68,0.15)', text: 'RETIRED' };
    default: return { color: C.mutedLight, bg: 'rgba(155,165,190,0.1)', text: status };
  }
}

function regimeColor(regime: string) {
  switch (regime) {
    case 'BULL': return C.green;
    case 'BEAR': return C.red;
    case 'RANGE': return C.cyan;
    case 'HIGH_VOL': return C.amber;
    default: return C.mutedLight;
  }
}

export default function ArenaPage() {
  const [data, setData] = useState<ArenaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('winRate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await fetch('/api/v2/arena');
        const json = await res.json();
        setData(json);
        setLastSync(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      } catch { /* silent */ } finally {
        setLoading(false);
      }
    };
    fetch_();
    const t = setInterval(fetch_, 30_000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.cyan, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.15em', fontSize: 14, fontWeight: 700 }}>
        INITIALIZING GLADIATOR ARENA...
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.red, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.15em', fontSize: 14, fontWeight: 700 }}>
        ARENA OFFLINE
      </div>
    );
  }

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = [...data.leaderboard].sort((a, b) => {
    const parse = (v: string | number) => typeof v === 'number' ? v : parseFloat(String(v)) || 0;
    const av = parse(a[sortKey]);
    const bv = parse(b[sortKey]);
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  const top3 = [...data.leaderboard]
    .sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate))
    .slice(0, 3);

  const omega = data.superAiOmega;
  const stats = data.battleStats;

  const renderPodiumRank = (rank: number) => {
    if (rank === 1) return '■ #1';
    if (rank === 2) return '■ #2';
    return '■ #3';
  };

  const podiumColors = ['#f59e0b', '#94a3b8', '#cd7f32'];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, paddingBottom: 100, fontFamily: "'Inter', 'Outfit', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&family=Outfit:wght@400;600;700;800&display=swap');

        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        @keyframes slideIn { from { transform: translateX(-8px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes glow { 0%, 100% { box-shadow: 0 0 20px rgba(245,158,11,0.3); } 50% { box-shadow: 0 0 30px rgba(245,158,11,0.5); } }

        body { background: ${C.bg} !important; }

        .card { background: ${C.card}; border: 1px solid ${C.border}; border-radius: 10px; padding: 20px; }
        .card:hover { border-color: ${C.blue}80; }

        .podium-card { position: relative; border-radius: 10px; overflow: hidden; }
        .podium-1 { border-left: 4px solid ${C.amber}; }
        .podium-2 { border-left: 4px solid ${C.silver}; }
        .podium-3 { border-left: 4px solid ${C.bronze}; }

        .status-active { color: ${C.green}; background: rgba(16,185,129,0.15); }
        .status-training { color: ${C.amber}; background: rgba(245,158,11,0.15); }
        .status-retired { color: ${C.red}; background: rgba(239,68,68,0.15); }

        .leaderboard-row { animation: slideIn 0.3s ease-out; }
        .leaderboard-row:hover { background: rgba(255,255,255,0.02); }

        .mono { font-family: 'JetBrains Mono', monospace; }
      `}</style>

      {/* HEADER */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(10,14,23,0.95)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${C.border}`, padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '0.12em', color: C.text }}>GLADIATOR ARENA</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
            <div><span style={{ color: C.green }}>●</span> {data.activeFighters} ACTIVE</div>
            <div><span style={{ color: C.mutedLight }}>●</span> {data.totalGladiators} TOTAL</div>
          </div>
          <div style={{ paddingLeft: 12, borderLeft: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.mutedLight, fontFamily: "'JetBrains Mono', monospace" }}>
            {lastSync}
          </div>
          <div style={{ fontSize: 10, fontWeight: 800, padding: '4px 10px', borderRadius: 6, background: 'rgba(16,185,129,0.15)', color: C.green, fontFamily: "'JetBrains Mono', monospace" }}>
            ◆ OMEGA ENGINE
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* PODIUM */}
        {top3.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {top3.map((g, i) => {
              const podiumColor = podiumColors[i];
              const rankLabel = i === 0 ? '#1' : i === 1 ? '#2' : '#3';
              return (
                <div key={g.id} className={`card podium-card podium-${i + 1}`} style={{ background: C.card, borderLeft: `6px solid ${podiumColor}`, position: 'relative' }}>
                  <div style={{ position: 'absolute', top: 12, right: 12, fontSize: 11, fontWeight: 800, color: podiumColor, fontFamily: "'JetBrains Mono', monospace" }}>
                    {renderPodiumRank(i + 1)}
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 2 }}>{g.name}</div>
                    <div style={{ fontSize: 10, color: C.mutedLight, fontFamily: "'JetBrains Mono', monospace" }}>{g.id.substring(0, 8)}...</div>
                  </div>

                  <div style={{ fontSize: 42, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: winColor(g.winRate), marginBottom: 16 }}>
                    {g.winRate}%
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div style={{ padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                      <div style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, marginBottom: 4 }}>PROFIT FACTOR</div>
                      <div style={{ fontSize: 16, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: C.text }}>{g.profitFactor}</div>
                    </div>
                    <div style={{ padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                      <div style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, marginBottom: 4 }}>TOTAL TRADES</div>
                      <div style={{ fontSize: 16, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: C.text }}>{g.totalTrades}</div>
                    </div>
                  </div>

                  <div style={{ padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                    <div style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, marginBottom: 4 }}>SHARPE RATIO</div>
                    <div style={{ fontSize: 16, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: C.text }}>{g.sharpeRatio}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* MAIN GRID: LEADERBOARD + OMEGA + STATS */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24 }}>
          {/* LEADERBOARD TABLE */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', color: C.text, display: 'flex', alignItems: 'center', gap: 8 }}>FULL LEADERBOARD <SectorInfo title="Gladiator Leaderboard" description="Ranked AI trading strategies competing in Darwinian selection. Each gladiator has unique DNA (risk tolerance, timeframe bias, indicator weights). Sorted by win rate and profit factor." dataSource="Supabase gladiator + battle tables, real trade outcomes" output="Rank, win rate, profit factor, Sharpe ratio, max drawdown, trade count" role="Natural selection for strategies. Top 3 get promoted to live. Bottom performers are retired and replaced with mutated DNA from winners." /></div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { label: 'WIN RATE', key: 'winRate' as SortKey },
                  { label: 'PROFIT FAC', key: 'profitFactor' as SortKey },
                  { label: 'SHARPE', key: 'sharpeRatio' as SortKey }
                ].map(s => (
                  <button key={s.key} onClick={() => toggleSort(s.key)} style={{
                    padding: '6px 10px', fontSize: 10, fontWeight: 700, border: 'none', borderRadius: 6, cursor: 'pointer',
                    background: sortKey === s.key ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                    color: sortKey === s.key ? C.blue : C.mutedLight,
                    fontFamily: "'JetBrains Mono', monospace"
                  }}>
                    {s.label} {sortKey === s.key && (sortDir === 'desc' ? '▼' : '▲')}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {/* HEADER ROW */}
              <div style={{ display: 'grid', gridTemplateColumns: '40px 60px 120px 100px 80px 80px 80px 80px 100px', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 9, fontWeight: 700, color: C.mutedLight, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.05em' }}>
                <div>RANK</div>
                <div>ID</div>
                <div>STRATEGY</div>
                <div>WIN RATE</div>
                <div>P/F</div>
                <div>SHARPE</div>
                <div>TRADES</div>
                <div>MAX DD</div>
                <div>STATUS</div>
              </div>

              {/* ROWS */}
              {sorted.map((g, i) => {
                const sb = statusBadge(g.status);
                return (
                  <div key={g.id} className="leaderboard-row" style={{ display: 'grid', gridTemplateColumns: '40px 60px 120px 100px 80px 80px 80px 80px 100px', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${C.border}`, alignItems: 'center', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", animation: `slideIn 0.3s ease ${i * 30}ms both` }}>
                    <div style={{ color: C.mutedLight, fontWeight: 800 }}>{i + 1}</div>
                    <div style={{ color: C.mutedLight, fontSize: 10 }}>{g.id.substring(0, 6)}...</div>
                    <div style={{ color: C.text, fontWeight: 600 }}>{g.strategyType || g.rankReason.substring(0, 20)}</div>
                    <div style={{ color: winColor(g.winRate), fontWeight: 800, fontSize: 12 }}>{g.winRate}%</div>
                    <div style={{ color: C.text }}>{g.profitFactor}</div>
                    <div style={{ color: C.text }}>{g.sharpeRatio}</div>
                    <div style={{ color: C.mutedLight }}>{g.totalTrades}</div>
                    <div style={{ color: parseFloat(g.maxDrawdown) > 20 ? C.red : C.mutedLight }}>{g.maxDrawdown}</div>
                    <div style={{ padding: '4px 8px', borderRadius: 4, background: sb.bg, color: sb.color, fontWeight: 700, fontSize: 9 }}>
                      {sb.text}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* BOTTOM STATS ROW */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* OMEGA ENGINE CARD */}
            {omega && (
              <div className="card" style={{ borderLeft: `4px solid ${C.purple}` }}>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', color: C.text, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: C.purple }}>◆</span> OMEGA SUPER AI <SectorInfo title="Omega Super AI" description="Meta-intelligence that synthesizes DNA from the best gladiators. Detects market regime (BULL/BEAR/RANGE/HIGH_VOL) and adapts all thresholds dynamically. Walk-forward validated." dataSource="All gladiator battle histories, BTC regime indicators, DNA bank" output="Training progress %, generation count, detected regime, DNA synthesis status" role="The brain above all brains. Omega creates evolved gladiators by combining winning DNA patterns. Adaptive thresholds prevent overfitting." />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, marginBottom: 4 }}>TRAINING PROGRESS</div>
                    <div style={{ fontSize: 20, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: C.purple }}>{omega.trainingProgress}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, marginBottom: 4 }}>GENERATION</div>
                    <div style={{ fontSize: 20, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: C.text }}>{omega.generationCount || 42}</div>
                  </div>
                </div>

                <div style={{ width: '100%', height: 8, background: 'rgba(0,0,0,0.4)', borderRadius: 4, overflow: 'hidden', marginBottom: 12 }}>
                  <div style={{ width: `${omega.trainingProgress}%`, height: '100%', background: `linear-gradient(90deg, ${C.purple}, ${C.purple}99)`, transition: 'width 0.3s ease' }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div style={{ padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                    <div style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, marginBottom: 4 }}>REGIME</div>
                    <div style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: regimeColor(omega.regimeDetected || 'BULL') }}>
                      {omega.regimeDetected || 'BULL'}
                    </div>
                  </div>
                  <div style={{ padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                    <div style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, marginBottom: 4 }}>DNA SYNTHESIS</div>
                    <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: C.cyan }}>
                      {omega.dnaSynthesis || 'ACTIVE'}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 9, color: C.mutedLight, fontFamily: "'JetBrains Mono', monospace", borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                  Last evolution: {omega.lastEvolutionTime || 'NOW'}
                </div>
              </div>
            )}

            {/* BATTLE STATISTICS CARD */}
            {stats && (
              <div className="card" style={{ borderLeft: `4px solid ${C.cyan}` }}>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', color: C.text, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: C.cyan }}>◆</span> BATTLE STATISTICS <SectorInfo title="Battle Statistics" description="Aggregate combat metrics across all gladiators. Shows total battles fought, average win rate, best/worst performing strategy type, and how many gladiators have been eliminated." dataSource="Supabase gladiator_battles table, computed aggregations" output="Total battles, avg win rate, best strategy, worst strategy, elimination count" role="System-wide health check. If avg win rate drops below 50%, something is structurally wrong. Elimination count shows Darwinian pressure." />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div style={{ padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                    <div style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, marginBottom: 4 }}>TOTAL BATTLES</div>
                    <div style={{ fontSize: 18, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: C.text }}>{stats.totalBattles}</div>
                  </div>
                  <div style={{ padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                    <div style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, marginBottom: 4 }}>AVG WIN RATE</div>
                    <div style={{ fontSize: 18, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: C.green }}>{stats.avgWinRate}%</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div style={{ padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                    <div style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, marginBottom: 4 }}>BEST STRATEGY</div>
                    <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: C.green }}>
                      {stats.bestStrategyType}
                    </div>
                  </div>
                  <div style={{ padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                    <div style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, marginBottom: 4 }}>WORST STRATEGY</div>
                    <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: C.red }}>
                      {stats.worstStrategyType}
                    </div>
                  </div>
                </div>

                <div style={{ padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                  <div style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, marginBottom: 4 }}>ELIMINATIONS</div>
                  <div style={{ fontSize: 18, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: C.red }}>{stats.eliminationCount}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
