'use client';

import { useEffect, useState } from 'react';

/**
 * Registers the service worker and shows an "Update Available" banner
 * when a new version is detected. User can dismiss or refresh.
 */
export default function SwRegister() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Check for waiting worker (update already downloaded)
      if (reg.waiting) {
        setWaitingWorker(reg.waiting);
        setUpdateAvailable(true);
      }

      // Listen for new updates
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setWaitingWorker(newWorker);
            setUpdateAvailable(true);
          }
        });
      });
    }).catch((err) => {
      console.warn('SW registration failed:', err);
    });

    // Reload when the new SW takes over
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }, []);

  const handleUpdate = () => {
    if (waitingWorker) {
      waitingWorker.postMessage('SKIP_WAITING');
    }
  };

  if (!updateAvailable) return null;

  return (
    <div className="sw-update-banner" role="alert" aria-live="polite">
      <span style={{ fontSize: 14 }}>🔄</span>
      <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>New version available</span>
      <button
        onClick={handleUpdate}
        aria-label="Update to the latest version"
        className="sw-update-btn"
      >
        Update Now
      </button>
      <button
        onClick={() => setUpdateAvailable(false)}
        aria-label="Dismiss update notification"
        className="sw-dismiss-btn"
      >
        ✕
      </button>
    </div>
  );
}
