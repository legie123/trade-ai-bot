'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string;
}

/**
 * AUDIT FIX T1.10: Global ErrorBoundary prevents white-screen crashes.
 * Catches any unhandled React render error and shows recovery UI.
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
    this.setState({ errorInfo: errorInfo.componentStack || '' });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleDismiss = () => {
    this.setState({ hasError: false, error: null, errorInfo: '' });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          minHeight: '100vh',
          background: '#0a0a0f',
          color: '#e0e0e0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'monospace',
          padding: '20px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>&#9888;</div>
          <h1 style={{ color: '#ff4444', fontSize: '24px', marginBottom: '10px' }}>
            TRADE AI — Runtime Error
          </h1>
          <p style={{ color: '#888', maxWidth: '500px', marginBottom: '20px' }}>
            A component crashed. Your trading positions are NOT affected — this is a UI error only.
          </p>
          <div style={{
            background: '#12121a',
            border: '1px solid #2a2a3a',
            borderRadius: '8px',
            padding: '15px',
            maxWidth: '600px',
            width: '100%',
            marginBottom: '20px',
            textAlign: 'left',
            fontSize: '12px',
            maxHeight: '200px',
            overflow: 'auto',
          }}>
            <div style={{ color: '#ff4444' }}>{this.state.error?.message}</div>
            {this.state.errorInfo && (
              <pre style={{ color: '#666', marginTop: '10px', whiteSpace: 'pre-wrap', fontSize: '11px' }}>
                {this.state.errorInfo.slice(0, 500)}
              </pre>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={this.handleReload}
              style={{
                background: '#ff4444',
                color: '#fff',
                border: 'none',
                padding: '10px 24px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '14px',
              }}
            >
              Reload Page
            </button>
            <button
              onClick={this.handleDismiss}
              style={{
                background: 'transparent',
                color: '#888',
                border: '1px solid #333',
                padding: '10px 24px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '14px',
              }}
            >
              Try to Recover
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
