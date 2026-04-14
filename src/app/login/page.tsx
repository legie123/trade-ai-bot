'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [particles, setParticles] = useState<{ x: number; y: number; size: number; speed: number; opacity: number }[]>([]);
  const [stats, setStats] = useState({ decisions: 0, exchanges: 3, uptime: '24/7' });
  const router = useRouter();

  // Generate floating particles
  useEffect(() => {
    const pts = Array.from({ length: 30 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 1,
      speed: Math.random() * 20 + 10,
      opacity: Math.random() * 0.5 + 0.1,
    }));
    setParticles(pts);

    // Check if already authenticated
    fetch('/api/auth').then(r => r.json()).then(d => {
      if (d.authenticated) router.push('/bot-center');
    }).catch(() => {});

    // Fetch live stats
    fetch('/api/v2/health').then(r => r.json()).then(d => {
      setStats(prev => ({
        ...prev,
        decisions: d.decisions?.total || 0,
      }));
    }).catch(() => {});
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (res.ok && data.status === 'authenticated') {
        router.push('/bot-center');
      } else {
        setError(data.error || 'Invalid password');
        setPassword('');
      }
    } catch {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* Animated background particles */}
      <div className="particles">
        {particles.map((p, i) => (
          <div
            key={i}
            className="particle"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              opacity: p.opacity,
              animationDuration: `${p.speed}s`,
              animationDelay: `${Math.random() * 5}s`,
            }}
          />
        ))}
      </div>

      {/* Gradient orbs */}
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />

      {/* Login card */}
      <div className="login-container">
        <div className="login-card">
          {/* Logo & Brand */}
          <div className="login-brand">
            <div className="login-logo">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <rect width="48" height="48" rx="12" fill="url(#logo-gradient)" />
                <path d="M14 28L20 22L26 26L34 18" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M28 18H34V24" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="14" cy="28" r="2" fill="white" opacity="0.8" />
                <circle cx="20" cy="22" r="2" fill="white" opacity="0.8" />
                <circle cx="26" cy="26" r="2" fill="white" opacity="0.8" />
                <defs>
                  <linearGradient id="logo-gradient" x1="0" y1="0" x2="48" y2="48">
                    <stop stopColor="#8B5CF6" />
                    <stop offset="1" stopColor="#3B82F6" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <h1 className="login-title">Trading AI</h1>
            <p className="login-subtitle">Intelligent Crypto Trading Platform</p>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="login-form">
            <div className="input-group">
              <label htmlFor="password" className="input-label">Access Key</label>
              <div className="input-wrapper">
                <svg className="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="login-input"
                  autoFocus
                  required
                />
              </div>
            </div>

            {error && (
              <div className="login-error">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M15 9l-6 6M9 9l6 6" />
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="login-button"
              disabled={loading || !password}
            >
              {loading ? (
                <span className="login-spinner" />
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
                  </svg>
                  Access Dashboard
                </>
              )}
            </button>
          </form>

          {/* Live stats */}
          <div className="login-stats">
            <div className="login-stat">
              <span className="stat-dot stat-dot-green" />
              <span>{stats.exchanges} Exchanges</span>
            </div>
            <div className="login-stat">
              <span className="stat-dot stat-dot-blue" />
              <span>{stats.decisions}+ Signals</span>
            </div>
            <div className="login-stat">
              <span className="stat-dot stat-dot-purple" />
              <span>{stats.uptime} Uptime</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="login-footer">
          Powered by AI &bull; Binance &bull; MEXC &bull; Bybit
        </p>
      </div>

      <style jsx>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0a0e17;
          position: relative;
          overflow: hidden;
          font-family: 'Inter', -apple-system, sans-serif;
        }

        /* Animated particles */
        .particles { position: absolute; inset: 0; z-index: 0; }
        .particle {
          position: absolute;
          background: #8B5CF6;
          border-radius: 50%;
          animation: float linear infinite;
        }
        @keyframes float {
          0% { transform: translateY(0) translateX(0); }
          25% { transform: translateY(-30px) translateX(15px); }
          50% { transform: translateY(-10px) translateX(-10px); }
          75% { transform: translateY(-40px) translateX(20px); }
          100% { transform: translateY(0) translateX(0); }
        }

        /* Gradient orbs */
        .orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          z-index: 0;
        }
        .orb-1 {
          width: 400px; height: 400px;
          background: rgba(139, 92, 246, 0.15);
          top: -100px; right: -100px;
          animation: pulse 8s ease-in-out infinite;
        }
        .orb-2 {
          width: 300px; height: 300px;
          background: rgba(59, 130, 246, 0.12);
          bottom: -50px; left: -50px;
          animation: pulse 10s ease-in-out infinite reverse;
        }
        .orb-3 {
          width: 200px; height: 200px;
          background: rgba(6, 182, 212, 0.1);
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          animation: pulse 6s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.2); opacity: 0.8; }
        }

        /* Container */
        .login-container {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          width: 100%;
          max-width: 420px;
          padding: 20px;
        }

        /* Card */
        .login-card {
          width: 100%;
          background: rgba(21, 28, 44, 0.7);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(139, 92, 246, 0.15);
          border-radius: 20px;
          padding: 40px 32px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 40px rgba(139, 92, 246, 0.05);
          animation: cardAppear 0.6s ease-out;
        }
        @keyframes cardAppear {
          from { opacity: 0; transform: translateY(20px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* Brand */
        .login-brand {
          text-align: center;
          margin-bottom: 32px;
        }
        .login-logo {
          display: inline-flex;
          margin-bottom: 16px;
          animation: logoGlow 3s ease-in-out infinite;
        }
        @keyframes logoGlow {
          0%, 100% { filter: drop-shadow(0 0 8px rgba(139, 92, 246, 0.3)); }
          50% { filter: drop-shadow(0 0 20px rgba(139, 92, 246, 0.6)); }
        }
        .login-title {
          font-size: 28px;
          font-weight: 700;
          background: linear-gradient(135deg, #e2e8f0, #8B5CF6);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 4px;
        }
        .login-subtitle {
          font-size: 13px;
          color: #64748b;
          letter-spacing: 0.5px;
        }

        /* Form */
        .login-form { display: flex; flex-direction: column; gap: 16px; }
        .input-group { display: flex; flex-direction: column; gap: 6px; }
        .input-label {
          font-size: 11px;
          font-weight: 600;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }
        .input-icon {
          position: absolute;
          left: 14px;
          color: #64748b;
          pointer-events: none;
        }
        .login-input {
          width: 100%;
          padding: 14px 14px 14px 44px;
          background: rgba(13, 19, 33, 0.8);
          border: 1px solid #1e293b;
          border-radius: 12px;
          color: #e2e8f0;
          font-size: 15px;
          font-family: inherit;
          outline: none;
          transition: all 0.3s ease;
        }
        .login-input:focus {
          border-color: #8B5CF6;
          box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15), 0 0 20px rgba(139, 92, 246, 0.1);
        }
        .login-input::placeholder { color: #475569; }

        /* Error */
        .login-error {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 10px;
          color: #ef4444;
          font-size: 13px;
          animation: shake 0.4s ease-in-out;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }

        /* Button */
        .login-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 14px 24px;
          background: linear-gradient(135deg, #8B5CF6, #6366F1);
          border: none;
          border-radius: 12px;
          color: white;
          font-size: 15px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.3s ease;
          margin-top: 4px;
        }
        .login-button:hover:not(:disabled) {
          background: linear-gradient(135deg, #7C3AED, #4F46E5);
          box-shadow: 0 8px 30px rgba(139, 92, 246, 0.3);
          transform: translateY(-1px);
        }
        .login-button:active:not(:disabled) { transform: translateY(0); }
        .login-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* Spinner */
        .login-spinner {
          width: 20px;
          height: 20px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Stats */
        .login-stats {
          display: flex;
          justify-content: center;
          gap: 20px;
          margin-top: 28px;
          padding-top: 20px;
          border-top: 1px solid rgba(30, 41, 59, 0.5);
        }
        .login-stat {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: #64748b;
        }
        .stat-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          animation: blink 2s ease-in-out infinite;
        }
        .stat-dot-green { background: #10b981; }
        .stat-dot-blue { background: #3b82f6; }
        .stat-dot-purple { background: #8b5cf6; }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        /* Footer */
        .login-footer {
          font-size: 11px;
          color: #475569;
          letter-spacing: 0.5px;
        }

        /* Mobile */
        @media (max-width: 480px) {
          .login-card { padding: 32px 24px; border-radius: 16px; }
          .login-title { font-size: 24px; }
          .login-stats { gap: 12px; flex-wrap: wrap; justify-content: center; }
        }
      `}</style>
    </div>
  );
}
