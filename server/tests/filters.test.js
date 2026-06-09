// Regression tests for the screener filter matcher — specifically the
// "add a filter, then clear it" bug: a cleared Sidebar input leaves
// { op, value: "" } in state, and global isFinite("") is true (coerces to 0),
// so a cleared "P/E ≤" used to act as "P/E ≤ 0" and empty the table.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyFilters, DEFAULT_FILTERS } from '../../src/hooks/useScreener.js';

const ROWS = [
  { symbol: 'AAA', name: 'Alpha', pe: 10, mcap: 5e9, price: 50, beta: 0.9, gross_margin: 0.55, roic: 0.18, volume: 2e6 },
  { symbol: 'BBB', name: 'Beta Co', pe: 25, mcap: 50e9, price: 120, beta: 1.4, gross_margin: 0.35, roic: 0.09, volume: 8e6 },
  { symbol: 'CCC', name: 'Gamma', pe: null, mcap: 0.8e9, price: 8, beta: null, gross_margin: null, roic: null, volume: 0.4e6 },
];

const NO_PINS = new Set();
const f = (overrides) => ({ ...DEFAULT_FILTERS, ...overrides });
const syms = (rows) => rows.map((r) => r.symbol);

test('cleared max-style filter ({op:"<=", value:""}) is a no-op, not "≤ 0"', () => {
  const out = applyFilters(ROWS, f({ peMax: { op: '<=', value: '' } }), NO_PINS);
  assert.deepEqual(syms(out), ['AAA', 'BBB', 'CCC']);
});

test('cleared min-style filter is a no-op', () => {
  const out = applyFilters(ROWS, f({ roicMin: { op: '>=', value: '' } }), NO_PINS);
  assert.deepEqual(syms(out), ['AAA', 'BBB', 'CCC']);
});

test('between with both sides empty is a no-op; one-sided between works', () => {
  const both = applyFilters(ROWS, f({ mcap: { op: 'between', min: '', max: '' } }), NO_PINS);
  assert.deepEqual(syms(both), ['AAA', 'BBB', 'CCC']);

  const minOnly = applyFilters(ROWS, f({ mcap: { op: 'between', min: '2', max: '' } }), NO_PINS);
  assert.deepEqual(syms(minOnly), ['AAA', 'BBB']); // CCC = $0.8B drops

  const maxOnly = applyFilters(ROWS, f({ mcap: { op: 'between', min: '', max: 10 } }), NO_PINS);
  assert.deepEqual(syms(maxOnly), ['AAA', 'CCC']); // BBB = $50B drops
});

test('cleared base-key condition (price/beta) is a no-op', () => {
  const price = applyFilters(ROWS, f({ price: { op: '<=', value: '' } }), NO_PINS);
  assert.deepEqual(syms(price), ['AAA', 'BBB', 'CCC']);
  const beta = applyFilters(ROWS, f({ beta: { op: '>=', value: '' } }), NO_PINS);
  assert.deepEqual(syms(beta), ['AAA', 'BBB', 'CCC']);
});

test('real values still filter (string inputs included)', () => {
  // Sidebar inputs store strings — they must filter like numbers.
  const pe = applyFilters(ROWS, f({ peMax: { op: '<=', value: '15' } }), NO_PINS);
  // CCC has null P/E — missing metrics pass by design.
  assert.deepEqual(syms(pe), ['AAA', 'CCC']);

  const legacyFlat = applyFilters(ROWS, f({ grossMin: '40' }), NO_PINS);
  assert.deepEqual(syms(legacyFlat), ['AAA', 'CCC']); // 55% passes, 35% fails, null passes

  const between = applyFilters(ROWS, f({ beta: { op: 'between', min: '0.8', max: '1.0' } }), NO_PINS);
  assert.deepEqual(syms(between), ['AAA', 'CCC']); // 1.4 drops, null passes
});

test('add-then-remove round trip restores the full table', () => {
  const applied = applyFilters(ROWS, f({ peMax: { op: '<=', value: 15 } }), NO_PINS);
  assert.equal(applied.length, 2);
  // User clears the input → value becomes "" but the op object stays.
  const cleared = applyFilters(ROWS, f({ peMax: { op: '<=', value: '' } }), NO_PINS);
  assert.equal(cleared.length, ROWS.length, 'clearing the input must restore all rows');
});

test('search and pinnedOnly still behave', () => {
  const search = applyFilters(ROWS, f({ search: 'alpha' }), NO_PINS);
  assert.deepEqual(syms(search), ['AAA']);
  const pinned = applyFilters(ROWS, f({ pinnedOnly: true }), new Set(['BBB']));
  assert.deepEqual(syms(pinned), ['BBB']);
});
