// Service worker for restaurant kiosks (/kiosk/...). Android browsers need one to offer "Install app".
// It caches nothing (the kiosk always needs live orders); when the network is down it shows a short notice.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;display:grid;place-items:center;height:100vh;background:#07110d;color:#ecfdf5;font:600 20px system-ui;text-align:center"><div>No internet connection.<br><small style="color:#86998f">The kiosk reconnects automatically. <a style="color:#6ee7b7" href="">Try again</a></small></div>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )),
  );
});
