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
  // V5.7: 多类型信息素 / Multi-type pheromones
  food:    { decayRate: 0.04, maxTTLMin: 180, mmasMin: 0.05, mmasMax: 1.00 },
  danger:  { decayRate: 0.20, maxTTLMin: 20,  mmasMin: 0.10, mmasMax: 1.00 },
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

    /** @type {import('../L1-infrastructure/worker-pool.js').WorkerPool | null} V6.0 Worker 委托 */
    this._workerPool = null;
  }

  /**
   * V6.0: 设置 Worker 线程池 (可选, 用于 decayPass 等批量计算)
   * V6.0: Set worker pool (optional, for batch computations like decayPass)
   *
   * @param {import('../L1-infrastructure/worker-pool.js').WorkerPool} pool
   */
  setWorkerPool(pool) {
    this._workerPool = pool;
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

  /**
   * V6.3 §4B.4: 获取方向性信息素路径 — 包含 sourceId + type + scope 的完整路径信息
   * Get directional pheromone trails with full path info (who is doing what)
   *
   * @param {Object} [options]
   * @param {string} [options.scope] - 过滤范围 / Filter by scope
   * @param {number} [options.limit=5] - 返回数量限制 / Limit
   * @returns {Array<{ sourceId: string, type: string, scope: string, intensity: number, payload?: any }>}
   */
  getDirectionalTrails({ scope, limit = 5 } = {}) {
    let pheromones = this._repo.getAll();

    if (scope) {
      pheromones = pheromones.filter(p =>
        p.targetScope === scope || (p.targetScope || '').startsWith(scope + '/')
      );
    }

    // 计算衰减后强度并过滤 / Compute decayed intensity and filter
    const trails = [];
    for (const ph of pheromones) {
      const decayed = this._computeDecayedIntensity(ph);
      if (decayed >= MIN_INTENSITY) {
        trails.push({
          sourceId: ph.sourceId,
          type: ph.type,
          scope: ph.targetScope,
          intensity: decayed,
          payload: ph.payload,
        });
      }
    }

    // 按强度降序 / Sort by intensity descending
    trails.sort((a, b) => b.intensity - a.intensity);

    return trails.slice(0, limit);
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

    // 构建信息素浓度快照 (按类型聚合) / Build concentration snapshot (aggregate by type)
    const concentrations = {};
    const remainingPheromones = allPheromones.filter(p => !toDelete.includes(p.id));
    for (const ph of remainingPheromones) {
      const decayed = this._computeDecayedIntensity(ph);
      if (decayed >= MIN_INTENSITY) {
        concentrations[ph.type] = Math.max(concentrations[ph.type] || 0, decayed);
      }
    }

    // 广播衰减完成 / Broadcast decay complete
    this._emit('pheromone.decayPass', {
      updated: updates.length,
      evaporated: toDelete.length,
      remaining: remainingPheromones.length,
      concentrations,
    });

    // 清理过期 / Clean expired
    this._repo.deleteExpired(now);

    return { updated: updates.length, evaporated: toDelete.length };
  }

  /**
   * V6.0: Worker 委托版衰减 (异步)
   * V6.0: Worker-delegated decay pass (async)
   *
   * 如果 WorkerPool 可用, 将衰减计算委托给 aco-worker;
   * 否则 fallback 到同步 decayPass()。
   *
   * If WorkerPool available, delegates decay to aco-worker;
   * otherwise falls back to synchronous decayPass().
   *
   * @returns {Promise<{updated: number, evaporated: number}>}
   */
  async decayPassAsync() {
    if (!this._workerPool) {
      return this.decayPass();
    }

    try {
      const allPheromones = this._repo.getAll();
      const now = Date.now();

      const result = await this._workerPool.submit('decayPass', {
        pheromones: allPheromones.map((p) => ({
          id: p.id,
          type: p.type,
          intensity: p.intensity,
          decayRate: p.decayRate || this._getTypeConfig(p.type).decayRate,
          updatedAt: p.updatedAt,
          expiresAt: p.expiresAt,
          mmasMin: this._getTypeConfig(p.type).mmasMin,
        })),
        now,
        minIntensity: MIN_INTENSITY,
      });

      // 应用 Worker 结果到 DB / Apply worker results to DB
      if (result.updated.length > 0) {
        this._repo.batchUpdateIntensity(result.updated);
      }
      for (const id of result.evaporated) {
        this._repo.delete(id);
      }

      this._stats.decayed += result.updated.length;
      this._stats.evaporated += result.evaporated.length;

      // Worker 版也需要浓度快照 / Worker version also needs concentrations
      const workerConcentrations = {};
      const workerRemaining = allPheromones.filter(p => !result.evaporated.includes(p.id));
      for (const ph of workerRemaining) {
        const decayed = this._computeDecayedIntensity(ph);
        if (decayed >= MIN_INTENSITY) {
          workerConcentrations[ph.type] = Math.max(workerConcentrations[ph.type] || 0, decayed);
        }
      }

      this._emit('pheromone.decayPass', {
        updated: result.updated.length,
        evaporated: result.evaporated.length,
        remaining: workerRemaining.length,
        concentrations: workerConcentrations,
        delegated: 'worker',
      });

      this._repo.deleteExpired(now);

      return { updated: result.updated.length, evaporated: result.evaporated.length };
    } catch (err) {
      this._logger.warn?.(`[PheromoneEngine] Worker decayPass failed, fallback to sync: ${err.message}`);
      return this.decayPass();
    }
  }

  // ━━━ ACO 轮盘赌选择 / ACO Roulette Wheel Selection ━━━

  /**
   * ACO 轮盘赌路径选择
   * ACO roulette wheel path selection
   *
   * 从多个路径/选项中按信息素浓度 + 启发式值概率选择。
   * P(select_i) = [τ_i^α · η_i^β] / Σ[τ_j^α · η_j^β]
   *
   * Select from multiple paths/options by pheromone intensity + heuristic probability.
   *
   * V5.1: 新增 beta 参数用于启发式权重（如 capability_match_score）。
   *   beta=0 时退化为 V5.0 行为（纯信息素强度）。
   *   调用方通过 candidate.eta 提供启发式值，缺失时中性化为 1.0。
   *
   * @param {Array<{id: string, intensity: number, eta?: number}>} candidates - 候选列表 / Candidate list
   * @param {number} [alpha=1.0] - 信息素权重指数 / Pheromone weight exponent
   * @param {number} [beta=0] - 启发式权重指数 / Heuristic weight exponent (0=V5.0 compat)
   * @returns {Object | null} 选中的候选 / Selected candidate
   */
  acoSelect(candidates, alpha = 1.0, beta = 0) {
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // 计算概率: [τ^α · η^β] / Compute probabilities: [τ^α · η^β]
    const weights = candidates.map(c => {
      const tau = Math.pow(c.intensity, alpha);
      // ⚠️ NaN 防护: 缺失 eta 时中性化为 1.0, Math.pow(1, β)=1, 等同 V5.0
      const eta = c.eta ?? 1.0;
      const heuristic = beta > 0 ? Math.pow(eta, beta) : 1;
      return tau * heuristic;
    });
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
   * @param {number} [alpha=1.0] - 信息素权重指数 / Pheromone weight exponent
   * @param {number} [beta=0] - 启发式权重指数 / Heuristic weight exponent
   * @returns {Object | null} 选中的信息素 / Selected pheromone
   */
  routeByPheromone(targetScope, type, alpha = 1.0, beta = 0) {
    const pheromones = this.read(targetScope, { type });
    if (pheromones.length === 0) return null;
    return this.acoSelect(pheromones, alpha, beta);
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

  // ━━━ V5.2: 自动升压 / Auto Escalation ━━━

  /**
   * 自动升压: 扫描所有活跃信息素，对滞留超时的 pending 信息素升压
   * Auto-escalate: scan active pheromones, boost stale pending ones
   *
   * @param {Object} [options]
   * @param {number} [options.k=0.3] - 压力梯度系数
   * @param {number} [options.threshold=0.9] - 升压阈值
   * @returns {{ checked: number, escalated: number }}
   */
  autoEscalate({ k = 0.3, threshold = 0.9 } = {}) {
    const all = this._repo.getAll();
    const now = Date.now();
    let checked = 0, escalated = 0;

    for (const ph of all) {
      const current = this._computeDecayedIntensity(ph, now);
      if (current < MIN_INTENSITY) continue;
      checked++;

      const ageMinutes = (now - ph.createdAt) / 60000;
      const pressure = current * (1 + k * Math.log(1 + ageMinutes));

      if (pressure > threshold && ph.type !== 'recruit') {
        this.emitPheromone({
          type: 'recruit',
          sourceId: 'auto-escalate',
          targetScope: ph.targetScope,
          intensity: Math.min(pressure, 1.0),
          payload: { escalatedFrom: ph.id, ageMinutes: Math.round(ageMinutes * 100) / 100 },
        });
        escalated++;

        this._emit('pheromone.escalated', {
          originalId: ph.id,
          targetScope: ph.targetScope,
          pressure: Math.round(pressure * 10000) / 10000,
          ageMinutes: Math.round(ageMinutes * 100) / 100,
        });
      }
    }

    return { checked, escalated };
  }

  // ━━━ V6.1: 信息素传播 / Pheromone Propagation ━━━

  /**
   * 信息素 hop-by-hop 传播 / Pheromone hop-by-hop propagation
   *
   * 将信息素从源范围传播到相邻范围, 强度按距离指数衰减。
   * Spreads pheromone from source scope to adjacent scopes with distance-based decay.
   *
   * propagatedIntensity = sourceIntensity × spreadFactor^hop
   *
   * @param {Object} params
   * @param {string} params.type - 信息素类型 / Pheromone type
   * @param {string} params.sourceScope - 源范围 / Source scope
   * @param {string[]} params.adjacentScopes - 相邻范围列表 / Adjacent scope list
   * @param {number} [params.spreadFactor=0.5] - 传播衰减系数 (0-1) / Spread decay factor
   * @param {number} [params.maxHops=2] - 最大传播跳数 / Max propagation hops
   * @returns {{ propagated: number, totalScopes: number }}
   */
  propagate({ type, sourceScope, adjacentScopes, spreadFactor = 0.5, maxHops = 2 }) {
    if (!adjacentScopes || adjacentScopes.length === 0) return { propagated: 0, totalScopes: 0 };
    if (spreadFactor <= 0 || spreadFactor >= 1) return { propagated: 0, totalScopes: 0 };

    // 读取源范围的信息素强度 / Read source scope pheromone intensity
    const sourcePheromones = this.read(sourceScope, { type });
    if (sourcePheromones.length === 0) return { propagated: 0, totalScopes: 0 };

    const maxSourceIntensity = Math.max(...sourcePheromones.map(p => p.intensity));
    let propagated = 0;

    // BFS 传播: 逐跳衰减 / BFS propagation: decay per hop
    const visited = new Set([sourceScope]);
    let currentFrontier = adjacentScopes.filter(s => !visited.has(s));

    for (let hop = 1; hop <= maxHops && currentFrontier.length > 0; hop++) {
      const propagatedIntensity = maxSourceIntensity * Math.pow(spreadFactor, hop);
      if (propagatedIntensity < 0.01) break; // 低于阈值停止 / Stop below threshold

      for (const scope of currentFrontier) {
        if (visited.has(scope)) continue;
        visited.add(scope);

        this.emitPheromone({
          type,
          sourceId: 'propagation',
          targetScope: scope,
          intensity: propagatedIntensity,
          payload: { propagatedFrom: sourceScope, hop, spreadFactor },
        });
        propagated++;
      }

      // 下一跳: 当前前沿的相邻范围 (简化: 基于 scope 层级展开)
      // Next hop: adjacent scopes of current frontier (simplified: scope hierarchy expansion)
      const nextFrontier = [];
      for (const scope of currentFrontier) {
        // 上层 scope: /task/123 → /task
        const parentScope = scope.substring(0, scope.lastIndexOf('/'));
        if (parentScope && !visited.has(parentScope)) {
          nextFrontier.push(parentScope);
        }
      }
      currentFrontier = nextFrontier;
    }

    if (propagated > 0) {
      this._emit('pheromone.propagated', {
        type,
        sourceScope,
        propagated,
        spreadFactor,
        maxHops,
      });
    }

    return { propagated, totalScopes: visited.size };
  }

  // ━━━ V5.2: 多类型衰减 / Multi-type Decay ━━━

  /**
   * 按类型获取独立衰减函数
   * Get type-specific decay function
   *
   * trail: 线性衰减, alarm: 阶梯衰减, recruit/default: 指数衰减
   *
   * @param {string} type
   * @param {number} intensity
   * @param {number} ageMinutes
   * @param {number} decayRate
   * @returns {number}
   */
  computeTypedDecay(type, intensity, ageMinutes, decayRate) {
    switch (type) {
      case 'trail':
      case 'food':       // V5.7: food 使用线性衰减 (持久资源路径)
        return Math.max(0, intensity - decayRate * ageMinutes);
      case 'alarm':
      case 'danger': {   // V5.7: danger 使用阶梯衰减 (短暂高强度警告)
        const steps = Math.floor(ageMinutes / 10);
        return intensity * Math.pow(0.7, steps);
      }
      case 'recruit':
      default:
        return intensity * Math.exp(-decayRate * ageMinutes);
    }
  }

  // ━━━ 导出 / Export ━━━

  /**
   * 将当前所有活跃信息素导出为结构化 JSON
   * Export all active pheromones to structured JSON
   *
   * 支持过滤和格式选项；包含衰减状态（剩余 TTL、衰减百分比）。
   * Supports filtering and format options; includes decay status (remaining TTL, decay %).
   *
   * @param {Object} [options]
   * @param {string} [options.type]        - 按类型过滤 / Filter by pheromone type
   * @param {string} [options.scope]       - 按范围前缀过滤 / Filter by scope prefix
   * @param {number} [options.minIntensity=0.01] - 最低强度阈值 / Minimum intensity threshold
   * @param {boolean} [options.pretty=false]     - 是否美化输出 / Pretty-print JSON
   * @returns {string} JSON string
   *
   * @example
   * // 导出所有活跃信息素
   * const json = engine.exportToJSON({ pretty: true });
   *
   * // 只导出 /task/42 范围的 alarm 信息素
   * const json = engine.exportToJSON({ type: 'alarm', scope: '/task/42' });
   */
  exportToJSON({ type, scope, minIntensity = MIN_INTENSITY, pretty = false } = {}) {
    const now = Date.now();
    let pheromones = this._repo.getAll();

    // 过滤 type / Filter by type
    if (type) {
      pheromones = pheromones.filter(p => p.type === type);
    }
    // 过滤 scope 前缀 / Filter by scope prefix
    if (scope) {
      pheromones = pheromones.filter(
        p => p.targetScope === scope || p.targetScope.startsWith(scope + '/')
      );
    }

    const active = [];

    for (const ph of pheromones) {
      const currentIntensity = this._computeDecayedIntensity(ph, now);

      if (currentIntensity < MIN_INTENSITY) continue;
      if (currentIntensity < minIntensity) continue;

      const typeConfig = this._getTypeConfig(ph.type);
      const ageMinutes = (now - ph.updatedAt) / 60000;
      // 剩余 TTL 估算: I·e^(-λ·t) = MIN → t = ln(I/MIN) / λ
      const remainingMinutes = Math.log(currentIntensity / MIN_INTENSITY)
        / (ph.decayRate || typeConfig.decayRate);
      const decayPct = ph.intensity > 0
        ? Math.round((1 - currentIntensity / ph.intensity) * 10000) / 100
        : 0;

      active.push({
        id: ph.id,
        type: ph.type,
        sourceId: ph.sourceId,
        targetScope: ph.targetScope,
        intensity: Math.round(currentIntensity * 10000) / 10000,
        storedIntensity: ph.intensity,
        decayStatus: {
          decayRate: ph.decayRate ?? typeConfig.decayRate,
          ageMinutes: Math.round(ageMinutes * 100) / 100,
          decayPct,
          remainingMinutes: Math.round(remainingMinutes * 100) / 100,
          mmasMin: typeConfig.mmasMin,
          mmasMax: typeConfig.mmasMax,
        },
        payload: ph.payload ?? null,
        createdAt: ph.createdAt,
        updatedAt: ph.updatedAt,
        createdAtISO: new Date(ph.createdAt).toISOString(),
        updatedAtISO: new Date(ph.updatedAt).toISOString(),
      });
    }

    const output = {
      exportedAt: new Date(now).toISOString(),
      exportedAtMs: now,
      filters: { type: type ?? null, scope: scope ?? null, minIntensity },
      stats: {
        active: active.length,
        engineStats: this.getStats(),
      },
      pheromones: active,
    };

    return pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output);
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

    // V5.7: 路由到类型特定衰减模型 / Route through type-specific decay model
    const decayModel = this._getDecayModel(ph.type);
    if (decayModel && decayModel !== 'exponential') {
      return this.computeTypedDecay(ph.type, ph.intensity, ageMinutes, decayRate);
    }

    return ph.intensity * Math.exp(-decayRate * ageMinutes);
  }

  /**
   * V5.7: 获取类型的衰减模型
   * V5.7: Get decay model for pheromone type
   *
   * 优先级: TypeRegistry (DB) → 内置映射 → null (默认 exponential)
   *
   * @param {string} type
   * @returns {string | null}
   * @private
   */
  _getDecayModel(type) {
    // 1. TypeRegistry (backed by pheromone_type_config DB)
    if (this._typeRegistry) {
      const typeConfig = this._typeRegistry.getType(type);
      if (typeConfig?.decayModel) return typeConfig.decayModel;
    }
    // 2. 内置类型映射 / Built-in type mapping
    const BUILTIN_DECAY_MODELS = {
      trail: 'linear',
      alarm: 'step',
      recruit: 'exponential',
      queen: 'exponential',
      dance: 'exponential',
      food: 'linear',
      danger: 'step',
    };
    return BUILTIN_DECAY_MODELS[type] || null;
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
