import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultWatchlists,
  normalizeWatchlists,
  pinsFromTabs,
  migratePinsIntoDefaultWatchlist,
  MAX_WATCHLISTS,
  MAX_WATCHLIST_SYMBOLS,
} from '../../src/lib/watchlistNormalize.js';

test('defaultWatchlists returns a single empty default list', () => {
  const lists = defaultWatchlists();
  assert.equal(lists.length, 1);
  assert.equal(lists[0].id, 'default');
  assert.deepEqual(lists[0].symbols, []);
});

test('normalizeWatchlists uppercases, dedupes, and drops invalid entries', () => {
  const raw = [
    { id: 'default', name: 'Mine', symbols: ['aapl', ' AAPL ', 'msft', ''] },
    { id: '', name: 'Bad', symbols: [] },
    null,
    { name: 'No id', symbols: ['X'] },
  ];
  const out = normalizeWatchlists(raw);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].symbols, ['AAPL', 'MSFT']);
});

test('normalizeWatchlists caps list count and symbol count', () => {
  const manyLists = Array.from({ length: MAX_WATCHLISTS + 3 }, (_, i) => ({
    id: `wl${i}`,
    name: `List ${i}`,
    symbols: [],
  }));
  assert.equal(normalizeWatchlists(manyLists).length, MAX_WATCHLISTS);

  const manySyms = Array.from({ length: MAX_WATCHLIST_SYMBOLS + 5 }, (_, i) => `S${i}`);
  const out = normalizeWatchlists([{ id: 'default', name: 'W', symbols: manySyms }]);
  assert.equal(out[0].symbols.length, MAX_WATCHLIST_SYMBOLS);
});

test('normalizeWatchlists returns default when input is empty or invalid', () => {
  assert.deepEqual(normalizeWatchlists([])[0].id, 'default');
  assert.deepEqual(normalizeWatchlists(null)[0].id, 'default');
});

test('pinsFromTabs collects legacy tab pins', () => {
  const tabs = [
    { state: { pins: ['aapl', 'msft'] } },
    { state: { pins: ['msft', ''] } },
    { state: {} },
  ];
  assert.deepEqual(pinsFromTabs(tabs).sort(), ['AAPL', 'MSFT']);
});

test('migratePinsIntoDefaultWatchlist merges tab pins once when default is empty', () => {
  const tabs = [{ state: { pins: ['nvda'] } }];
  const lists = [{ id: 'default', name: 'Watchlist', symbols: [], updatedAt: 1 }];
  const migrated = migratePinsIntoDefaultWatchlist(lists, tabs);
  assert.deepEqual(migrated[0].symbols, ['NVDA']);

  const withSymbols = [{ id: 'default', name: 'Watchlist', symbols: ['AAPL'], updatedAt: 1 }];
  const skipped = migratePinsIntoDefaultWatchlist(withSymbols, tabs);
  assert.deepEqual(skipped[0].symbols, ['AAPL']);
});

test('migratePinsIntoDefaultWatchlist is a no-op without legacy pins', () => {
  const lists = [{ id: 'default', name: 'Watchlist', symbols: [], updatedAt: 1 }];
  const out = migratePinsIntoDefaultWatchlist(lists, []);
  assert.deepEqual(out[0].symbols, []);
});