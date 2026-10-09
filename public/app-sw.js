// Service worker for the Bite Wise app installed on a phone or computer (start page /offers). Android browsers need
// one to offer "Install app". It caches nothing (deals change by the minute); when the network is down it shows a
// short notice. Kiosks (/kiosk/...) have their own service worker.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;display:grid;place-items:center;height:100vh;background:#07110d;color:#ecfdf5;font:600 20px system-ui;text-align:center;padding:24px"><div>No internet connection.<br><small style="color:#86998f">Bite Wise needs the internet to show live deals. <a style="color:#6ee7b7" href="">Try again</a></small></div>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )),
  );
});
