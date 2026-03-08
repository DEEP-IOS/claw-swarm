/**
 * DatabaseManager — 数据库连接与事务管理 / Database Connection & Transaction Management
 *
 * V5.0 使用 Node.js 内置 node:sqlite (DatabaseSync), 提供:
 * - WAL 模式 + 优化 PRAGMA
 * - 预编译语句缓存
 * - 手动事务封装 (BEGIN/COMMIT/ROLLBACK)
 * - 批量事务 (减少 WAL 提交)
 * - Repository 注入接口
 *
 * V5.0 uses Node.js built-in node:sqlite (DatabaseSync), providing:
 * - WAL mode + optimized PRAGMAs
 * - Prepared statement caching
 * - Manual transaction wrapper (BEGIN/COMMIT/ROLLBACK)
 * - Batch transactions (reduce WAL commits)
 * - Repository injection interface
 *
 * @module L1-infrastructure/database/database-manager
 * @author DEEP-IOS
 */

import { DatabaseSync } from './sqlite-binding.js';
import { nanoid } from 'nanoid';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// 常量 / Constants
// ---------------------------------------------------------------------------

const BUSY_RETRY_COUNT = 3;
const BUSY_RETRY_DELAY_MS = 100;
const DEFAULT_BATCH_SIZE = 100;

/** PRAGMA 优化设置 / PRAGMA optimization settings */
const PRAGMA_SETTINGS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA busy_timeout = 5000',
  'PRAGMA foreign_keys = ON',
  'PRAGMA cache_size = -8000',        // 8MB 页缓存 / 8MB page cache
  'PRAGMA temp_store = MEMORY',       // 临时表存内存 / Temp tables in memory
];

// ---------------------------------------------------------------------------
// DatabaseManager 类 / DatabaseManager Class
// ---------------------------------------------------------------------------

export class DatabaseManager {
  /**
   * @param {Object} [options]
   * @param {string} [options.dbPath] - 数据库文件路径 / Database file path
   * @param {Object} [options.logger] - pino logger 实例 / pino logger instance
   * @param {boolean} [options.readonly] - 只读模式 / Read-only mode
   * @param {boolean} [options.memory] - 内存数据库 (测试用) / In-memory database (for testing)
   */
  constructor(options = {}) {
    /** @type {DatabaseSync | null} */
    this._db = null;

    /** @type {string} */
    this._dbPath = options.dbPath || null;

    /** @type {Object} */
    this._logger = options.logger || console;

    /** @type {boolean} */
    this._readonly = options.readonly || false;

    /** @type {boolean} */
    this._memory = options.memory || false;

    /** @type {Map<string, Object>} 预编译语句缓存 / Prepared statement cache */
    this._stmtCache = new Map();

    /** @type {boolean} */
    this._initialized = false;
  }

  // ━━━ 连接管理 / Connection Management ━━━

  /**
   * 初始化数据库连接
   * Initialize database connection
   *
   * @param {Array<{name: string, sql: string, indexes?: string[]}>} [schemas] - 表 DDL
   * @returns {DatabaseSync}
   */
  open(schemas) {
    if (this._db) return this._db;

    const dbPath = this._resolveDbPath();
    this._logger.info?.(`[DatabaseManager] Opening database: ${dbPath}`);

    this._db = new DatabaseSync(dbPath);

    // 应用 PRAGMA 设置 / Apply PRAGMA settings
    this._applyPragmas();

    // 创建表 / Create tables if schemas provided
    if (schemas) {
      this._createTables(schemas);
    }

    // 确保 swarm_meta 表存在 / Ensure swarm_meta table exists
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS swarm_meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    this._initialized = true;
    return this._db;
  }

  /**
   * 关闭数据库连接
   * Close database connection
   */
  close() {
    if (!this._db) return;

    // 清除语句缓存 / Clear statement cache
    this._stmtCache.clear();

    try {
      this._db.close();
    } catch (err) {
      this._logger.warn?.(`[DatabaseManager] Error closing database: ${err.message}`);
    }

    this._db = null;
    this._initialized = false;
    this._logger.info?.('[DatabaseManager] Database closed');
  }

  /**
   * 获取原始数据库实例
   * Get raw database instance
   *
   * @returns {DatabaseSync}
   * @throws {Error} 如果数据库未初始化 / If database not initialized
   */
  getDb() {
    if (!this._db) {
      throw new Error('Database not initialized. Call open() first.');
    }
    return this._db;
  }

  /**
   * 检查数据库是否已初始化
   * Check if database is initialized
   *
   * @returns {boolean}
   */
  isOpen() {
    return this._initialized && this._db !== null;
  }

  // ━━━ 事务管理 / Transaction Management ━━━

  /**
   * 在事务中执行函数 (手动 BEGIN/COMMIT/ROLLBACK)
   * Execute function within transaction (manual BEGIN/COMMIT/ROLLBACK)
   *
   * @template T
   * @param {() => T} fn - 要执行的函数 / Function to execute
   * @returns {T}
   */
  transaction(fn) {
    const db = this.getDb();

    for (let attempt = 0; attempt <= BUSY_RETRY_COUNT; attempt++) {
      try {
        db.exec('BEGIN');
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch { /* ignore rollback errors */ }

        if (err.message?.includes('SQLITE_BUSY') && attempt < BUSY_RETRY_COUNT) {
          this._logger.warn?.(
            `[DatabaseManager] SQLITE_BUSY, retry ${attempt + 1}/${BUSY_RETRY_COUNT}`,
          );
          const start = Date.now();
          while (Date.now() - start < BUSY_RETRY_DELAY_MS * (attempt + 1)) {
            // busy wait
          }
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * 批量事务 (减少 WAL 提交次数)
   * Batch transaction (reduce WAL commit count)
   *
   * @template T
   * @param {Array<T>} items - 要处理的项目 / Items to process
   * @param {(item: T) => void} fn - 处理函数 / Processing function
   * @param {number} [batchSize=100] - 批大小 / Batch size
   * @returns {number} 处理数量 / Processed count
   */
  batchTransaction(items, fn, batchSize = DEFAULT_BATCH_SIZE) {
    let processed = 0;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      this.transaction(() => {
        for (const item of batch) {
          fn(item);
          processed++;
        }
      });
    }

    return processed;
  }

  // ━━━ 预编译语句 / Prepared Statements ━━━

  /**
   * 获取或创建预编译语句
   * Get or create prepared statement
   *
   * @param {string} key - 缓存键 / Cache key
   * @param {string} sql - SQL 语句 / SQL statement
   * @returns {Object} prepared statement
   */
  prepare(key, sql) {
    if (this._stmtCache.has(key)) {
      return this._stmtCache.get(key);
    }

    const stmt = this.getDb().prepare(sql);
    this._stmtCache.set(key, stmt);
    return stmt;
  }

  /**
   * 清除预编译语句缓存
   * Clear prepared statement cache
   */
  clearStatementCache() {
    this._stmtCache.clear();
  }

  // ━━━ Meta 操作 / Meta Operations ━━━

  /**
   * 获取 meta 值
   * Get meta value
   *
   * @param {string} key
   * @returns {string | null}
   */
  getMeta(key) {
    const stmt = this.prepare('getMeta', 'SELECT value FROM swarm_meta WHERE key = ?');
    const row = stmt.get(key);
    return row ? row.value : null;
  }

  /**
   * 设置 meta 值
   * Set meta value
   *
   * @param {string} key
   * @param {string} value
   */
  setMeta(key, value) {
    const stmt = this.prepare(
      'setMeta',
      'INSERT OR REPLACE INTO swarm_meta (key, value) VALUES (?, ?)',
    );
    stmt.run(key, value);
  }

  /**
   * 获取 schema 版本
   * Get schema version
   *
   * @returns {number}
   */
  getSchemaVersion() {
    const val = this.getMeta('schema_version');
    return val ? parseInt(val, 10) : 0;
  }

  /**
   * 设置 schema 版本
   * Set schema version
   *
   * @param {number} version
   */
  setSchemaVersion(version) {
    this.setMeta('schema_version', String(version));
  }

  // ━━━ 便捷查询方法 / Convenience Query Methods ━━━

  /**
   * 执行 SQL 并返回所有行
   * Execute SQL and return all rows
   *
   * @param {string} sql
   * @param {...any} params
   * @returns {Array<Object>}
   */
  all(sql, ...params) {
    return this.getDb().prepare(sql).all(...params);
  }

  /**
   * 执行 SQL 并返回第一行
   * Execute SQL and return first row
   *
   * @param {string} sql
   * @param {...any} params
   * @returns {Object | undefined}
   */
  get(sql, ...params) {
    return this.getDb().prepare(sql).get(...params);
  }

  /**
   * 执行 SQL (INSERT/UPDATE/DELETE)
   * Execute SQL (INSERT/UPDATE/DELETE)
   *
   * @param {string} sql
   * @param {...any} params
   * @returns {Object} result with changes property
   */
  run(sql, ...params) {
    return this.getDb().prepare(sql).run(...params);
  }

  /**
   * 执行原始 SQL (多语句)
   * Execute raw SQL (multiple statements)
   *
   * @param {string} sql
   */
  exec(sql) {
    this.getDb().exec(sql);
  }

  // ━━━ ID 生成 / ID Generation ━━━

  /**
   * 生成唯一 ID
   * Generate unique ID
   *
   * @param {string} [prefix] - 可选前缀 / Optional prefix
   * @returns {string}
   */
  generateId(prefix) {
    const id = nanoid();
    return prefix ? `${prefix}_${id}` : id;
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 解析数据库路径
   * Resolve database path
   *
   * @returns {string}
   * @private
   */
  _resolveDbPath() {
    if (this._memory) {
      return ':memory:';
    }

    if (this._dbPath) {
      // 确保目录存在 / Ensure directory exists
      const dir = resolve(this._dbPath, '..');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      return this._dbPath;
    }

    // 回退到临时目录 / Fallback to temp directory
    const tempDir = resolve(tmpdir(), 'claw-swarm');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }
    return resolve(tempDir, 'swarm.db');
  }

  /**
   * 应用 PRAGMA 设置
   * Apply PRAGMA settings
   *
   * @private
   */
  _applyPragmas() {
    for (const pragma of PRAGMA_SETTINGS) {
      try {
        this._db.exec(pragma);
      } catch (err) {
        this._logger.warn?.(`[DatabaseManager] Failed to set ${pragma}: ${err.message}`);
      }
    }
  }

  /**
   * 创建表
   * Create tables from schema definitions
   *
   * @param {Array<{name: string, sql: string, indexes?: string[]}>} schemas
   * @private
   */
  _createTables(schemas) {
    this.transaction(() => {
      for (const schema of schemas) {
        try {
          this._db.exec(schema.sql);

          // 创建索引 / Create indexes
          if (schema.indexes) {
            for (const indexSql of schema.indexes) {
              this._db.exec(indexSql);
            }
          }
        } catch (err) {
          this._logger.error?.(
            `[DatabaseManager] Failed to create table ${schema.name}: ${err.message}`,
          );
          throw err;
        }
      }
    });

    this._logger.info?.(`[DatabaseManager] Created ${schemas.length} tables`);
  }

  /**
   * 获取所有表名
   * Get all table names
   *
   * @returns {string[]}
   */
  getTableNames() {
    const rows = this.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    return rows.map((r) => r.name);
  }

  /**
   * 获取表行数
   * Get row count for a table
   *
   * @param {string} tableName
   * @returns {number}
   */
  getRowCount(tableName) {
    // 防 SQL 注入: 验证表名 / Prevent SQL injection: validate table name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new Error(`Invalid table name: ${tableName}`);
    }
    const row = this.get(`SELECT COUNT(*) as count FROM ${tableName}`);
    return row ? row.count : 0;
  }
}
