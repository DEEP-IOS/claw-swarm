/**
 * Database migration integration tests for Claw-Swarm v4.0
 *
 * Tests the migration chain defined in layer1-core/db-migration.js,
 * verifying table creation, idempotency, schema version tracking,
 * backup creation, and import functions (OME + Swarm Lite).
 *
 * Uses :memory: where possible; temp files only for backup and import tests.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as db from '../../src/layer1-core/db.js';
import {
  SCHEMA_VERSION,
  migrate,
  migrateWithBackup,
  importOmeDatabase,
  importSwarmLiteDatabase,
} from '../../src/layer1-core/db-migration.js';

// ---------------------------------------------------------------------------
// All 25 tables expected after full migration
// ---------------------------------------------------------------------------

const ALL_TABLES = [
  // Metadata (1)
  'swarm_meta',
  // Memory Engine (6)
  'memories', 'daily_summaries', 'checkpoints', 'events', 'tasks', 'event_cursors',
  // Orchestration (5)
  'swarm_tasks', 'swarm_roles', 'swarm_checkpoints', 'swarm_artifacts', 'swarm_locks',
  // Governance (11)
  'agents', 'capabilities', 'capability_details', 'skills', 'contributions',
  'votes', 'vote_results', 'behavior_tags', 'collaboration_history',
  'event_log', 'evaluation_queue',
  // Pheromone (1)
  'pheromones',
  // Persona (1)
  'persona_outcomes',
];

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Database Migration Tests (v4.0)', () => {
  // Track temp files for cleanup
  const tempFiles = [];

  after(() => {
    db.closeDb();
    // Clean up all temp files
    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
      try { fs.unlinkSync(f + '-wal'); } catch { /* ignore */ }
      try { fs.unlinkSync(f + '-shm'); } catch { /* ignore */ }
    }
  });

  // -------------------------------------------------------------------------
  // 1. migrate() creates all 25 tables on fresh DB
  // -------------------------------------------------------------------------

  it('migrate() creates all 25 tables on a fresh :memory: DB', () => {
    db.initDb(':memory:');
    migrate();

    const database = db.getDb();
    const rows = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();
    const tableNames = rows.map(r => r.name);

    for (const expected of ALL_TABLES) {
      assert.ok(
        tableNames.includes(expected),
        `Expected table '${expected}' to exist. Found: ${tableNames.join(', ')}`,
      );
    }

    db.closeDb();
  });

  // -------------------------------------------------------------------------
  // 2. migrate() is idempotent (running twice does not error)
  // -------------------------------------------------------------------------

  it('migrate() is idempotent (running twice does not error)', () => {
    db.initDb(':memory:');
    migrate();

    // Running migrate again should not throw
    assert.doesNotThrow(() => migrate(), 'Second migrate() call should not throw');

    // Tables should still be there
    const database = db.getDb();
    const count = database.prepare(
      "SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table'"
    ).get();
    assert.ok(count.cnt >= 25, `Should have at least 25 tables, got ${count.cnt}`);

    db.closeDb();
  });

  // -------------------------------------------------------------------------
  // 3. SCHEMA_VERSION is set correctly after migration
  // -------------------------------------------------------------------------

  it('SCHEMA_VERSION is set correctly after migration', () => {
    db.initDb(':memory:');
    migrate();

    const version = db.getMeta('schema_version');
    assert.equal(version, String(SCHEMA_VERSION), `Schema version should be '${SCHEMA_VERSION}', got '${version}'`);
    assert.equal(SCHEMA_VERSION, 3, 'Current SCHEMA_VERSION constant should be 3');

    db.closeDb();
  });

  // -------------------------------------------------------------------------
  // 4. migrateWithBackup() creates backup file
  // -------------------------------------------------------------------------

  it('migrateWithBackup() creates a backup file', () => {
    const tmpDir = os.tmpdir();
    const dbPath = path.join(tmpDir, `swarm-migration-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
    tempFiles.push(dbPath);

    // Initialize the DB on disk so there is a file to back up
    db.initDb(dbPath);
    db.closeDb();

    // Re-open and run migrateWithBackup
    db.initDb(dbPath);
    migrateWithBackup(dbPath);

    // Check for backup file: pattern is dbPath.backup-<timestamp>
    const dir = path.dirname(dbPath);
    const base = path.basename(dbPath);
    const files = fs.readdirSync(dir);
    const backupFiles = files.filter(f => f.startsWith(base + '.backup-'));

    assert.ok(backupFiles.length > 0, 'At least one backup file should have been created');

    // Track backup files for cleanup
    for (const bf of backupFiles) {
      tempFiles.push(path.join(dir, bf));
    }

    // Verify migration actually ran
    const version = db.getMeta('schema_version');
    assert.equal(version, String(SCHEMA_VERSION), 'Schema version should be set after migrateWithBackup');

    db.closeDb();
  });

  // -------------------------------------------------------------------------
  // 5. importOmeDatabase() sets ome_imported flag
  // -------------------------------------------------------------------------

  it('importOmeDatabase() sets ome_imported flag', () => {
    const tmpDir = os.tmpdir();

    // Create a minimal OME source database
    const omeDbPath = path.join(tmpDir, `ome-src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
    tempFiles.push(omeDbPath);

    const omeDb = new DatabaseSync(omeDbPath);
    omeDb.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, layer TEXT NOT NULL,
        agent_id TEXT NOT NULL, content TEXT NOT NULL, importance REAL DEFAULT 0.5,
        tags TEXT, date TEXT NOT NULL, version INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER
      );
      CREATE TABLE daily_summaries (
        date TEXT NOT NULL, agent_id TEXT NOT NULL, summary TEXT NOT NULL,
        topics TEXT, stats TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (date, agent_id)
      );
      CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, session_id TEXT NOT NULL,
        trigger TEXT NOT NULL, mechanical TEXT NOT NULL, summary TEXT, created_at INTEGER NOT NULL
      );
    `);
    // Insert a test memory
    omeDb.prepare(
      'INSERT INTO memories (id, scope, layer, agent_id, content, importance, tags, date, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('mem-1', 'global', 'core', 'agent-1', 'Test memory', 0.8, '["test"]', '2025-01-01', 1, Date.now(), Date.now());
    omeDb.close();

    // Initialize the destination DB
    db.initDb(':memory:');
    migrate();

    const result = importOmeDatabase(omeDbPath);

    assert.equal(result.memoriesImported, 1, 'Should import 1 memory');
    assert.equal(db.getMeta('ome_imported'), 'true', 'ome_imported flag should be set');
    assert.ok(db.getMeta('ome_imported_at'), 'ome_imported_at should be set');

    db.closeDb();
  });

  // -------------------------------------------------------------------------
  // 6. importOmeDatabase() is idempotent (second call skips)
  // -------------------------------------------------------------------------

  it('importOmeDatabase() is idempotent (second call skips)', () => {
    const tmpDir = os.tmpdir();

    // Create a minimal OME source database
    const omeDbPath = path.join(tmpDir, `ome-idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
    tempFiles.push(omeDbPath);

    const omeDb = new DatabaseSync(omeDbPath);
    omeDb.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, layer TEXT NOT NULL,
        agent_id TEXT NOT NULL, content TEXT NOT NULL, importance REAL DEFAULT 0.5,
        tags TEXT, date TEXT NOT NULL, version INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER
      );
      CREATE TABLE daily_summaries (
        date TEXT NOT NULL, agent_id TEXT NOT NULL, summary TEXT NOT NULL,
        topics TEXT, stats TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (date, agent_id)
      );
      CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, session_id TEXT NOT NULL,
        trigger TEXT NOT NULL, mechanical TEXT NOT NULL, summary TEXT, created_at INTEGER NOT NULL
      );
    `);
    omeDb.prepare(
      'INSERT INTO memories (id, scope, layer, agent_id, content, importance, tags, date, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('mem-idem-1', 'global', 'core', 'agent-1', 'Test memory', 0.8, '["test"]', '2025-01-01', 1, Date.now(), Date.now());
    omeDb.close();

    // Initialize and run import twice
    db.initDb(':memory:');
    migrate();

    const result1 = importOmeDatabase(omeDbPath);
    assert.equal(result1.memoriesImported, 1, 'First import should import 1 memory');

    const result2 = importOmeDatabase(omeDbPath);
    assert.equal(result2.memoriesImported, 0, 'Second import should skip (0 memories imported)');
    assert.equal(result2.checkpointsImported, 0, 'Second import should skip checkpoints too');

    db.closeDb();
  });

  // -------------------------------------------------------------------------
  // 7. importSwarmLiteDatabase() sets swarmv3_imported flag
  // -------------------------------------------------------------------------

  it('importSwarmLiteDatabase() sets swarmv3_imported flag', () => {
    const tmpDir = os.tmpdir();

    // Create a minimal Swarm Lite v3 source database
    const swarmLiteDbPath = path.join(tmpDir, `swarm-lite-src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
    tempFiles.push(swarmLiteDbPath);

    const srcDb = new DatabaseSync(swarmLiteDbPath);
    srcDb.exec(`
      CREATE TABLE swarm_tasks (
        id TEXT PRIMARY KEY, config TEXT, status TEXT DEFAULT 'pending',
        strategy TEXT, retry_count INTEGER DEFAULT 0, error TEXT,
        idempotency_key TEXT, expired_at TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE swarm_roles (
        id TEXT PRIMARY KEY, task_id TEXT, name TEXT, description TEXT,
        capabilities TEXT, priority INTEGER, depends_on TEXT,
        status TEXT DEFAULT 'pending', result TEXT, created_at TEXT
      );
      CREATE TABLE swarm_checkpoints (
        id TEXT PRIMARY KEY, task_id TEXT, role_name TEXT,
        trigger TEXT, data TEXT, created_at TEXT
      );
      CREATE TABLE swarm_artifacts (
        id TEXT PRIMARY KEY, task_id TEXT, role_name TEXT,
        type TEXT, path TEXT, content TEXT, created_at TEXT
      );
    `);
    // Insert a test task
    srcDb.prepare(
      'INSERT INTO swarm_tasks (id, config, status, strategy, retry_count, error, idempotency_key, expired_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('task-v3-1', '{"description":"test"}', 'completed', 'simulated', 0, null, null, null, new Date().toISOString(), new Date().toISOString());
    srcDb.close();

    // Initialize destination DB
    db.initDb(':memory:');
    migrate();

    const result = importSwarmLiteDatabase(swarmLiteDbPath);

    assert.equal(result.tasksImported, 1, 'Should import 1 task');
    assert.equal(db.getMeta('swarmv3_imported'), 'true', 'swarmv3_imported flag should be set');
    assert.ok(db.getMeta('swarmv3_imported_at'), 'swarmv3_imported_at should be set');

    db.closeDb();
  });

  // -------------------------------------------------------------------------
  // 8. Schema version check (getSchemaVersion via getMeta)
  // -------------------------------------------------------------------------

  it('schema version progresses correctly through migration chain', () => {
    db.initDb(':memory:');

    // Before migration, schema_version should not be set
    const versionBefore = db.getMeta('schema_version');
    assert.equal(versionBefore, null, 'Schema version should be null before migration');

    // Run migration
    migrate();

    // After migration, schema_version should be SCHEMA_VERSION
    const versionAfter = db.getMeta('schema_version');
    assert.equal(versionAfter, String(SCHEMA_VERSION), `Schema version should be '${SCHEMA_VERSION}' after migration`);

    // Running migrate again should not change the version
    migrate();
    const versionFinal = db.getMeta('schema_version');
    assert.equal(versionFinal, String(SCHEMA_VERSION), 'Schema version should remain unchanged after second migrate');

    db.closeDb();
  });
});
