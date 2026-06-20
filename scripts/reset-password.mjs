#!/usr/bin/env node
// Reset a user's password in the local SQLite DB.
// Usage: node scripts/reset-password.mjs <username> <new-password>
// Example: node scripts/reset-password.mjs admin OrizenDev1

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import path from 'path';

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.error('Usage: node scripts/reset-password.mjs <username> <new-password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters');
  process.exit(1);
}

const dbPath = process.env.DB_PATH || './data/screener.db';
const db = new Database(path.resolve(dbPath));
const row = db.prepare('SELECT username FROM users WHERE username = ? COLLATE NOCASE').get(username.trim());
if (!row) {
  console.error(`No user found for: ${username}`);
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
db.prepare('UPDATE users SET password_hash = ? WHERE username = ? COLLATE NOCASE').run(hash, username.trim());
console.log(`Password updated for ${row.username}`);