import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveDatabaseLocation } from '../dbPath.js';

test('local development defaults to the repository data directory', () => {
  const location = resolveDatabaseLocation({}, '/workspace/app');
  assert.equal(location.resolvedPath, '/workspace/app/data/screener.db');
  assert.equal(location.error, null);
  assert.equal(location.railway, false);
});

test('Railway infers SQLite path from its attached volume', () => {
  const location = resolveDatabaseLocation({
    RAILWAY_ENVIRONMENT: 'production',
    RAILWAY_VOLUME_MOUNT_PATH: '/data',
  }, '/app');
  assert.equal(location.resolvedPath, '/data/screener.db');
  assert.equal(location.inferredFromVolume, true);
  assert.equal(location.error, null);
});

test('Railway accepts an explicit DB_PATH inside its mounted volume', () => {
  const location = resolveDatabaseLocation({
    RAILWAY_ENVIRONMENT: 'production',
    RAILWAY_VOLUME_MOUNT_PATH: '/app/data',
    DB_PATH: './data/screener.db',
  }, '/app');
  assert.equal(location.resolvedPath, '/app/data/screener.db');
  assert.equal(location.error, null);
});

test('Railway refuses SQLite when no persistent volume is attached', () => {
  const location = resolveDatabaseLocation({ RAILWAY_ENVIRONMENT: 'production' }, '/app');
  assert.match(location.error, /No Railway volume is attached/);
});

test('Railway refuses DB_PATH outside the attached volume', () => {
  const location = resolveDatabaseLocation({
    RAILWAY_ENVIRONMENT: 'production',
    RAILWAY_VOLUME_MOUNT_PATH: '/data',
    DB_PATH: '/app/data/screener.db',
  }, '/app');
  assert.match(location.error, /outside the Railway volume/);

  const sibling = resolveDatabaseLocation({
    RAILWAY_PROJECT_ID: 'project',
    RAILWAY_VOLUME_MOUNT_PATH: '/data',
    DB_PATH: '/data-other/screener.db',
  }, '/app');
  assert.match(sibling.error, /outside the Railway volume/);
});
