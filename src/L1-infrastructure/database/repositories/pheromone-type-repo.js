/**
 * PheromoneTypeRepository — 信息素类型数据访问 / Pheromone Type Data Access
 *
 * 管理 pheromone_types 表 (V5.0 新增: 自定义信息素类型注册)。
 * Manages pheromone_types table (V5.0 new: custom pheromone type registration).
 *
 * @module L1-infrastructure/database/repositories/pheromone-type-repo
 * @author DEEP-IOS
 */

export class PheromoneTypeRepository {
  constructor(dbManager) {
    this.db = dbManager;
  }

  /**
   * 注册自定义信息素类型
   * Register custom pheromone type
   */
  register({ id, name, decayRate = 0.05, maxTTLMin = 120, mmasMin = 0.05, mmasMax = 1.0, description, createdBy }) {
    const typeId = id || this.db.generateId('pt');
    const stmt = this.db.prepare('pt_register', `
      INSERT INTO pheromone_types (id, name, decay_rate, max_ttl_min, mmas_min, mmas_max, description, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(typeId, name, decayRate, maxTTLMin, mmasMin, mmasMax, description || null, createdBy || null, Date.now());
    return typeId;
  }

  /**
   * 按名称获取类型
   * Get type by name
   */
  getByName(name) {
    const row = this.db.get('SELECT * FROM pheromone_types WHERE name = ?', name);
    return row ? this._parse(row) : null;
  }

  /**
   * 获取类型
   * Get type by ID
   */
  get(id) {
    const row = this.db.get('SELECT * FROM pheromone_types WHERE id = ?', id);
    return row ? this._parse(row) : null;
  }

  /**
   * 列出所有类型
   * List all types
   */
  list() {
    return this.db.all('SELECT * FROM pheromone_types ORDER BY name').map(r => this._parse(r));
  }

  /**
   * 删除类型
   * Delete type
   */
  delete(id) {
    this.db.run('DELETE FROM pheromone_types WHERE id = ?', id);
  }

  /**
   * 检查类型是否存在
   * Check if type exists
   */
  exists(name) {
    const row = this.db.get('SELECT 1 FROM pheromone_types WHERE name = ?', name);
    return !!row;
  }

  _parse(row) {
    return {
      id: row.id,
      name: row.name,
      decayRate: row.decay_rate,
      maxTTLMin: row.max_ttl_min,
      mmasMin: row.mmas_min,
      mmasMax: row.mmas_max,
      description: row.description,
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }
}
