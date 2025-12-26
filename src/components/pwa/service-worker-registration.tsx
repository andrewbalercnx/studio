'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // Only register service worker in production or when explicitly enabled
      const shouldRegister =
        process.env.NODE_ENV === 'production' ||
        process.env.NEXT_PUBLIC_ENABLE_SW === 'true';

      if (shouldRegister) {
        navigator.serviceWorker
          .register('/sw.js')
          .then((registration) => {
            console.log('[PWA] Service Worker registered:', registration.scope);

            // Check for updates
            registration.addEventListener('updatefound', () => {
              const newWorker = registration.installing;
              if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                  if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    // New content available
                    console.log('[PWA] New content available, refresh to update');
                    // Could show a toast here to prompt refresh
                  }
                });
              }
            });
          })
          .catch((error) => {
            console.error('[PWA] Service Worker registration failed:', error);
          });
      }
    }
  }, []);

  return null;
}
