const crypto = require('node:crypto');
const { HttpError } = require('./errors');

const COOKIE = 'bw_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSessionStore(db, config) {
  const insert = db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)');
  const lookup = db.prepare(`
    SELECT u.id, u.email, u.username, u.role, u.payment_customer_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`);
  const remove = db.prepare('DELETE FROM sessions WHERE token_hash = ?');

  function cookieHeader(value, maxAgeSeconds) {
    return [
      `${COOKIE}=${value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAgeSeconds}`,
      config.cookieSecure ? 'Secure' : null,
    ].filter(Boolean).join('; ');
  }

  return {
    start(res, userId) {
      const token = crypto.randomBytes(32).toString('base64url');
      const maxAge = config.sessionDays * 86400;
      insert.run(sha256(token), userId, new Date(Date.now() + maxAge * 1000).toISOString());
      res.setHeader('Set-Cookie', cookieHeader(token, maxAge));
    },
    end(req, res) {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) remove.run(sha256(token));
      res.setHeader('Set-Cookie', cookieHeader('', 0));
    },
    // Express middleware: attaches req.user when a valid session cookie is present.
    middleware(req, _res, next) {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      req.user = token ? lookup.get(sha256(token), new Date().toISOString()) || null : null;
      next();
    },
  };
}

function requireRole(role) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please log in.'));
    if (role && req.user.role !== role) return next(new HttpError(403, 'This page is not available for your account type.'));
    next();
  };
}

// Simple in-memory fixed-window limiter, keyed by an arbitrary string.
function createLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) return true;
      return entry.count < max;
    },
    fail(key) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) hits.set(key, { count: 1, resetAt: now + windowMs });
      else entry.count += 1;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

module.exports = { hashPassword, verifyPassword, createSessionStore, requireRole, createLimiter };
