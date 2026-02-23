const { isValidEmail, normalizeEmail } = require('../utils/security');

function fail(res, message) {
  return res.status(400).json({ error: message });
}

function validateRegister(req, res, next) {
  const { name, email, password } = req.body || {};
  const cleanName = String(name || '').trim();
  const cleanEmail = normalizeEmail(email);

  if (!cleanName || !cleanEmail || !password) return fail(res, 'All fields required');
  if (cleanName.length < 2 || cleanName.length > 30) return fail(res, 'Name must be 2-30 characters');
  if (!/^[a-zA-Z0-9_]+$/.test(cleanName)) return fail(res, 'Username: letters, numbers, _ only');
  if (!isValidEmail(cleanEmail)) return fail(res, 'Email is invalid');

  req.body.name = cleanName;
  req.body.email = cleanEmail;
  next();
}

function validateLogin(req, res, next) {
  const { email, password } = req.body || {};
  if (!email || !password) return fail(res, 'Email and password required');
  req.body.email = normalizeEmail(email);
  next();
}

function validateEmailOnly(req, res, next) {
  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) return fail(res, 'Valid email required');
  req.body.email = email;
  next();
}

function validatePasswordReset(req, res, next) {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');
  if (!token || !password) return fail(res, 'Token and password are required');
  next();
}

module.exports = {
  validateRegister,
  validateLogin,
  validateEmailOnly,
  validatePasswordReset
};
