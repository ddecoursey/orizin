import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveRank, RANKS, parseSessionPlan, hasOriAccess } from '../../src/lib/ranks.js';

test('resolveRank maps plans to thematic ranks', () => {
  assert.equal(resolveRank({ plan: 'free' }).id, 'traveler');
  assert.equal(resolveRank({ plan: 'pro' }).id, 'voyager');
  assert.equal(resolveRank({ plan: 'ultimate' }).id, 'starfarer');
  assert.equal(resolveRank({ plan: 'free', isAdmin: true }).id, 'admin');
});

test('parseSessionPlan maps API plans', () => {
  assert.equal(parseSessionPlan('ultimate'), 'ultimate');
  assert.equal(parseSessionPlan('pro'), 'pro');
  assert.equal(parseSessionPlan('free'), 'free');
});

test('hasOriAccess includes ultimate and admin', () => {
  assert.equal(hasOriAccess({ plan: 'ultimate' }), true);
  assert.equal(hasOriAccess({ plan: 'pro' }), true);
  assert.equal(hasOriAccess({ plan: 'free', isAdmin: true }), true);
  assert.equal(hasOriAccess({ plan: 'free' }), false);
});

test('ranks keep familiar tier labels', () => {
  assert.equal(RANKS.traveler.label, 'Free');
  assert.equal(RANKS.voyager.label, 'Pro');
  assert.equal(RANKS.starfarer.label, 'Ultimate');
});