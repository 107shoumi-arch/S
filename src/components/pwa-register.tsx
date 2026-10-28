'use client';
import { useEffect, useState } from 'react';
export default function PwaRegister() {
  const [offline, setOffline] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync); window.addEventListener('offline', sync);
    let reloaded = false;
    // First installation must not interrupt a form or reset scroll. Reload only
    // when replacing a worker that already controlled this document.
    const hadController = Boolean(navigator.serviceWorker?.controller);
    const changed = () => { if (hadController && !reloaded) { reloaded = true; window.location.reload(); } };
    navigator.serviceWorker?.addEventListener('controllerchange', changed);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        if (reg.waiting) setWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(worker);
          });
        });
      }).catch(() => { /* Core app remains usable if PWA registration is unavailable. */ });
    }
    return () => {
      window.removeEventListener('online', sync); window.removeEventListener('offline', sync);
      navigator.serviceWorker?.removeEventListener('controllerchange', changed);
    };
  }, []);
  return <>{offline && <div className="pwa-banner" role="status">離線模式 · 僅顯示已儲存資料，行情不會更新</div>}
    {waiting && <div className="pwa-banner" role="status">已有新版本 <button onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}>更新 App</button></div>}</>;
}
