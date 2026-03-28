'use client';

/**
 * Sparkline — tiny inline SVG chart for indicator trends.
 * Pure React, zero dependencies. Renders a smooth polyline with gradient fill.
 */
interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showDot?: boolean;
  fillOpacity?: number;
}

export default function Sparkline({
  data,
  width = 80,
  height = 28,
  color = '#06b6d4',
  showDot = true,
  fillOpacity = 0.15,
}: SparklineProps) {
  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} style={{ opacity: 0.3 }}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2}
          stroke={color} strokeWidth={1} strokeDasharray="4,3" />
      </svg>
    );
  }

  const pad = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = linePath +
    ` L${points[points.length - 1].x.toFixed(1)},${height} L${points[0].x.toFixed(1)},${height} Z`;

  const last = points[points.length - 1];
  const trend = data[data.length - 1] >= data[0];
  const id = `spark-${data.length}-${Math.round(data[0] * 10)}-${Math.round(data[data.length - 1] * 10)}`;

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={fillOpacity} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${id})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {showDot && (
        <circle cx={last.x} cy={last.y} r={2.5}
          fill={trend ? '#10b981' : '#ef4444'}
          stroke="rgba(0,0,0,0.4)" strokeWidth={1} />
      )}
    </svg>
  );
}

/**
 * Generate simulated historical data from a current value for demo sparklines.
 * In production, replace with actual API historical data.
 */
export function generateSparkData(currentValue: number, points: number = 12, volatility: number = 0.05): number[] {
  const data: number[] = [];
  let val = currentValue * (1 - volatility * points * 0.3);
  for (let i = 0; i < points - 1; i++) {
    val += (currentValue - val) / (points - i) + (Math.random() - 0.45) * currentValue * volatility;
    data.push(Math.max(0, val));
  }
  data.push(currentValue);
  return data;
}
