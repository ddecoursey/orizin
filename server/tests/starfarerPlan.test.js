import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizePlan,
  hasOriPlan,
  setUserPlan,
  setUserSubscription,
  createUser,
  getUserByUsername,
  deleteUserCascade,
} from '../db.js';
import { hasOriAccess } from '../access.js';
import { oriLimitsForPlan } from '../oriUsage.js';

test('normalizePlan accepts ultimate / starfarer', () => {
  assert.equal(normalizePlan('ultimate'), 'ultimate');
  assert.equal(normalizePlan('starfarer'), 'ultimate');
  assert.equal(normalizePlan('pro'), 'pro');
  assert.equal(normalizePlan('free'), 'free');
});

test('hasOriPlan includes ultimate', () => {
  assert.equal(hasOriPlan('ultimate'), true);
  assert.equal(hasOriPlan('pro'), true);
  assert.equal(hasOriPlan('free'), false);
});

test('oriLimitsForPlan doubles caps for ultimate by default', () => {
  const voyager = oriLimitsForPlan('pro');
  const starfarer = oriLimitsForPlan('ultimate');
  assert.ok(starfarer.session >= voyager.session);
  assert.ok(starfarer.daily >= voyager.daily);
  assert.ok(starfarer.weekly >= voyager.weekly);
  assert.ok(starfarer.monthly >= voyager.monthly);
  assert.equal(starfarer.sessionHours, voyager.sessionHours);
});

test('setUserSubscription does not clobber admin Starfarer plan', () => {
  const user = `starfarer-${Date.now()}@test.local`;
  createUser(user, 'testpass1', false, user, 'free');
  setUserPlan(user, 'ultimate');
  setUserSubscription(user, { subscriptionId: 'I-TEST', status: 'EXPIRED', proUntil: null });
  const row = getUserByUsername(user);
  assert.equal(normalizePlan(row.plan), 'ultimate');
  deleteUserCascade(user);
});

test('hasOriAccess grants Ori to ultimate plan users', () => {
  const user = `ori-ultimate-${Date.now()}@test.local`;
  createUser(user, 'testpass1', false, user, 'free');
  setUserPlan(user, 'ultimate');
  assert.equal(hasOriAccess(user), true);
  deleteUserCascade(user);
});