/**
 * DatabaseManager 单元测试 / DatabaseManager Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../src/L1-infrastructure/database/database-manager.js';

describe('DatabaseManager', () => {
  let dbManager;

  beforeEach(() => {
    dbManager = new DatabaseManager({ memory: true });
    dbManager.open();
  });

  afterEach(() => {
    dbManager.close();
  });

  // ━━━ 连接管理 / Connection Management ━━━

  describe('connection', () => {
    it('should open an in-memory database', () => {
      expect(dbManager.isOpen()).toBe(true);
    });

    it('should return the same db instance on multiple open() calls', () => {
      const db1 = dbManager.getDb();
      const db2 = dbManager.open(); // should be idempotent
      expect(db1).toBe(db2);
    });

    it('should close and clear state', () => {
      dbManager.close();
      expect(dbManager.isOpen()).toBe(false);
      expect(() => dbManager.getDb()).toThrow('Database not initialized');
    });

    it('should throw when getDb() called before open()', () => {
      const fresh = new DatabaseManager({ memory: true });
      expect(() => fresh.getDb()).toThrow('Database not initialized');
    });
  });

  // ━━━ PRAGMA ━━━

  describe('PRAGMAs', () => {
    it('should set journal mode (WAL for file, memory for :memory:)', () => {
      const row = dbManager.get('PRAGMA journal_mode');
      // 内存数据库的 journal_mode 是 'memory', 文件数据库是 'wal'
      expect(['wal', 'memory']).toContain(row.journal_mode);
    });

    it('should enable foreign keys', () => {
      const row = dbManager.get('PRAGMA foreign_keys');
      expect(row.foreign_keys).toBe(1);
    });
  });

  // ━━━ 表创建 / Table Creation ━━━

  describe('table creation', () => {
    it('should create tables from schemas', () => {
      const schemas = [
        {
          name: 'test_table',
          sql: 'CREATE TABLE IF NOT EXISTS test_table (id TEXT PRIMARY KEY, value TEXT)',
          indexes: ['CREATE INDEX IF NOT EXISTS idx_test_val ON test_table(value)'],
        },
      ];

      const freshDb = new DatabaseManager({ memory: true });
      freshDb.open(schemas);

      freshDb.run("INSERT INTO test_table (id, value) VALUES ('a', 'hello')");
      const row = freshDb.get("SELECT * FROM test_table WHERE id = 'a'");
      expect(row.value).toBe('hello');

      freshDb.close();
    });

    it('should always create swarm_meta table', () => {
      const tables = dbManager.getTableNames();
      expect(tables).toContain('swarm_meta');
    });
  });

  // ━━━ 事务 / Transactions ━━━

  describe('transactions', () => {
    it('should execute in transaction', () => {
      dbManager.exec('CREATE TABLE t1 (id INTEGER PRIMARY KEY, val TEXT)');

      dbManager.transaction(() => {
        dbManager.run("INSERT INTO t1 (val) VALUES ('a')");
        dbManager.run("INSERT INTO t1 (val) VALUES ('b')");
      });

      const rows = dbManager.all('SELECT * FROM t1');
      expect(rows.length).toBe(2);
    });

    it('should rollback on error', () => {
      dbManager.exec('CREATE TABLE t2 (id INTEGER PRIMARY KEY, val TEXT UNIQUE)');
      dbManager.run("INSERT INTO t2 (val) VALUES ('x')");

      expect(() => {
        dbManager.transaction(() => {
          dbManager.run("INSERT INTO t2 (val) VALUES ('y')");
          dbManager.run("INSERT INTO t2 (val) VALUES ('x')"); // duplicate → error
        });
      }).toThrow();

      const rows = dbManager.all('SELECT * FROM t2');
      expect(rows.length).toBe(1); // only 'x' from before
    });
  });

  // ━━━ 批量事务 / Batch Transactions ━━━

  describe('batchTransaction', () => {
    it('should process items in batches', () => {
      dbManager.exec('CREATE TABLE t3 (id INTEGER PRIMARY KEY, val TEXT)');
      const items = Array.from({ length: 25 }, (_, i) => `item_${i}`);

      const processed = dbManager.batchTransaction(items, (item) => {
        dbManager.run('INSERT INTO t3 (val) VALUES (?)', item);
      }, 10);

      expect(processed).toBe(25);
      const rows = dbManager.all('SELECT * FROM t3');
      expect(rows.length).toBe(25);
    });
  });

  // ━━━ Meta 操作 / Meta Operations ━━━

  describe('meta', () => {
    it('should set and get meta values', () => {
      dbManager.setMeta('test_key', 'test_value');
      expect(dbManager.getMeta('test_key')).toBe('test_value');
    });

    it('should return null for missing key', () => {
      expect(dbManager.getMeta('nonexistent')).toBeNull();
    });

    it('should manage schema version', () => {
      expect(dbManager.getSchemaVersion()).toBe(0);
      dbManager.setSchemaVersion(5);
      expect(dbManager.getSchemaVersion()).toBe(5);
    });
  });

  // ━━━ 预编译语句 / Prepared Statements ━━━

  describe('prepared statements', () => {
    it('should cache and reuse statements', () => {
      dbManager.exec('CREATE TABLE t4 (id INTEGER PRIMARY KEY, val TEXT)');

      const stmt1 = dbManager.prepare('t4_insert', 'INSERT INTO t4 (val) VALUES (?)');
      const stmt2 = dbManager.prepare('t4_insert', 'INSERT INTO t4 (val) VALUES (?)');
      expect(stmt1).toBe(stmt2); // same cached instance

      stmt1.run('hello');
      const row = dbManager.get('SELECT val FROM t4');
      expect(row.val).toBe('hello');
    });

    it('should clear statement cache', () => {
      dbManager.prepare('test_stmt', 'SELECT 1');
      dbManager.clearStatementCache();
      // No error accessing prepare again
      dbManager.prepare('test_stmt', 'SELECT 1');
    });
  });

  // ━━━ 便捷方法 / Convenience Methods ━━━

  describe('convenience methods', () => {
    beforeEach(() => {
      dbManager.exec('CREATE TABLE t5 (id INTEGER PRIMARY KEY, val TEXT)');
      dbManager.run("INSERT INTO t5 (val) VALUES ('a')");
      dbManager.run("INSERT INTO t5 (val) VALUES ('b')");
    });

    it('all() should return all rows', () => {
      const rows = dbManager.all('SELECT * FROM t5');
      expect(rows.length).toBe(2);
    });

    it('get() should return first row', () => {
      const row = dbManager.get('SELECT * FROM t5 LIMIT 1');
      expect(row.val).toBe('a');
    });

    it('run() should return changes info', () => {
      const result = dbManager.run("UPDATE t5 SET val = 'c' WHERE val = 'a'");
      expect(result.changes).toBe(1);
    });
  });

  // ━━━ ID 生成 / ID Generation ━━━

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = dbManager.generateId();
      const id2 = dbManager.generateId();
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
    });

    it('should support prefix', () => {
      const id = dbManager.generateId('ph');
      expect(id.startsWith('ph_')).toBe(true);
    });
  });

  // ━━━ 辅助方法 / Helper Methods ━━━

  describe('helpers', () => {
    it('getTableNames() should list tables', () => {
      dbManager.exec('CREATE TABLE helper_test (id INTEGER PRIMARY KEY)');
      const tables = dbManager.getTableNames();
      expect(tables).toContain('swarm_meta');
      expect(tables).toContain('helper_test');
    });

    it('getRowCount() should count rows', () => {
      dbManager.exec('CREATE TABLE rc_test (id INTEGER PRIMARY KEY)');
      dbManager.run('INSERT INTO rc_test DEFAULT VALUES');
      dbManager.run('INSERT INTO rc_test DEFAULT VALUES');
      expect(dbManager.getRowCount('rc_test')).toBe(2);
    });

    it('getRowCount() should reject invalid table names', () => {
      expect(() => dbManager.getRowCount('DROP TABLE; --')).toThrow('Invalid table name');
    });
  });
});
