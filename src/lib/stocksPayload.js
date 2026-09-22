// Compact wire format for the full universe (GET /api/stocks?format=columns).
//
// ~8k rows × ~55 fields as JSON objects repeat every key on every row and ship
// floats like 0.5186736691216669. Sending { columns, rows: [[…], …] } with
// non-integer numbers rounded to 6 significant digits halves the gzipped
// payload (≈2.2 MB → ≈1.1 MB) and cuts the JSON the browser must parse from
// ≈9.7 MB to ≈3.4 MB. Six significant digits is far below anything the UI shows
// or the scoring thresholds can distinguish. Shared by server and client so the
// two sides can't disagree.

export const STOCKS_FORMAT = "columns-v1";

const round6 = (v) => (typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v);

export function encodeStockRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const columns = [];
  const seen = new Set();
  for (const row of list) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return {
    format: STOCKS_FORMAT,
    columns,
    rows: list.map((row) => columns.map((c) => (row[c] === undefined ? null : round6(row[c])))),
  };
}

export function decodeStockRows(payload) {
  if (!payload || payload.format !== STOCKS_FORMAT || !Array.isArray(payload.columns) || !Array.isArray(payload.rows)) {
    return null;
  }
  const { columns } = payload;
  return payload.rows.map((values) => {
    const row = {};
    for (let i = 0; i < columns.length; i++) row[columns[i]] = values[i] ?? null;
    return row;
  });
}
