import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  displayColKeys,
  resolveSortField,
  tierColumnDefs,
} from '../../src/lib/screenerDisplay.js';

test('displayColKeys swaps conviction → orizin for free tier', () => {
  const pro = displayColKeys(true);
  assert.ok(pro.includes('conviction'));
  assert.equal(pro.includes('orizin'), false);

  const free = displayColKeys(false);
  assert.ok(free.includes('orizin'));
  assert.equal(free.includes('conviction'), false);
  assert.deepEqual(
    free,
    pro.map((k) => (k === 'conviction' ? 'orizin' : k)),
  );
});

test('resolveSortField maps orizin to fundamentals score', () => {
  assert.equal(resolveSortField('orizin'), 'score');
  assert.equal(resolveSortField('mcap'), 'mcap');
});

test('tierColumnDefs swaps conviction column metadata', () => {
  const cols = [
    { key: 'symbol', label: 'Symbol' },
    { key: 'conviction', label: 'Conviction' },
  ];
  assert.deepEqual(tierColumnDefs(cols, true), cols);
  const free = tierColumnDefs(cols, false);
  assert.equal(free[1].key, 'orizin');
  assert.equal(free[1].label, 'Orizin');
});