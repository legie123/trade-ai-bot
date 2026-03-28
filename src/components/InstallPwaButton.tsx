'use client';

import { useState, useEffect } from 'react';

export default function InstallPwaButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIos, setIsIos] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Check if already installed
      const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
      setIsStandalone(isStandaloneMode);

      // Detect iOS
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      setIsIos(ios);

      // Chrome Prompt
      const handleBeforeInstallPrompt = (e: any) => {
        e.preventDefault();
        setDeferredPrompt(e);
      };
      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

      return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      };
    }
  }, []);

  const handleInstallClick = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult: any) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('User accepted the PWA install prompt');
        }
        setDeferredPrompt(null);
      });
    } else if (isIos) {
      setShowInstallPrompt(true);
    }
  };

  // Disappears perfectly if the user has already installed the PWA
  if (isStandalone) return null;

  return (
    <>
      <button 
        onClick={handleInstallClick}
        style={{
          background: "linear-gradient(45deg, #d4af37, #f3e5ab)",
          color: "#050505",
          border: 'none',
          padding: '6px 14px',
          borderRadius: '20px',
          fontWeight: 'bold',
          cursor: 'pointer',
          boxShadow: '0 0 10px rgba(212, 175, 55, 0.4)',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
        suppressHydrationWarning
      >
        <span style={{ fontSize: '14px' }}>📲</span> Install App
      </button>

      {/* iOS Manual Instruction Modal */}
      {showInstallPrompt && (
        <div style={{
          position: 'fixed', 
          bottom: '24px', 
          left: '50%', 
          transform: 'translateX(-50%)',
          background: 'rgba(5, 5, 5, 0.95)', 
          backdropFilter: 'blur(10px)',
          color: '#fff', 
          padding: '20px', 
          borderRadius: '16px',
          border: '1px solid #d4af37', 
          boxShadow: '0 10px 40px rgba(0,0,0,0.8), 0 0 20px rgba(212, 175, 55, 0.2)', 
          zIndex: 9999,
          textAlign: 'center', 
          minWidth: '280px',
          animation: 'slideUp 0.3s ease-out forwards'
        }}>
          <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px', color: '#d4af37' }}>Install TRADE AI</div>
          <div style={{ margin: '12px 0', fontSize: '14px', color: '#ccc', lineHeight: '1.6' }}>
            To install this app on your iPhone:<br/><br/>
            1. Tap the <b style={{ color: '#fff' }}>Share</b> icon at the bottom.<br/>
            2. Scroll down and tap <b style={{ color: '#fff' }}>Add to Home Screen</b>.
          </div>
          <button 
            onClick={() => setShowInstallPrompt(false)} 
            style={{ 
              background: '#333', 
              color: '#d4af37', 
              border: '1px solid #444', 
              padding: '8px 20px', 
              borderRadius: '8px', 
              cursor: 'pointer',
              fontWeight: 'bold',
              marginTop: '8px',
              width: '100%'
            }}
          >
            Got it
          </button>
        </div>
      )}
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes slideUp {
          from { opacity: 0; transform: translate(-50%, 20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}} />
    </>
  );
}
