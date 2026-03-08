/**
 * MigrationRunner 单元测试 / MigrationRunner Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../src/L1-infrastructure/database/database-manager.js';
import { MigrationRunner } from '../../../src/L1-infrastructure/database/migration-runner.js';
import { TABLE_SCHEMAS, SCHEMA_VERSION } from '../../../src/L1-infrastructure/schemas/database-schemas.js';

describe('MigrationRunner', () => {
  let dbManager;

  beforeEach(() => {
    dbManager = new DatabaseManager({ memory: true });
    dbManager.open();
  });

  afterEach(() => {
    dbManager.close();
  });

  describe('freshInstall', () => {
    it('should create all tables and set schema version', () => {
      const runner = new MigrationRunner(dbManager);
      runner.freshInstall();

      expect(dbManager.getSchemaVersion()).toBe(SCHEMA_VERSION);
      const tables = dbManager.getTableNames();
      expect(tables).toContain('pheromones');
      expect(tables).toContain('agents');
      expect(tables).toContain('knowledge_nodes');
      expect(tables).toContain('knowledge_edges');
      expect(tables).toContain('episodic_events');
      expect(tables).toContain('zones');
      expect(tables).toContain('zone_memberships');
      expect(tables).toContain('pheromone_types');
      expect(tables).toContain('execution_plans');
    });
  });

  describe('autoMigrate', () => {
    it('should do fresh install on empty DB', () => {
      const runner = new MigrationRunner(dbManager);
      const result = runner.autoMigrate();

      expect(result.fresh).toBe(true);
      expect(result.to).toBe(SCHEMA_VERSION);
    });

    it('should detect v4.x DB and migrate', () => {
      // Simulate v4.x by creating legacy tables
      dbManager.exec('CREATE TABLE pheromones (id TEXT PRIMARY KEY, type TEXT, source_id TEXT, target_scope TEXT, intensity REAL, payload TEXT, decay_rate REAL, created_at INTEGER, updated_at INTEGER, expires_at INTEGER)');
      dbManager.exec('CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT, role TEXT, tier TEXT, status TEXT, total_score REAL, contribution_points INTEGER, failure_count INTEGER, success_count INTEGER, created_at TEXT, updated_at TEXT, last_active TEXT)');

      const runner = new MigrationRunner(dbManager);
      const result = runner.autoMigrate();

      expect(result.fresh).toBe(false);
      expect(result.migrated).toBe(true);
      expect(result.to).toBe(SCHEMA_VERSION);

      // Should have V5.0 new tables
      const tables = dbManager.getTableNames();
      expect(tables).toContain('knowledge_nodes');
      expect(tables).toContain('episodic_events');
      expect(tables).toContain('zones');
    });

    it('should skip migration when already at target version', () => {
      const runner = new MigrationRunner(dbManager);
      runner.freshInstall();

      const runner2 = new MigrationRunner(dbManager);
      const result = runner2.autoMigrate();
      expect(result.migrated).toBe(false);
    });
  });

  describe('v4 to v5 migration', () => {
    it('should not duplicate tables on re-run', () => {
      const runner = new MigrationRunner(dbManager);
      runner.freshInstall();

      // Simulate re-running migration (should not fail)
      dbManager.setSchemaVersion(4);
      const result = runner.migrate();
      expect(result.migrated).toBe(true);
      expect(result.to).toBe(SCHEMA_VERSION);
    });

    it('should migrate legacy memories to episodic_events', () => {
      // Create legacy memories table
      dbManager.exec(`CREATE TABLE memories (
        id TEXT PRIMARY KEY, scope TEXT, layer TEXT, agent_id TEXT, content TEXT,
        importance REAL DEFAULT 0.5, tags TEXT, date TEXT, version INTEGER DEFAULT 1,
        created_at INTEGER, updated_at INTEGER, expires_at INTEGER
      )`);
      dbManager.exec('CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT)');

      // Insert a legacy memory
      dbManager.run(
        "INSERT INTO memories (id, scope, layer, agent_id, content, importance, created_at, updated_at) VALUES ('m1', 'project', 'mid', 'a1', 'test content', 0.8, ?, ?)",
        Date.now(), Date.now(),
      );

      dbManager.setSchemaVersion(4);
      const runner = new MigrationRunner(dbManager);
      runner.migrate();

      // Check episodic_events has the migrated memory
      const events = dbManager.all('SELECT * FROM episodic_events');
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });
});
