import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  displayColKeys,
  resolveSortField,
  applyWatchlistFilter,
  tierColumnDefs,
} from '../../src/lib/screenerDisplay.js';

const ROWS = [
  { symbol: 'AAA', score: 80, mcap: 1e9 },
  { symbol: 'BBB', score: 60, mcap: 2e9 },
  { symbol: 'CCC', score: 40, mcap: 3e9 },
];

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

test('applyWatchlistFilter is a no-op when pinnedOnly is false', () => {
  assert.deepEqual(
    applyWatchlistFilter(ROWS, false, new Set(['AAA']), new Set(['BBB'])),
    ROWS,
  );
});

test('applyWatchlistFilter prefers watchlist symbols over tab pins', () => {
  const out = applyWatchlistFilter(
    ROWS,
    true,
    new Set(['AAA']),
    new Set(['BBB']),
  );
  assert.deepEqual(out.map((r) => r.symbol), ['AAA']);
});

test('applyWatchlistFilter falls back to tab pins when watchlist is empty', () => {
  const out = applyWatchlistFilter(
    ROWS,
    true,
    new Set(),
    new Set(['BBB', 'CCC']),
  );
  assert.deepEqual(out.map((r) => r.symbol), ['BBB', 'CCC']);
});