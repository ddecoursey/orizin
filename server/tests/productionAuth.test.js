import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, '..', 'index.js');

async function startProductionServer(setupToken) {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'orizin-production-auth-'));
  const port = 5700 + Math.floor(Math.random() * 800);
  const base = `http://127.0.0.1:${port}`;
  let output = '';
  const proc = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(tmpDir, 'screener.db'),
      NODE_ENV: 'production',
      APP_ENV: 'production',
      RAILWAY_ENVIRONMENT: '',
      RAILWAY_GIT_COMMIT_SHA: 'production-auth-test-sha',
      RAILWAY_VOLUME_MOUNT_PATH: '',
      AUTH_SECRET: 'production-test-auth-secret-'.repeat(3),
      APP_URL: 'https://production-test.orizin.invalid',
      FIRST_ADMIN_SETUP_TOKEN: setupToken,
      AUTH_PASSWORD: '',
      AUTH_USERS_JSON: '',
      PAYPAL_ENV: 'sandbox',
      PAYPAL_CLIENT_ID: '',
      PAYPAL_SECRET: '',
      PAYPAL_PLAN_ID: '',
      FMP_API_KEY: '',
      GEMINI_API_KEY: '',
      RESEND_API_KEY: '',
      SENDGRID_API_KEY: '',
      EMAIL_DISABLED: 'true',
      ENABLE_BACKGROUND_ENRICH: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (chunk) => { output += chunk; });
  proc.stderr.on('data', (chunk) => { output += chunk; });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`Production server exited early:\n${output}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        return {
          base,
          async stop() {
            proc.kill('SIGTERM');
            await new Promise((resolve) => {
              proc.once('exit', resolve);
              setTimeout(resolve, 2_000).unref();
            });
            rmSync(tmpDir, { recursive: true, force: true });
          },
        };
      }
    } catch {
      // Wait for the listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  proc.kill('SIGTERM');
  rmSync(tmpDir, { recursive: true, force: true });
  throw new Error(`Production server did not become ready:\n${output}`);
}

test('an empty production database remains locked without a setup token', async () => {
  const server = await startProductionServer('');
  try {
    const healthBody = await (await fetch(`${server.base}/api/health`)).json();
    assert.equal(healthBody.deploymentSha, 'production-auth-test-sha');

    const status = await fetch(`${server.base}/api/auth/status`);
    const statusBody = await status.json();
    assert.equal(statusBody.authEnabled, true);
    assert.equal(statusBody.needsSetup, true);
    assert.equal(statusBody.setupTokenRequired, true);
    assert.equal(statusBody.setupAvailable, false);

    assert.equal((await fetch(`${server.base}/api/auth/me`)).status, 401);
    assert.equal((await fetch(`${server.base}/api/stocks`)).status, 401);

    const setup = await fetch(`${server.base}/api/auth/setup-first-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'admin@example.com', password: 'strongpass1A' }),
    });
    assert.equal(setup.status, 503);
    assert.equal((await setup.json()).code, 'setup_not_configured');
  } finally {
    await server.stop();
  }
});

test('production first-admin setup requires the configured private token', async () => {
  const setupToken = 'production-first-admin-setup-token-12345';
  const server = await startProductionServer(setupToken);
  try {
    const wrong = await fetch(`${server.base}/api/auth/setup-first-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: 'admin@example.com',
        password: 'strongpass1A',
        setupToken: 'wrong-token',
      }),
    });
    assert.equal(wrong.status, 403);

    const setup = await fetch(`${server.base}/api/auth/setup-first-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'admin@example.com', password: 'strongpass1A', setupToken }),
    });
    assert.equal(setup.status, 200);
    assert.ok((setup.headers.get('set-cookie') || '').startsWith('orizin_auth='));
  } finally {
    await server.stop();
  }
});

test('production rejects cross-origin browser mutations before authentication', async () => {
  const server = await startProductionServer('production-first-admin-setup-token-12345');
  try {
    const response = await fetch(`${server.base}/api/auth/setup-first-admin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example',
      },
      body: JSON.stringify({
        user: 'admin@example.com',
        password: 'strongpass1A',
        setupToken: 'production-first-admin-setup-token-12345',
      }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'origin_rejected');
  } finally {
    await server.stop();
  }
});
