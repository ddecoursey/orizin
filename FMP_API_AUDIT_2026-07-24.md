# FMP API access and project-usage audit

Audit date: 2026-07-24 UTC

## Executive summary

- The live FMP documentation exposed 263 sample API cards representing 230 unique `/stable` paths.
- This account returned HTTP 200 for 158 unique documented paths and HTTP 402 for 72 paths.
- Orizin currently references 41 FMP paths:
  - 40 documented paths returned HTTP 200.
  - The undocumented fallback `/stable/stock/list` returned HTTP 404 with `[]`.
- Therefore, 118 currently callable documented paths are not used by the project.
- The authenticated legacy changelog route returned HTTP 403 even though the same key works on `/stable`. The public changelog page remains available and currently has updates through June 5, 2026.
- FMP's current public Starter summary says 300 calls/minute, five years of history, U.S. coverage, annual fundamentals and ratios, historical stock prices, news, crypto, and forex. The observed account access is broader than that summary for several endpoint families, so this report treats live probe results as the practical truth for this key today—not as a contractual guarantee.

## Implemented after the audit

The repository now includes the first high-value remediation batch:

- Company-screener refreshes use the new `page` parameter with a constant,
  configurable page size and symbol deduplication.
- The broken `/stable/stock/list` fallback was replaced with the supported paged
  company screener.
- Latest technical-indicator calls now request only a 14-day output window,
  reducing each observed response from roughly 1,255 rows to about 8 while
  retaining FMP's server-calculated 200-day values.
- Per-symbol earnings retain `time`, `periodEnding`, `fiscalPeriod`,
  `fiscalYear`, `confirmed`, and `lastUpdated`.
- Congressional-trade results retain `senateID` / `houseID`.
- A symbol-level 402 from executive compensation is remembered for the process
  so repeated detail refreshes do not keep spending calls on the same denial.
- Ori now integrates FMP's hosted MCP server. It discovers the live tool schemas,
  exposes only message-relevant Starter-safe endpoints, shares the existing FMP
  rate budget, caches and trims results, limits each turn to three calls over two
  tool rounds, and returns tool errors to Gemini without breaking the chat.

The remaining items under “Highest-value next integrations” are the backlog
after this implementation batch.

## How the audit was run

1. Scraped the current official FMP stable documentation in a browser and extracted every documented example.
2. Sent a paced, sequential GET probe for every example using the configured key in an HTTP header.
3. Read only a small response prefix during the main sweep to reduce bandwidth on list and bulk endpoints.
4. Deduplicated the 263 examples into 230 unique endpoint paths.
5. Compared those paths with all FMP calls in `server/fmp.js` and their call sites.
6. Re-tested the project's symbol endpoints with ORCL and FICO, not just the documentation's AAPL example.
7. Corrected two inconclusive documentation probes:
   - `/stable/industry-classification-search` returned 200 when supplied `symbol=AAPL`.
   - `/stable/insider-trading/reporting-name` returned 200 on retry with `name=Zuckerberg`.

The full sweep produced no HTTP 429 responses. The API key and raw response bodies are not stored in this report.

## Latest changelog items Orizin can use

### June 5, 2026

1. Stock Screener pagination

   FMP added `page` to `/stable/company-screener`. A live check with `limit=3` returned different symbols on pages 0 and 1. Orizin currently sends a large `limit` but no page, so a capped response can silently truncate the universe.

2. Earnings Calendar report timing

   `/stable/earnings-calendar?includeReportTimes=true` is callable. A live response included:

   - `time` such as `bmo`
   - `periodEnding`
   - `fiscalPeriod`
   - `fiscalYear`
   - `confirmed`
   - `lastUpdated`

   Orizin currently uses the per-symbol `/stable/earnings` endpoint and drops these timing/confirmation fields. A cached daily calendar pull could add pre-market/after-market timing and confirmed-versus-estimated status without one calendar request per symbol.

3. Stable legislator identity

   FMP added `senateID` to Senate and House trade data. Live Senate and House responses both contained it. Orizin's `fetchCongressTrades` mapper currently drops the field, retaining only the name, district, transaction type, and amount. Keeping `senateID` would improve grouping, deduplication, and longitudinal tracking.

### Other useful recent changes

- December 16, 2025: `/stable/etf/info` added `isActivelyTrading`. The endpoint is callable and also exposes useful ETF fields such as expense ratio and assets under management.
- November 24, 2025: the splits calendar added `splitType`.
- October 28, 2025: delisted-company synchronization was improved. `/stable/delisted-companies` is callable and returned recent 2026 removals.
- October 9, 2025: CUSIP matching was improved. `/stable/search-cusip` is callable.
- August 27, 2025: legacy routes became auth-gated for eligible accounts. This explains why `/api/v3/changelog` returns 403 for this key while stable APIs work.
- April 17, 2025: `dividendPerShareTTM` was restored to TTM ratios. The live AAPL response also contains `forwardPriceToEarningsGrowthRatioTTM`; Orizin's ratio mapper currently drops both.

## Highest-value next integrations

1. Make the universe refresh page-aware.

   Loop over `/stable/company-screener?page=N` until a short/empty page, deduplicate symbols, and retain the existing stable-list fallback. This directly uses the newest changelog addition and avoids silent universe truncation.

2. Add a cached corporate-events layer.

   The callable, unused endpoints `/stable/earnings-calendar`, `/stable/dividends-calendar`, `/stable/splits-calendar`, `/stable/delisted-companies`, and `/stable/symbol-change` can support upcoming-event warnings and keep the universe/watchlists clean.

3. Add ETF-specific research.

   `/stable/etf/info`, `/stable/etf/sector-weightings`, and `/stable/etf/country-weightings` all work. They can give ETFs meaningful details even though holdings are plan-gated. The tested SPY response included `isActivelyTrading`, expense ratio, and assets under management.

4. Enrich quality and risk scoring.

   `/stable/financial-scores`, `/stable/shares-float`, `/stable/enterprise-values`, `/stable/stock-price-change`, and `/stable/insider-trading/statistics` are callable. They can add distress/quality scores, dilution/liquidity context, multi-horizon performance, and summarized insider behavior.

5. Improve Deep Research.

   Callable unused paths include product/geographic revenue segmentation, as-reported statements, financial-report documents, historical ratings, grade consensus, price-target summary, custom DCF, and levered DCF.

6. Add macro inputs to Strategies.

   `/stable/treasury-rates`, `/stable/economic-indicators`, `/stable/economic-calendar`, and `/stable/market-risk-premium` all work and can augment the existing sector/industry/mover context.

7. Improve search and symbol canonicalization.

   Symbol/name search, exchange variants, CIK/CUSIP/ISIN search, profile-by-CIK, and SEC profile/search paths are callable. Exchange variants are particularly useful for duplicate listings, ADRs, and canonical-symbol decisions.

## Problems and avoidable cost in the current integration

### 1. Broken last-resort universe fallback

`fetchStockList()` falls back to:

`/stable/stock/list`

That path is not in the stable documentation and returned HTTP 404 with an empty array. The normal `/stable/stock-list` and `/stable/etf-list` paths work, but the fallback will not rescue a failure.

### 2. Executive compensation is symbol-limited

`/stable/governance-executive-compensation` returned:

- AAPL: 200
- ORCL: 402
- FICO: 402

The project already has an optional `FMP_EXEC_COMP_SYMBOLS` gate and `.env.example` contains an 87-symbol Starter allowlist, but the active `.env` does not configure it. As a result, Deep Research can make predictable 402 calls for unsupported symbols.

### 3. Latest-indicator calls download full histories

For both ORCL and FICO, every tested daily technical-indicator request returned 1,255 rows. The Deep Research technical bundle calls seven endpoints and then keeps only the newest row:

- SMA 50
- SMA 200
- EMA 20
- RSI 14
- ADX 14
- Williams %R 14
- Standard deviation 20

That is 8,785 returned records per uncached symbol merely to select seven values. FMP supports `from` and `to` on technical indicators. Supplying a sufficient warm-up range—or deriving indicators from one OHLC history pull—would materially reduce bandwidth and latency.

### 4. Newly available fields are discarded

- Congress trades discard `senateID`.
- TTM ratios discard `dividendPerShareTTM` and `forwardPriceToEarningsGrowthRatioTTM`.
- The project does not use the earnings calendar's `time`, `confirmed`, fiscal-period, or last-updated fields.

### 5. The project does not use screener pagination

Both stock and ETF/fund screener calls send `limit` but no `page`, despite the June 2026 pagination addition.

## FMP paths currently used by Orizin

All paths below returned HTTP 200 unless explicitly noted. The 29 broadly useful per-symbol paths tested with ORCL and FICO also returned 200; executive compensation was the only tested symbol-limited exception.

### Universe and directory

- `/stable/company-screener`
- `/stable/stock-list`
- `/stable/etf-list`
- `/stable/stock/list` — HTTP 404; undocumented fallback

### Company, fundamentals, valuation, and analyst data

- `/stable/profile`
- `/stable/key-metrics-ttm`
- `/stable/ratios-ttm`
- `/stable/income-statement`
- `/stable/balance-sheet-statement`
- `/stable/cash-flow-statement`
- `/stable/financial-growth`
- `/stable/owner-earnings`
- `/stable/analyst-estimates`
- `/stable/ratings-snapshot`
- `/stable/grades`
- `/stable/stock-peers`
- `/stable/governance-executive-compensation` — callable but symbol-limited
- `/stable/discounted-cash-flow`
- `/stable/price-target-consensus`

### Price and technical data

- `/stable/quote`
- `/stable/historical-price-eod/light`
- `/stable/historical-chart/5min`
- `/stable/technical-indicators/sma`
- `/stable/technical-indicators/ema`
- `/stable/technical-indicators/rsi`
- `/stable/technical-indicators/adx`
- `/stable/technical-indicators/williams`
- `/stable/technical-indicators/standarddeviation`

### Events, filings, trades, and news

- `/stable/earnings`
- `/stable/senate-trades`
- `/stable/house-trades`
- `/stable/insider-trading/search`
- `/stable/sec-filings-search/symbol`
- `/stable/news/stock`
- `/stable/news/general-latest`

### Market context

- `/stable/historical-sector-performance`
- `/stable/historical-industry-performance`
- `/stable/historical-sector-pe`
- `/stable/historical-industry-pe`
- `/stable/biggest-gainers`
- `/stable/biggest-losers`

## Callable but unused paths (118)

These paths returned HTTP 200 with the current key and a valid documentation example. A 200 can still be parameter-, history-, geography-, or symbol-limited.

### Search and directory

- `/stable/actively-trading-list`
- `/stable/available-countries`
- `/stable/available-exchanges`
- `/stable/available-industries`
- `/stable/available-sectors`
- `/stable/cik-list`
- `/stable/financial-statement-symbol-list`
- `/stable/search-cik`
- `/stable/search-cusip`
- `/stable/search-exchange-variants`
- `/stable/search-isin`
- `/stable/search-name`
- `/stable/search-symbol`
- `/stable/symbol-change`

### Company and reference data

- `/stable/company-notes`
- `/stable/delisted-companies`
- `/stable/employee-count`
- `/stable/historical-employee-count`
- `/stable/historical-market-capitalization`
- `/stable/key-executives`
- `/stable/market-capitalization`
- `/stable/market-capitalization-batch`
- `/stable/mergers-acquisitions-latest`
- `/stable/profile-cik`
- `/stable/shares-float`
- `/stable/shares-float-all`

### Quotes, prices, and charts

- `/stable/aftermarket-quote`
- `/stable/aftermarket-trade`
- `/stable/historical-chart/15min`
- `/stable/historical-chart/1hour`
- `/stable/historical-chart/30min`
- `/stable/historical-chart/4hour`
- `/stable/historical-price-eod/dividend-adjusted`
- `/stable/historical-price-eod/full`
- `/stable/historical-price-eod/non-split-adjusted`
- `/stable/quote-short`
- `/stable/stock-price-change`

### Statements, ratios, reports, and segmentation

- `/stable/balance-sheet-statement-as-reported`
- `/stable/balance-sheet-statement-growth`
- `/stable/cash-flow-statement-as-reported`
- `/stable/cash-flow-statement-growth`
- `/stable/enterprise-values`
- `/stable/financial-reports-dates`
- `/stable/financial-reports-json`
- `/stable/financial-reports-xlsx`
- `/stable/financial-scores`
- `/stable/financial-statement-full-as-reported`
- `/stable/income-statement-as-reported`
- `/stable/income-statement-growth`
- `/stable/key-metrics`
- `/stable/ratios`
- `/stable/revenue-geographic-segmentation`
- `/stable/revenue-product-segmentation`

### Valuation and analyst data

- `/stable/custom-discounted-cash-flow`
- `/stable/custom-levered-discounted-cash-flow`
- `/stable/grades-consensus`
- `/stable/grades-historical`
- `/stable/levered-discounted-cash-flow`
- `/stable/price-target-summary`
- `/stable/ratings-historical`

### Corporate calendars and events

- `/stable/dividends`
- `/stable/dividends-calendar`
- `/stable/earnings-calendar`
- `/stable/ipos-calendar`
- `/stable/ipos-disclosure`
- `/stable/ipos-prospectus`
- `/stable/splits`
- `/stable/splits-calendar`

### News

- `/stable/fmp-articles`
- `/stable/news/crypto`
- `/stable/news/crypto-latest`
- `/stable/news/forex`
- `/stable/news/forex-latest`
- `/stable/news/stock-latest`

### ETF, forex, crypto, and commodity reference data

- `/stable/commodities-list`
- `/stable/cryptocurrency-list`
- `/stable/etf/country-weightings`
- `/stable/etf/info`
- `/stable/etf/sector-weightings`
- `/stable/forex-list`

### SEC and industry classification

- `/stable/all-industry-classification`
- `/stable/industry-classification-search`
- `/stable/sec-filings-8k`
- `/stable/sec-filings-company-search/cik`
- `/stable/sec-filings-company-search/name`
- `/stable/sec-filings-company-search/symbol`
- `/stable/sec-filings-financials`
- `/stable/sec-filings-search/cik`
- `/stable/sec-filings-search/form-type`
- `/stable/sec-profile`
- `/stable/standard-industrial-classification-list`

### Insider and congressional data

- `/stable/acquisition-of-beneficial-ownership`
- `/stable/house-latest`
- `/stable/house-trades-by-name`
- `/stable/insider-trading-transaction-type`
- `/stable/insider-trading/latest`
- `/stable/insider-trading/reporting-name`
- `/stable/insider-trading/statistics`
- `/stable/senate-latest`
- `/stable/senate-trades-by-name`

### Index, market-hours, and market-performance data

- `/stable/all-exchange-market-hours`
- `/stable/exchange-market-hours`
- `/stable/holidays-by-exchange`
- `/stable/index-list`
- `/stable/most-actives`

### Economics

- `/stable/economic-calendar`
- `/stable/economic-indicators`
- `/stable/market-risk-premium`
- `/stable/treasury-rates`

### Additional technical indicators

- `/stable/technical-indicators/dema`
- `/stable/technical-indicators/tema`
- `/stable/technical-indicators/wma`

### Fundraising

- `/stable/crowdfunding-offerings`
- `/stable/crowdfunding-offerings-latest`
- `/stable/crowdfunding-offerings-search`
- `/stable/fundraising`
- `/stable/fundraising-latest`
- `/stable/fundraising-search`

## Plan-gated paths (72)

These returned HTTP 402, "Restricted Endpoint," with the current key and documentation parameters.

### Batch quotes

- `/stable/batch-aftermarket-quote`
- `/stable/batch-aftermarket-trade`
- `/stable/batch-commodity-quotes`
- `/stable/batch-crypto-quotes`
- `/stable/batch-etf-quotes`
- `/stable/batch-exchange-quote`
- `/stable/batch-forex-quotes`
- `/stable/batch-index-quotes`
- `/stable/batch-mutualfund-quotes`
- `/stable/batch-quote`
- `/stable/batch-quote-short`

### Bulk delivery

- `/stable/balance-sheet-statement-bulk`
- `/stable/balance-sheet-statement-growth-bulk`
- `/stable/cash-flow-statement-bulk`
- `/stable/cash-flow-statement-growth-bulk`
- `/stable/dcf-bulk`
- `/stable/earnings-surprises-bulk`
- `/stable/eod-bulk`
- `/stable/etf-holder-bulk`
- `/stable/income-statement-bulk`
- `/stable/income-statement-growth-bulk`
- `/stable/key-metrics-ttm-bulk`
- `/stable/peers-bulk`
- `/stable/price-target-summary-bulk`
- `/stable/profile-bulk`
- `/stable/rating-bulk`
- `/stable/ratios-ttm-bulk`
- `/stable/scores-bulk`
- `/stable/upgrades-downgrades-consensus-bulk`

### TTM and latest financial statements

- `/stable/balance-sheet-statement-ttm`
- `/stable/cash-flow-statement-ttm`
- `/stable/income-statement-ttm`
- `/stable/latest-financial-statements`

### Earnings transcripts

- `/stable/earning-call-transcript`
- `/stable/earning-call-transcript-dates`
- `/stable/earning-call-transcript-latest`
- `/stable/earnings-transcript-list`

### ETF and mutual-fund holdings/disclosures

- `/stable/etf/asset-exposure`
- `/stable/etf/holdings`
- `/stable/funds/disclosure`
- `/stable/funds/disclosure-dates`
- `/stable/funds/disclosure-holders-latest`
- `/stable/funds/disclosure-holders-search`

### Institutional ownership / Form 13F

- `/stable/institutional-ownership/dates`
- `/stable/institutional-ownership/extract`
- `/stable/institutional-ownership/extract-analytics/holder`
- `/stable/institutional-ownership/holder-industry-breakdown`
- `/stable/institutional-ownership/holder-performance-summary`
- `/stable/institutional-ownership/industry-summary`
- `/stable/institutional-ownership/latest`
- `/stable/institutional-ownership/symbol-positions-summary`

### Index constituents

- `/stable/dowjones-constituent`
- `/stable/historical-dowjones-constituent`
- `/stable/historical-nasdaq-constituent`
- `/stable/historical-sp500-constituent`
- `/stable/nasdaq-constituent`
- `/stable/sp500-constituent`

### Premium market data

- `/stable/historical-chart/1min`
- `/stable/industry-pe-snapshot`
- `/stable/industry-performance-snapshot`
- `/stable/sector-pe-snapshot`
- `/stable/sector-performance-snapshot`

### ESG and commitments of traders

- `/stable/commitment-of-traders-analysis`
- `/stable/commitment-of-traders-list`
- `/stable/commitment-of-traders-report`
- `/stable/esg-benchmark`
- `/stable/esg-disclosures`
- `/stable/esg-ratings`

### Press releases and M&A

- `/stable/mergers-acquisitions-search`
- `/stable/news/press-releases`
- `/stable/news/press-releases-latest`

### Other

- `/stable/executive-compensation-benchmark`

## Important interpretation notes

- HTTP 200 means the tested route and example work with this key now. It does not promise all symbols, dates, exchanges, or parameter combinations.
- Executive compensation demonstrably has symbol-level restrictions.
- Some 200 responses can legitimately be empty because no matching event/data exists.
- Access can change if FMP changes plan enforcement or the subscription.
- FMP's public pricing page currently states a 20 GB rolling 30-day bandwidth allowance for Starter. This is important because several accessible endpoints return large histories even when Orizin only needs one row.

## Official references

- Stable API documentation: https://site.financialmodelingprep.com/developer/docs
- Changelog: https://site.financialmodelingprep.com/developer/docs/changelog
- Hosted MCP server: https://site.financialmodelingprep.com/developer/docs/mcp-server
- Pricing and plan comparison: https://site.financialmodelingprep.com/pricing-plans
