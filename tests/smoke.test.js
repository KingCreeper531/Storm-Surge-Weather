const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const NODE = process.execPath;
const BASE = 'http://127.0.0.1:4050';
let child;

async function waitForHealth(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server failed to boot');
}

test.before(async () => {
  child = spawn(NODE, ['server.js'], {
    env: { ...process.env, PORT: '4050', JWT_SECRET: 'integration-test-secret' },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  await waitForHealth();
});

test.after(() => {
  if (child && !child.killed) child.kill('SIGTERM');
});

test('health endpoint works', async () => {
  const r = await fetch(`${BASE}/api/health`);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.status, 'ok');
});

test('register + protected endpoint works', async () => {
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'smoke_user', email: 'smoke@example.com', password: 'StrongPass!234' })
  });
  assert.equal(reg.status, 200);
  const data = await reg.json();
  assert.ok(data.token);

  const loc = await fetch(`${BASE}/api/user/locations`, {
    headers: { authorization: `Bearer ${data.token}` }
  });
  assert.equal(loc.status, 200);
});

test('radar frames endpoint works', async () => {
  const r = await fetch(`${BASE}/api/radar/frames`);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(Array.isArray(d.frames));
});
