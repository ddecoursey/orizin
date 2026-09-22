import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveKeyMetrics, deriveRatios } from '../fmp.js';

test('deriveKeyMetrics derives margins and P/S from EV yields without mutating the input', () => {
  const km = { earnings_yield: 0.05, fcf_yield: 0.04, ev_sales: 4, _ev: 200, _haveEv: true };
  const out = deriveKeyMetrics(km, 100);
  assert.equal(out.net_margin, (100 * 0.05 * 4) / 200);
  assert.equal(out.fcf_margin, (100 * 0.04 * 4) / 200);
  assert.equal(out.ps, (100 * 4) / 200);
  assert.equal(out._ev, undefined);
  assert.equal(out._haveEv, undefined);
  assert.equal(km._ev, 200, 'input (possibly a cached response) is untouched');
});

test('deriveKeyMetrics leaves derived fields alone without EV or market cap', () => {
  assert.equal(deriveKeyMetrics({ ev_sales: 4, _ev: 200, _haveEv: true }, null).ps, undefined);
  assert.equal(deriveKeyMetrics(null, 1), null);
});

test('deriveRatios adds EV/gross profit only with a positive gross margin', () => {
  assert.equal(deriveRatios({ gross_margin: 0.5 }, 4).ev_gp, 8);
  assert.equal(deriveRatios({ gross_margin: 0 }, 4).ev_gp, undefined);
  assert.equal(deriveRatios({ gross_margin: 0.5 }, null).ev_gp, undefined);
});
