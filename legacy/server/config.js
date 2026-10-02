const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

module.exports = {
  // Map tiles (Leaflet). OpenStreetMap's public tiles are fine for development and light use;
  // use a commercial tile provider (MapTiler, Stadia, Mapbox...) in production.
  mapTileUrl: process.env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  mapAttribution: process.env.MAP_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  // Darken light map tiles to match the dark UI. Set to false if your tile provider is already dark.
  mapDarkFilter: process.env.MAP_DARK_FILTER !== 'false',
  // Company details shown in the Terms of Service, Partner Agreement and Privacy Policy.
  legalEntityName: process.env.LEGAL_ENTITY_NAME || 'Bite Wise',
  supportEmail: process.env.SUPPORT_EMAIL || 'support@bitewise.app',
  legalAddress: process.env.LEGAL_ADDRESS || 'Seattle, Washington',
  // New restaurants must be approved by an admin before their offers are visible.
  requireRestaurantApproval: process.env.REQUIRE_RESTAURANT_APPROVAL !== 'false',
  // 64 hex chars. Encrypts restaurant bank account numbers. Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY || '',
  timeZone: process.env.TIME_ZONE || 'America/Los_Angeles',
  port: int(process.env.PORT, 3000),
  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'data', 'uploads'),
  databasePath: process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'bitewise.db'),
  serviceFeeBps: int(process.env.SERVICE_FEE_BPS, 500),
  defaultTaxRateBps: int(process.env.DEFAULT_TAX_RATE_BPS, 1035),
  taxServiceFee: process.env.TAX_SERVICE_FEE === 'true',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionDays: 30,
  // Unpaid checkouts (e.g. waiting on 3-D Secure) are released after this many minutes.
  pendingPaymentMinutes: 15,
  // When an offer's discard timer runs out, orders not yet picked up are released (never charged)
  // after this short grace period, for customers already at the counter.
  pickupGraceMinutes: 10,
};
