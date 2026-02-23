const express = require('express');
const { validateRegister, validateLogin, validateEmailOnly, validatePasswordReset } = require('../middleware/validation');

function buildAuthRoutes({ authLimiter, tokenService, userService, logger, metrics }) {
  const router = express.Router();

  router.get('/check-username', async (req, res, next) => {
    try {
      const username = String(req.query?.username || '').trim();
      if (username.length < 2) return res.json({ available: false, reason: 'Too short' });
      if (username.length > 30) return res.json({ available: false, reason: 'Too long (max 30 chars)' });
      if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.json({ available: false, reason: 'Letters, numbers and _ only' });

      const taken = await userService.findByUsername(username);
      res.json({ available: !taken, reason: taken ? 'Username already taken' : null });
    } catch (error) {
      next(error);
    }
  });

  router.post('/register', authLimiter, validateRegister, async (req, res, next) => {
    try {
      const { name, email, password } = req.body;
      const { user, verifyToken } = await userService.createUser({ name, email, password });
      const accessToken = tokenService.signAccessToken(user);
      const refresh = tokenService.issueRefreshSession(user, { ip: req.ip, userAgent: req.headers['user-agent'] });
      tokenService.setAuthCookies(res, refresh);

      if (process.env.DEBUG_AUTH === '1') {
        logger.info('auth.register.verify_token', { email: user.email, verifyToken });
      }

      res.json({ token: accessToken, user: userService.sanitizeUser(user) });
    } catch (error) {
      if (error.code) return res.status(error.code).json({ error: error.message });
      next(error);
    }
  });

  router.post('/login', authLimiter, validateLogin, async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const user = await userService.findByEmail(email);

      // Avoid account enumeration leakage.
      if (!user) {
        if (metrics) metrics.authFailures += 1;
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (Number(user.lockUntil || 0) > Date.now()) {
        return res.status(429).json({ error: 'Account temporarily locked due to repeated failures' });
      }

      const valid = await userService.verifyPassword(user, password);
      if (!valid) {
        if (metrics) metrics.authFailures += 1;
        await userService.recordFailedLogin(email);
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      await userService.clearFailedLogin(email);
      const accessToken = tokenService.signAccessToken(user);
      const refresh = tokenService.issueRefreshSession(user, { ip: req.ip, userAgent: req.headers['user-agent'] });
      tokenService.setAuthCookies(res, refresh);

      res.json({ token: accessToken, user: userService.sanitizeUser(user) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/refresh', async (req, res) => {
    const { sessionId, refreshToken, csrfToken } = tokenService.parseRefreshFromRequest(req);
    if (!sessionId || !refreshToken || !csrfToken) {
      tokenService.clearAuthCookies(res);
      return res.status(401).json({ error: 'Missing refresh credentials' });
    }

    const rotated = tokenService.rotateRefreshSession(sessionId, refreshToken, csrfToken);
    if (!rotated) {
      tokenService.clearAuthCookies(res);
      return res.status(401).json({ error: 'Refresh token invalid or expired' });
    }

    const nextRefresh = {
      sessionId,
      refreshToken: rotated.refreshToken,
      csrfToken: rotated.csrfToken
    };
    tokenService.setAuthCookies(res, nextRefresh);
    const token = tokenService.signAccessToken(rotated.user);
    res.json({ token, user: rotated.user });
  });

  router.post('/logout', (req, res) => {
    const { sessionId } = tokenService.parseRefreshFromRequest(req);
    if (sessionId) tokenService.revokeSession(sessionId);
    tokenService.clearAuthCookies(res);
    res.json({ ok: true });
  });

  router.post('/verify-email', async (req, res, next) => {
    try {
      const token = String(req.body?.token || '').trim();
      if (!token) return res.status(400).json({ error: 'Token required' });
      const user = await userService.markVerified(token);
      if (!user) return res.status(400).json({ error: 'Invalid or expired token' });
      res.json({ ok: true, user: userService.sanitizeUser(user) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/request-password-reset', authLimiter, validateEmailOnly, async (req, res, next) => {
    try {
      const token = await userService.issuePasswordReset(req.body.email);
      if (token && process.env.DEBUG_AUTH === '1') {
        logger.info('auth.password_reset_token', { email: req.body.email, token });
      }
      // Always return ok to avoid account enumeration.
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post('/reset-password', authLimiter, validatePasswordReset, async (req, res, next) => {
    try {
      const user = await userService.resetPassword({ token: req.body.token, password: req.body.password });
      if (!user) return res.status(400).json({ error: 'Invalid or expired token' });
      res.json({ ok: true });
    } catch (error) {
      if (error.code) return res.status(error.code).json({ error: error.message });
      next(error);
    }
  });

  return router;
}

module.exports = { buildAuthRoutes };
