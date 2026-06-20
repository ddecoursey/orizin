import test from 'node:test';
import assert from 'node:assert/strict';
import { emailForNotifications, displayNameFor, EMAIL_RE } from '../userProfile.js';

test('EMAIL_RE accepts simple addresses', () => {
  assert.ok(EMAIL_RE.test('a@b.co'));
  assert.ok(!EMAIL_RE.test('not-an-email'));
});

test('emailForNotifications prefers notification_email', () => {
  const user = {
    username: 'admin1',
    email: 'login@example.com',
    notification_email: 'alerts@example.com',
  };
  assert.equal(emailForNotifications(user), 'alerts@example.com');
});

test('emailForNotifications falls back to login email then username', () => {
  assert.equal(
    emailForNotifications({ username: 'x', email: 'user@example.com' }),
    'user@example.com',
  );
  assert.equal(
    emailForNotifications({ username: 'user@example.com', email: null }),
    'user@example.com',
  );
  assert.equal(emailForNotifications({ username: 'admin1', email: null }), null);
});

test('displayNameFor uses nickname and avoids raw email', () => {
  assert.equal(
    displayNameFor({ username: 'user@example.com' }, { nickname: 'Alex' }),
    'Alex',
  );
  assert.equal(
    displayNameFor({ username: 'user@example.com', email: null }, {}),
    'user',
  );
  assert.equal(displayNameFor({ username: 'admin1' }, {}), 'admin1');
});