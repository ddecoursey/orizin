import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchScreenerStocks } from "../fmp.js";

test("company-screener pagination keeps a constant limit so page offsets do not overlap", async () => {
  const previousKey = process.env.FMP_API_KEY;
  const previousPageSize = process.env.FMP_SCREENER_PAGE_SIZE;
  const realFetch = global.fetch;
  process.env.FMP_API_KEY = "test-key";
  process.env.FMP_SCREENER_PAGE_SIZE = "3";
  const requests = [];
  const pages = [
    ["AAA", "BBB", "CCC"],
    ["DDD", "EEE", "FFF"],
  ];
  global.fetch = async (input) => {
    const url = new URL(input);
    requests.push({
      page: url.searchParams.get("page"),
      limit: url.searchParams.get("limit"),
    });
    const page = Number(url.searchParams.get("page"));
    return new Response(JSON.stringify(
      (pages[page] || []).map((symbol) => ({
        symbol,
        companyName: symbol,
        isEtf: false,
        isFund: false,
      })),
    ), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const rows = await fetchScreenerStocks({ limit: 5 });
    assert.deepEqual(rows.map((row) => row.symbol), ["AAA", "BBB", "CCC", "DDD", "EEE"]);
    assert.deepEqual(requests, [
      { page: "0", limit: "3" },
      { page: "1", limit: "3" },
    ]);
  } finally {
    global.fetch = realFetch;
    if (previousKey == null) delete process.env.FMP_API_KEY;
    else process.env.FMP_API_KEY = previousKey;
    if (previousPageSize == null) delete process.env.FMP_SCREENER_PAGE_SIZE;
    else process.env.FMP_SCREENER_PAGE_SIZE = previousPageSize;
  }
});
