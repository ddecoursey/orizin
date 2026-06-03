import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const DB_PATH = process.env.DB_PATH || './data/screener.db';

// Use the path as-is if it is already absolute, otherwise resolve relative to cwd.
// path.resolve() on an absolute path is a no-op, but being explicit here avoids
// any confusion when DB_PATH="/data/screener.db" is injected by Railway.
const resolvedDbPath = path.isAbsolute(DB_PATH) ? DB_PATH : path.resolve(DB_PATH);
const dir = path.dirname(resolvedDbPath);

console.log(`[db] DB_PATH env: "${DB_PATH}"`);
console.log(`[db] Resolved database path: "${resolvedDbPath}"`);
console.log(`[db] Database directory: "${dir}"`);

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
    is_admin      INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id     TEXT PRIMARY KEY,
    data        TEXT,            -- JSON blob: { tabs, activeTab, weights, theme, sidebarCollapsed }
    updated_at  INTEGER
  );
`);
  console.log('[db] Schema initialized successfully');
} catch (err) {
  console.error(`[db] FATAL: Schema initialization failed: ${err.message}`);
  process.exit(1);
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
  ];
  for (const [name, type] of NEW_COLS) {
    if (!existingCols.has(name)) {
      db.exec(`ALTER TABLE stocks ADD COLUMN ${name} ${type}`);
      console.log(`[db] Migration: added column "${name} ${type}" to stocks`);
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

// Migrate users table if it was added later
try {
  const userCols = new Set(
    db.prepare("PRAGMA table_info(users)").all().map((r) => r.name),
  );
  if (!userCols.has('username')) {
    // Table didn't exist or is very old — the CREATE TABLE above should have handled it
    console.log('[db] Users table ready');
  }
} catch (e) {
  // Ignore — table creation above should cover it
}

// Ensure the per-user chat index exists (covers fresh DBs created with the column
// in CREATE TABLE, and any edge cases after migration).
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);`);
} catch {}

// Secondary indexes on the stocks table. The screener serves every row ordered by
// mcap, and the always-on background enrichment job repeatedly looks for the
// oldest-updated and not-yet-enriched symbols. Without these each of those is a
// full-table scan (plus a temp b-tree for the sort) across the whole ~8k+ universe,
// several times a minute, forever.
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stocks_mcap ON stocks(mcap DESC);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stocks_updated_at ON stocks(updated_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stocks_enrich ON stocks(has_km, has_rat);`);
  console.log('[db] Stocks indexes ready');
} catch (e) {
  console.warn('[db] Could not create stocks indexes:', e.message);
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
    div_yield, updated_at
  ) VALUES (
    @symbol, @name, @sector, @industry, @exchange, @country,
    @price, @mcap, @volume, @beta,
    @div_yield, @updated_at
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

export function getAllStocks() {
  return db.prepare('SELECT * FROM stocks ORDER BY mcap DESC NULLS LAST').all();
}

export function getStock(symbol) {
  return db.prepare('SELECT * FROM stocks WHERE symbol=?').get(symbol);
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
  if (limit && Number.isFinite(limit)) {
    return db
      .prepare('SELECT symbol FROM stocks WHERE has_km=0 OR has_rat=0 LIMIT ?')
      .all(limit)
      .map((r) => r.symbol);
  }
  return db.prepare('SELECT symbol FROM stocks WHERE has_km=0 OR has_rat=0').all().map(r => r.symbol);
}

// Count only — for status/telemetry. Avoids building (and discarding) the full
// array of missing symbols just to read its .length.
export function getMissingEnrichCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM stocks WHERE has_km=0 OR has_rat=0').get().c;
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
 * Prune stocks below a minimum market cap.
 * Used optionally after force universe refresh if a minMcap was passed in request.
 * (Universe now comes from full stock-list + etf-list; no default floor applied on fetch.)
 */
export function pruneBelowMarketCap(minMcap) {
  const stmt = db.prepare(`DELETE FROM stocks WHERE mcap IS NOT NULL AND mcap < ?`);
  const info = stmt.run(minMcap);
  return info.changes || 0;
}

export function getStockCount() {
  return db.prepare('SELECT COUNT(*) as c FROM stocks').get().c;
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
  INSERT INTO users (username, password_hash, created_at, is_admin)
  VALUES (?, ?, ?, ?)
`);

const getUserByUsernameStmt = db.prepare(`
  SELECT * FROM users WHERE username = ?
`);

export function getUserByUsername(username) {
  return getUserByUsernameStmt.get(username);
}

export function createUser(username, password, isAdmin = false) {
  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  try {
    insertUser.run(username, hash, now, isAdmin ? 1 : 0);
    return { success: true };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { success: false, error: 'Username already exists' };
    }
    return { success: false, error: err.message };
  }
}



export function verifyUserPassword(username, password) {
  const user = getUserByUsername(username);
  if (!user) return null;
  const valid = bcrypt.compareSync(password, user.password_hash);
  return valid ? { id: user.id, username: user.username, isAdmin: !!user.is_admin } : null;
}

export function listUsers() {
  return db.prepare('SELECT id, username, created_at, is_admin FROM users ORDER BY created_at').all();
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

// ── Per-user settings (screens/tabs, pins, weights, theme, sidebar) ─────────
// Stored as a single JSON blob per user. Writes are a shallow merge so that
// independent clients (the screener and the theme/sidebar layer) can update
// their own keys without clobbering each other.

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

export default db;
