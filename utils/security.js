const crypto = require('crypto');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function validatePasswordStrength(password) {
  const value = String(password || '');
  if (value.length < 10) return { ok: false, reason: 'Password must be at least 10 characters long' };
  if (!/[A-Z]/.test(value)) return { ok: false, reason: 'Password must contain at least one uppercase letter' };
  if (!/[a-z]/.test(value)) return { ok: false, reason: 'Password must contain at least one lowercase letter' };
  if (!/\d/.test(value)) return { ok: false, reason: 'Password must contain at least one number' };
  if (!/[^A-Za-z0-9]/.test(value)) return { ok: false, reason: 'Password must contain at least one special character' };
  return { ok: true };
}

function parseCookies(header = '') {
  return String(header)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, item) => {
      const idx = item.indexOf('=');
      if (idx <= 0) return acc;
      const key = item.slice(0, idx).trim();
      const val = decodeURIComponent(item.slice(idx + 1).trim());
      acc[key] = val;
      return acc;
    }, {});
}

function randomToken(size = 32) {
  return crypto.randomBytes(size).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

module.exports = {
  normalizeEmail,
  isValidEmail,
  validatePasswordStrength,
  parseCookies,
  randomToken,
  sha256
};
