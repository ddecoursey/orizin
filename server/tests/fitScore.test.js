import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFitContext, computeFit } from '../../src/lib/fitScore.js';

test('buildFitContext reads holdings from ticker or legacy symbol field', () => {
  const ctx = buildFitContext({
    portfolios: [{
      id: 'p1',
      name: 'Manual',
      totalInvested: 10000,
      holdings: [{ symbol: 'PLTR', dollars: 10000 }],
    }],
    goals: [],
    theses: [],
    stocks: [{ symbol: 'PLTR', sector: 'Technology', name: 'Palantir' }],
  });
  assert.equal(ctx.hasContext, true);
  assert.ok(ctx.heldSymbols.has('PLTR'));
});

test('computeFit scores held symbols in the user portfolio', () => {
  const ctx = buildFitContext({
    portfolios: [{
      id: 'p1',
      name: 'Manual',
      totalInvested: 0,
      holdings: [{ ticker: 'PLTR' }],
    }],
    goals: [],
    theses: [],
    stocks: [{ symbol: 'PLTR', sector: 'Technology' }],
  });
  const fit = computeFit({ symbol: 'PLTR', sector: 'Technology' }, ctx);
  assert.equal(fit.needsContext, false);
  assert.equal(fit.held, true);
  assert.ok(fit.score != null);
  assert.ok(fit.reasons.some((r) => /portfolio/i.test(r)));
});