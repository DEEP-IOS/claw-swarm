/**
 * PheromoneTypeRegistry — 信息素类型注册表 / Pheromone Type Registry
 *
 * V5.0 新增: 管理自定义信息素类型, 提供:
 * - 动态注册/注销自定义信息素类型
 * - 类型配置查询 (MMAS 边界、衰减率)
 * - 内置类型 + 自定义类型统一接口
 * - 持久化到 pheromone_types 表
 *
 * V5.0 new: Manages custom pheromone types, providing:
 * - Dynamic register/unregister custom pheromone types
 * - Type config query (MMAS bounds, decay rate)
 * - Unified interface for built-in + custom types
 * - Persistence to pheromone_types table
 *
 * @module L2-communication/pheromone-type-registry
 * @author DEEP-IOS
 */

/** 内置类型 (不可删除) / Built-in types (cannot be deleted) */
const BUILTIN_TYPES = new Set(['trail', 'alarm', 'recruit', 'queen', 'dance', 'food', 'danger']);

export class PheromoneTypeRegistry {
  /**
   * @param {Object} deps
   * @param {import('../L1-infrastructure/database/repositories/pheromone-type-repo.js').PheromoneTypeRepository} deps.pheromoneTypeRepo
   * @param {Object} [deps.logger]
   */
  constructor({ pheromoneTypeRepo, logger } = {}) {
    /** @type {import('../L1-infrastructure/database/repositories/pheromone-type-repo.js').PheromoneTypeRepository} */
    this._repo = pheromoneTypeRepo;

    /** @type {Object} */
    this._logger = logger || console;

    /** @type {Map<string, Object>} 内存缓存 / In-memory cache */
    this._cache = new Map();

    /** @type {boolean} 缓存已加载 / Cache loaded */
    this._loaded = false;
  }

  /**
   * 加载所有自定义类型到缓存
   * Load all custom types into cache
   */
  load() {
    const types = this._repo.list();
    this._cache.clear();
    for (const t of types) {
      this._cache.set(t.name, t);
    }
    this._loaded = true;
    this._logger.info?.(`[PheromoneTypeRegistry] Loaded ${types.length} custom types`);
  }

  /**
   * 注册自定义信息素类型
   * Register custom pheromone type
   *
   * @param {Object} params
   * @param {string} params.name - 类型名称 (唯一) / Type name (unique)
   * @param {number} [params.decayRate=0.05] - 衰减率 / Decay rate
   * @param {number} [params.maxTTLMin=120] - 最大生存时间(分钟) / Max TTL in minutes
   * @param {number} [params.mmasMin=0.05] - MMAS 最小浓度 / MMAS min
   * @param {number} [params.mmasMax=1.0] - MMAS 最大浓度 / MMAS max
   * @param {string} [params.description] - 描述 / Description
   * @param {string} [params.createdBy] - 创建者 / Created by
   * @returns {string} type ID
   * @throws {Error} 如果名称已被内置类型占用 / If name is reserved by built-in
   */
  register({ name, decayRate = 0.05, maxTTLMin = 120, mmasMin = 0.05, mmasMax = 1.0, description, createdBy }) {
    if (BUILTIN_TYPES.has(name)) {
      throw new Error(`Cannot register: '${name}' is a built-in pheromone type`);
    }

    if (mmasMin >= mmasMax) {
      throw new Error(`Invalid MMAS bounds: min(${mmasMin}) must be less than max(${mmasMax})`);
    }

    // 检查是否已存在 / Check if already exists
    if (this._cache.has(name) || this._repo.exists(name)) {
      throw new Error(`Pheromone type '${name}' already registered`);
    }

    const id = this._repo.register({ name, decayRate, maxTTLMin, mmasMin, mmasMax, description, createdBy });

    // 更新缓存 / Update cache
    const typeConfig = { id, name, decayRate, maxTTLMin, mmasMin, mmasMax, description, createdBy };
    this._cache.set(name, typeConfig);

    this._logger.info?.(`[PheromoneTypeRegistry] Registered custom type: ${name}`);
    return id;
  }

  /**
   * 注销自定义信息素类型
   * Unregister custom pheromone type
   *
   * @param {string} name - 类型名称 / Type name
   * @throws {Error} 如果是内置类型 / If built-in type
   */
  unregister(name) {
    if (BUILTIN_TYPES.has(name)) {
      throw new Error(`Cannot unregister built-in type: '${name}'`);
    }

    const typeConfig = this._cache.get(name);
    if (typeConfig) {
      this._repo.delete(typeConfig.id);
      this._cache.delete(name);
      this._logger.info?.(`[PheromoneTypeRegistry] Unregistered type: ${name}`);
    }
  }

  /**
   * 获取类型配置 (内置或自定义)
   * Get type config (built-in or custom)
   *
   * @param {string} name
   * @returns {Object | null}
   */
  getType(name) {
    // 从缓存查询 / Query from cache
    if (this._cache.has(name)) {
      return { ...this._cache.get(name) };
    }

    // 延迟加载 / Lazy load
    if (!this._loaded) {
      this.load();
      if (this._cache.has(name)) {
        return { ...this._cache.get(name) };
      }
    }

    // 从数据库查询 / Query from DB
    const fromDb = this._repo.getByName(name);
    if (fromDb) {
      this._cache.set(name, fromDb);
      return { ...fromDb };
    }

    return null;
  }

  /**
   * 检查类型是否存在
   * Check if type exists (built-in or custom)
   *
   * @param {string} name
   * @returns {boolean}
   */
  exists(name) {
    return BUILTIN_TYPES.has(name) || this._cache.has(name) || this._repo.exists(name);
  }

  /**
   * 列出所有自定义类型
   * List all custom types
   *
   * @returns {Array<Object>}
   */
  listCustomTypes() {
    if (!this._loaded) this.load();
    return [...this._cache.values()];
  }

  /**
   * 列出所有类型名 (内置 + 自定义)
   * List all type names (built-in + custom)
   *
   * @returns {string[]}
   */
  listAllTypeNames() {
    if (!this._loaded) this.load();
    return [...BUILTIN_TYPES, ...this._cache.keys()];
  }

  /**
   * 检查是否为内置类型
   * Check if name is a built-in type
   *
   * @param {string} name
   * @returns {boolean}
   */
  isBuiltin(name) {
    return BUILTIN_TYPES.has(name);
  }

  /**
   * 清除缓存
   * Clear cache
   */
  clearCache() {
    this._cache.clear();
    this._loaded = false;
  }
}
