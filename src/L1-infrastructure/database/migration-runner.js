/**
 * MigrationRunner — 数据库迁移引擎 / Database Migration Engine
 *
 * 支持:
 * - v4.x → V5.0 Schema 迁移
 * - 渐进式版本迁移 (v0→v1→v2→...→v5)
 * - 回滚保护 (WAL 事务)
 * - 迁移日志
 *
 * Supports:
 * - v4.x → V5.0 schema migration
 * - Incremental version migration
 * - Rollback protection (WAL transactions)
 * - Migration logging
 *
 * @module L1-infrastructure/database/migration-runner
 * @author DEEP-IOS
 */

import { TABLE_SCHEMAS, SCHEMA_VERSION } from '../schemas/database-schemas.js';

export class MigrationRunner {
  /**
   * @param {import('./database-manager.js').DatabaseManager} dbManager
   * @param {Object} [options]
   * @param {Object} [options.logger]
   */
  constructor(dbManager, options = {}) {
    this.db = dbManager;
    this.logger = options.logger || console;
    this.targetVersion = SCHEMA_VERSION;
  }

  /**
   * 运行迁移: 检测当前版本, 执行必要的迁移步骤
   * Run migration: detect current version, execute necessary migration steps
   *
   * @returns {{ from: number, to: number, migrated: boolean }}
   */
  migrate() {
    const currentVersion = this.db.getSchemaVersion();
    this.logger.info?.(
      `[MigrationRunner] Current schema v${currentVersion}, target v${this.targetVersion}`,
    );

    if (currentVersion >= this.targetVersion) {
      this.logger.info?.('[MigrationRunner] Schema is up to date');
      return { from: currentVersion, to: currentVersion, migrated: false };
    }

    // 按版本逐步迁移 / Migrate step by step
    let version = currentVersion;

    while (version < this.targetVersion) {
      const nextVersion = version + 1;
      const migrator = this._getMigration(version, nextVersion);

      if (migrator) {
        this.logger.info?.(`[MigrationRunner] Migrating v${version} → v${nextVersion}`);
        this.db.transaction(() => {
          migrator();
          this.db.setSchemaVersion(nextVersion);
        });
        this.logger.info?.(`[MigrationRunner] Migration v${version} → v${nextVersion} complete`);
      } else {
        // 没有明确的迁移步骤, 直接设置版本 / No explicit migration, set version
        this.db.setSchemaVersion(nextVersion);
      }

      version = nextVersion;
    }

    return { from: currentVersion, to: this.targetVersion, migrated: true };
  }

  /**
   * 全新安装: 创建所有表并设置 schema 版本
   * Fresh install: create all tables and set schema version
   */
  freshInstall() {
    this.logger.info?.(`[MigrationRunner] Fresh install - creating ${TABLE_SCHEMAS.length} tables`);

    this.db.transaction(() => {
      for (const schema of TABLE_SCHEMAS) {
        this.db.exec(schema.sql);
        if (schema.indexes) {
          for (const idx of schema.indexes) {
            this.db.exec(idx);
          }
        }
      }
      this.db.setSchemaVersion(this.targetVersion);
    });

    this.logger.info?.(`[MigrationRunner] Fresh install complete - schema v${this.targetVersion}`);
  }

  /**
   * 自动检测并执行: 新库则 freshInstall, 旧库则 migrate
   * Auto-detect and execute: freshInstall for new DB, migrate for existing
   *
   * @returns {{ from: number, to: number, migrated: boolean, fresh: boolean }}
   */
  autoMigrate() {
    const currentVersion = this.db.getSchemaVersion();

    if (currentVersion === 0) {
      // 检查是否有旧表 / Check for legacy tables
      const tables = this.db.getTableNames();
      const hasLegacyTables = tables.includes('pheromones') || tables.includes('agents');

      if (hasLegacyTables) {
        // v4.x 旧库, 需要迁移 / v4.x legacy DB, needs migration
        this.logger.info?.('[MigrationRunner] Detected v4.x database, running migration');

        // 先设置为 v4 再迁移到 v5 / Set to v4 then migrate to v5
        this.db.setSchemaVersion(4);
        const result = this.migrate();
        return { ...result, fresh: false };
      }

      // 全新库 / Fresh database
      this.freshInstall();
      return { from: 0, to: this.targetVersion, migrated: false, fresh: true };
    }

    // 已有版本, 迁移 / Has version, migrate
    const result = this.migrate();
    return { ...result, fresh: false };
  }

  // ━━━ 版本迁移函数 / Version Migration Functions ━━━

  /**
   * 获取特定版本的迁移函数
   * Get migration function for a specific version transition
   *
   * @param {number} from
   * @param {number} to
   * @returns {Function | null}
   * @private
   */
  _getMigration(from, to) {
    const key = `v${from}_to_v${to}`;
    const migrations = {
      v4_to_v5: () => this._migrateV4ToV5(),
    };
    return migrations[key] || null;
  }

  /**
   * v4 → v5 迁移: 添加 V5.0 新表
   * v4 → v5 migration: add V5.0 new tables
   *
   * v4.x 的 27 张表结构保持不变, 仅新增 7 张 V5.0 表:
   * - knowledge_nodes, knowledge_edges
   * - episodic_events
   * - zones, zone_memberships
   * - pheromone_types
   * - execution_plans
   *
   * @private
   */
  _migrateV4ToV5() {
    const newTables = [
      'knowledge_nodes', 'knowledge_edges',
      'episodic_events',
      'zones', 'zone_memberships',
      'pheromone_types',
      'execution_plans',
    ];

    const existingTables = new Set(this.db.getTableNames());

    for (const tableName of newTables) {
      if (existingTables.has(tableName)) {
        this.logger.info?.(`[MigrationRunner] Table '${tableName}' already exists, skipping`);
        continue;
      }

      const schema = TABLE_SCHEMAS.find(s => s.name === tableName);
      if (!schema) {
        this.logger.warn?.(`[MigrationRunner] Schema not found for '${tableName}'`);
        continue;
      }

      this.db.exec(schema.sql);
      if (schema.indexes) {
        for (const idx of schema.indexes) {
          this.db.exec(idx);
        }
      }
      this.logger.info?.(`[MigrationRunner] Created table '${tableName}'`);
    }

    // 迁移 legacy memory 表到 episodic_events (可选, 仅当有数据时)
    // Migrate legacy memory table to episodic_events (optional, only if data exists)
    this._migrateLegacyMemories();

    this.logger.info?.('[MigrationRunner] v4 → v5 migration complete');
  }

  /**
   * 迁移旧记忆数据到情景事件 (最佳努力)
   * Migrate legacy memory data to episodic events (best effort)
   *
   * @private
   */
  _migrateLegacyMemories() {
    try {
      const tables = this.db.getTableNames();
      if (!tables.includes('memories')) return;

      const count = this.db.getRowCount('memories');
      if (count === 0) return;

      this.logger.info?.(`[MigrationRunner] Migrating ${count} legacy memories to episodic_events`);

      // 仅迁移高重要性记忆 / Only migrate high-importance memories
      const memories = this.db.all(
        'SELECT * FROM memories WHERE importance >= 0.3 ORDER BY created_at ASC LIMIT 500',
      );

      const stmt = this.db.getDb().prepare(`
        INSERT OR IGNORE INTO episodic_events (id, agent_id, event_type, subject, predicate, object, context, importance, timestamp, session_id)
        VALUES (?, ?, 'observation', ?, 'recalled', NULL, ?, ?, ?, NULL)
      `);

      for (const mem of memories) {
        try {
          stmt.run(
            `legacy_${mem.id}`,
            mem.agent_id,
            mem.scope || 'unknown',
            mem.content ? JSON.stringify({ legacy: true, layer: mem.layer }) : null,
            mem.importance || 0.5,
            mem.created_at,
          );
        } catch {
          // 忽略单条迁移失败 / Ignore individual migration failures
        }
      }

      this.logger.info?.(`[MigrationRunner] Migrated ${memories.length} legacy memories`);
    } catch (err) {
      this.logger.warn?.(`[MigrationRunner] Legacy memory migration skipped: ${err.message}`);
    }
  }
}
