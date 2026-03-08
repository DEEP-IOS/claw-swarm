/**
 * PheromoneRepository — 信息素数据访问 / Pheromone Data Access
 *
 * 从 v4.x db.js 提取的信息素 CRUD 操作, 适配 Repository 模式。
 * Extracted pheromone CRUD operations from v4.x db.js, adapted to Repository pattern.
 *
 * @module L1-infrastructure/database/repositories/pheromone-repo
 * @author DEEP-IOS
 */

export class PheromoneRepository {
  /**
   * @param {import('../database-manager.js').DatabaseManager} dbManager
   */
  constructor(dbManager) {
    this.db = dbManager;
  }

  // ━━━ 信息素 CRUD / Pheromone CRUD ━━━

  /**
   * 插入信息素
   * Insert pheromone
   *
   * @param {Object} params
   * @param {string} params.id
   * @param {string} params.type
   * @param {string} params.sourceId
   * @param {string} params.targetScope
   * @param {number} [params.intensity=1.0]
   * @param {any} [params.payload]
   * @param {number} [params.decayRate=0.01]
   * @param {number} [params.createdAt]
   * @param {number} [params.updatedAt]
   * @param {number} [params.expiresAt]
   */
  insert({ id, type, sourceId, targetScope, intensity = 1.0, payload, decayRate = 0.01, createdAt, updatedAt, expiresAt }) {
    const now = Date.now();
    const stmt = this.db.prepare('pheromone_insert', `
      INSERT INTO pheromones (id, type, source_id, target_scope, intensity, payload, decay_rate, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id || this.db.generateId('ph'),
      type, sourceId, targetScope,
      intensity,
      payload != null ? JSON.stringify(payload) : null,
      decayRate,
      createdAt || now,
      updatedAt || now,
      expiresAt || null,
    );
  }

  /**
   * Upsert 信息素 (强化: 累加 intensity)
   * Upsert pheromone (reinforcement: accumulate intensity)
   *
   * @param {Object} params
   * @param {string} params.type
   * @param {string} params.sourceId
   * @param {string} params.targetScope
   * @param {number} [params.intensity=1.0]
   * @param {any} [params.payload]
   * @param {number} [params.decayRate=0.01]
   * @returns {string} pheromone ID
   */
  upsert({ type, sourceId, targetScope, intensity = 1.0, payload, decayRate = 0.01 }) {
    const now = Date.now();

    // 查找已有同类信息素 / Find existing same-type pheromone
    const existing = this.findByTypeAndScope(type, sourceId, targetScope);

    if (existing) {
      // 强化: 累加 intensity / Reinforce: accumulate intensity
      const newIntensity = existing.intensity + intensity;
      this.updateIntensity(existing.id, newIntensity, now);
      return existing.id;
    }

    // 创建新信息素 / Create new pheromone
    const id = this.db.generateId('ph');
    this.insert({ id, type, sourceId, targetScope, intensity, payload, decayRate, createdAt: now, updatedAt: now });
    return id;
  }

  /**
   * 按类型和范围查找信息素
   * Find pheromone by type and scope
   *
   * @param {string} type
   * @param {string} sourceId
   * @param {string} targetScope
   * @returns {Object | undefined}
   */
  findByTypeAndScope(type, sourceId, targetScope) {
    const stmt = this.db.prepare('pheromone_findByTypeScope', `
      SELECT * FROM pheromones
      WHERE type = ? AND source_id = ? AND target_scope = ?
      LIMIT 1
    `);
    const row = stmt.get(type, sourceId, targetScope);
    return row ? this._parseRow(row) : undefined;
  }

  /**
   * 查询范围内的信息素
   * Query pheromones in a scope
   *
   * @param {string} targetScope
   * @param {Object} [options]
   * @param {string} [options.type]
   * @param {number} [options.minIntensity=0]
   * @returns {Array<Object>}
   */
  query(targetScope, { type, minIntensity = 0 } = {}) {
    const now = Date.now();
    let sql;
    let params;

    if (type) {
      sql = `
        SELECT * FROM pheromones
        WHERE target_scope = ? AND type = ? AND intensity >= ?
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY intensity DESC
      `;
      params = [targetScope, type, minIntensity, now];
    } else {
      sql = `
        SELECT * FROM pheromones
        WHERE target_scope = ? AND intensity >= ?
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY intensity DESC
      `;
      params = [targetScope, minIntensity, now];
    }

    const rows = this.db.getDb().prepare(sql).all(...params);
    return rows.map((r) => this._parseRow(r));
  }

  /**
   * 更新信息素强度
   * Update pheromone intensity
   *
   * @param {string} id
   * @param {number} newIntensity
   * @param {number} [updatedAt]
   */
  updateIntensity(id, newIntensity, updatedAt) {
    const stmt = this.db.prepare('pheromone_updateIntensity', `
      UPDATE pheromones SET intensity = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(newIntensity, updatedAt || Date.now(), id);
  }

  /**
   * 删除过期信息素
   * Delete expired pheromones
   *
   * @param {number} [nowMs]
   * @returns {number} 删除数量 / Deleted count
   */
  deleteExpired(nowMs) {
    const stmt = this.db.prepare('pheromone_deleteExpired', `
      DELETE FROM pheromones WHERE expires_at IS NOT NULL AND expires_at <= ?
    `);
    const result = stmt.run(nowMs || Date.now());
    return result.changes;
  }

  /**
   * 获取信息素总数
   * Get total pheromone count
   *
   * @returns {number}
   */
  count() {
    const row = this.db.get('SELECT COUNT(*) as count FROM pheromones');
    return row ? row.count : 0;
  }

  /**
   * 获取所有信息素 (用于衰减)
   * Get all pheromones (for decay pass)
   *
   * @returns {Array<Object>}
   */
  getAll() {
    const rows = this.db.all('SELECT * FROM pheromones ORDER BY intensity DESC');
    return rows.map((r) => this._parseRow(r));
  }

  /**
   * 按 ID 删除
   * Delete by ID
   *
   * @param {string} id
   */
  delete(id) {
    this.db.run('DELETE FROM pheromones WHERE id = ?', id);
  }

  /**
   * 批量更新强度
   * Batch update intensities
   *
   * @param {Array<{id: string, intensity: number}>} updates
   */
  batchUpdateIntensity(updates) {
    const stmt = this.db.prepare('pheromone_batchUpdate', `
      UPDATE pheromones SET intensity = ?, updated_at = ? WHERE id = ?
    `);
    const now = Date.now();

    this.db.transaction(() => {
      for (const { id, intensity } of updates) {
        stmt.run(intensity, now, id);
      }
    });
  }

  /**
   * 删除最旧的信息素 (超出限制时)
   * Delete oldest pheromones (when exceeding limit)
   *
   * @param {number} maxCount
   * @returns {number} 删除数量 / Deleted count
   */
  trimToLimit(maxCount) {
    const currentCount = this.count();
    if (currentCount <= maxCount) return 0;

    const toDelete = currentCount - maxCount;
    const stmt = this.db.prepare('pheromone_trimOldest', `
      DELETE FROM pheromones WHERE id IN (
        SELECT id FROM pheromones ORDER BY intensity ASC, updated_at ASC LIMIT ?
      )
    `);
    const result = stmt.run(toDelete);
    return result.changes;
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 解析数据库行
   * Parse database row
   *
   * @param {Object} row
   * @returns {Object}
   * @private
   */
  _parseRow(row) {
    return {
      id: row.id,
      type: row.type,
      sourceId: row.source_id,
      targetScope: row.target_scope,
      intensity: row.intensity,
      payload: row.payload ? JSON.parse(row.payload) : null,
      decayRate: row.decay_rate,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  }
}
