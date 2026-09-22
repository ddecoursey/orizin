import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeStockRows, decodeStockRows } from '../../src/lib/stocksPayload.js';

test('columnar universe payload round-trips rows, nulls and nested values', () => {
  const rows = [
    { symbol: 'AAA', price: 187.5, mcap: 4990029201000, roic: 0.5186736691216669, pe: null, ori: { intangiblesScore: 80 } },
    { symbol: 'BBB', price: 12, extra: 'only-here' },
  ];
  const decoded = decodeStockRows(JSON.parse(JSON.stringify(encodeStockRows(rows))));
  assert.equal(decoded.length, 2);
  assert.equal(decoded[0].symbol, 'AAA');
  assert.equal(decoded[0].mcap, 4990029201000, 'integers are exact');
  assert.equal(decoded[0].price, 187.5);
  assert.equal(decoded[0].roic, 0.518674, 'floats keep 6 significant digits');
  assert.equal(decoded[0].pe, null);
  assert.deepEqual(decoded[0].ori, { intangiblesScore: 80 });
  assert.equal(decoded[0].extra, null, 'a column missing on a row decodes as null');
  assert.equal(decoded[1].extra, 'only-here');
});

test('decode rejects anything that is not the columnar format', () => {
  assert.equal(decodeStockRows({ stocks: [] }), null);
  assert.equal(decodeStockRows(null), null);
  assert.equal(decodeStockRows({ format: 'columns-v1', columns: 'x', rows: [] }), null);
});
