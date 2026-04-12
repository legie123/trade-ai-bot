'use client';

import { useEffect, useState } from 'react';
import BottomNav from '@/components/BottomNav';

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
}

interface SuperAiOmega {
  rank: string;
  trainingProgress: number;
  winRate: string;
  status: string;
}

interface ArenaData {
  activeFighters: number;
  superAiOmega: SuperAiOmega | null;
  leaderboard: Gladiator[];
}

type SortKey = 'winRate' | 'totalTrades' | 'profitFactor' | 'maxDrawdown' | 'sharpeRatio';

const C = {
  text: '#e8ecf4',
  muted: '#6b7891',
  mutedLight: '#9aa5be',
  green: '#00e676',
  red: '#ff3d57',
  blue: '#29b6f6',
  yellow: '#ffd740',
  purple: '#c084fc',
};

function winColor(wr: string) {
  const n = parseFloat(wr);
  if (n >= 60) return C.green;
  if (n >= 45) return C.yellow;
  return C.red;
}

function statusStyle(status: string) {
  switch (status) {
    case 'LIVE':      return { color: C.green,      bg: 'rgba(0,230,118,0.15)',  border: \`\${C.green}50\` };
    case 'SHADOW':    return { color: C.blue,       bg: 'rgba(41,182,246,0.15)',   border: \`\${C.blue}50\` };
    case 'STANDBY':   return { color: C.mutedLight, bg: 'rgba(155,165,190,0.1)', border: 'rgba(155,165,190,0.3)' };
    case 'ELIMINATED':return { color: C.red,        bg: 'rgba(255,61,87,0.15)',    border: \`\${C.red}50\` };
    default:          return { color: C.mutedLight, bg: 'transparent', border: 'rgba(255,255,255,0.1)' };
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
    const t = setInterval(fetch_, 10_000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <div style={{ background: '#050609', minHeight: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center', color: C.blue, fontFamily: 'monospace', letterSpacing: '0.2em' }}>
        LOADING ARENA...
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ background: '#050609', minHeight: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center', color: C.red, fontFamily: 'monospace', letterSpacing: '0.2em' }}>
        FAILED TO LOAD ARENA
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

  const top3 = [...data.leaderboard].sort((a, b) =>
    parseFloat(b.winRate) - parseFloat(a.winRate)).slice(0, 3);

  const omega = data.superAiOmega;

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at 50% 0%, #151a2d, #050609)', color: C.text, paddingBottom: 80,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Outfit", "Inter", sans-serif' }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap');
        
        @keyframes pulseGlow { 0%,100%{opacity:1; transform: scale(1)} 50%{opacity:.6; transform: scale(1.02)} }
        @keyframes slideRightCard { from{transform:translateX(-10px); opacity:0} to{transform:translateX(0); opacity:1} }
        @keyframes stripeScroll { 0% { background-position: 0 0; } 100% { background-position: 40px 0; } }

        .glass-card {
          background: rgba(18, 22, 38, 0.55);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.04);
          border-radius: 16px;
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.2);
        }
        
        .fighter-plate {
           background: rgba(12, 15, 26, 0.4);
           border: 1px solid rgba(255,255,255,0.03);
           border-radius: 12px;
           padding: 16px 20px;
           transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .fighter-plate:hover {
           background: rgba(25, 30, 45, 0.6);
           border-color: rgba(41,182,246,0.4);
           transform: translateX(6px);
           box-shadow: -4px 0 15px rgba(41,182,246,0.15);
        }

        .stripe-bg {
          background-image: repeating-linear-gradient(
            -45deg,
            rgba(255,255,255,0.1) 0,
            rgba(255,255,255,0.1) 10px,
            transparent 10px,
            transparent 20px
          );
          background-size: 28px 28px;
          animation: stripeScroll 2s linear infinite;
        }
      `}</style>

      {/* ── TOP NAV ───────────────────────────────── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(5, 6, 9, 0.8)',
        backdropFilter: 'blur(20px)', borderBottom: \`1px solid rgba(255,255,255,0.05)\`, padding: '14px 24px',
        display: 'flex', alignItems: 'center', gap: 20 }}>
        
        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.15em', color: C.text, textShadow: '0 0 10px rgba(255,255,255,0.2)' }}>
          ARENA<span style={{ color: C.red }}>.AI</span>
        </span>
        
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
        
        <div style={{ display: 'flex', gap: 16, fontSize: 12, fontWeight: 800, fontFamily: 'monospace' }}>
           <div><span style={{ color: C.green, textShadow: \`0 0 10px \${C.green}80\` }}>{data.activeFighters}</span> LIVE</div>
           <div style={{ color: C.mutedLight }}><span>{data.leaderboard.length}</span> TOTAL</div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.02)', padding: '6px 12px', borderRadius: 8 }}>
            <span style={{ fontSize: 11, color: C.mutedLight, fontWeight: 600, letterSpacing: '0.05em' }}>
               \${lastSync}
            </span>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: C.green, boxShadow: \`0 0 10px \${C.green}\`,
              animation: 'pulseGlow 2s infinite',
            }} />
        </div>
      </div>

      <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* ── TOP 3 PODIUM ──────────────────────────── */}
        {top3.length > 0 && (
          <div className="glass-card" style={{ padding: '30px 24px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.2em', color: C.text, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 4, height: 14, background: C.yellow, borderRadius: 2 }} />
              ELITE STRIKE TEAM (TOP 3)
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: \`repeat(\${top3.length}, 1fr)\`, gap: 20 }}>
              {top3.map((g, i) => {
                const ss = statusStyle(g.status);
                const isFirst = i === 0;
                const rankColor = isFirst ? '#FFD700' : i === 1 ? '#C0C0C0' : '#CD7F32';
                
                return (
                  <div key={g.id} style={{ 
                    position: 'relative', padding: isFirst ? '28px' : '20px',
                    margin: isFirst ? '-8px 0 0 0' : '0', // Pop slightly up
                    background: isFirst ? 'rgba(25, 30, 45, 0.6)' : 'rgba(12, 15, 26, 0.4)',
                    border: \`1px solid \${isFirst ? \`\${rankColor}80\` : 'rgba(255,255,255,0.05)'}\`,
                    borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 12,
                    boxShadow: isFirst ? \`0 10px 40px \${rankColor}20\` : 'none',
                    animation: isFirst ? 'pulseGlow 3s infinite' : 'none'
                  }}>
                    {/* Rank Badge */}
                    <div style={{ position: 'absolute', top: -14, left: 20, background: 'rgba(5, 6, 9, 0.9)', border: \`1px solid \${rankColor}\`, padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 800, color: rankColor, boxShadow: \`0 0 15px \${rankColor}60\` }}>
                      RANK {i + 1}
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: isFirst ? 10 : 0 }}>
                       <div style={{ fontSize: isFirst ? 20 : 16, fontWeight: 800, color: C.text, letterSpacing: '0.02em', whiteSpace: 'nowrap', overflow: 'hidden' }}>{g.name}</div>
                       <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 6, color: ss.color, background: ss.bg, border: \`1px solid \${ss.border}\` }}>
                          {g.status}
                       </span>
                    </div>

                    <div style={{ fontSize: isFirst ? 36 : 28, fontWeight: 800, fontFamily: 'monospace', color: winColor(g.winRate), textShadow: \`0 0 20px \${winColor(g.winRate)}50\` }}>
                      {g.winRate}%
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: 8 }}>
                       <div>
                         <div style={{ fontSize: 10, color: C.mutedLight, fontWeight: 700, letterSpacing: '0.05em' }}>PROFIT FAC</div>
                         <div style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 800, color: C.text }}>{g.profitFactor}</div>
                       </div>
                       <div>
                         <div style={{ fontSize: 10, color: C.mutedLight, fontWeight: 700, letterSpacing: '0.05em' }}>TRADES</div>
                         <div style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 800, color: C.text }}>{g.totalTrades}</div>
                       </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── OMEGA PROGRESS CYBERNETIC BAR ─────────── */}
        {omega && (
          <div className="glass-card" style={{ padding: '24px', border: \`1px solid \${C.purple}50\`, boxShadow: \`0 0 20px \${C.purple}15\` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 12, height: 12, background: C.purple, borderRadius: '50%', boxShadow: \`0 0 10px \${C.purple}\`, animation: 'pulseGlow 1.5s infinite' }} />
                <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.2em', color: C.text }}>SUPER AI OMEGA</div>
                <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: \`\${C.purple}20\`, color: C.purple, border: \`1px solid \${C.purple}50\`, fontWeight: 800 }}>
                  {omega.status}
                </span>
              </div>
              <div style={{ fontSize: 16, fontFamily: 'monospace', fontWeight: 800, color: winColor(omega.winRate) }}>
                {omega.winRate}% WR
              </div>
            </div>
            
            {/* Cyberpunk Progress Bar */}
            <div style={{ position: 'relative', width: '100%', height: 16, background: 'rgba(0,0,0,0.4)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden' }}>
              <div className="stripe-bg" style={{ 
                position: 'absolute', top: 0, left: 0, height: '100%',
                width: \`\${omega.trainingProgress}%\`, 
                background: \`linear-gradient(90deg, \${C.purple}88, \${C.purple})\`,
                transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
              }}>
                <div className="stripe-bg" style={{ width: '100%', height: '100%' }} />
              </div>
            </div>
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', fontSize: 12, color: C.purple, fontWeight: 800, fontFamily: 'monospace' }}>
               {omega.trainingProgress}% TRAINED
            </div>
          </div>
        )}

        {/* ── FIGHTER LEADERBOARD PLATES ───────────────── */}
        <div className="glass-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
             <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.2em', color: C.text, display: 'flex', alignItems: 'center', gap: 10 }}>
               <span style={{ width: 4, height: 14, background: C.blue, borderRadius: 2 }} />
               GLOBAL LEADERBOARD
             </div>
             
             {/* Sorters */}
             <div style={{ display: 'flex', gap: 10, background: 'rgba(0,0,0,0.2)', padding: '6px', borderRadius: 8 }}>
               {[
                  { label: 'WIN RATE', key: 'winRate' as SortKey },
                  { label: 'PROFIT FAC', key: 'profitFactor' as SortKey },
                  { label: 'MAX DD', key: 'maxDrawdown' as SortKey }
               ].map(s => (
                 <button key={s.label} onClick={() => toggleSort(s.key)} style={{
                   background: sortKey === s.key ? 'rgba(41,182,246,0.15)' : 'transparent',
                   border: 'none', color: sortKey === s.key ? C.blue : C.mutedLight,
                   padding: '6px 12px', fontSize: 10, fontWeight: 800, borderRadius: 6, cursor: 'pointer', transition: 'all 0.2s'
                 }}>
                   {s.label} {sortKey === s.key ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                 </button>
               ))}
             </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
             {sorted.map((g, i) => {
               const ss = statusStyle(g.status);
               return (
                 <div key={g.id} className="fighter-plate" style={{ display: 'flex', alignItems: 'center', gap: 20, animation: \`slideRightCard 0.3s ease \${i * 30}ms both\` }}>
                   
                   <div style={{ minWidth: 24, fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: C.mutedLight }}>
                     #{i + 1}
                   </div>
                   
                   <div style={{ flex: 1, minWidth: 200 }}>
                     <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                       <span style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{g.name}</span>
                       <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4, color: ss.color, background: ss.bg, border: \`1px solid \${ss.border}\` }}>
                          {g.status}
                       </span>
                     </div>
                     <div style={{ fontSize: 11, color: C.mutedLight, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {g.rankReason}
                     </div>
                   </div>

                   <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 80 }}>
                         <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '0.05em' }}>WIN RATE</div>
                         <div style={{ fontSize: 18, fontFamily: 'monospace', fontWeight: 800, color: winColor(g.winRate) }}>{g.winRate}%</div>
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 60 }}>
                         <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '0.05em' }}>P/F</div>
                         <div style={{ fontSize: 15, fontFamily: 'monospace', fontWeight: 800, color: C.text }}>{g.profitFactor}</div>
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 60 }}>
                         <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '0.05em' }}>TRADES</div>
                         <div style={{ fontSize: 15, fontFamily: 'monospace', fontWeight: 800, color: C.mutedLight }}>{g.totalTrades}</div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 60 }}>
                         <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '0.05em' }}>MAX DD</div>
                         <div style={{ fontSize: 15, fontFamily: 'monospace', fontWeight: 800, color: parseFloat(g.maxDrawdown) > 15 ? C.red : C.mutedLight }}>{g.maxDrawdown}</div>
                      </div>
                   </div>
                   
                   {/* Mini progress bar internal */}
                   <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'transparent' }}>
                      <div style={{ width: \`\${g.winRate}%\`, height: '100%', background: \`linear-gradient(90deg, transparent, \${winColor(g.winRate)})\` }} />
                   </div>
                 </div>
               );
             })}
          </div>
        </div>

      </div>

      <BottomNav />
    </div>
  );
}
