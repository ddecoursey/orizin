import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  displayColKeys,
  resolveSortField,
  tierColumnDefs,
} from '../../src/lib/screenerDisplay.js';

test('displayColKeys always includes conviction', () => {
  const keys = displayColKeys();
  assert.ok(keys.includes('conviction'));
  assert.equal(keys.includes('orizin'), false);
});

test('resolveSortField passes through sort keys', () => {
  assert.equal(resolveSortField('conviction'), 'conviction');
  assert.equal(resolveSortField('mcap'), 'mcap');
});

test('tierColumnDefs returns columns unchanged', () => {
  const cols = [
    { key: 'symbol', label: 'Symbol' },
    { key: 'conviction', label: 'Conviction' },
  ];
  assert.deepEqual(tierColumnDefs(cols), cols);
});