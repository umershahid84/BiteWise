const path = require('node:path');
const express = require('express');
const { createSessionStore } = require('./auth');
const { createOrderService } = require('./orders');
const { HttpError } = require('./errors');
const { createImageStore } = require('./images');
const { createReceiptService } = require('./receipts');
const { lookupZip } = require('./areas');
const { createLegal } = require('./legal/documents');
const { createTermsService } = require('./terms');
const { createSettings } = require('./settings');
const { createCipher } = require('./secure');

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://js.stripe.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "connect-src 'self' https://api.stripe.com",
  "img-src 'self' data: blob: https://*.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// Allows map tile images from the configured tile server in the CSP.
function tileOrigin(url) {
  try {
    const u = new URL(String(url).replace(/\{s\}\./, 'a.'));
    return String(url).includes('{s}.') ? `${u.protocol}//*.${u.host.split('.').slice(1).join('.')}` : u.origin;
  } catch {
    return '';
  }
}

function createApp({ db, config, payments }) {
  const app = express();
  const csp = CSP.replace("img-src 'self' data: blob:", `img-src 'self' data: blob: ${tileOrigin(config.mapTileUrl || 'https://tile.openstreetmap.org')}`);
  // Restaurants without map coordinates get their ZIP code's center.
  for (const r of db.prepare('SELECT id, zip FROM restaurants WHERE lat IS NULL OR lng IS NULL').all()) {
    const z = lookupZip(r.zip);
    if (z) db.prepare('UPDATE restaurants SET lat = ?, lng = ? WHERE id = ?').run(z.lat, z.lng, r.id);
  }
  const sessions = createSessionStore(db, config);
  const orders = createOrderService({ db, config, payments });
  const images = createImageStore(config.uploadsDir || path.join(__dirname, '..', 'data', 'uploads'));
  const receipts = createReceiptService({ db, config });
  const legal = createLegal(config);
  const settings = createSettings(db, config, { onChange: () => legal.refresh() });
  legal.refresh();
  const terms = createTermsService({ db, legal });
  const cipher = createCipher(config);
  const deps = { db, config, payments, sessions, orders, images, receipts, legal, terms, settings, cipher };

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), payment=(self)');
    next();
  });

  // Menu items carry a photo (base64), so they get a larger body limit.
  app.use('/api/restaurant/menu', express.json({ limit: '5mb' }));
  app.use('/api', express.json({ limit: '50kb' }));
  // CSRF protection: state-changing API calls must carry a custom header, which browsers
  // only allow from same-origin scripts.
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'Bite Wise') {
      return next(new HttpError(403, 'Request blocked.'));
    }
    next();
  });
  app.use('/api', sessions.middleware);
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/auth', require('./routes/auth')(deps));
  app.use('/api/legal', require('./routes/legal').api(deps));
  app.use('/legal', require('./routes/legal').pages(deps));
  app.use('/api/restaurant', require('./routes/restaurant')(deps));
  app.use('/api/admin', require('./routes/admin')(deps));
  app.use('/api', require('./routes/customer')(deps));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
  app.use('/vendor/leaflet', express.static(path.join(path.dirname(require.resolve('leaflet/package.json')), 'dist'), { maxAge: '7d' }));
  app.use('/uploads', express.static(images.dir, { fallthrough: false, maxAge: '30d', immutable: true }));

  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const message = status >= 500 && !(err instanceof HttpError) ? 'Something went wrong. Please try again.' : err.message;
    res.status(status).json(err.code && typeof err.code === 'string' && status < 500 ? { error: message, code: err.code } : { error: message });
  });

  return { app, orders };
}

module.exports = { createApp };
