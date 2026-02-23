const jwt = require('jsonwebtoken');
const { randomToken, sha256, parseCookies } = require('../utils/security');

function buildTokenService({ jwtSecret, cache, secureCookies }) {
  const sessionKey = (id) => `refresh_session:${id}`;

  function signAccessToken(user) {
    return jwt.sign({
      sub: user.email,
      email: user.email,
      name: user.name,
      role: user.role || 'user'
    }, jwtSecret, { expiresIn: '15m' });
  }

  function issueRefreshSession(user, meta = {}) {
    const sessionId = randomToken(18);
    const refreshToken = randomToken(32);
    const csrfToken = randomToken(24);
    const session = {
      id: sessionId,
      email: user.email,
      role: user.role || 'user',
      name: user.name,
      refreshHash: sha256(refreshToken),
      csrfHash: sha256(csrfToken),
      ip: meta.ip || null,
      userAgent: meta.userAgent || null,
      createdAt: Date.now(),
      rotatedAt: Date.now()
    };
    cache.set(sessionKey(sessionId), session, 60 * 60 * 24 * 30);
    return { sessionId, refreshToken, csrfToken };
  }

  function rotateRefreshSession(sessionId, providedRefreshToken, providedCsrfToken) {
    const existing = cache.get(sessionKey(sessionId));
    if (!existing) return null;
    if (existing.refreshHash !== sha256(providedRefreshToken)) return null;
    if (existing.csrfHash !== sha256(providedCsrfToken)) return null;

    const refreshToken = randomToken(32);
    const csrfToken = randomToken(24);
    existing.refreshHash = sha256(refreshToken);
    existing.csrfHash = sha256(csrfToken);
    existing.rotatedAt = Date.now();
    cache.set(sessionKey(sessionId), existing, 60 * 60 * 24 * 30);

    return {
      user: { email: existing.email, name: existing.name, role: existing.role },
      refreshToken,
      csrfToken
    };
  }

  function revokeSession(sessionId) {
    cache.del(sessionKey(sessionId));
  }

  function setAuthCookies(res, { sessionId, refreshToken, csrfToken }) {
    const common = [
      'Path=/',
      'SameSite=Lax',
      secureCookies ? 'Secure' : ''
    ].filter(Boolean).join('; ');

    const refreshCookie = `ss_refresh=${encodeURIComponent(`${sessionId}.${refreshToken}`)}; ${common}; HttpOnly; Max-Age=${60 * 60 * 24 * 30}`;
    const csrfCookie = `ss_csrf=${encodeURIComponent(csrfToken)}; ${common}; Max-Age=${60 * 60 * 24 * 30}`;
    res.setHeader('Set-Cookie', [refreshCookie, csrfCookie]);
  }

  function clearAuthCookies(res) {
    const common = ['Path=/', 'SameSite=Lax', secureCookies ? 'Secure' : ''].filter(Boolean).join('; ');
    res.setHeader('Set-Cookie', [
      `ss_refresh=; ${common}; HttpOnly; Max-Age=0`,
      `ss_csrf=; ${common}; Max-Age=0`
    ]);
  }

  function parseRefreshFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie || '');
    const raw = cookies.ss_refresh || '';
    const csrfCookie = cookies.ss_csrf || '';
    const csrfHeader = req.headers['x-csrf-token'];
    const csrfToken = String(csrfHeader || csrfCookie || '');
    const [sessionId, refreshToken] = raw.split('.');
    return { sessionId, refreshToken, csrfToken };
  }

  return {
    signAccessToken,
    issueRefreshSession,
    rotateRefreshSession,
    revokeSession,
    setAuthCookies,
    clearAuthCookies,
    parseRefreshFromRequest
  };
}

module.exports = { buildTokenService };
