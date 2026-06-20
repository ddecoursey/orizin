import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as db from '../db.js';
import {
  canSendEmail,
  dailyEmailSentCount,
  emailQuotaDateKey,
} from '../email.js';

const QUOTA_DAY = '2099-06-20';

test('canSendEmail reserves slots for critical sends', () => {
  const key = `email_sent:${QUOTA_DAY}`;
  const prev = db.getMeta(key);
  try {
    db.setMeta(key, '74');
    assert.equal(canSendEmail('optional', new Date(`${QUOTA_DAY}T12:00:00Z`)), true);
    db.setMeta(key, '75');
    assert.equal(canSendEmail('optional', new Date(`${QUOTA_DAY}T12:00:00Z`)), false);
    assert.equal(canSendEmail('critical', new Date(`${QUOTA_DAY}T12:00:00Z`)), true);
    db.setMeta(key, '100');
    assert.equal(canSendEmail('critical', new Date(`${QUOTA_DAY}T12:00:00Z`)), false);
  } finally {
    if (prev == null) db.setMeta(key, '');
    else db.setMeta(key, prev);
  }
});

test('dailyEmailSentCount reads the UTC day bucket', () => {
  const key = `email_sent:${QUOTA_DAY}`;
  const prev = db.getMeta(key);
  try {
    db.setMeta(key, '3');
    assert.equal(dailyEmailSentCount(new Date(`${QUOTA_DAY}T23:59:00Z`)), 3);
    assert.equal(emailQuotaDateKey(new Date(`${QUOTA_DAY}T23:59:00Z`)), QUOTA_DAY);
  } finally {
    if (prev == null) db.setMeta(key, '');
    else db.setMeta(key, prev);
  }
});