import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computePortfolioOverlap,
  computeSectorGaps,
  overlapChipText,
} from '../../src/lib/portfolioAnalysis.js';

const ctx = {
  hasContext: true,
  heldSymbols: new Set(['AAPL']),
  hasSectorWeights: true,
  sectorWeight: new Map([
    ['Technology', 0.35],
    ['Healthcare', 0.02],
  ]),
};

test('computePortfolioOverlap reports held symbols and heavy sector exposure', () => {
  const held = computePortfolioOverlap({ symbol: 'aapl', sector: 'Technology' }, ctx);
  assert.equal(held.held, true);
  assert.equal(held.sectorHeavy, true);
  assert.equal(held.sectorPct, 0.35);

  const heavy = computePortfolioOverlap({ symbol: 'MSFT', sector: 'Technology' }, ctx);
  assert.equal(heavy.held, false);
  assert.equal(heavy.sectorHeavy, true);

  const light = computePortfolioOverlap({ symbol: 'JNJ', sector: 'Healthcare' }, ctx);
  assert.equal(light.sectorHeavy, false);
});

test('computePortfolioOverlap returns null without context or symbol', () => {
  assert.equal(computePortfolioOverlap({ symbol: 'X' }, null), null);
  assert.equal(computePortfolioOverlap({}, ctx), null);
});

test('computeSectorGaps finds underweight sectors with enough universe names', () => {
  const stocks = [
    { sector: 'Healthcare' },
    { sector: 'Healthcare' },
    { sector: 'Healthcare' },
    { sector: 'Technology' },
  ];
  const gaps = computeSectorGaps(ctx, stocks);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].sector, 'Healthcare');
  assert.equal(gaps[0].portfolioPct, 2);
  assert.equal(gaps[0].universeCount, 3);
});

test('computeSectorGaps ignores sectors with fewer than 3 names', () => {
  const gaps = computeSectorGaps(ctx, [
    { sector: 'Healthcare' },
    { sector: 'Healthcare' },
  ]);
  assert.deepEqual(gaps, []);
});

test('overlapChipText prioritizes held, then heavy sector', () => {
  assert.equal(overlapChipText({ held: true }), 'Already in your portfolio');
  assert.equal(
    overlapChipText({ held: false, sectorHeavy: true, sector: 'Technology', sectorPct: 0.31 }),
    'Heavy Technology exposure (31% of portfolio)',
  );
  assert.equal(overlapChipText({ held: false, sectorHeavy: false }), null);
  assert.equal(overlapChipText(null), null);
});