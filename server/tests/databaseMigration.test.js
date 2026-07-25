import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import {
  LEGACY_LITE_GAME_PLAN_CACHE_PREFIXES,
  LITE_GAME_PLAN_CACHE_PREFIX,
} from "../gamePlanCache.js";

const tmpDir = mkdtempSync(path.join(tmpdir(), "orizin-migration-"));
const databasePath = path.join(tmpDir, "screener.db");
process.env.DB_PATH = databasePath;

const legacy = new Database(databasePath);
legacy.exec(`
  CREATE TABLE stocks (
    symbol TEXT PRIMARY KEY,
    name TEXT,
    sector TEXT,
    industry TEXT,
    exchange TEXT,
    price REAL,
    mcap REAL,
    volume REAL,
    beta REAL,
    roic REAL,
    roe REAL,
    roa REAL,
    ev_ebitda REAL,
    ev_sales REAL,
    fcf_yield REAL,
    earnings_yield REAL,
    net_debt_ebitda REAL,
    current_ratio REAL,
    div_yield REAL,
    pe REAL,
    pb REAL,
    ps REAL,
    ebitda_margin REAL,
    net_margin REAL,
    fcf_margin REAL,
    ev_gp REAL,
    gross_margin REAL,
    op_margin REAL,
    debt_equity REAL,
    payout REAL,
    has_km INTEGER DEFAULT 0,
    has_rat INTEGER DEFAULT 0,
    updated_at INTEGER
  );
  CREATE TABLE chat_sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER,
    updated_at INTEGER,
    title TEXT,
    messages TEXT
  );
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER,
    is_admin INTEGER DEFAULT 0
  );
  CREATE TABLE kv_cache (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE ori_usage (
    user_id TEXT NOT NULL,
    day TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    chat_requests INTEGER NOT NULL DEFAULT 0,
    plan_requests INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER,
    PRIMARY KEY (user_id, day)
  );
`);

const insertedAt = Date.now() - 60_000;
legacy.prepare("INSERT INTO stocks (symbol, name, mcap, updated_at) VALUES (?, ?, ?, ?)")
  .run("LEG", "Legacy ETF", 12_000_000_000, insertedAt);
legacy.prepare("INSERT INTO chat_sessions (id, created_at, updated_at, title, messages) VALUES (?, ?, ?, ?, ?)")
  .run("legacy-chat", insertedAt, insertedAt, "Retained chat", "[]");
legacy.prepare("INSERT INTO users (username, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?)")
  .run("legacy@example.com", "retained-password-hash", insertedAt, 1);
legacy.prepare("INSERT INTO kv_cache (key, data, updated_at) VALUES (?, ?, ?)")
  .run(`${LEGACY_LITE_GAME_PLAN_CACHE_PREFIXES[0]}LEG`, JSON.stringify({ score: 77 }), insertedAt);
legacy.prepare("INSERT INTO ori_usage (user_id, day, requests, updated_at) VALUES (?, ?, ?, ?)")
  .run("legacy@example.com", "2026-07-01", 4, insertedAt);
legacy.close();

const db = await import(`../db.js?migration=${Date.now()}`);

after(() => {
  try { db.default.close(); } catch { /* already closed */ }
  rmSync(tmpDir, { recursive: true, force: true });
});

function columns(table) {
  return new Set(db.default.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

test("a pre-account-system database upgrades without losing existing data", () => {
  const stockColumns = columns("stocks");
  for (const column of ["country", "dcf", "is_etf", "price_updated_at", "mom", "sma50", "sma200"]) {
    assert.ok(stockColumns.has(column), `stocks.${column} was not migrated`);
  }

  const userColumns = columns("users");
  for (const column of ["email", "plan", "paypal_subscription_id", "notification_email", "session_epoch"]) {
    assert.ok(userColumns.has(column), `users.${column} was not migrated`);
  }

  const usageColumns = columns("ori_usage");
  for (const column of ["chat_prompt_tokens", "plan_output_tokens", "cost_usd_micros"]) {
    assert.ok(usageColumns.has(column), `ori_usage.${column} was not migrated`);
  }

  const stock = db.default.prepare("SELECT symbol, name, mcap, is_etf FROM stocks WHERE symbol = ?").get("LEG");
  assert.deepEqual(stock, {
    symbol: "LEG",
    name: "Legacy ETF",
    mcap: 12_000_000_000,
    is_etf: 1,
  });
  assert.equal(db.default.prepare("SELECT title, user_id FROM chat_sessions WHERE id = ?").get("legacy-chat").title, "Retained chat");
  assert.equal(db.default.prepare("SELECT user_id FROM chat_sessions WHERE id = ?").get("legacy-chat").user_id, "default");
  assert.equal(db.default.prepare("SELECT password_hash FROM users WHERE username = ?").get("legacy@example.com").password_hash, "retained-password-hash");
  assert.equal(db.default.prepare("SELECT requests FROM ori_usage WHERE user_id = ?").get("legacy@example.com").requests, 4);
});

test("the upgrade installs session, deletion, and Ori cache persistence structures", () => {
  for (const table of ["auth_sessions", "revoked_auth_tokens", "billing_checkout_tokens", "watchlist_alert_state"]) {
    const found = db.default.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    assert.equal(found?.name, table);
  }

  const migrated = db.default.prepare("SELECT data, updated_at FROM kv_cache WHERE key = ?")
    .get(`${LITE_GAME_PLAN_CACHE_PREFIX}LEG`);
  assert.deepEqual(JSON.parse(migrated.data), { score: 77 });
  assert.equal(migrated.updated_at, insertedAt);
  assert.equal(
    db.default.prepare("SELECT 1 FROM kv_cache WHERE key = ?").get(`${LEGACY_LITE_GAME_PLAN_CACHE_PREFIXES[0]}LEG`),
    undefined,
  );

  db.createAuthSession("legacy@example.com", "migration-session-id", Date.now() + 60_000);
  assert.equal(db.isAuthSessionActive("legacy@example.com", "migration-session-id"), true);

  db.saveWatchlistAlertState("legacy@example.com", "LEG", { baseline_price: 100 });
  assert.equal(db.listWatchlistAlertStatesForUser("legacy@example.com").length, 1);
  assert.equal(db.deleteUserCascade("legacy@example.com").changes, 1);
  assert.equal(db.isAuthSessionActive("legacy@example.com", "migration-session-id"), false);
  assert.equal(db.listWatchlistAlertStatesForUser("legacy@example.com").length, 0);
});
