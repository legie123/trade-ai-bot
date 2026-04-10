'use client';

import { useEffect, useRef, memo, useState, useCallback } from 'react';

// ============================================================
// TradingView Advanced Chart Widget — Hardened integration
// Error handling, loading states, retry on failure
// ============================================================

interface TradingViewChartProps {
  symbol?: string;
  height?: number;
  showToolbar?: boolean;
}

function TradingViewChartInner({ symbol = 'BINANCE:BTCUSDT', height = 400, showToolbar = true }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retryCount, setRetryCount] = useState(0);

  const loadWidget = useCallback(() => {
    if (!containerRef.current) return;

    // Clean up previous widget
    if (scriptRef.current) {
      scriptRef.current.remove();
      scriptRef.current = null;
    }
    containerRef.current.innerHTML = '';
    setStatus('loading');

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

    script.onload = () => setStatus('ready');
    script.onerror = () => {
      setStatus('error');
      // Auto-retry once after 3s
      if (retryCount < 2) {
        setTimeout(() => {
          setRetryCount(prev => prev + 1);
        }, 3000);
      }
    };

    scriptRef.current = script;
    containerRef.current.appendChild(script);
  }, [symbol, height, showToolbar, retryCount]);

  useEffect(() => {
    loadWidget();

    // Timeout fallback: if still loading after 10s, mark as ready (widget loaded silently)
    const fallback = setTimeout(() => {
      setStatus(prev => prev === 'loading' ? 'ready' : prev);
    }, 10000);

    return () => {
      clearTimeout(fallback);
      if (scriptRef.current) {
        scriptRef.current.remove();
        scriptRef.current = null;
      }
    };
  }, [loadWidget]);

  return (
    <div style={{ position: 'relative', height, width: '100%' }}>
      {/* Loading overlay */}
      {status === 'loading' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(10, 14, 23, 0.9)', zIndex: 2,
          fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)',
        }}>
          Loading chart...
        </div>
      )}

      {/* Error overlay with retry */}
      {status === 'error' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8,
          background: 'rgba(10, 14, 23, 0.95)', zIndex: 2,
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#ef4444' }}>
            Chart unavailable
          </span>
          <button
            onClick={() => { setRetryCount(prev => prev + 1); }}
            style={{
              padding: '4px 12px', fontSize: 11, fontFamily: 'var(--font-mono)',
              border: '1px solid var(--border)', borderRadius: 4,
              background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      <div className="tradingview-widget-container" ref={containerRef} style={{ height, width: '100%' }}>
        <div className="tradingview-widget-container__widget" style={{ height: '100%', width: '100%' }} />
      </div>
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
        <span className="card-title">Live Chart</span>
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
