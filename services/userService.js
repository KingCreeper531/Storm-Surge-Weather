const { randomToken, sha256, validatePasswordStrength, normalizeEmail } = require('../utils/security');

function buildUserService({ gcsRead, gcsWrite, bcrypt }) {
  async function readUsers() {
    return gcsRead('users.json', {});
  }

  async function writeUsers(users) {
    return gcsWrite('users.json', users);
  }

  function sanitizeUser(user) {
    return {
      name: user.name,
      email: user.email,
      role: user.role || 'user',
      emailVerified: !!user.emailVerified,
      joinedAt: user.joinedAt,
      avatar: user.avatar || null
    };
  }

  async function findByEmail(email) {
    const users = await readUsers();
    return users[normalizeEmail(email)] || null;
  }

  async function findByUsername(username) {
    const users = await readUsers();
    const target = String(username || '').toLowerCase();
    return Object.values(users).find((u) => String(u.name || '').toLowerCase() === target) || null;
  }

  async function createUser({ name, email, password }) {
    const users = await readUsers();
    const cleanEmail = normalizeEmail(email);

    if (users[cleanEmail]) {
      const err = new Error('Email already registered');
      err.code = 409;
      throw err;
    }

    const usernameTaken = Object.values(users).some((u) => String(u.name || '').toLowerCase() === name.toLowerCase());
    if (usernameTaken) {
      const err = new Error('Username already taken — try another');
      err.code = 409;
      throw err;
    }

    const strength = validatePasswordStrength(password);
    if (!strength.ok) {
      const err = new Error(strength.reason);
      err.code = 400;
      throw err;
    }

    const hash = await bcrypt.hash(password, 12);
    const verifyTokenRaw = randomToken(24);
    users[cleanEmail] = {
      name,
      email: cleanEmail,
      hash,
      role: 'user',
      avatar: null,
      joinedAt: new Date().toISOString(),
      emailVerified: false,
      verifyTokenHash: sha256(verifyTokenRaw),
      verifyTokenExpiresAt: Date.now() + (1000 * 60 * 60 * 24),
      failedLoginAttempts: 0,
      lockUntil: 0,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: 0
    };

    await writeUsers(users);
    return { user: users[cleanEmail], verifyToken: verifyTokenRaw };
  }

  async function verifyPassword(user, password) {
    return bcrypt.compare(password, user.hash);
  }

  async function recordFailedLogin(email) {
    const users = await readUsers();
    const cleanEmail = normalizeEmail(email);
    const user = users[cleanEmail];
    if (!user) return;
    user.failedLoginAttempts = Number(user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= 6) {
      user.lockUntil = Date.now() + (1000 * 60 * 15);
      user.failedLoginAttempts = 0;
    }
    users[cleanEmail] = user;
    await writeUsers(users);
  }

  async function clearFailedLogin(email) {
    const users = await readUsers();
    const cleanEmail = normalizeEmail(email);
    const user = users[cleanEmail];
    if (!user) return;
    user.failedLoginAttempts = 0;
    user.lockUntil = 0;
    users[cleanEmail] = user;
    await writeUsers(users);
  }

  async function markVerified(token) {
    const users = await readUsers();
    const tokenHash = sha256(token);
    const entry = Object.entries(users).find(([, u]) => u.verifyTokenHash === tokenHash && Date.now() < Number(u.verifyTokenExpiresAt || 0));
    if (!entry) return null;
    const [email, user] = entry;
    user.emailVerified = true;
    user.verifyTokenHash = null;
    user.verifyTokenExpiresAt = 0;
    users[email] = user;
    await writeUsers(users);
    return user;
  }

  async function issuePasswordReset(email) {
    const users = await readUsers();
    const cleanEmail = normalizeEmail(email);
    const user = users[cleanEmail];
    if (!user) return null;
    const rawToken = randomToken(24);
    user.passwordResetTokenHash = sha256(rawToken);
    user.passwordResetExpiresAt = Date.now() + (1000 * 60 * 30);
    users[cleanEmail] = user;
    await writeUsers(users);
    return rawToken;
  }

  async function resetPassword({ token, password }) {
    const users = await readUsers();
    const tokenHash = sha256(token);
    const strength = validatePasswordStrength(password);
    if (!strength.ok) {
      const err = new Error(strength.reason);
      err.code = 400;
      throw err;
    }
    const entry = Object.entries(users).find(([, u]) => u.passwordResetTokenHash === tokenHash && Date.now() < Number(u.passwordResetExpiresAt || 0));
    if (!entry) return null;

    const [email, user] = entry;
    user.hash = await bcrypt.hash(password, 12);
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = 0;
    user.failedLoginAttempts = 0;
    user.lockUntil = 0;
    users[email] = user;
    await writeUsers(users);
    return user;
  }

  return {
    readUsers,
    findByEmail,
    findByUsername,
    createUser,
    verifyPassword,
    recordFailedLogin,
    clearFailedLogin,
    markVerified,
    issuePasswordReset,
    resetPassword,
    sanitizeUser
  };
}

module.exports = { buildUserService };
