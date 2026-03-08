/**
 * PheromoneEngine — 信息素引擎 / Pheromone Engine
 *
 * V5.0 从 v4.x 迁移核心算法, 增强:
 * - MMAS [τ_min, τ_max] 浓度边界 (防停滞+蒸发)
 * - ACO 轮盘赌路径选择
 * - 自定义信息素类型支持 (通过 PheromoneTypeRegistry)
 * - Repository 模式 (替代直接 SQL)
 * - MessageBus 事件集成
 * - 懒衰减 (读取时计算真实强度)
 *
 * V5.0 migrated from v4.x core algorithms, enhanced with:
 * - MMAS [τ_min, τ_max] concentration bounds (prevent stagnation + evaporation)
 * - ACO roulette wheel path selection
 * - Custom pheromone type support (via PheromoneTypeRegistry)
 * - Repository pattern (replaces direct SQL)
 * - MessageBus event integration
 * - Lazy decay (real intensity computed at read time)
 *
 * @module L2-communication/pheromone-engine
 * @author DEEP-IOS
 */

// ---------------------------------------------------------------------------
// 默认信息素配置 / Default Pheromone Configuration
// ---------------------------------------------------------------------------

/**
 * 内置信息素类型默认参数 (从 v4.x 迁移)
 * Built-in pheromone type defaults (migrated from v4.x)
 *
 * decayRate: 每分钟衰减系数 / decay coefficient per minute
 * maxTTLMin: 最大生存时间(分钟) / max time-to-live in minutes
 * mmasMin: MMAS 最小浓度 / MMAS minimum concentration (V5.0 新增)
 * mmasMax: MMAS 最大浓度 / MMAS maximum concentration (V5.0 新增)
 */
const BUILTIN_DEFAULTS = {
  trail:   { decayRate: 0.05, maxTTLMin: 120, mmasMin: 0.05, mmasMax: 1.00 },
  alarm:   { decayRate: 0.15, maxTTLMin: 30,  mmasMin: 0.05, mmasMax: 1.00 },
  recruit: { decayRate: 0.10, maxTTLMin: 60,  mmasMin: 0.05, mmasMax: 1.00 },
  queen:   { decayRate: 0.02, maxTTLMin: 480, mmasMin: 0.10, mmasMax: 1.00 },
  dance:   { decayRate: 0.08, maxTTLMin: 90,  mmasMin: 0.05, mmasMax: 1.00 },
};

/** 低于此阈值视为蒸发 / Below this threshold, consider evaporated */
const MIN_INTENSITY = 0.01;

/** 默认 MMAS 边界 / Default MMAS bounds */
const DEFAULT_MMAS_MIN = 0.05;
const DEFAULT_MMAS_MAX = 1.00;

/** 最大信息素记录数 / Max pheromone record count */
const MAX_PHEROMONE_COUNT = 5000;

// ---------------------------------------------------------------------------
// PheromoneEngine 类 / PheromoneEngine Class
// ---------------------------------------------------------------------------

export class PheromoneEngine {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {import('../L1-infrastructure/database/repositories/pheromone-repo.js').PheromoneRepository} deps.pheromoneRepo
   * @param {import('./pheromone-type-registry.js').PheromoneTypeRegistry} [deps.typeRegistry]
   * @param {import('./message-bus.js').MessageBus} [deps.messageBus]
   * @param {Object} [deps.logger]
   * @param {Object} [deps.config] - 信息素配置 / Pheromone config override
   */
  constructor({ pheromoneRepo, typeRegistry, messageBus, logger, config } = {}) {
    /** @type {import('../L1-infrastructure/database/repositories/pheromone-repo.js').PheromoneRepository} */
    this._repo = pheromoneRepo;

    /** @type {import('./pheromone-type-registry.js').PheromoneTypeRegistry | null} */
    this._typeRegistry = typeRegistry || null;

    /** @type {import('./message-bus.js').MessageBus | null} */
    this._messageBus = messageBus || null;

    /** @type {Object} */
    this._logger = logger || console;

    /** @type {Object} 配置覆盖 / Config overrides */
    this._config = config || {};

    /** @type {Object} 统计 / Statistics */
    this._stats = {
      emitted: 0,
      reinforced: 0,
      decayed: 0,
      evaporated: 0,
      reads: 0,
    };
  }

  // ━━━ 发射 / Emit ━━━

  /**
   * 发射信息素 (Upsert + MMAS 边界)
   * Emit pheromone (Upsert + MMAS bounds)
   *
   * 如果同类型+同范围已存在, 累加强度 (强化); 否则新建。
   * 强度会被 clamp 到 [τ_min, τ_max] 范围内。
   *
   * If same type+scope exists, accumulate intensity (reinforce); otherwise create.
   * Intensity is clamped to [τ_min, τ_max] bounds.
   *
   * @param {Object} params
   * @param {string} params.type - 信息素类型 / Pheromone type (trail/alarm/recruit/queen/dance/custom)
   * @param {string} params.sourceId - 发射者 ID / Emitter ID
   * @param {string} params.targetScope - 目标范围 / Target scope (e.g., 'task/123', '/zone/frontend')
   * @param {number} [params.intensity=1.0] - 初始/追加强度 / Initial/additional intensity
   * @param {Object} [params.payload] - 附加数据 / Additional data
   * @returns {string} pheromone ID
   */
  emitPheromone({ type, sourceId, targetScope, intensity = 1.0, payload }) {
    const typeConfig = this._getTypeConfig(type);
    const { decayRate, maxTTLMin, mmasMin, mmasMax } = typeConfig;

    // 查找已有信息素 / Find existing pheromone
    const existing = this._repo.findByTypeAndScope(type, sourceId, targetScope);

    let phId;
    if (existing) {
      // 强化: 累加并 clamp / Reinforce: accumulate and clamp
      const currentIntensity = this._computeDecayedIntensity(existing);
      const rawNew = currentIntensity + intensity;
      const clamped = this._clamp(rawNew, mmasMin, mmasMax);

      this._repo.updateIntensity(existing.id, clamped);
      phId = existing.id;
      this._stats.reinforced++;
    } else {
      // 新建: clamp 初始强度 / Create: clamp initial intensity
      const clamped = this._clamp(intensity, mmasMin, mmasMax);
      const now = Date.now();
      const expiresAt = now + maxTTLMin * 60 * 1000;

      phId = this._repo.upsert({
        type,
        sourceId,
        targetScope,
        intensity: clamped,
        payload,
        decayRate,
      });

      // 设置过期时间 / Set expiration
      this._repo.updateIntensity(phId, clamped);
      this._stats.emitted++;
    }

    // 广播事件 / Broadcast event
    this._emit('pheromone.emitted', {
      pheromoneId: phId,
      type,
      sourceId,
      targetScope,
      intensity,
    });

    // 检查数量限制 / Check count limit
    this._trimIfNeeded();

    return phId;
  }

  // ━━━ 读取 / Read ━━━

  /**
   * 读取范围内的信息素 (懒衰减)
   * Read pheromones in scope (with lazy decay)
   *
   * 读取时实时计算衰减后的真实强度。
   * Computes real intensity with decay applied at read time.
   *
   * @param {string} targetScope - 目标范围 / Target scope
   * @param {Object} [options]
   * @param {string} [options.type] - 过滤类型 / Filter by type
   * @param {number} [options.minIntensity=0.01] - 最小强度 / Min intensity filter
   * @returns {Array<Object>} 衰减后的信息素列表 / Decayed pheromone list
   */
  read(targetScope, { type, minIntensity = MIN_INTENSITY } = {}) {
    this._stats.reads++;

    const pheromones = this._repo.query(targetScope, { type, minIntensity: 0 });

    // 应用懒衰减 / Apply lazy decay
    const results = [];
    for (const ph of pheromones) {
      const decayedIntensity = this._computeDecayedIntensity(ph);

      if (decayedIntensity < MIN_INTENSITY) {
        // 蒸发: 删除 / Evaporated: delete
        this._repo.delete(ph.id);
        this._stats.evaporated++;
        continue;
      }

      if (decayedIntensity >= minIntensity) {
        results.push({
          ...ph,
          intensity: decayedIntensity,
        });
      }
    }

    return results;
  }

  /**
   * 读取单个信息素 (懒衰减)
   * Read single pheromone by ID (with lazy decay)
   *
   * @param {string} id
   * @returns {Object | null}
   */
  readById(id) {
    // 直接通过 repo 查询
    const allPheromones = this._repo.getAll();
    const ph = allPheromones.find(p => p.id === id);
    if (!ph) return null;

    const decayedIntensity = this._computeDecayedIntensity(ph);
    if (decayedIntensity < MIN_INTENSITY) {
      this._repo.delete(ph.id);
      this._stats.evaporated++;
      return null;
    }

    return { ...ph, intensity: decayedIntensity };
  }

  // ━━━ 快照 / Snapshot ━━━

  /**
   * 构建信息素快照 (全量 + 衰减)
   * Build pheromone snapshot (full + decayed)
   *
   * @param {Object} [options]
   * @param {string} [options.type] - 过滤类型 / Filter by type
   * @param {string} [options.scope] - 过滤范围 / Filter by scope
   * @returns {Object} snapshot
   */
  buildSnapshot({ type, scope } = {}) {
    let pheromones = this._repo.getAll();

    // 过滤 / Filter
    if (type) {
      pheromones = pheromones.filter(p => p.type === type);
    }
    if (scope) {
      pheromones = pheromones.filter(p => p.targetScope === scope || p.targetScope.startsWith(scope + '/'));
    }

    // 计算真实强度 / Compute real intensities
    const snapshot = [];
    for (const ph of pheromones) {
      const decayed = this._computeDecayedIntensity(ph);
      if (decayed >= MIN_INTENSITY) {
        snapshot.push({
          id: ph.id,
          type: ph.type,
          sourceId: ph.sourceId,
          targetScope: ph.targetScope,
          intensity: decayed,
          payload: ph.payload,
          createdAt: ph.createdAt,
          updatedAt: ph.updatedAt,
        });
      }
    }

    return {
      timestamp: Date.now(),
      count: snapshot.length,
      pheromones: snapshot,
    };
  }

  // ━━━ 衰减 / Decay ━━━

  /**
   * 全量衰减通道 (定时任务调用)
   * Full decay pass (called by scheduler)
   *
   * 遍历所有信息素, 计算衰减, 更新/删除。
   * MMAS 确保: 衰减后不低于 τ_min。
   *
   * Iterate all pheromones, compute decay, update/delete.
   * MMAS ensures: decayed value >= τ_min.
   *
   * @returns {Object} { updated, evaporated }
   */
  decayPass() {
    const allPheromones = this._repo.getAll();
    const now = Date.now();

    const updates = [];
    const toDelete = [];

    for (const ph of allPheromones) {
      const decayed = this._computeDecayedIntensity(ph, now);

      if (decayed < MIN_INTENSITY) {
        toDelete.push(ph.id);
        continue;
      }

      // MMAS: 确保不低于 τ_min / Ensure not below τ_min
      const typeConfig = this._getTypeConfig(ph.type);
      const finalIntensity = Math.max(decayed, typeConfig.mmasMin);

      // 只更新有显著变化的 / Only update if significantly changed
      if (Math.abs(finalIntensity - ph.intensity) > 0.0001) {
        updates.push({ id: ph.id, intensity: finalIntensity });
      }
    }

    // 批量更新 / Batch update
    if (updates.length > 0) {
      this._repo.batchUpdateIntensity(updates);
    }

    // 删除蒸发的 / Delete evaporated
    for (const id of toDelete) {
      this._repo.delete(id);
    }

    this._stats.decayed += updates.length;
    this._stats.evaporated += toDelete.length;

    // 广播衰减完成 / Broadcast decay complete
    this._emit('pheromone.decayPass', {
      updated: updates.length,
      evaporated: toDelete.length,
      remaining: allPheromones.length - toDelete.length,
    });

    // 清理过期 / Clean expired
    this._repo.deleteExpired(now);

    return { updated: updates.length, evaporated: toDelete.length };
  }

  // ━━━ ACO 轮盘赌选择 / ACO Roulette Wheel Selection ━━━

  /**
   * ACO 轮盘赌路径选择
   * ACO roulette wheel path selection
   *
   * 从多个路径/选项中按信息素浓度概率选择。
   * P(select_i) = τ_i^α / Σ(τ_j^α)
   *
   * Select from multiple paths/options by pheromone intensity probability.
   *
   * @param {Array<{id: string, intensity: number}>} candidates - 候选列表 / Candidate list
   * @param {number} [alpha=1.0] - 信息素权重指数 / Pheromone weight exponent
   * @returns {Object | null} 选中的候选 / Selected candidate
   */
  acoSelect(candidates, alpha = 1.0) {
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // 计算概率 / Compute probabilities
    const weights = candidates.map(c => Math.pow(c.intensity, alpha));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    if (totalWeight <= 0) {
      // 均匀随机 / Uniform random
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    // 轮盘赌 / Roulette wheel
    const rand = Math.random() * totalWeight;
    let cumulative = 0;

    for (let i = 0; i < candidates.length; i++) {
      cumulative += weights[i];
      if (rand <= cumulative) {
        return candidates[i];
      }
    }

    // 兜底 / Fallback
    return candidates[candidates.length - 1];
  }

  /**
   * 基于信息素的路由选择 (从范围内信息素做 ACO 选择)
   * Pheromone-based route selection (ACO from scoped pheromones)
   *
   * @param {string} targetScope - 范围 / Scope
   * @param {string} type - 信息素类型 / Pheromone type
   * @param {number} [alpha=1.0] - 权重指数 / Weight exponent
   * @returns {Object | null} 选中的信息素 / Selected pheromone
   */
  routeByPheromone(targetScope, type, alpha = 1.0) {
    const pheromones = this.read(targetScope, { type });
    if (pheromones.length === 0) return null;
    return this.acoSelect(pheromones, alpha);
  }

  // ━━━ MMAS 边界查询 / MMAS Bounds Query ━━━

  /**
   * 获取指定类型的 MMAS 边界
   * Get MMAS bounds for a type
   *
   * @param {string} type
   * @returns {{ mmasMin: number, mmasMax: number }}
   */
  getMMASBounds(type) {
    const config = this._getTypeConfig(type);
    return { mmasMin: config.mmasMin, mmasMax: config.mmasMax };
  }

  /**
   * 检查强度是否在 MMAS 边界内
   * Check if intensity is within MMAS bounds
   *
   * @param {string} type
   * @param {number} intensity
   * @returns {boolean}
   */
  isWithinMMAS(type, intensity) {
    const { mmasMin, mmasMax } = this.getMMASBounds(type);
    return intensity >= mmasMin && intensity <= mmasMax;
  }

  // ━━━ ALARM 密度检测 / ALARM Density Detection ━━━

  /**
   * 计算指定范围内的 ALARM 信息素密度
   * Calculate ALARM pheromone density in scope
   *
   * 用于重规划触发: 当 ALARM 密度 >= 阈值时触发重规划。
   * Used for replan triggering: when ALARM density >= threshold, trigger replan.
   *
   * @param {string} targetScope
   * @param {number} [threshold=3] - 密度阈值 / Density threshold
   * @returns {{ count: number, totalIntensity: number, triggered: boolean }}
   */
  getAlarmDensity(targetScope, threshold = 3) {
    const alarms = this.read(targetScope, { type: 'alarm' });
    const count = alarms.length;
    const totalIntensity = alarms.reduce((sum, a) => sum + a.intensity, 0);
    const triggered = count >= threshold;

    if (triggered) {
      this._emit('pheromone.alarmThreshold', {
        targetScope,
        count,
        totalIntensity,
        threshold,
      });
    }

    return { count, totalIntensity, triggered };
  }

  // ━━━ 统计 / Statistics ━━━

  /**
   * 获取引擎统计
   * Get engine statistics
   *
   * @returns {Object}
   */
  getStats() {
    return {
      ...this._stats,
      totalCount: this._repo.count(),
    };
  }

  /**
   * 重置统计
   * Reset statistics
   */
  resetStats() {
    this._stats = {
      emitted: 0,
      reinforced: 0,
      decayed: 0,
      evaporated: 0,
      reads: 0,
    };
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 计算衰减后的真实强度 (指数衰减)
   * Compute decayed real intensity (exponential decay)
   *
   * I(t) = I₀ × e^(-λ × Δt)
   * 其中 λ = decayRate, Δt = (now - updatedAt) / 60000 (分钟)
   *
   * where λ = decayRate, Δt = (now - updatedAt) / 60000 (minutes)
   *
   * @param {Object} ph - 信息素记录 / Pheromone record
   * @param {number} [now] - 当前时间 / Current time
   * @returns {number} 衰减后强度 / Decayed intensity
   * @private
   */
  _computeDecayedIntensity(ph, now) {
    now = now || Date.now();
    const ageMinutes = (now - ph.updatedAt) / 60000;
    if (ageMinutes <= 0) return ph.intensity;

    const decayRate = ph.decayRate || 0.05;
    return ph.intensity * Math.exp(-decayRate * ageMinutes);
  }

  /**
   * 获取信息素类型配置 (内置 → 自定义 → 默认)
   * Get pheromone type config (built-in → custom → default)
   *
   * @param {string} type
   * @returns {{ decayRate: number, maxTTLMin: number, mmasMin: number, mmasMax: number }}
   * @private
   */
  _getTypeConfig(type) {
    // 1. 内置类型 / Built-in type
    if (BUILTIN_DEFAULTS[type]) {
      return { ...BUILTIN_DEFAULTS[type] };
    }

    // 2. 自定义类型 (通过 TypeRegistry) / Custom type (via TypeRegistry)
    if (this._typeRegistry) {
      const custom = this._typeRegistry.getType(type);
      if (custom) {
        return {
          decayRate: custom.decayRate,
          maxTTLMin: custom.maxTTLMin,
          mmasMin: custom.mmasMin,
          mmasMax: custom.mmasMax,
        };
      }
    }

    // 3. 全局配置覆盖 / Global config override
    if (this._config.defaultDecayRate) {
      return {
        decayRate: this._config.defaultDecayRate,
        maxTTLMin: this._config.defaultMaxTTLMin || 120,
        mmasMin: this._config.mmasMin || DEFAULT_MMAS_MIN,
        mmasMax: this._config.mmasMax || DEFAULT_MMAS_MAX,
      };
    }

    // 4. 硬编码默认 / Hard-coded default
    return {
      decayRate: 0.05,
      maxTTLMin: 120,
      mmasMin: DEFAULT_MMAS_MIN,
      mmasMax: DEFAULT_MMAS_MAX,
    };
  }

  /**
   * MMAS clamp: 将值限制在 [min, max] 范围内
   * MMAS clamp: restrict value to [min, max]
   *
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @returns {number}
   * @private
   */
  _clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  /**
   * 数量限制: 超出时裁剪最弱的
   * Count limit: trim weakest when exceeded
   *
   * @private
   */
  _trimIfNeeded() {
    const maxCount = this._config.maxCount || MAX_PHEROMONE_COUNT;
    this._repo.trimToLimit(maxCount);
  }

  /**
   * 发布消息总线事件
   * Publish to message bus
   *
   * @param {string} topic
   * @param {Object} data
   * @private
   */
  _emit(topic, data) {
    if (this._messageBus) {
      try {
        this._messageBus.publish(topic, data, { senderId: 'pheromone-engine' });
      } catch {
        // 忽略消息总线错误 / Ignore message bus errors
      }
    }
  }
}
