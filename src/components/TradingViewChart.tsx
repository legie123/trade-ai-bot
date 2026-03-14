'use client';

import { useEffect, useRef, memo, useState } from 'react';

// ============================================================
// TradingView Advanced Chart Widget — Premium integration
// Supports multiple symbols, dark theme, technical indicators
// ============================================================

interface TradingViewChartProps {
  symbol?: string;
  height?: number;
  showToolbar?: boolean;
}

function TradingViewChartInner({ symbol = 'BINANCE:BTCUSDT', height = 400, showToolbar = true }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up previous widget
    if (scriptRef.current) {
      scriptRef.current.remove();
    }
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: '15',
      timezone: 'Europe/Bucharest',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: 'rgba(10, 14, 23, 1)',
      gridColor: 'rgba(30, 41, 59, 0.3)',
      hide_top_toolbar: !showToolbar,
      hide_legend: false,
      allow_symbol_change: true,
      save_image: false,
      calendar: false,
      studies: ['RSI@tv-basicstudies', 'MAExp@tv-basicstudies'],
      support_host: 'https://www.tradingview.com',
      width: '100%',
      height,
    });

    scriptRef.current = script;
    containerRef.current.appendChild(script);

    return () => {
      if (scriptRef.current) {
        scriptRef.current.remove();
        scriptRef.current = null;
      }
    };
  }, [symbol, height, showToolbar]);

  return (
    <div className="tradingview-widget-container" ref={containerRef} style={{ height, width: '100%' }}>
      <div className="tradingview-widget-container__widget" style={{ height: '100%', width: '100%' }} />
    </div>
  );
}

export const TradingViewChart = memo(TradingViewChartInner);

// ─── Symbol Selector + Chart combo ────────────────
const CHART_SYMBOLS = [
  { label: 'BTC/USDT', value: 'BINANCE:BTCUSDT' },
  { label: 'SOL/USDT', value: 'BINANCE:SOLUSDT' },
  { label: 'ETH/USDT', value: 'BINANCE:ETHUSDT' },
  { label: 'BONK/USDT', value: 'BINANCE:BONKUSDT' },
  { label: 'WIF/USDT', value: 'BINANCE:WIFUSDT' },
  { label: 'JUP/USDT', value: 'BINANCE:JUPUSDT' },
  { label: 'RAY/USDT', value: 'BINANCE:RAYUSDT' },
  { label: 'RNDR/USDT', value: 'BINANCE:RNDRUSDT' },
];

export function TradingViewPanel() {
  const [activeSymbol, setActiveSymbol] = useState(CHART_SYMBOLS[0].value);

  return (
    <div className="card" style={{ marginBottom: 16, overflow: 'hidden' }}>
      <div className="card-header">
        <span className="card-title">📊 Live Chart</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {CHART_SYMBOLS.map(s => (
            <button
              key={s.value}
              onClick={() => setActiveSymbol(s.value)}
              style={{
                padding: '3px 10px',
                fontSize: 10,
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                border: activeSymbol === s.value ? '1px solid var(--accent-purple)' : '1px solid var(--border)',
                borderRadius: 6,
                background: activeSymbol === s.value ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
                color: activeSymbol === s.value ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <TradingViewChart symbol={activeSymbol} height={450} />
    </div>
  );
}
