# Architecture, bug and security review — 2026-09-22

Branch: `tour-and-bug-fixes`. Scope: server (`server/`), client (`src/`), data
freshness, rate limiting, auth/session, billing, and Ori (Gemini) flows.
Status legend: **Fixed** (in this branch, with tests where practical),
**Recommend** (not changed; needs a product/ops decision).

## 1. Reported problems — root causes

### 1.1 Stock prices stale / out of sync — **Fixed**

| Cause | Effect | Fix |
| --- | --- | --- |
| Prices refreshed one `/quote` call per symbol. Top 500 by market cap every ~30 min; everything else on a **6-hour** rotation; nothing overnight. Batch quote endpoints are plan-restricted (402) and comma-separated `/quote` returns `[]`. | Most of the ~8k-row universe showed prices hours old during the session. A name last quoted at 1 PM kept that price all night and all weekend (close never captured). | `server/priceSweep.js`: session-aware **universe price sweep** through the paged company screener (price, volume and market cap included; ~1 call per 1,000 symbols). Every 10 min open, 30 min pre/after, 6 h closed, plus a sweep on every session change so the close lands. Only price fields and `price_updated_at` move — never `updated_at`, which drives the fundamentals rotation — and a live quote newer than the sweep is kept. Verified: screener price = `/quote` price (NVDA 228.87 both, at the close). |
| The browser read `/api/stocks` once at page load and never again (except watchlist symbols). | An open tab drifted further out of date all day. | `GET /api/stocks/prices?since=` (SQLite only) returns just the rows re-priced since the cursor; `useScreener` polls every 3 min while visible and immediately on returning to the tab. |
| Deep Research never refreshed anything for non-admins; admins ran the heavy force re-gather on **every** open, which shares `enrichLimiter` (3/hour in prod). | Non-admins saw whatever the rotation last wrote. Admins hit 429 on the 4th open in an hour, which also blocked the Data menu. | `POST /api/stocks/sync/:symbol` for **every** account: live quote if older than 60 s (6 h while closed), key metrics + ratios if missing or older than 24 h. Coalesced per symbol, 30 s per-symbol throttle, 20/min per user. Off-universe symbols get a read-only transient row (never inserted into the shared table) so the Game Plan works for them too. Manual Re-gather stays admin-only. |
| DR chart read the 5-year sparkline from the DB with no maximum age. | Chart could end weeks before today. | Chart requests `maxAgeHours=20`; if the refetch fails the server now returns the aged series instead of an empty chart. |

### 1.2 "Refresh Ori" on Deep Research fails on the first try — **Fixed**

1. **Shared limiter starvation.** One DR open fires ~16 requests on `aiDetailLimiter`
   (30/min). The Game Plan shared that limiter and always went last (after its
   350 ms defer). The DR open also fetched everything **twice**: non-admins bumped
   `detailReloadToken` immediately, admins after the auto re-gather. That's
   ~34 requests, so the Game Plan / Refresh got HTTP 429. The client's backoff
   capped at 8 s × 3 retries, well inside the 60 s window, so it failed. A second
   click a minute later worked.
   *Fix:* Game Plan has its own `gamePlanLimiter` (12/min; spend is still metered
   by the Ori quota). The data-panel limiter was raised to 150/min (every one of
   those routes is cached, and FMP is bounded by the global rate gate). The open
   flow no longer bumps the reload token.
2. **Stuck "loading" state.** `useGamePlanOri` kept `prev.enabled = true` through a
   disable, so if the effect cleanup aborted an in-flight request and the hook
   re-enabled for the same symbol, nothing re-fired. The take spun forever, and
   `refresh()`/`retry()` were no-ops. *Fix:* record the disabled state.
3. **A failed refresh destroyed a good take.** Any refresh failure replaced the
   cached weekly review with an error. *Fix:* restore the last good take with an
   inline notice ("…Showing the previous take.").
4. `enrichAll` returned early without calling `onComplete` while another gather was
   running, so a DR re-gather could leave its caller waiting forever. *Fix:*
   `onComplete` now fires on that early return.

## 2. Other bugs found and fixed

| Area | Issue | Fix |
| --- | --- | --- |
| `App.jsx` watchlist poll | `useEffect(..., [watchlistSymbolsKey, refreshWatchlistQuotes])` depended on a function recreated every render, so it **POSTed `/api/watchlist/quotes` on every App render** (typing, hovering, tab changes). | Read the function through a ref; restart only when the watchlist changes. |
| `mergeStocks` | Replaced the client row with the bare `stocks` row, dropping fields `/api/stocks` joins in (analyst targets, ratings snapshot, cached Ori review). Conviction silently changed and the Ori emblem vanished after a re-gather. | Merge the fresh row **over** the loaded row. |
| Game Plan cache integrity (security) | Client-POSTed `stats` fed the prompt of a review cached per symbol and served to **every user for a week**. A crafted request (any Pro user) for an uncached symbol could skew it. | `trustedGamePlanStats`: database values win, client values only fill gaps, everything coerced to numbers; sector capped. Tested. |
| Unit-test isolation | `email`, `gamePlanCache`, `starfarerPlan` and `watchlistAlerts` tests imported `db.js` without `DB_PATH` and wrote into the developer's `./data/screener.db`. | `server/tests/isolatedDb.js` side-effect import points them at a temp DB. |
| Tour copy accuracy | The draft tours claimed free accounts get the Game Plan (they get a Pro gate), described chat "analysis modes" that don't exist in the UI, and described Strategies as "saved filters" (they are simulated paper portfolios). | Rewritten against the actual UI and scoring code. |
| `useTour` | Assigned refs during render (2 lint errors). | Synced in a layout effect. |

## 3. Security review — what was checked

Sound as-is:
- **Session:** HMAC-signed cookie; `AUTH_SECRET` is enforced at ≥32 bytes on any
  deployed runtime (Railway/production/live PayPal); per-device session ids with
  server-side revocation; the admin flag is re-read from the DB on every request.
- **CSRF:** mutations are gated on a trusted Origin / `Sec-Fetch-Site` in
  deployed runtimes.
- **Password reset:** only the token hash is stored, the token lasts 1 hour and
  is single-use, it is compared in constant time, and the response is generic
  (no account enumeration). Links use `APP_URL`, which production config requires.
- **PayPal webhooks:** signature-verified; fail closed without `PAYPAL_WEBHOOK_ID`;
  plan id checked; subscription state is re-fetched from PayPal for sync events.
- **Ori chat rendering:** the Markdown renderer HTML-escapes `& < >` before
  inserting any markup and only emits fixed attributes, so no XSS from model
  output.
- **Prompt inputs:** Game Plan free text is control-character stripped and
  length-capped (now also number-coerced, see §2).
- **FMP:** symbol inputs are validated; only admins can bypass the cache (`?force=1`);
  one global rate gate with a bounded queue.

Recommendations (not changed):

1. **Username-based admin promotion (Medium).** `promoteDesignatedAdmins()` in
   `server/index.js` promotes any account named `dylan` or `admin` to admin on
   **every boot**, so demoting that account doesn't survive a restart, and an
   admin who creates a user with either name hands out admin. Replace it with an
   explicit env allowlist (e.g. `BOOTSTRAP_ADMINS`) that is only applied when no
   admin exists, or remove it now that first-admin setup exists.
2. ~~Unbounded simulated brokerage rows~~ **Fixed:** 10 linked accounts per user;
   finished orders capped at 1,000 per user by the daily maintenance job.
3. ~~Error message leakage~~ **Fixed:** `stocks` and `brokerage` 500s now log the
   detail and return a generic message.
4. **Webhook replay (Low).** Verified-but-old CANCELLED/EXPIRED events are applied
   as-is. Consider ignoring events older than the last applied `update_time`.

## 4. Architecture follow-ups — **Fixed** (second pass)

| Item | Change | Result |
| --- | --- | --- |
| Bundle size | `DeepResearchPage`, `PortfolioGoalsPage`, `StrategiesPage`, `StockDetailModal`, `CompareModal`, `UsersModal`, `UpgradeModal`, `AddTickerModal` are `lazy()` chunks, prefetched on idle after first paint. React and framer-motion are separate long-cached vendor chunks; libraries used by one lazy page (e.g. `yaml`) stay in that page's chunk. | First load 783 kB → 627 kB, and a deploy only re-downloads the 358 kB app chunk. No chunk-size warning. |
| Ori stock context | `src/lib/oriContext.js` → `buildOriStockContext(row, detail, fitCtx, lens)` (plus `pricePerformance`/`rsiTrend`) builds all four contexts (open overview, Deep Research, two chat-focus symbols). | ~80 duplicated lines removed from `App.jsx`; the four can't drift. |
| KM-derived metrics | `deriveKeyMetrics(km, mcap)` / `deriveRatios(rat, evSales)` in `server/fmp.js`, used by the manual gather, the background job, add-ticker and the Deep Research sync. They copy rather than mutate, so a cached response is never altered. | **Bug fixed along the way:** add-ticker never derived net margin / FCF margin / P/S, so manually added tickers were missing them until their next full gather. |
| Full-universe payload | `GET /api/stocks?format=columns` sends `{ columns, rows }` with non-integer numbers at 6 significant digits (`src/lib/stocksPayload.js`, shared by server and client). The default object shape remains for other callers. | 2.19 MB → 1.10 MB gzipped; the JSON the browser parses drops from 9.7 MB to 3.4 MB. |
| Price sweep monitoring | `/debug` shows the sweep's status, last run, rows re-priced, duration and last error, next to the maintenance report. | Nothing to go and find after deploy. |

## 5. Data growth and retention — **Fixed**

**Is a stock refresh appending or updating?** Updating. `stocks`, `sparklines`,
`ai_enrichment` and `kv_cache` are keyed by symbol (or symbol + window, or cache
key) with `ON CONFLICT … DO UPDATE`, so re-fetching replaces the existing row.
The database does not grow per refresh. It grew from the items below, which
`server/maintenance.js` now bounds on a daily run (first run 10 min after start;
the report is on `/debug`):

| Grew without bound | Retention now |
| --- | --- |
| Delisted / renamed listings stayed forever, showed stale prices and kept costing background FMP calls (a failed quote still advanced `price_updated_at`, so they never looked dead). | New `price_seen_at` column that only a *returned* price advances. Listings unpriced for `STOCK_RETENTION_DAYS` (45) are removed with their sparklines and analyst data. Guards: price sweep healthy, a full retention window of tracking on this database, server up ≥ 3 days, never a symbol any user watches / holds / uses in a strategy, max ~2% of the universe per day. |
| A 1–2 MB cached universe blob in `meta` per scope / market-cap floor, never deleted (≈4.7 MB of dead blobs in the local DB). | Dropped once past 48 h (TTL is 24 h). |
| One `email_sent:<day>` row per day. | Kept 30 days. |
| Sparklines / analyst data for removed symbols. | Removed after a 30-day grace. |
| Chat sessions per user. | Newest 200 per user (`CHAT_SESSIONS_PER_USER`). |
| Simulated brokerage accounts / orders. | Max 10 linked accounts; newest 1,000 finished orders per user. |
| Watchlist alert state for symbols no longer watched. | Removed. |
| SQLite free pages never returned to disk. | `PRAGMA optimize` + WAL truncate daily; `VACUUM` on a closed-market Sunday at most weekly, only when ≥25% and ≥64 MB of the file is free. |

Already bounded before (unchanged): `kv_cache` 14 days (moved into the daily
job), login events 90 days, Ori usage ledger ~95 days, expired sessions and
checkout tokens, the in-memory error log (200 entries), per-session chat length.

**Related fix:** a Universe Refresh used to set `updated_at` (the fundamentals
clock) on every row without refreshing any fundamentals. Every row then looked
freshly enriched, and stale fundamentals were pushed out of the refresh
rotation. The upsert now leaves `updated_at` alone; the force-prune uses
`price_seen_at`.

Settings: `MAINTENANCE_ENABLED`, `STOCK_RETENTION_DAYS`,
`CHAT_SESSIONS_PER_USER`, `MAINTENANCE_VACUUM`, `MAINTENANCE_INTERVAL_HOURS`
(see `.env.example`).

## 6. Verification

- `npm test`: 340/340 (new: `priceSweep`, `gamePlanStats`, `maintenance`,
  `fmpDerive`, `stocksPayload`, plus regression tests for the price feed, symbol
  sync and tour-settings sanitizing).
- `npm run lint`: clean. `npm run build`: OK.
- Playwright `core-flows`: 4/4, including a new guided-tour journey (first-run
  prompt → step → Esc → persisted → replay from the Guide menu → cross-page tour).
