import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmpDir = mkdtempSync(path.join(tmpdir(), 'orizin-billing-checkout-'));
const previousDbPath = process.env.DB_PATH;
process.env.DB_PATH = path.join(tmpDir, 'screener.db');

const db = await import(`../db.js?billing-checkout=${Date.now()}`);

after(() => {
  db.default.close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  rmSync(tmpDir, { recursive: true, force: true });
});

test('billing checkout tokens are hashed, user-bound, and short-lived', () => {
  const user = 'checkout-owner@example.com';
  assert.equal(db.createUser(user, 'strongpass1A', false, user).success, true);

  const token = db.createBillingCheckoutToken(user);
  const row = db.default
    .prepare('SELECT token_hash, expires_at FROM billing_checkout_tokens WHERE user_id = ?')
    .get(user);

  assert.ok(token.length >= 20);
  assert.notEqual(row.token_hash, token);
  assert.equal(row.token_hash.length, 64);
  assert.equal(db.getUserByBillingCheckoutToken(token).username, user);
  assert.equal(db.getUserByBillingCheckoutToken('not-a-valid-token'), undefined);

  db.default
    .prepare('UPDATE billing_checkout_tokens SET expires_at = ? WHERE user_id = ?')
    .run(Date.now() - 1, user);
  assert.equal(db.getUserByBillingCheckoutToken(token), undefined);
});

test('checkout token issuance is bounded and account deletion removes tokens', () => {
  const user = 'bounded-checkout@example.com';
  assert.equal(db.createUser(user, 'strongpass1A', false, user).success, true);

  for (let i = 0; i < 8; i += 1) db.createBillingCheckoutToken(user);
  const before = db.default
    .prepare('SELECT COUNT(*) AS count FROM billing_checkout_tokens WHERE user_id = ?')
    .get(user).count;
  assert.equal(before, 5);

  db.deleteUserCascade(user);
  const afterDelete = db.default
    .prepare('SELECT COUNT(*) AS count FROM billing_checkout_tokens WHERE user_id = ?')
    .get(user).count;
  assert.equal(afterDelete, 0);
});
