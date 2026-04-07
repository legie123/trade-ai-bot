'use client';

interface EquityPoint {
  timestamp: string;
  pnl: number;
  balance: number;
  outcome: string;
}

interface EquityCurveProps {
  data: EquityPoint[];
  initialBalance: number;
}

export default function EquityCurve({ data, initialBalance }: EquityCurveProps) {
  const W = 100; // percentage-based viewbox
  const H = 50;
  const PAD = 4;

  if (!data || data.length < 2) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: 140, color: 'var(--text-muted)', fontSize: 12, gap: 6,
        background: 'rgba(0,0,0,0.15)', borderRadius: 12, border: '1px dashed var(--border)',
      }}>
        <span style={{ fontSize: 24, opacity: 0.4 }}>📈</span>
        <span>Equity curve requires evaluated trades</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>Run Evaluate to generate data</span>
      </div>
    );
  }

  const balances = data.map(d => d.balance);
  const minB = Math.min(...balances, initialBalance);
  const maxB = Math.max(...balances, initialBalance);
  const range = maxB - minB || 1;

  const points = data.map((d, i) => ({
    x: PAD + (i / (data.length - 1)) * (W - PAD * 2),
    y: PAD + (1 - (d.balance - minB) / range) * (H - PAD * 2),
  }));

  // Drawdown calculation (single pass, no reassignment)
  const ddPoints = data.reduce<{ x: number; dd: number; peak: number }[]>((acc, d, i) => {
    const currentPeak = acc.length > 0 ? Math.max(acc[acc.length - 1].peak, d.balance) : Math.max(initialBalance, d.balance);
    const dd = (currentPeak - d.balance) / currentPeak * 100;
    acc.push({ x: points[i].x, dd, peak: currentPeak });
    return acc;
  }, []);

  const maxDD = Math.max(...ddPoints.map(p => p.dd));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const areaPath = linePath + ` L${points[points.length - 1].x.toFixed(2)},${H} L${points[0].x.toFixed(2)},${H} Z`;

  const last = data[data.length - 1];
  const totalPnl = ((last.balance - initialBalance) / initialBalance * 100);
  const isUp = totalPnl >= 0;

  return (
    <div>
      {/* Stats row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, padding: '0 4px' }}>
        <div>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>BALANCE</span>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            ${last.balance.toLocaleString()}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>P&L</span>
          <div style={{
            fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)',
            color: isUp ? 'var(--accent-green)' : 'var(--accent-red)',
          }}>
            {isUp ? '+' : ''}{totalPnl.toFixed(2)}%
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>MAX DD</span>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-red)' }}>
            -{maxDD.toFixed(1)}%
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>TRADES</span>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {data.length}
          </div>
        </div>
      </div>

      {/* SVG Chart */}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 140, display: 'block' }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="eq-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0.2} />
            <stop offset="100%" stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Zero line */}
        <line
          x1={PAD} x2={W - PAD}
          y1={PAD + (1 - (initialBalance - minB) / range) * (H - PAD * 2)}
          y2={PAD + (1 - (initialBalance - minB) / range) * (H - PAD * 2)}
          stroke="rgba(255,255,255,0.08)" strokeWidth={0.3} strokeDasharray="2,2"
        />

        {/* Area fill */}
        <path d={areaPath} fill="url(#eq-grad)" />

        {/* Main line */}
        <path d={linePath} fill="none"
          stroke={isUp ? '#10b981' : '#ef4444'}
          strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round"
        />

        {/* Trade dots */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={0.8}
            fill={data[i].outcome === 'WIN' ? '#10b981' : data[i].outcome === 'LOSS' ? '#ef4444' : '#f59e0b'}
            opacity={0.8}
          />
        ))}

        {/* Last point glow  */}
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={1.5}
          fill={last.outcome === 'FLOATING' ? (last.balance >= (data[data.length - 2]?.balance || initialBalance) ? '#10b981' : '#f59e0b') : (isUp ? '#10b981' : '#ef4444')}
          stroke="rgba(0,0,0,0.5)" strokeWidth={0.4}
          style={last.outcome === 'FLOATING' ? { animation: 'pulseLive 2s infinite' } : {}}
        />
      </svg>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes pulseLive {
          0% { r: 1.5px; opacity: 0.9; }
          50% { r: 3.5px; opacity: 0.3; }
          100% { r: 1.5px; opacity: 0.9; }
        }
      `}} />
    </div>
  );
}
