// Side-effect import: point the DB module at a throwaway SQLite file. Import it
// FIRST in any test that (directly or transitively) imports ../db.js — ES
// modules evaluate in import order, so this runs before db.js opens a
// database. Without it those tests wrote into the developer's ./data/screener.db.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

if (!process.env.ORIZIN_TEST_DB_ISOLATED) {
  process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'orizin-unit-')), 'screener.db');
  process.env.ORIZIN_TEST_DB_ISOLATED = '1';
}
