import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { resolveDatabaseLocation } from './dbPath.js';
import {
  gamePlanFrontierTtlMs,
  gamePlanLiteTtlMs,
  isFreshGamePlanCacheEntry,
  screenerLiteTtlMs,
  screenerMinMcap,
  LITE_GAME_PLAN_CACHE_PREFIX,
  LEGACY_LITE_GAME_PLAN_CACHE_PREFIXES,
} from './gamePlanCache.js';

const dbLocation = resolveDatabaseLocation();
const DB_PATH = dbLocation.inputPath;
const resolvedDbPath = dbLocation.resolvedPath;
const dir = path.dirname(resolvedDbPath);

console.log(`[db] DB_PATH: "${DB_PATH}"${dbLocation.inferredFromVolume ? ' (inferred from Railway volume)' : ''}`);
console.log(`[db] Resolved database path: "${resolvedDbPath}"`);
console.log(`[db] Database directory: "${dir}"`);

if (dbLocation.error) {
  console.error(`[db] FATAL: ${dbLocation.error}`);
  process.exit(1);
} else if (process.env.NODE_ENV === 'production' && !dbLocation.railway && !process.env.DB_PATH) {
  console.warn('[db] WARNING: DB_PATH is not configured in production. Confirm that the default data directory is persistent.');
}

// Ensure the parent directory exists and is writable before opening the database.
try {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[db] Created directory: "${dir}"`);
  } else {
    // Verify the directory is writable by attempting an access check.
    fs.accessSync(dir, fs.constants.W_OK);
    console.log(`[db] Directory exists and is writable: "${dir}"`);
  }
} catch (err) {
  console.error(`[db] FATAL: Cannot access or create database directory "${dir}": ${err.message}`);
  process.exit(1);
}

let db;
try {
  db = new Database(resolvedDbPath);
  console.log(`[db] Opened database at "${resolvedDbPath}"`);
} catch (err) {
  console.error(`[db] FATAL: Failed to open database at "${resolvedDbPath}": ${err.message}`);
  process.exit(1);
}

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
// Wait (up to 5s) for a competing writer instead of throwing SQLITE_BUSY — the
// background enrichment job writes while API requests read/write concurrently.
db.pragma('busy_timeout = 5000');

try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS stocks (
    symbol         TEXT PRIMARY KEY,
    name           TEXT,
    sector         TEXT,
    industry       TEXT,
    exchange       TEXT,
    country        TEXT,
    price          REAL,
    mcap           REAL,
    volume         REAL,
    beta           REAL,
    -- fundamentals: key-metrics-ttm
    roic           REAL,
    roe            REAL,
    roa            REAL,
    ev_ebitda      REAL,
    ev_sales       REAL,
    fcf_yield      REAL,
    earnings_yield REAL,
    net_debt_ebitda REAL,
    current_ratio  REAL,
    div_yield      REAL,
    pe             REAL,
    pb             REAL,
    -- derived / math-computed
    ps             REAL,
    ebitda_margin  REAL,
    net_margin     REAL,
    fcf_margin     REAL,
    ev_gp          REAL,
    -- fundamentals: metrics-ratios-ttm
    gross_margin   REAL,
    op_margin      REAL,
    debt_equity    REAL,
    payout         REAL,
    -- DCF (Phase 2 backfill)
    dcf            REAL,
    dcf_date       TEXT,
    has_dcf        INTEGER DEFAULT 0,
    -- Growth (Phase 2 backfill, from financial-growth endpoint)
    revenue_growth     REAL,
    eps_growth         REAL,
    fcf_growth         REAL,
    op_income_growth   REAL,
    has_growth         INTEGER DEFAULT 0,
    -- load state
    has_km         INTEGER DEFAULT 0,
    has_rat        INTEGER DEFAULT 0,
    -- 1 = ETF/fund: kept in the universe for price/name but never enriched
    -- (no key-metrics/ratios exist for them) and excluded from the enrich queues.
    is_etf         INTEGER DEFAULT 0,
    updated_at     INTEGER
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS ai_enrichment (
    symbol           TEXT PRIMARY KEY,
    dcf              REAL,
    stock_price      REAL,
    dcf_date         TEXT,
    target_high      REAL,
    target_low       REAL,
    target_consensus REAL,
    target_median    REAL,
    revenue_growth   REAL,
    net_income_growth REAL,
    eps_growth       REAL,
    fcf_growth       REAL,
    op_income_growth REAL,
    owner_earnings   REAL,
    owner_eps        REAL,
    growth_capex     REAL,
    estimates_json   TEXT,
    updated_at       INTEGER
  );

  CREATE TABLE IF NOT EXISTS sparklines (
    symbol      TEXT NOT NULL,
    days        INTEGER NOT NULL,
    data        TEXT NOT NULL,   -- JSON array of {date, price}
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (symbol, days)
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT 'default',
    created_at  INTEGER,
    updated_at  INTEGER,
    title       TEXT,
    messages    TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER,
    is_admin      INTEGER DEFAULT 0,
    email         TEXT,
    plan          TEXT DEFAULT 'free',   -- 'free' | 'pro' | 'ultimate' (Starfarer — admin-granted)
    plan_updated_at INTEGER,
    paypal_subscription_id TEXT,         -- PayPal Subscriptions API id (I-XXXXXXXX)
    subscription_status TEXT,            -- PayPal status: ACTIVE | CANCELLED | SUSPENDED | EXPIRED
    subscription_updated_at INTEGER,
    pro_until INTEGER,                   -- grace: Pro access stays until this time after cancellation
    reset_token_hash TEXT,               -- sha256 of the active password-reset token (single-use)
    reset_expires INTEGER,               -- reset-token expiry (ms epoch)
    last_login_at INTEGER,
    last_login_ip TEXT,
    login_count INTEGER DEFAULT 0,
    last_active_at INTEGER,
    session_epoch INTEGER DEFAULT 0      -- bumped on password change to revoke other sessions
  );

  -- Opaque PayPal checkout ownership tokens. Only the hash is persisted; the
  -- raw token is sent to PayPal as custom_id and proves which signed-in user
  -- initiated a subscription when approval/webhook callbacks arrive.
  CREATE TABLE IF NOT EXISTS billing_checkout_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- Per-device server-side session registry. Tokens carry the random session id,
  -- while SQLite stores only its hash so logout can revoke one copied token
  -- without ending every other device's session.
  CREATE TABLE IF NOT EXISTS auth_sessions (
    session_hash TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);

  -- One-release bridge for cookies issued before auth_sessions existed. Once a
  -- legacy cookie is upgraded or logged out, its hash is denied until expiry.
  CREATE TABLE IF NOT EXISTS revoked_auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_revoked_auth_tokens_expiry ON revoked_auth_tokens(expires_at);

  CREATE TABLE IF NOT EXISTS login_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    at         INTEGER NOT NULL,
    ip         TEXT,
    user_agent TEXT,
    kind       TEXT NOT NULL             -- login | signup | setup | reset
  );

  -- Brokerage scaffolding: linked external accounts (Plaid-style) and order
  -- tickets (Alpaca-style). provider='simulated' until real integrations land.
  CREATE TABLE IF NOT EXISTS linked_accounts (
    id             TEXT PRIMARY KEY,        -- acct_<random>
    user_id        TEXT NOT NULL,
    provider       TEXT NOT NULL DEFAULT 'simulated',
    institution_id TEXT,
    institution    TEXT,
    account_name   TEXT,
    account_mask   TEXT,
    status         TEXT DEFAULT 'linked',
    cash           REAL DEFAULT 0,
    holdings       TEXT DEFAULT '[]',       -- JSON [{ symbol, qty, avg_cost }]
    created_at     INTEGER
  );

  CREATE TABLE IF NOT EXISTS brokerage_orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    account_id  TEXT NOT NULL,
    symbol      TEXT NOT NULL,
    side        TEXT NOT NULL,              -- 'buy' | 'sell'
    qty         REAL NOT NULL,
    type        TEXT NOT NULL DEFAULT 'market',  -- 'market' | 'limit'
    limit_price REAL,
    status      TEXT NOT NULL DEFAULT 'pending', -- pending|filled|cancelled|rejected
    fill_price  REAL,
    simulated   INTEGER DEFAULT 1,
    created_at  INTEGER,
    updated_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id     TEXT PRIMARY KEY,
    data        TEXT,            -- JSON blob: { tabs, activeTab, weights, theme, sidebarCollapsed }
    updated_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS kv_cache (
    key         TEXT PRIMARY KEY,  -- e.g. "profile:AAPL", "ratings:MSFT"
    data        TEXT NOT NULL,     -- JSON payload
    updated_at  INTEGER NOT NULL
  );

  -- Per-user Ori (Gemini) usage ledger, one row per user per ET calendar day.
  -- Drives the fair-use limiter and the "Ori usage" panel. requests = billable
  -- generations (a chat turn or a cache-MISS Game Plan); cached serves cost
  -- nothing and are never counted. Token columns mirror Gemini's usageMetadata
  -- so we can show real input/output volume and how much input the context cache
  -- served (cached_tokens / prompt_tokens).
  CREATE TABLE IF NOT EXISTS ori_usage (
    user_id        TEXT NOT NULL,
    day            TEXT NOT NULL,            -- 'YYYY-MM-DD' in America/New_York
    requests       INTEGER NOT NULL DEFAULT 0,
    chat_requests  INTEGER NOT NULL DEFAULT 0,
    plan_requests  INTEGER NOT NULL DEFAULT 0,
    prompt_tokens  INTEGER NOT NULL DEFAULT 0,
    cached_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens  INTEGER NOT NULL DEFAULT 0,
    updated_at     INTEGER,
    PRIMARY KEY (user_id, day)
  );

  -- Rolling-window meter: one row per billable Ori action (chat / Game Plan).
  -- Used for the 5-hour session cap; pruned aggressively once outside the window.
  CREATE TABLE IF NOT EXISTS ori_usage_events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  TEXT NOT NULL,
    at       INTEGER NOT NULL,               -- unix ms
    kind     TEXT NOT NULL                   -- 'chat' | 'plan'
  );
`);
  console.log('[db] Schema initialized successfully');
} catch (err) {
  console.error(`[db] FATAL: Schema initialization failed: ${err.message}`);
  process.exit(1);
}

// v2 originally changed the lite Game Plan key without moving existing rows,
// which made every paid trickle score look deleted after deployment. Cache-key
// changes must migrate data: copy the newest value to the current key, then remove
// the superseded key. This is safe to run on every boot and across rolling deploys.
export function migrateLegacyLiteGamePlanCache() {
  const migrate = db.transaction(() => {
    let found = 0;
    let removed = 0;
    const countStmt = db.prepare('SELECT COUNT(*) AS count FROM kv_cache WHERE key LIKE ?');
    const copyStmt = db.prepare(`
      INSERT INTO kv_cache (key, data, updated_at)
      SELECT ? || substr(key, ?), data, updated_at
        FROM kv_cache
       WHERE key LIKE ?
      ON CONFLICT(key) DO UPDATE SET
        data = excluded.data,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at > kv_cache.updated_at
    `);
    const deleteStmt = db.prepare('DELETE FROM kv_cache WHERE key LIKE ?');

    for (const prefix of LEGACY_LITE_GAME_PLAN_CACHE_PREFIXES) {
      const pattern = `${prefix}%`;
      const count = countStmt.get(pattern)?.count || 0;
      if (!count) continue;
      found += count;
      copyStmt.run(LITE_GAME_PLAN_CACHE_PREFIX, prefix.length + 1, pattern);
      removed += deleteStmt.run(pattern).changes;
    }
    const current = countStmt.get(`${LITE_GAME_PLAN_CACHE_PREFIX}%`)?.count || 0;
    return { found, removed, current };
  });

  return migrate();
}

try {
  const migrated = migrateLegacyLiteGamePlanCache();
  if (migrated.found > 0) {
    console.log(`[db] Migration: restored ${migrated.found} legacy Ori trickle score(s) under the current cache key`);
  }
  console.log(`[db] Ori trickle cache ready: ${migrated.current} persisted score(s)`);
} catch (err) {
  // The read path still falls back to legacy keys, so a migration failure is
  // visible and recoverable rather than a reason to take the whole app down.
  console.error(`[db] Ori trickle cache migration failed: ${err.message}`);
}

// ── Migrations: ensure new columns exist on already-created databases ─────
try {
  const existingCols = new Set(
    db.prepare("PRAGMA table_info(stocks)").all().map((r) => r.name),
  );
  const NEW_COLS = [
    ["dcf", "REAL"],
    ["dcf_date", "TEXT"],
    ["has_dcf", "INTEGER DEFAULT 0"],
    ["revenue_growth", "REAL"],
    ["eps_growth", "REAL"],
    ["fcf_growth", "REAL"],
    ["op_income_growth", "REAL"],
    ["has_growth", "INTEGER DEFAULT 0"],
    ["country", "TEXT"],
    ["is_etf", "INTEGER DEFAULT 0"],
    // Tracks quote/price freshness separately from updated_at: the background
    // price refresher must not bump updated_at, or it would push rows out of
    // the km/rat staleness rotation without actually refreshing fundamentals.
    ["price_updated_at", "INTEGER"],
    // ~45-day price return (e.g. 0.10 = +10%), computed during enrichment from
    // the sparkline. Powers a lightweight Technicals signal in the screener
    // Conviction so falling "value traps" don't sort to the top.
    ["mom", "REAL"],
    // SMA50 / SMA200 computed from the 365-day sparkline. These let the screener
    // Technicals pillar use the SAME 50-vs-200 trend regime as Deep Research, so
    // a stock in a long downtrend reads bearish on the screener too (a 45-day
    // bounce no longer makes it look healthy).
    ["sma50", "REAL"],
    ["sma200", "REAL"],
  ];
  for (const [name, type] of NEW_COLS) {
    if (!existingCols.has(name)) {
      db.exec(`ALTER TABLE stocks ADD COLUMN ${name} ${type}`);
      console.log(`[db] Migration: added column "${name} ${type}" to stocks`);
      // One-time backfill: tag existing ETF/fund rows by name so they immediately
      // drop out of the enrichment queues. The next screener refresh sets is_etf
      // authoritatively (and corrects any heuristic mistake), so this is just a
      // best-effort head start for the rows already in the DB.
      if (name === "is_etf") {
        const info = db
          .prepare(
            `UPDATE stocks SET is_etf = 1 WHERE
               name LIKE '%ETF%' OR name LIKE '%ETN%'
               OR name LIKE '%iShares%' OR name LIKE '%SPDR%' OR name LIKE '%Vanguard%'
               OR name LIKE '%Invesco%' OR name LIKE '%ProShares%'
               OR name LIKE '% Fund%' OR name LIKE '% Index%' OR name LIKE '% Trust'`,
          )
          .run();
        console.log(`[db] Migration: tagged ${info.changes} existing rows as ETF/fund (heuristic)`);
      }
    }
  }
  // chat_sessions.user_id was added for multi-user support; backfill on
  // databases created before this column existed.
  const chatCols = new Set(
    db.prepare("PRAGMA table_info(chat_sessions)").all().map((r) => r.name),
  );
  if (!chatCols.has('user_id')) {
    db.exec(`ALTER TABLE chat_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC)`);
    console.log('[db] Migration: added user_id to chat_sessions');
  }
  console.log('[db] Migrations complete');
} catch (err) {
  console.error(`[db] FATAL: Migration failed: ${err.message}`);
  process.exit(1);
}

// Migrate users table if it was added later, and add account-system columns
// (email login + free/pro plan) on databases created before they existed.
try {
  const userCols = new Set(
    db.prepare("PRAGMA table_info(users)").all().map((r) => r.name),
  );
  const USER_COLS = [
    ["email", "TEXT"],
    ["plan", "TEXT DEFAULT 'free'"],
    ["plan_updated_at", "INTEGER"],
    ["paypal_subscription_id", "TEXT"],
    ["subscription_status", "TEXT"],
    ["subscription_updated_at", "INTEGER"],
    ["pro_until", "INTEGER"],
    ["reset_token_hash", "TEXT"],
    ["reset_expires", "INTEGER"],
    ["notification_email", "TEXT"],
    ["last_login_at", "INTEGER"],
    ["last_login_ip", "TEXT"],
    ["login_count", "INTEGER DEFAULT 0"],
    ["last_active_at", "INTEGER"],
    ["session_epoch", "INTEGER DEFAULT 0"],
  ];
  for (const [name, type] of USER_COLS) {
    if (userCols.size > 0 && !userCols.has(name)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
      console.log(`[db] Migration: added column "${name}" to users`);
    }
  }
  // Partial unique index: many NULL emails are fine (legacy username-only
  // accounts), but a real email may belong to only one account.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_paypal_subscription
           ON users(paypal_subscription_id) WHERE paypal_subscription_id IS NOT NULL;`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_billing_checkout_tokens_user
           ON billing_checkout_tokens(user_id, created_at DESC);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_linked_accounts_user ON linked_accounts(user_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_brokerage_orders_user ON brokerage_orders(user_id, created_at DESC);`);
} catch (e) {
  console.error('[db] users/brokerage migration failed:', e.message);
}

// Ensure the per-user chat index exists (covers fresh DBs created with the column
// in CREATE TABLE, and any edge cases after migration).
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);`);
} catch {}

// Ori usage cost columns (per-kind tokens + USD micros for admin cost panels).
try {
  const oriCols = new Set(
    db.prepare("PRAGMA table_info(ori_usage)").all().map((r) => r.name),
  );
  const ORI_USAGE_COLS = [
    ["chat_prompt_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["chat_cached_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["chat_output_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["plan_prompt_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["plan_cached_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["plan_output_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["chat_thoughts_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["plan_thoughts_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["chat_cost_usd_micros", "INTEGER NOT NULL DEFAULT 0"],
    ["plan_cost_usd_micros", "INTEGER NOT NULL DEFAULT 0"],
    ["cost_usd_micros", "INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [name, type] of ORI_USAGE_COLS) {
    if (oriCols.size > 0 && !oriCols.has(name)) {
      db.exec(`ALTER TABLE ori_usage ADD COLUMN ${name} ${type}`);
      console.log(`[db] Migration: added column "${name}" to ori_usage`);
    }
  }
} catch (e) {
  console.error("[db] ori_usage cost migration failed:", e.message);
}

// Ori usage is read by (user, day) for the daily total and by (user, day-range)
// for the month, so a composite index on (user_id, day) covers both.
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ori_usage_user_day ON ori_usage(user_id, day);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ori_usage_events_user_at ON ori_usage_events(user_id, at);`);
  db.exec(`CREATE TABLE IF NOT EXISTS login_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT,
    kind TEXT NOT NULL
  );`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_login_events_user_at ON login_events(user_id, at DESC);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_login_events_at ON login_events(at DESC);`);
} catch {}

// Secondary indexes on the stocks table. The screener serves every row ordered by
// mcap, and the always-on background enrichment job repeatedly looks for the
// oldest-updated and not-yet-enriched symbols. Without these each of those is a
// full-table scan (plus a temp b-tree for the sort) across the whole ~8k+ universe,
// several times a minute, forever.
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stocks_mcap ON stocks(mcap DESC);`);
  // (is_etf, updated_at): the enrich selectors all filter is_etf=0 and walk/seek by
  // updated_at, so this serves getMissingEnrichDue + getStaleEnriched directly.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stocks_etf_updated ON stocks(is_etf, updated_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stocks_enrich ON stocks(is_etf, has_km, has_rat);`);
  // Serves the price-refresh rotation (stalest quoted symbols first).
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stocks_price_updated ON stocks(price_updated_at);`);
  console.log('[db] Stocks indexes ready');
} catch (e) {
  console.warn('[db] Could not create stocks indexes:', e.message);
}

// Watchlist alert state (per user + symbol baselines, cooldowns, digest queue).
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlist_alert_state (
      user_id               TEXT NOT NULL,
      symbol                TEXT NOT NULL,
      baseline_price        REAL,
      baseline_session_date TEXT,
      last_price            REAL,
      last_conviction       REAL,
      last_news_urls        TEXT,
      last_alert_at         TEXT,
      pending_digest        TEXT,
      in_app_delivered_at   INTEGER,
      PRIMARY KEY (user_id, symbol)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wl_alert_user ON watchlist_alert_state(user_id);`);
} catch (e) {
  console.warn('[db] watchlist_alert_state migration failed:', e.message);
}

// Migration: sparklines table for persisted historical price data (for sparklines)
try {
  const sparkCols = new Set(
    db.prepare("PRAGMA table_info(sparklines)").all().map((r) => r.name),
  );
  if (sparkCols.size === 0) {
    // Table didn't exist yet
    console.log('[db] Sparklines table ready (created on first run)');
  } else {
    console.log('[db] Sparklines table exists');
  }
} catch (e) {
  // Ignore on very fresh DBs
}

// ── Upsert helpers ─────────────────────────────────────────────────────────

const upsertStock = db.prepare(`
  INSERT INTO stocks (
    symbol, name, sector, industry, exchange, country,
    price, mcap, volume, beta,
    div_yield, is_etf, updated_at
  ) VALUES (
    @symbol, @name, @sector, @industry, @exchange, @country,
    @price, @mcap, @volume, @beta,
    @div_yield, @is_etf, @updated_at
  )
  ON CONFLICT(symbol) DO UPDATE SET
    -- Preserve existing values when the incoming row is a "placeholder" (null,
    -- '' or '—'). The list-based universe refresh only carries symbol+name, so a
    -- naive overwrite would wipe mcap/sector/industry/price/etc. from already-
    -- enriched rows (they'd still show the "enriched" dot but be blank). COALESCE/
    -- NULLIF makes a refresh non-destructive: real data updates, placeholders keep
    -- whatever the profile/screener already populated.
    name      = COALESCE(NULLIF(excluded.name, ''), stocks.name),
    sector    = COALESCE(NULLIF(excluded.sector, '—'), stocks.sector),
    industry  = COALESCE(NULLIF(excluded.industry, '—'), stocks.industry),
    exchange  = COALESCE(NULLIF(excluded.exchange, ''), stocks.exchange),
    country   = COALESCE(NULLIF(excluded.country, ''), stocks.country),
    price     = COALESCE(excluded.price, stocks.price),
    mcap      = COALESCE(excluded.mcap, stocks.mcap),
    volume    = COALESCE(excluded.volume, stocks.volume),
    beta      = COALESCE(excluded.beta, stocks.beta),
    div_yield = COALESCE(excluded.div_yield, stocks.div_yield),
    -- screener/profile carry an authoritative 0/1, so this corrects the migration
    -- heuristic; COALESCE only guards against a caller that omits the field.
    is_etf    = COALESCE(excluded.is_etf, stocks.is_etf),
    updated_at = excluded.updated_at
`);

const applyKm = db.prepare(`
  UPDATE stocks SET
    roic            = @roic,
    roe             = @roe,
    roa             = @roa,
    ev_ebitda       = @ev_ebitda,
    ev_sales        = @ev_sales,
    fcf_yield       = @fcf_yield,
    earnings_yield  = @earnings_yield,
    net_debt_ebitda = @net_debt_ebitda,
    current_ratio   = @current_ratio,
    div_yield       = COALESCE(@div_yield, div_yield),
    pe              = COALESCE(@pe, pe),
    pb              = COALESCE(@pb, pb),
    ps              = @ps,
    ebitda_margin   = @ebitda_margin,
    net_margin      = @net_margin,
    fcf_margin      = @fcf_margin,
    has_km          = 1,
    updated_at      = @updated_at
  WHERE symbol = @symbol
`);

const applyRat = db.prepare(`
  UPDATE stocks SET
    gross_margin = @gross_margin,
    op_margin    = @op_margin,
    pe           = COALESCE(@pe, pe),
    pb           = COALESCE(@pb, pb),
    ps           = COALESCE(@ps, ps),
    debt_equity  = @debt_equity,
    payout       = @payout,
    div_yield    = COALESCE(@div_yield, div_yield),
    roe          = COALESCE(@roe, roe),
    current_ratio = COALESCE(@current_ratio, current_ratio),
    ev_gp        = @ev_gp,
    has_rat      = 1,
    updated_at   = @updated_at
  WHERE symbol = @symbol
`);

const bulkUpsert = db.transaction((rows) => {
  for (const r of rows) upsertStock.run(r);
});

export function setMeta(key, value) {
  db.prepare(`INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run(key, String(value));
}

export function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
  return row ? row.value : null;
}

export function saveScreenerBatch(rows) {
  bulkUpsert(rows);
}

export function saveKm(symbol, data) {
  applyKm.run({ symbol, updated_at: Date.now(), ...data });
}

export function saveRat(symbol, data) {
  applyRat.run({ symbol, updated_at: Date.now(), ...data });
}

// The screener universe. LEFT JOIN ai_enrichment so each row carries analyst
// consensus targets (target_consensus/high/low), and LEFT JOIN the persistent
// detail cache for ratings snapshots already gathered by detail/deep-research
// flows. (mom lives on the stocks row.)
export function getAllStocks() {
  const now = Date.now();
  const frontierTtl = gamePlanFrontierTtlMs();
  const screenerLiteTtl = screenerLiteTtlMs();
  const rows = db
    .prepare(
      `SELECT s.*, ae.target_consensus, ae.target_high, ae.target_low,
              rc.data AS ratings_json,
              gp.data AS gameplan_json, gp.updated_at AS gameplan_at,
              gpl.data AS gameplan_lite_json, gpl.updated_at AS gameplan_lite_at
         FROM stocks s
         LEFT JOIN ai_enrichment ae ON ae.symbol = s.symbol
         LEFT JOIN kv_cache rc ON rc.key = ('ratings:' || s.symbol)
         LEFT JOIN kv_cache gp ON gp.key = ('gameplan:' || s.symbol)
         LEFT JOIN kv_cache gpl ON gpl.key = ('${LITE_GAME_PLAN_CACHE_PREFIX}' || s.symbol)
        ORDER BY s.mcap DESC NULLS LAST`,
    )
    .all();
  return rows.map((row) => {
    let rating = null;
    let ratingOverallScore = null;
    if (row.ratings_json) {
      try {
        const parsed = JSON.parse(row.ratings_json);
        rating = parsed?.rating ?? null;
        ratingOverallScore = parsed?.overall_score ?? null;
      } catch {
        /* ignore corrupt cache entry */
      }
    }
    // Fold a STILL-FRESH cached Ori review onto the row so the screener
    // Conviction can reuse it — free (no new LLM call). Prefer the premium
    // frontier review from a Deep Research visit (`gameplan:`); fall back to the
    // cheap lite review the screener/background trickle generates (the versioned lite Game Plan cache).
    // modelTier on the object tells them apart (frontier vs lite).
    const parseJson = (jsonStr) => {
      if (!jsonStr) return null;
      try {
        const parsed = JSON.parse(jsonStr);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        return null;
      }
    };
    const parseFresh = (jsonStr, at, ttlMs) => {
      if (!jsonStr || !at || now - at >= ttlMs) return null;
      return parseJson(jsonStr);
    };
    const detailOri =
      row.gameplan_at && now - row.gameplan_at < frontierTtl
        ? parseJson(row.gameplan_json)
        : null;
    const freshDetailOri = isFreshGamePlanCacheEntry(detailOri, row.gameplan_at, now) ? detailOri : null;
    // Lite reviews are served on the long screener TTL (≈30d) so a trickled name
    // keeps its nudge as the sweep works through the rest of the universe.
    const liteOri = parseFresh(row.gameplan_lite_json, row.gameplan_lite_at, screenerLiteTtl);
    const ori = freshDetailOri || liteOri;
    const oriCachedAt = freshDetailOri ? row.gameplan_at : liteOri ? row.gameplan_lite_at : null;
    const clean = { ...row };
    delete clean.ratings_json;
    delete clean.gameplan_json;
    delete clean.gameplan_at;
    delete clean.gameplan_lite_json;
    delete clean.gameplan_lite_at;
    return { ...clean, rating, rating_overall_score: ratingOverallScore, ori, oriCachedAt };
  });
}

// Background screener trickle — BOUNDED sweep. Each tick returns the next `limit`
// stocks AT/ABOVE the market-cap floor (screenerMinMcap, default $10B; ETFs already
// excluded) that still need a lite intangibles review: NEVER-scored names first so
// coverage works down the cap ladder before anything is refreshed, then the stalest.
// A name counts as "covered" (and is skipped) while it has a lite review inside the
// long screener TTL OR a fresh frontier Pro review (frontier TTL is longer than
// lite). So as each stock gets its score it drops out of the backlog and the trickle
// advances to the next-biggest uncovered name — covering the large/mid-cap set, then
// idling until reviews age past the screener TTL and slowly refresh. The mcap floor
// keeps the swept universe small and cheap; a sub-floor stock only gets an Ori read
// when a user opens Deep Research on it. (mcap >= floor implies mcap NOT NULL.)
const nextIntangiblesStmt = db.prepare(`
  SELECT s.symbol FROM stocks s
  LEFT JOIN kv_cache gp  ON gp.key  = ('gameplan:' || s.symbol)
  LEFT JOIN kv_cache gpl ON gpl.key = ('${LITE_GAME_PLAN_CACHE_PREFIX}' || s.symbol)
  WHERE (s.is_etf IS NULL OR s.is_etf = 0) AND s.mcap >= ? AND s.has_km = 1
    AND (gpl.updated_at IS NULL OR gpl.updated_at < ?)
    AND (
      gp.updated_at IS NULL
      OR json_valid(gp.data) = 0
      OR (
        COALESCE(
          json_extract(gp.data, '$.modelTier') = 'frontier'
          OR json_extract(gp.data, '$.model') = 'gemini-3.1-pro-preview',
          0
        )
        AND gp.updated_at < ?
      )
      OR (
        NOT COALESCE(
          json_extract(gp.data, '$.modelTier') = 'frontier'
          OR json_extract(gp.data, '$.model') = 'gemini-3.1-pro-preview',
          0
        )
        AND gp.updated_at < ?
      )
    )
  ORDER BY (gpl.updated_at IS NULL) DESC, s.mcap DESC
  LIMIT ?
`);
export function nextIntangiblesBacklog(now = Date.now(), limit = 1) {
  const liteCutoff = now - screenerLiteTtlMs();
  const frontierCutoff = now - gamePlanFrontierTtlMs();
  const detailFallbackCutoff = now - gamePlanLiteTtlMs();
  return nextIntangiblesStmt
    .all(screenerMinMcap(), liteCutoff, frontierCutoff, detailFallbackCutoff, limit)
    .map((r) => r.symbol);
}

// Persist the ~45-day price return used by the screener Technicals signal.
const updateMom = db.prepare('UPDATE stocks SET mom = ? WHERE symbol = ?');
export function saveMomentum(symbol, mom) {
  updateMom.run(mom == null || !Number.isFinite(mom) ? null : mom, symbol);
}

// Total return across a sparkline (oldest → newest close). Orientation-safe:
// sorts by date so it works whether FMP returns newest- or oldest-first. Shared
// by the enrich pipeline (fresh fetch) and the boot backfill below.
export function momentumFromSparkline(arr) {
  if (!Array.isArray(arr) || arr.length < 5) return null;
  const pts = arr
    .map((p) => ({ date: p?.date ?? null, price: typeof p === 'number' ? p : (p?.price ?? p?.close) }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0);
  if (pts.length < 5) return null;
  if (pts[0].date && pts[pts.length - 1].date) pts.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const first = pts[0].price;
  const last = pts[pts.length - 1].price;
  return first > 0 ? (last - first) / first : null;
}

// SMA50 / SMA200 from a sparkline (oldest → newest). Needs enough history;
// returns nulls it can't compute. Shared by enrich + the boot backfill.
export function trendFromSparkline(arr) {
  if (!Array.isArray(arr) || arr.length < 60) return null;
  const pts = arr
    .map((p) => ({ date: p?.date ?? null, price: typeof p === 'number' ? p : (p?.price ?? p?.close) }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0);
  if (pts.length < 60) return null;
  if (pts[0].date && pts[pts.length - 1].date) pts.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const px = pts.map((p) => p.price);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sma50 = px.length >= 50 ? mean(px.slice(-50)) : null;
  // Prefer a true 200-day average; fall back to the full window (≥120d) so newer
  // listings still get a usable long-trend reference.
  const sma200 = px.length >= 200 ? mean(px.slice(-200)) : px.length >= 120 ? mean(px) : null;
  return { sma50, sma200 };
}

const updateTrend = db.prepare('UPDATE stocks SET sma50 = ?, sma200 = ? WHERE symbol = ?');
export function saveTrend(symbol, sma50, sma200) {
  updateTrend.run(Number.isFinite(sma50) ? sma50 : null, Number.isFinite(sma200) ? sma200 : null, symbol);
}

// One-time backfill: compute SMA50/SMA200 for stocks that have a 365-day
// sparkline but no stored trend yet.
export function backfillTrend(limit = 200000) {
  const rows = db
    .prepare(
      `SELECT sp.symbol AS symbol, sp.data AS data
         FROM sparklines sp
         JOIN stocks s ON s.symbol = sp.symbol
        WHERE sp.days = 365 AND s.sma200 IS NULL
        LIMIT ?`,
    )
    .all(limit);
  let n = 0;
  const tx = db.transaction((items) => {
    for (const row of items) {
      try {
        const t = trendFromSparkline(JSON.parse(row.data));
        if (t && t.sma200 != null) {
          updateTrend.run(Number.isFinite(t.sma50) ? t.sma50 : null, t.sma200, row.symbol);
          n++;
        }
      } catch {
        /* skip */
      }
    }
  });
  tx(rows);
  return n;
}

// One-time backfill: compute `mom` for already-enriched stocks that have a
// 45-day sparkline but no momentum yet, so the screener signal lights up
// immediately instead of waiting for the slow background re-enrich cycle.
export function backfillMomentum(limit = 200000) {
  const rows = db
    .prepare(
      `SELECT sp.symbol AS symbol, sp.data AS data
         FROM sparklines sp
         JOIN stocks s ON s.symbol = sp.symbol
        WHERE sp.days = 45 AND s.mom IS NULL
        LIMIT ?`,
    )
    .all(limit);
  let n = 0;
  const tx = db.transaction((items) => {
    for (const row of items) {
      try {
        const mom = momentumFromSparkline(JSON.parse(row.data));
        if (mom != null) {
          updateMom.run(mom, row.symbol);
          n++;
        }
      } catch {
        /* skip unparseable sparkline */
      }
    }
  });
  tx(rows);
  return n;
}

export function getStock(symbol) {
  return db.prepare('SELECT * FROM stocks WHERE symbol=?').get(symbol);
}

export function getStockClassifications(symbols) {
  const clean = [...new Set((symbols || []).map((symbol) => String(symbol || '').toUpperCase()).filter((symbol) => /^[A-Z0-9.-]{1,12}$/.test(symbol)))].slice(0, 200);
  if (!clean.length) return [];
  const placeholders = clean.map(() => '?').join(',');
  return db.prepare(`SELECT symbol, sector, industry, mcap FROM stocks WHERE symbol IN (${placeholders})`).all(...clean);
}

export function getMissingKm() {
  return db.prepare('SELECT symbol FROM stocks WHERE has_km=0').all().map(r => r.symbol);
}

export function getMissingRat() {
  return db.prepare('SELECT symbol FROM stocks WHERE has_rat=0').all().map(r => r.symbol);
}

export function getMissingEnrich(limit) {
  // The background loop only ever needs the next handful; passing a limit keeps it
  // from materializing a multi-thousand-element array on every tick. The enrich
  // route still calls it with no arg to build the full target list.
  // is_etf=0: ETFs/funds have no key-metrics/ratios, so they're never "missing".
  if (limit && Number.isFinite(limit)) {
    return db
      .prepare('SELECT symbol FROM stocks WHERE is_etf = 0 AND (has_km=0 OR has_rat=0) LIMIT ?')
      .all(limit)
      .map((r) => r.symbol);
  }
  return db.prepare('SELECT symbol FROM stocks WHERE is_etf = 0 AND (has_km=0 OR has_rat=0)').all().map(r => r.symbol);
}

// Count only — for status/telemetry. Avoids building (and discarding) the full
// array of missing symbols just to read its .length.
export function getMissingEnrichCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM stocks WHERE is_etf = 0 AND (has_km=0 OR has_rat=0)').get().c;
}

// Background-loop selector: symbols still missing core data, oldest-attempt first,
// EXCLUDING any attempted within `cooldownMs`. Combined with touchStock() on every
// attempt, this rotates through the whole missing backlog instead of re-selecting
// the same un-enrichable symbols (ETFs/funds with no fundamentals) every tick.
export function getMissingEnrichDue(limit = 8, cooldownMs = 6 * 60 * 60 * 1000) {
  const cutoff = Date.now() - cooldownMs;
  return db
    .prepare(
      `SELECT symbol FROM stocks
         WHERE is_etf = 0 AND (has_km = 0 OR has_rat = 0)
           AND (updated_at IS NULL OR updated_at < ?)
         ORDER BY updated_at ASC
         LIMIT ?`,
    )
    .all(cutoff, limit)
    .map((r) => r.symbol);
}

// Background maintenance selector: already-enriched symbols whose data is older
// than `staleMs`, stalest first. Lets the loop keep metrics fresh once the missing
// backlog is drained, without churning rows that were just updated.
export function getStaleEnriched(limit = 12, staleMs = 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - staleMs;
  return db
    .prepare(
      `SELECT symbol FROM stocks
         WHERE is_etf = 0 AND has_km = 1 AND has_rat = 1
           AND updated_at IS NOT NULL AND updated_at < ?
         ORDER BY updated_at ASC
         LIMIT ?`,
    )
    .all(cutoff, limit)
    .map((r) => r.symbol);
}

// Advance updated_at without otherwise changing a row. Used by the background loop
// so an attempt that produced no new data still moves the rotation forward (and
// starts that symbol's cooldown) instead of being picked again immediately.
export function touchStock(symbol) {
  db.prepare('UPDATE stocks SET updated_at = ? WHERE symbol = ?').run(Date.now(), symbol);
}

// ── Intraday price refresh (quote-driven, market-hours aware) ──────────────

const applyQuoteStmt = db.prepare(`
  UPDATE stocks SET
    price            = COALESCE(@price, price),
    volume           = COALESCE(@volume, volume),
    mcap             = COALESCE(@mcap, mcap),
    price_updated_at = @price_updated_at
  WHERE symbol = @symbol
`);

export function saveQuote(symbol, q) {
  applyQuoteStmt.run({
    symbol,
    price: q?.price ?? null,
    volume: q?.volume ?? null,
    mcap: q?.mcap ?? null,
    price_updated_at: Date.now(),
  });
}

// Advance only the quote clock (used when a quote attempt returned nothing, so
// the rotation moves on instead of re-picking the same dead symbol).
export function touchQuote(symbol) {
  db.prepare('UPDATE stocks SET price_updated_at = ? WHERE symbol = ?').run(Date.now(), symbol);
}

// Top-N by market cap whose quote is older than staleMs — the "keep the names
// that matter fresh through the trading day" tier.
export function getTopPriceRefreshDue(topN = 500, staleMs = 30 * 60 * 1000, limit = 10) {
  const cutoff = Date.now() - staleMs;
  return db
    .prepare(
      `SELECT symbol FROM (
         SELECT symbol, price_updated_at FROM stocks
           WHERE mcap IS NOT NULL
           ORDER BY mcap DESC LIMIT ?
       )
       WHERE price_updated_at IS NULL OR price_updated_at < ?
       ORDER BY price_updated_at ASC
       LIMIT ?`,
    )
    .all(topN, cutoff, limit)
    .map((r) => r.symbol);
}

// Whole-universe rotation: stalest quotes first (NULLs sort first in SQLite).
export function getAnyPriceRefreshDue(staleMs = 6 * 60 * 60 * 1000, limit = 10) {
  const cutoff = Date.now() - staleMs;
  return db
    .prepare(
      `SELECT symbol FROM stocks
         WHERE price IS NOT NULL
           AND (price_updated_at IS NULL OR price_updated_at < ?)
         ORDER BY price_updated_at ASC
         LIMIT ?`,
    )
    .all(cutoff, limit)
    .map((r) => r.symbol);
}

// ── Watchlist priority selectors ───────────────────────────────────────────

function watchlistInClause(symbols) {
  if (!symbols?.length) return null;
  return { placeholders: symbols.map(() => '?').join(','), args: symbols };
}

export function getWatchlistQuoteDue(symbols, staleMs, limit = 6) {
  const clause = watchlistInClause(symbols);
  if (!clause) return [];
  const cutoff = Date.now() - staleMs;
  return db
    .prepare(
      `SELECT symbol FROM stocks
         WHERE symbol IN (${clause.placeholders})
           AND is_etf = 0
           AND price IS NOT NULL
           AND (price_updated_at IS NULL OR price_updated_at < ?)
         ORDER BY price_updated_at ASC
         LIMIT ?`,
    )
    .all(...clause.args, cutoff, limit)
    .map((r) => r.symbol);
}

export function getWatchlistEnrichDue(symbols, staleMs, limit = 4) {
  const clause = watchlistInClause(symbols);
  if (!clause) return [];
  const cutoff = Date.now() - staleMs;
  return db
    .prepare(
      `SELECT symbol FROM stocks
         WHERE symbol IN (${clause.placeholders})
           AND is_etf = 0
           AND (
             has_km = 0 OR has_rat = 0
             OR updated_at IS NULL OR updated_at < ?
           )
         ORDER BY updated_at ASC
         LIMIT ?`,
    )
    .all(...clause.args, cutoff, limit)
    .map((r) => r.symbol);
}

/** Prioritize live quote refresh for watchlist symbols (price only). */
export function markWatchlistQuoteDue(symbols) {
  if (!symbols?.length) return;
  const stmt = db.prepare(
    `UPDATE stocks SET price_updated_at = NULL WHERE symbol = ? AND is_etf = 0`,
  );
  const tx = db.transaction((syms) => {
    for (const s of syms) stmt.run(s);
  });
  tx(symbols);
}

/** Force watchlist symbols to the front of the priority rotation (quotes + fundamentals). */
export function markWatchlistGatherDue(symbols) {
  if (!symbols?.length) return;
  const stmt = db.prepare(
    `UPDATE stocks SET price_updated_at = NULL, updated_at = NULL WHERE symbol = ? AND is_etf = 0`,
  );
  const tx = db.transaction((syms) => {
    for (const s of syms) stmt.run(s);
  });
  tx(symbols);
}

// ── Data freshness summary (debug page) ────────────────────────────────────

export function getFreshnessSummary() {
  const now = Date.now();
  const m30 = now - 30 * 60 * 1000;
  const h6 = now - 6 * 60 * 60 * 1000;
  const h24 = now - 24 * 60 * 60 * 1000;
  const d7 = now - 7 * 24 * 60 * 60 * 1000;
  const one = (sql, ...args) => db.prepare(sql).get(...args).c;
  return {
    stocks: one('SELECT COUNT(*) c FROM stocks'),
    etfs: one('SELECT COUNT(*) c FROM stocks WHERE is_etf = 1'),
    enriched: one('SELECT COUNT(*) c FROM stocks WHERE has_km = 1 AND has_rat = 1'),
    missingEnrich: one('SELECT COUNT(*) c FROM stocks WHERE is_etf = 0 AND (has_km = 0 OR has_rat = 0)'),
    price: {
      fresh30m: one('SELECT COUNT(*) c FROM stocks WHERE price_updated_at >= ?', m30),
      fresh6h: one('SELECT COUNT(*) c FROM stocks WHERE price_updated_at >= ?', h6),
      fresh24h: one('SELECT COUNT(*) c FROM stocks WHERE price_updated_at >= ?', h24),
      older: one('SELECT COUNT(*) c FROM stocks WHERE price IS NOT NULL AND (price_updated_at IS NULL OR price_updated_at < ?)', h24),
    },
    fundamentals: {
      fresh24h: one('SELECT COUNT(*) c FROM stocks WHERE has_km = 1 AND updated_at >= ?', h24),
      fresh7d: one('SELECT COUNT(*) c FROM stocks WHERE has_km = 1 AND updated_at >= ?', d7),
      stale7d: one('SELECT COUNT(*) c FROM stocks WHERE has_km = 1 AND (updated_at IS NULL OR updated_at < ?)', d7),
    },
    sparklines: one('SELECT COUNT(*) c FROM sparklines'),
    kvCache: one('SELECT COUNT(*) c FROM kv_cache'),
    aiEnrichment: one('SELECT COUNT(*) c FROM ai_enrichment'),
  };
}

// ── Persistent key-value cache (per-symbol detail lookups) ─────────────────
// Write-through companion to the in-memory detail cache so profiles, ratings,
// grades, insider trades, news, and RSI survive server restarts instead of
// costing a fresh FMP call each redeploy.

const getKvStmt = db.prepare('SELECT data, updated_at FROM kv_cache WHERE key = ?');
const setKvStmt = db.prepare(`
  INSERT INTO kv_cache (key, data, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
`);

export function kvGet(key) {
  const row = getKvStmt.get(key);
  if (!row) return null;
  try {
    return { data: JSON.parse(row.data), updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export function kvSet(key, data) {
  try {
    setKvStmt.run(key, JSON.stringify(data), Date.now());
  } catch (e) {
    console.warn('[db] kvSet failed:', e.message);
  }
}

// Drop entries not touched within maxAgeMs (run occasionally to bound growth).
// Trickle scores have their own longer configurable TTL and must not be removed
// early by the generic detail-cache policy.
export function kvPurgeOlderThan(maxAgeMs = 14 * 24 * 60 * 60 * 1000) {
  const now = Date.now();
  const cutoff = now - maxAgeMs;
  const liteCutoff = now - screenerLiteTtlMs();
  const litePattern = `${LITE_GAME_PLAN_CACHE_PREFIX}%`;
  return db.prepare(`
    DELETE FROM kv_cache
     WHERE (key LIKE ? AND updated_at < ?)
        OR (key NOT LIKE ? AND updated_at < ?)
  `).run(litePattern, liteCutoff, litePattern, cutoff).changes;
}

export function getOldestSymbols(limit = 50) {
  // Prefer symbols that haven't been touched in a while (for background maintenance)
  return db
    .prepare(
      `SELECT symbol FROM stocks ORDER BY updated_at ASC NULLS FIRST, symbol ASC LIMIT ?`
    )
    .all(limit)
    .map((r) => r.symbol);
}

const applyDcf = db.prepare(`
  UPDATE stocks SET
    dcf        = @dcf,
    dcf_date   = @dcf_date,
    has_dcf    = 1,
    updated_at = @updated_at
  WHERE symbol = @symbol
`);

const applyGrowth = db.prepare(`
  UPDATE stocks SET
    revenue_growth   = @revenue_growth,
    eps_growth       = @eps_growth,
    fcf_growth       = @fcf_growth,
    op_income_growth = @op_income_growth,
    has_growth       = 1,
    updated_at       = @updated_at
  WHERE symbol = @symbol
`);

export function saveDcf(symbol, data) {
  applyDcf.run({
    symbol,
    updated_at: Date.now(),
    dcf: data?.dcf ?? null,
    dcf_date: data?.dcf_date ?? null,
  });
}

export function saveGrowth(symbol, data) {
  applyGrowth.run({
    symbol,
    updated_at: Date.now(),
    revenue_growth: data?.revenue_growth ?? null,
    eps_growth: data?.eps_growth ?? null,
    fcf_growth: data?.fcf_growth ?? null,
    op_income_growth: data?.op_income_growth ?? null,
  });
}

// Mark a symbol as "we tried but nothing came back" so we don't retry every enrich.
export function markDcfChecked(symbol) {
  db.prepare(`UPDATE stocks SET has_dcf=1, updated_at=? WHERE symbol=?`).run(Date.now(), symbol);
}
export function markGrowthChecked(symbol) {
  db.prepare(`UPDATE stocks SET has_growth=1, updated_at=? WHERE symbol=?`).run(Date.now(), symbol);
}

/**
 * Prune stocks below a minimum market cap. ETFs/funds (is_etf=1) are always kept
 * — they're carried for price/name and don't have a meaningful market-cap floor.
 */
export function pruneBelowMarketCap(minMcap) {
  const stmt = db.prepare(`DELETE FROM stocks WHERE is_etf = 0 AND mcap IS NOT NULL AND mcap < ?`);
  const info = stmt.run(minMcap);
  return info.changes || 0;
}

/**
 * Full universe cleanup after a (force) screener refresh with a market-cap floor.
 * Removes non-ETF stocks below the floor, plus stale NULL-mcap placeholders that
 * weren't refreshed this pass (i.e. symbols the screener no longer returns because
 * they're below the floor / delisted). ETFs are always kept. `refreshStart` is the
 * timestamp captured before the refresh wrote its rows.
 */
export function pruneUniverse(floor, refreshStart = 0) {
  const belowFloor =
    db.prepare(`DELETE FROM stocks WHERE is_etf = 0 AND mcap IS NOT NULL AND mcap < ?`).run(floor)
      .changes || 0;
  let stalePlaceholders = 0;
  if (refreshStart) {
    stalePlaceholders =
      db
        .prepare(
          `DELETE FROM stocks WHERE is_etf = 0 AND mcap IS NULL AND (updated_at IS NULL OR updated_at < ?)`,
        )
        .run(refreshStart).changes || 0;
  }
  return { belowFloor, stalePlaceholders, total: belowFloor + stalePlaceholders };
}

export function getStockCount() {
  return db.prepare('SELECT COUNT(*) as c FROM stocks').get().c;
}

export function getStrategyContextNames() {
  const sectors = db.prepare("SELECT DISTINCT sector FROM stocks WHERE sector IS NOT NULL AND sector != '' AND sector != '—'").all().map((row) => row.sector);
  const industries = db.prepare("SELECT DISTINCT industry FROM stocks WHERE industry IS NOT NULL AND industry != '' AND industry != '—'").all().map((row) => row.industry);
  return { sectors, industries };
}

export function getKmCount() {
  return db.prepare('SELECT COUNT(*) as c FROM stocks WHERE has_km=1').get().c;
}

export function getEnrichedCount() {
  return db.prepare('SELECT COUNT(*) as c FROM stocks WHERE has_km=1 AND has_rat=1').get().c;
}

// ── AI enrichment ─────────────────────────────────────────────────────────

const upsertAi = db.prepare(`
  INSERT INTO ai_enrichment (
    symbol, dcf, stock_price, dcf_date,
    target_high, target_low, target_consensus, target_median,
    revenue_growth, net_income_growth, eps_growth, fcf_growth, op_income_growth,
    owner_earnings, owner_eps, growth_capex,
    estimates_json, updated_at
  ) VALUES (
    @symbol, @dcf, @stock_price, @dcf_date,
    @target_high, @target_low, @target_consensus, @target_median,
    @revenue_growth, @net_income_growth, @eps_growth, @fcf_growth, @op_income_growth,
    @owner_earnings, @owner_eps, @growth_capex,
    @estimates_json, @updated_at
  )
  ON CONFLICT(symbol) DO UPDATE SET
    dcf=excluded.dcf, stock_price=excluded.stock_price, dcf_date=excluded.dcf_date,
    target_high=excluded.target_high, target_low=excluded.target_low,
    target_consensus=excluded.target_consensus, target_median=excluded.target_median,
    revenue_growth=excluded.revenue_growth, net_income_growth=excluded.net_income_growth,
    eps_growth=excluded.eps_growth, fcf_growth=excluded.fcf_growth,
    op_income_growth=excluded.op_income_growth,
    owner_earnings=excluded.owner_earnings, owner_eps=excluded.owner_eps,
    growth_capex=excluded.growth_capex,
    estimates_json=excluded.estimates_json, updated_at=excluded.updated_at
`);

export function saveAiEnrichment(symbol, data) {
  upsertAi.run({ symbol, updated_at: Date.now(), ...data });
}

export function getAiEnrichment(symbol) {
  return db.prepare('SELECT * FROM ai_enrichment WHERE symbol=?').get(symbol);
}

export function getAiEnrichmentBatch(symbols) {
  if (!symbols.length) return [];
  const placeholders = symbols.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM ai_enrichment WHERE symbol IN (${placeholders})`).all(...symbols);
}

// ── Sparklines (persisted historical prices for the chart) ────────────────

const upsertSparkline = db.prepare(`
  INSERT INTO sparklines (symbol, days, data, updated_at)
  VALUES (@symbol, @days, @data, @updated_at)
  ON CONFLICT(symbol, days) DO UPDATE SET
    data = excluded.data,
    updated_at = excluded.updated_at
`);

export function saveSparkline(symbol, days, data) {
  upsertSparkline.run({
    symbol,
    days,
    data: JSON.stringify(data),
    updated_at: Date.now(),
  });
}

export function getSparkline(symbol, days) {
  return db
    .prepare('SELECT * FROM sparklines WHERE symbol = ? AND days = ?')
    .get(symbol, days);
}

// ── Chat sessions ─────────────────────────────────────────────────────────

const upsertChat = db.prepare(`
  INSERT INTO chat_sessions (id, user_id, created_at, updated_at, title, messages)
  VALUES (@id, @user_id, @created_at, @updated_at, @title, @messages)
  ON CONFLICT(id) DO UPDATE SET
    updated_at=excluded.updated_at, title=excluded.title, messages=excluded.messages
`);

export function saveChatSession(session) {
  upsertChat.run({ user_id: 'default', ...session });
}

export function getChatSession(id, userId = 'default') {
  return db
    .prepare('SELECT * FROM chat_sessions WHERE id=? AND user_id=?')
    .get(id, userId);
}

export function listChatSessions(userId = 'default') {
  return db
    .prepare(
      'SELECT id, title, created_at, updated_at FROM chat_sessions WHERE user_id=? ORDER BY updated_at DESC',
    )
    .all(userId);
}

export function deleteChatSession(id, userId = 'default') {
  db.prepare('DELETE FROM chat_sessions WHERE id=? AND user_id=?').run(id, userId);
}

// ── User management (for secure multi-user auth) ───────────────────────────

const insertUser = db.prepare(`
  INSERT INTO users (username, password_hash, created_at, is_admin, email, plan, plan_updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const getUserByUsernameStmt = db.prepare(`
  SELECT * FROM users WHERE username = ?
`);

const getUserByEmailStmt = db.prepare(`
  SELECT * FROM users WHERE email = ? COLLATE NOCASE
`);

export function getUserByUsername(username) {
  return getUserByUsernameStmt.get(username);
}

export function getUserByEmail(email) {
  if (!email) return undefined;
  return getUserByEmailStmt.get(String(email).trim());
}

/** Canonical plan id: free | pro | ultimate (Starfarer). */
export function normalizePlan(plan) {
  const p = String(plan || 'free').toLowerCase();
  if (p === 'ultimate' || p === 'starfarer') return 'ultimate';
  if (p === 'pro' || p === 'voyager') return 'pro';
  return 'free';
}

export function hasOriPlan(plan) {
  const p = normalizePlan(plan);
  return p === 'pro' || p === 'ultimate';
}

export function createUser(username, password, isAdmin = false, email = null, plan = 'free') {
  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  try {
    insertUser.run(
      username,
      hash,
      now,
      isAdmin ? 1 : 0,
      email ? String(email).trim().toLowerCase() : null,
      normalizePlan(plan) === 'pro' ? 'pro' : 'free',
      now,
    );
    return { success: true };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { success: false, error: 'An account with that username or email already exists' };
    }
    return { success: false, error: err.message };
  }
}

const getUserByUsernameCiStmt = db.prepare(`
  SELECT * FROM users WHERE username = ? COLLATE NOCASE
`);

// Accepts a username OR an email as the identifier (trimmed; username is case-insensitive).
export function verifyUserPassword(identifier, password) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  const user =
    getUserByUsername(id) ||
    getUserByUsernameCiStmt.get(id) ||
    getUserByEmail(id);
  if (!user) return null;
  const valid = bcrypt.compareSync(password, user.password_hash);
  return valid
    ? {
        id: user.id,
        username: user.username,
        isAdmin: !!user.is_admin,
        plan: normalizePlan(user.plan),
      }
    : null;
}

export function setUserPlan(username, plan) {
  const next = normalizePlan(plan);
  const info = db
    .prepare('UPDATE users SET plan = ?, plan_updated_at = ? WHERE username = ?')
    .run(next, Date.now(), username);
  return info.changes > 0;
}

// ── Self-service account deletion ────────────────────────────────────────────
// Cascade-delete a user and ALL of their per-user data in one transaction, so
// nothing is left orphaned (and can't be silently inherited if the same
// username/email signs up again). Returns the users-row delete result (.changes).
export function deleteUserCascade(username) {
  const tx = db.transaction((u) => {
    db.prepare('DELETE FROM billing_checkout_tokens WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM revoked_auth_tokens WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM chat_sessions WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM linked_accounts WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM brokerage_orders WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM ori_usage WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM ori_usage_events WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM login_events WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM watchlist_alert_state WHERE user_id = ?').run(u);
    return db.prepare('DELETE FROM users WHERE username = ?').run(u);
  });
  return tx(username);
}

// ── Password reset ───────────────────────────────────────────────────────────
// Store the sha256 hash of a single-use reset token + its expiry. We persist the
// HASH, never the token itself, so a DB leak can't be used to reset passwords.
export function setResetToken(username, tokenHash, expiresMs) {
  return db
    .prepare('UPDATE users SET reset_token_hash = ?, reset_expires = ? WHERE username = ?')
    .run(tokenHash, expiresMs, username).changes > 0;
}

// Set a new password from a plaintext value, clear any pending reset token, and
// bump the epoch so every previously issued session token is invalidated.
export function setUserPassword(username, plainPassword) {
  const hash = bcrypt.hashSync(plainPassword, 10);
  return db
    .prepare(`UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_expires = NULL,
              session_epoch = COALESCE(session_epoch, 0) + 1 WHERE username = ?`)
    .run(hash, username).changes > 0;
}

export function bumpSessionEpoch(username) {
  db.prepare('UPDATE users SET session_epoch = COALESCE(session_epoch, 0) + 1 WHERE username = ?').run(username);
  return getUserByUsername(username)?.session_epoch ?? 0;
}

// ── Per-device session revocation ───────────────────────────────────────────
const insertAuthSessionStmt = db.prepare(`
  INSERT INTO auth_sessions (session_hash, user_id, created_at, expires_at)
  VALUES (?, ?, ?, ?)
`);
const activeAuthSessionStmt = db.prepare(`
  SELECT 1 FROM auth_sessions
  WHERE session_hash = ? AND user_id = ? AND expires_at > ?
`);
const extendAuthSessionStmt = db.prepare(`
  UPDATE auth_sessions SET expires_at = ?
  WHERE session_hash = ? AND user_id = ? AND expires_at > ?
`);
const revokeAuthSessionStmt = db.prepare(`
  DELETE FROM auth_sessions WHERE session_hash = ? AND user_id = ?
`);
const revokeLegacyAuthTokenStmt = db.prepare(`
  INSERT INTO revoked_auth_tokens (token_hash, user_id, expires_at)
  VALUES (?, ?, ?)
  ON CONFLICT(token_hash) DO UPDATE SET expires_at = MAX(expires_at, excluded.expires_at)
`);
const isLegacyAuthTokenRevokedStmt = db.prepare(`
  SELECT 1 FROM revoked_auth_tokens
  WHERE token_hash = ? AND user_id = ? AND expires_at > ?
`);

function authSessionHash(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length < 16 || sessionId.length > 200) return null;
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}

function legacyAuthTokenHash(token) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 4096) return null;
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createAuthSession(userId, sessionId, expiresAt, createdAt = Date.now()) {
  const hash = authSessionHash(sessionId);
  if (!hash || !userId || !Number.isFinite(expiresAt)) return false;
  insertAuthSessionStmt.run(hash, userId, createdAt, expiresAt);
  return true;
}

export function isAuthSessionActive(userId, sessionId, now = Date.now()) {
  const hash = authSessionHash(sessionId);
  return !!(hash && activeAuthSessionStmt.get(hash, userId, now));
}

export function extendAuthSession(userId, sessionId, expiresAt, now = Date.now()) {
  const hash = authSessionHash(sessionId);
  if (!hash || !Number.isFinite(expiresAt)) return false;
  return extendAuthSessionStmt.run(expiresAt, hash, userId, now).changes > 0;
}

export function revokeAuthSession(userId, sessionId) {
  const hash = authSessionHash(sessionId);
  if (!hash) return false;
  return revokeAuthSessionStmt.run(hash, userId).changes > 0;
}

export function revokeLegacyAuthToken(userId, token, expiresAt) {
  const hash = legacyAuthTokenHash(token);
  if (!hash || !userId || !Number.isFinite(expiresAt)) return false;
  revokeLegacyAuthTokenStmt.run(hash, userId, expiresAt);
  return true;
}

export function isLegacyAuthTokenRevoked(userId, token, now = Date.now()) {
  const hash = legacyAuthTokenHash(token);
  return !!(hash && isLegacyAuthTokenRevokedStmt.get(hash, userId, now));
}

export function pruneExpiredAuthSessions(now = Date.now()) {
  const prune = db.transaction(() => ({
    sessions: db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now).changes,
    legacyTokens: db.prepare('DELETE FROM revoked_auth_tokens WHERE expires_at <= ?').run(now).changes,
  }));
  return prune();
}

const recordLoginStmt = db.prepare(`
  UPDATE users SET
    last_login_at = @at,
    last_login_ip = @ip,
    login_count = COALESCE(login_count, 0) + 1,
    last_active_at = @at
  WHERE username = @user_id
`);
const insertLoginEventStmt = db.prepare(`
  INSERT INTO login_events (user_id, at, ip, user_agent, kind) VALUES (?, ?, ?, ?, ?)
`);
const touchActivityStmt = db.prepare('UPDATE users SET last_active_at = ? WHERE username = ?');

const activityThrottle = new Map();
const ACTIVITY_THROTTLE_MS = 2 * 60 * 1000;

/** Record a successful sign-in and append to the login audit log. */
export function recordUserLogin(userId, { ip, userAgent, kind = 'login' } = {}) {
  const at = Date.now();
  recordLoginStmt.run({ user_id: userId, at, ip: ip || null });
  insertLoginEventStmt.run(userId, at, ip || null, userAgent || null, kind);
  activityThrottle.set(userId, at);
}

/**
 * Throttled last-seen update (called on authenticated API traffic).
 * @returns {boolean} true if last-seen actually advanced (throttle window
 *   elapsed), false if it was a no-op — lets callers roll the session cookie
 *   only when activity genuinely moved forward.
 */
export function touchUserActivity(userId) {
  const now = Date.now();
  const last = activityThrottle.get(userId) || 0;
  if (now - last < ACTIVITY_THROTTLE_MS) return false;
  activityThrottle.set(userId, now);
  touchActivityStmt.run(now, userId);
  return true;
}

export function listRecentLoginEvents(limit = 40) {
  return db.prepare('SELECT * FROM login_events ORDER BY at DESC LIMIT ?').all(limit);
}

export function listLoginEventsForUser(userId, limit = 20) {
  return db.prepare('SELECT * FROM login_events WHERE user_id = ? ORDER BY at DESC LIMIT ?').all(userId, limit);
}

const chatStatsByUserStmt = db.prepare(`
  SELECT user_id, COUNT(*) AS sessions, MAX(updated_at) AS last_chat_at
  FROM chat_sessions GROUP BY user_id
`);

/** Per-user chat session counts and last activity. */
export function chatStatsByUser() {
  const map = new Map();
  for (const row of chatStatsByUserStmt.all()) {
    map.set(row.user_id, { sessions: row.sessions, lastChatAt: row.last_chat_at });
  }
  return map;
}

export function listUsersWithActivity() {
  return db.prepare(`
    SELECT id, username, email, plan, created_at, is_admin,
           last_login_at, last_login_ip, login_count, last_active_at, session_epoch,
           notification_email, subscription_status, pro_until
    FROM users ORDER BY created_at
  `).all();
}

/** Drop login audit rows older than `beforeMs`. */
export function pruneLoginEvents(beforeMs) {
  try { db.prepare('DELETE FROM login_events WHERE at < ?').run(beforeMs); }
  catch (e) { console.warn('[db] pruneLoginEvents failed:', e.message); }
}

// ── PayPal subscription state → plan, with a post-cancellation grace period ───
//   ACTIVE / APPROVED      → Pro (pro_until tracks the current period end).
//   CANCELLED / SUSPENDED  → Pro until `pro_until` (the paid-through date), then
//                            Free. PayPal billing has already stopped.
//   EXPIRED                → Free immediately.
// `proUntil` (ms) is PayPal's billing_info.next_billing_time (end of the paid
// period). Pass `undefined` to keep the stored value; pass null to clear it.
const ACTIVE_SUB_STATUSES = new Set(['ACTIVE', 'APPROVED']);

const BILLING_CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BILLING_CHECKOUT_TOKENS_PER_USER = 5;

function hashBillingCheckoutToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

const insertBillingCheckoutTokenStmt = db.prepare(`
  INSERT INTO billing_checkout_tokens (token_hash, user_id, created_at, expires_at)
  VALUES (?, ?, ?, ?)
`);
const pruneBillingCheckoutTokensStmt = db.prepare(
  'DELETE FROM billing_checkout_tokens WHERE expires_at <= ?',
);
const trimBillingCheckoutTokensStmt = db.prepare(`
  DELETE FROM billing_checkout_tokens
   WHERE user_id = ?
     AND token_hash NOT IN (
       SELECT token_hash
         FROM billing_checkout_tokens
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
     )
`);
const issueBillingCheckoutToken = db.transaction((userId, now) => {
  pruneBillingCheckoutTokensStmt.run(now);
  const token = crypto.randomBytes(24).toString('base64url');
  insertBillingCheckoutTokenStmt.run(
    hashBillingCheckoutToken(token),
    userId,
    now,
    now + BILLING_CHECKOUT_TTL_MS,
  );
  trimBillingCheckoutTokensStmt.run(
    userId,
    userId,
    MAX_BILLING_CHECKOUT_TOKENS_PER_USER,
  );
  return token;
});

/** Issue a short-lived opaque token that binds a PayPal checkout to a user. */
export function createBillingCheckoutToken(userId) {
  if (!getUserByUsername(userId)) throw new Error('Cannot create checkout token for an unknown user');
  return issueBillingCheckoutToken(userId, Date.now());
}

/** Resolve an unexpired raw checkout token back to its owning user. */
export function getUserByBillingCheckoutToken(token) {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (raw.length < 20 || raw.length > 200) return undefined;
  const now = Date.now();
  pruneBillingCheckoutTokensStmt.run(now);
  return db.prepare(`
    SELECT u.*
      FROM billing_checkout_tokens AS t
      JOIN users AS u ON u.username = t.user_id
     WHERE t.token_hash = ? AND t.expires_at > ?
  `).get(hashBillingCheckoutToken(raw), now);
}

export function setUserSubscription(username, { subscriptionId, status = null, proUntil } = {}) {
  const u = getUserByUsername(username);
  if (!u) return false;

  const s = String(status || '').toUpperCase();
  const now = Date.now();
  const nextProUntil = proUntil === undefined ? (u.pro_until ?? null) : (proUntil || null);
  const nextSubId = subscriptionId === undefined ? (u.paypal_subscription_id ?? null) : (subscriptionId || null);

  // Starfarer (ultimate) is admin-granted for higher Ori limits — never driven by PayPal.
  if (normalizePlan(u.plan) === 'ultimate') {
    const info = db
      .prepare(
        `UPDATE users
           SET paypal_subscription_id = ?, subscription_status = ?, subscription_updated_at = ?,
               pro_until = ?
         WHERE username = ?`,
      )
      .run(nextSubId, status, now, nextProUntil, username);
    return info.changes > 0;
  }

  let plan;
  if (ACTIVE_SUB_STATUSES.has(s)) plan = 'pro';
  else if (s === 'EXPIRED') plan = 'free';
  else plan = nextProUntil && nextProUntil > now ? 'pro' : 'free'; // CANCELLED/SUSPENDED → grace

  const finalProUntil = plan === 'pro' ? nextProUntil : null;

  const info = db
    .prepare(
      `UPDATE users
         SET paypal_subscription_id = ?, subscription_status = ?, subscription_updated_at = ?,
             pro_until = ?, plan = ?, plan_updated_at = ?
       WHERE username = ?`,
    )
    .run(nextSubId, status, now, finalProUntil, plan, now, username);
  return info.changes > 0;
}

export function getUserBySubscriptionId(subscriptionId) {
  if (!subscriptionId) return undefined;
  return db.prepare('SELECT * FROM users WHERE paypal_subscription_id = ?').get(subscriptionId);
}

// Lazily downgrade a single user whose post-cancellation grace has ended. Call
// before reading a plan for access decisions (/auth/me, the chat gate).
export function reconcileUserPlan(username) {
  const u = getUserByUsername(username);
  if (!u) return u;
  if (normalizePlan(u.plan) === 'ultimate') return u;
  const lapsed =
    u.plan === 'pro' &&
    u.pro_until &&
    u.pro_until < Date.now() &&
    !ACTIVE_SUB_STATUSES.has(String(u.subscription_status || '').toUpperCase());
  if (lapsed) {
    db.prepare('UPDATE users SET plan = ?, plan_updated_at = ? WHERE username = ?')
      .run('free', Date.now(), username);
    return getUserByUsername(username);
  }
  return u;
}

// Sweep: downgrade everyone whose grace has ended (covers users who never hit
// /auth/me). Cheap UPDATE; run on an interval.
export function expireLapsedPro() {
  const now = Date.now();
  const info = db
    .prepare(
      `UPDATE users
         SET plan = 'free', plan_updated_at = ?
       WHERE plan = 'pro' AND pro_until IS NOT NULL AND pro_until < ?
         AND (subscription_status IS NULL OR subscription_status NOT IN ('ACTIVE', 'APPROVED'))`,
    )
    .run(now, now);
  return info.changes;
}

export function listUsers() {
  return db
    .prepare('SELECT id, username, email, plan, created_at, is_admin FROM users ORDER BY created_at')
    .all();
}

export function userCount() {
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get();
  return row.count;
}

export function adminCount() {
  return db.prepare('SELECT COUNT(*) as c FROM users WHERE is_admin = 1').get().c;
}

export function setUserAdmin(username, isAdmin) {
  const info = db
    .prepare('UPDATE users SET is_admin = ? WHERE username = ?')
    .run(isAdmin ? 1 : 0, username);
  return info.changes > 0;
}

export function setUserNotificationEmail(username, email) {
  const next = email && String(email).trim() ? String(email).trim() : null;
  return db
    .prepare('UPDATE users SET notification_email = ? WHERE username = ?')
    .run(next, username).changes > 0;
}

// ── Per-user settings (screens/tabs, pins, weights, theme, sidebar) ─────────
// Stored as a single JSON blob per user. Writes are a shallow merge so that
// independent clients (the screener and the theme/sidebar layer) can update
// their own keys without clobbering each other.

export function listAllUserSettingsRows() {
  return db.prepare('SELECT user_id, data FROM user_settings').all();
}

const getUserSettingsStmt = db.prepare('SELECT data FROM user_settings WHERE user_id = ?');
const upsertUserSettingsStmt = db.prepare(`
  INSERT INTO user_settings (user_id, data, updated_at)
  VALUES (@user_id, @data, @updated_at)
  ON CONFLICT(user_id) DO UPDATE SET
    data = excluded.data,
    updated_at = excluded.updated_at
`);

export function getUserSettings(userId = 'default') {
  const row = getUserSettingsStmt.get(userId);
  if (!row || !row.data) return {};
  try {
    return JSON.parse(row.data);
  } catch {
    return {};
  }
}

export function patchUserSettings(userId = 'default', partial = {}) {
  const current = getUserSettings(userId);
  const merged = { ...current, ...(partial && typeof partial === 'object' ? partial : {}) };
  upsertUserSettingsStmt.run({
    user_id: userId,
    data: JSON.stringify(merged),
    updated_at: Date.now(),
  });
  return merged;
}

// ── Ori (Gemini) usage ledger ────────────────────────────────────────────────
// One row per user per ET calendar day; counters only ever increment. The day
// key is supplied by the caller (oriUsage.js, using the ET-safe formatter) so
// the DB layer stays timezone-agnostic.

const incOriUsageStmt = db.prepare(`
  INSERT INTO ori_usage (
    user_id, day, requests, chat_requests, plan_requests,
    prompt_tokens, cached_tokens, output_tokens,
    chat_prompt_tokens, chat_cached_tokens, chat_output_tokens, chat_thoughts_tokens,
    plan_prompt_tokens, plan_cached_tokens, plan_output_tokens, plan_thoughts_tokens,
    chat_cost_usd_micros, plan_cost_usd_micros, cost_usd_micros,
    updated_at
  ) VALUES (
    @user_id, @day, @requests, @chat_requests, @plan_requests,
    @prompt_tokens, @cached_tokens, @output_tokens,
    @chat_prompt_tokens, @chat_cached_tokens, @chat_output_tokens, @chat_thoughts_tokens,
    @plan_prompt_tokens, @plan_cached_tokens, @plan_output_tokens, @plan_thoughts_tokens,
    @chat_cost_usd_micros, @plan_cost_usd_micros, @cost_usd_micros,
    @updated_at
  )
  ON CONFLICT(user_id, day) DO UPDATE SET
    requests       = requests + excluded.requests,
    chat_requests  = chat_requests + excluded.chat_requests,
    plan_requests  = plan_requests + excluded.plan_requests,
    prompt_tokens  = prompt_tokens + excluded.prompt_tokens,
    cached_tokens  = cached_tokens + excluded.cached_tokens,
    output_tokens  = output_tokens + excluded.output_tokens,
    chat_prompt_tokens = chat_prompt_tokens + excluded.chat_prompt_tokens,
    chat_cached_tokens = chat_cached_tokens + excluded.chat_cached_tokens,
    chat_output_tokens = chat_output_tokens + excluded.chat_output_tokens,
    chat_thoughts_tokens = chat_thoughts_tokens + excluded.chat_thoughts_tokens,
    plan_prompt_tokens = plan_prompt_tokens + excluded.plan_prompt_tokens,
    plan_cached_tokens = plan_cached_tokens + excluded.plan_cached_tokens,
    plan_output_tokens = plan_output_tokens + excluded.plan_output_tokens,
    plan_thoughts_tokens = plan_thoughts_tokens + excluded.plan_thoughts_tokens,
    chat_cost_usd_micros = chat_cost_usd_micros + excluded.chat_cost_usd_micros,
    plan_cost_usd_micros = plan_cost_usd_micros + excluded.plan_cost_usd_micros,
    cost_usd_micros = cost_usd_micros + excluded.cost_usd_micros,
    updated_at     = excluded.updated_at
`);

/** Increment a user's usage for an ET day. Each delta field defaults to 0. */
export function incrementOriUsage(userId, day, delta = {}) {
  const chatCost = delta.chatCostUsdMicros | 0;
  const planCost = delta.planCostUsdMicros | 0;
  const totalCost = delta.costUsdMicros != null ? (delta.costUsdMicros | 0) : (chatCost + planCost);
  incOriUsageStmt.run({
    user_id: userId,
    day,
    requests: delta.requests | 0,
    chat_requests: delta.chatRequests | 0,
    plan_requests: delta.planRequests | 0,
    prompt_tokens: delta.promptTokens | 0,
    cached_tokens: delta.cachedTokens | 0,
    output_tokens: delta.outputTokens | 0,
    chat_prompt_tokens: delta.chatPromptTokens | 0,
    chat_cached_tokens: delta.chatCachedTokens | 0,
    chat_output_tokens: delta.chatOutputTokens | 0,
    chat_thoughts_tokens: delta.chatThoughtsTokens | 0,
    plan_prompt_tokens: delta.planPromptTokens | 0,
    plan_cached_tokens: delta.planCachedTokens | 0,
    plan_output_tokens: delta.planOutputTokens | 0,
    plan_thoughts_tokens: delta.planThoughtsTokens | 0,
    chat_cost_usd_micros: chatCost,
    plan_cost_usd_micros: planCost,
    cost_usd_micros: totalCost,
    updated_at: Date.now(),
  });
}

const ZERO_USAGE = {
  requests: 0, chat_requests: 0, plan_requests: 0,
  prompt_tokens: 0, cached_tokens: 0, output_tokens: 0,
  chat_prompt_tokens: 0, chat_cached_tokens: 0, chat_output_tokens: 0, chat_thoughts_tokens: 0,
  plan_prompt_tokens: 0, plan_cached_tokens: 0, plan_output_tokens: 0, plan_thoughts_tokens: 0,
  chat_cost_usd_micros: 0, plan_cost_usd_micros: 0, cost_usd_micros: 0,
};

const getOriUsageDayStmt = db.prepare(
  'SELECT * FROM ori_usage WHERE user_id = ? AND day = ?',
);
// Month = every day row whose key shares the 'YYYY-MM' prefix. Lexicographic
// order on the ISO day string matches chronological order, so a range scan works.
const sumOriUsageRangeStmt = db.prepare(`
  SELECT
    COALESCE(SUM(requests), 0)      AS requests,
    COALESCE(SUM(chat_requests), 0) AS chat_requests,
    COALESCE(SUM(plan_requests), 0) AS plan_requests,
    COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
    COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
    COALESCE(SUM(output_tokens), 0) AS output_tokens,
    COALESCE(SUM(chat_prompt_tokens), 0) AS chat_prompt_tokens,
    COALESCE(SUM(chat_cached_tokens), 0) AS chat_cached_tokens,
    COALESCE(SUM(chat_output_tokens), 0) AS chat_output_tokens,
    COALESCE(SUM(chat_thoughts_tokens), 0) AS chat_thoughts_tokens,
    COALESCE(SUM(plan_prompt_tokens), 0) AS plan_prompt_tokens,
    COALESCE(SUM(plan_cached_tokens), 0) AS plan_cached_tokens,
    COALESCE(SUM(plan_output_tokens), 0) AS plan_output_tokens,
    COALESCE(SUM(plan_thoughts_tokens), 0) AS plan_thoughts_tokens,
    COALESCE(SUM(chat_cost_usd_micros), 0) AS chat_cost_usd_micros,
    COALESCE(SUM(plan_cost_usd_micros), 0) AS plan_cost_usd_micros,
    COALESCE(SUM(cost_usd_micros), 0) AS cost_usd_micros
  FROM ori_usage
  WHERE user_id = ? AND day >= ? AND day <= ?
`);

/** Sum Gemini cost across all users for an inclusive ET-day range. */
export function sumOriCostAllUsers(startDay, endDay) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(cost_usd_micros), 0) AS cost_usd_micros
    FROM ori_usage
    WHERE day >= ? AND day <= ?
  `).get(startDay, endDay);
  return row?.cost_usd_micros ?? 0;
}

/** A single ET day's usage row (zeroed if the user hasn't used Ori that day). */
export function getOriUsageDay(userId, day) {
  return getOriUsageDayStmt.get(userId, day) || { ...ZERO_USAGE, user_id: userId, day };
}

/** Summed usage across an inclusive ET-day range (used for the month total). */
export function getOriUsageRange(userId, startDay, endDay) {
  return sumOriUsageRangeStmt.get(userId, startDay, endDay) || { ...ZERO_USAGE };
}

/** Drop ledger rows older than `beforeDay` (housekeeping; rows are tiny). */
export function pruneOriUsage(beforeDay) {
  try { db.prepare('DELETE FROM ori_usage WHERE day < ?').run(beforeDay); }
  catch (e) { console.warn('[db] pruneOriUsage failed:', e.message); }
}

const insertOriUsageEventStmt = db.prepare(
  'INSERT INTO ori_usage_events (user_id, at, kind) VALUES (?, ?, ?)',
);
const countOriUsageEventsSinceStmt = db.prepare(
  'SELECT COUNT(*) AS n FROM ori_usage_events WHERE user_id = ? AND at >= ?',
);
const oldestOriUsageEventSinceStmt = db.prepare(
  'SELECT MIN(at) AS at FROM ori_usage_events WHERE user_id = ? AND at >= ?',
);

/** Record a single billable Ori action for rolling-window limits. */
export function insertOriUsageEvent(userId, kind, at = Date.now()) {
  insertOriUsageEventStmt.run(userId, at, kind);
}

const recordOriUsageLedgerTransaction = db.transaction((userId, day, delta, kind, at) => {
  incrementOriUsage(userId, day, delta);
  insertOriUsageEvent(userId, kind, at);
});

/** Keep calendar totals and the rolling-window event in one SQLite commit. */
export function recordOriUsageLedger(userId, day, delta, kind, at = Date.now()) {
  recordOriUsageLedgerTransaction(userId, day, delta, kind, at);
}

/** Count billable Ori actions since `sinceMs` (5-hour session window). */
export function countOriUsageEventsSince(userId, sinceMs) {
  return countOriUsageEventsSinceStmt.get(userId, sinceMs)?.n ?? 0;
}

/** Oldest event timestamp in the window (for "resets at" UI). */
export function oldestOriUsageEventSince(userId, sinceMs) {
  const row = oldestOriUsageEventSinceStmt.get(userId, sinceMs);
  return row?.at ?? null;
}

/** Drop event rows older than `beforeMs` (housekeeping). */
export function pruneOriUsageEvents(beforeMs) {
  try { db.prepare('DELETE FROM ori_usage_events WHERE at < ?').run(beforeMs); }
  catch (e) { console.warn('[db] pruneOriUsageEvents failed:', e.message); }
}

// ── Watchlist alert state ───────────────────────────────────────────────────

const getWlAlertStmt = db.prepare(
  'SELECT * FROM watchlist_alert_state WHERE user_id = ? AND symbol = ?',
);
const upsertWlAlertStmt = db.prepare(`
  INSERT INTO watchlist_alert_state (
    user_id, symbol, baseline_price, baseline_session_date, last_price, last_conviction,
    last_news_urls, last_alert_at, pending_digest, in_app_delivered_at
  ) VALUES (
    @user_id, @symbol, @baseline_price, @baseline_session_date, @last_price, @last_conviction,
    @last_news_urls, @last_alert_at, @pending_digest, @in_app_delivered_at
  )
  ON CONFLICT(user_id, symbol) DO UPDATE SET
    baseline_price = excluded.baseline_price,
    baseline_session_date = excluded.baseline_session_date,
    last_price = excluded.last_price,
    last_conviction = excluded.last_conviction,
    last_news_urls = excluded.last_news_urls,
    last_alert_at = excluded.last_alert_at,
    pending_digest = excluded.pending_digest,
    in_app_delivered_at = excluded.in_app_delivered_at
`);

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function getWatchlistAlertState(userId, symbol) {
  const row = getWlAlertStmt.get(userId, symbol);
  if (!row) return null;
  return {
    ...row,
    last_news_urls: parseJson(row.last_news_urls, []),
    last_alert_at: parseJson(row.last_alert_at, {}),
    pending_digest: parseJson(row.pending_digest, []),
  };
}

export function saveWatchlistAlertState(userId, symbol, patch = {}) {
  const cur = getWatchlistAlertState(userId, symbol) || {
    user_id: userId,
    symbol,
    baseline_price: null,
    baseline_session_date: null,
    last_price: null,
    last_conviction: null,
    last_news_urls: [],
    last_alert_at: {},
    pending_digest: [],
    in_app_delivered_at: null,
  };
  const next = { ...cur, ...patch, user_id: userId, symbol };
  upsertWlAlertStmt.run({
    user_id: userId,
    symbol,
    baseline_price: next.baseline_price,
    baseline_session_date: next.baseline_session_date,
    last_price: next.last_price,
    last_conviction: next.last_conviction,
    last_news_urls: JSON.stringify(next.last_news_urls || []),
    last_alert_at: JSON.stringify(next.last_alert_at || {}),
    pending_digest: JSON.stringify(next.pending_digest || []),
    in_app_delivered_at: next.in_app_delivered_at ?? null,
  });
  return next;
}

export function listWatchlistAlertStatesForUser(userId) {
  return db
    .prepare('SELECT * FROM watchlist_alert_state WHERE user_id = ?')
    .all(userId)
    .map((row) => ({
      ...row,
      last_news_urls: parseJson(row.last_news_urls, []),
      last_alert_at: parseJson(row.last_alert_at, {}),
      pending_digest: parseJson(row.pending_digest, []),
    }));
}

export function deleteWatchlistAlertState(userId, symbol) {
  db.prepare('DELETE FROM watchlist_alert_state WHERE user_id = ? AND symbol = ?').run(userId, symbol);
}

export default db;
