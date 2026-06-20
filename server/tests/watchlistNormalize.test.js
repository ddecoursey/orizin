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
  assert.equal(MAX_WATCHLISTS, 1);
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
  assert.equal(out[0].id, 'default');
  assert.deepEqual(out[0].symbols, ['AAPL', 'MSFT', 'X']);
});

test('normalizeWatchlists merges legacy multi-list payloads into one list', () => {
  const raw = [
    { id: 'default', name: 'A', symbols: ['AAPL'] },
    { id: 'wl_1', name: 'B', symbols: ['MSFT', 'aapl'] },
    { id: 'wl_2', name: 'C', symbols: ['NVDA'] },
  ];
  const out = normalizeWatchlists(raw);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].symbols, ['AAPL', 'MSFT', 'NVDA']);
});

test('normalizeWatchlists caps symbol count', () => {
  const manySyms = Array.from({ length: MAX_WATCHLIST_SYMBOLS + 5 }, (_, i) => `S${i}`);
  const out = normalizeWatchlists([{ id: 'default', name: 'W', symbols: manySyms }]);
  assert.equal(out[0].symbols.length, MAX_WATCHLIST_SYMBOLS);
});

test('normalizeWatchlists returns default when input is empty or invalid', () => {
  assert.deepEqual(normalizeWatchlists([])[0].id, 'default');
  assert.deepEqual(normalizeWatchlists(null)[0].id, 'default');
});

test('normalizeWatchlists preserves stored updatedAt without bumping to now', () => {
  const past = 1_700_000_000_000;
  const out = normalizeWatchlists([{ id: 'default', name: 'W', symbols: ['AAPL'], updatedAt: past }]);
  assert.equal(out[0].updatedAt, past);
});

test('pinsFromTabs collects legacy tab pins', () => {
  const tabs = [
    { state: { pins: ['aapl', 'msft'] } },
    { state: { pins: ['msft', ''] } },
    { state: {} },
  ];
  assert.deepEqual(pinsFromTabs(tabs).sort(), ['AAPL', 'MSFT']);
});

test('migratePinsIntoDefaultWatchlist merges tab pins when default is empty', () => {
  const tabs = [{ state: { pins: ['nvda'] } }];
  const lists = [{ id: 'default', name: 'Watchlist', symbols: [], updatedAt: 1 }];
  const migrated = migratePinsIntoDefaultWatchlist(lists, tabs);
  assert.deepEqual(migrated[0].symbols, ['NVDA']);
});