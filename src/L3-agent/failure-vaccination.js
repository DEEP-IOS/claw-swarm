/**
 * FailureVaccination — 免疫记忆库 / Failure Immunization Database
 *
 * V5.2: 记录已遇到的失败模式，免疫同类错误。
 * 与 tool-resilience 的 circuit breaker 联动。
 *
 * V5.2: Records encountered failure patterns and immunizes against
 * similar errors. Works with tool-resilience circuit breaker.
 *
 * @module L3-agent/failure-vaccination
 * @version 5.2.0
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

const SOURCE = 'failure-vaccination';

export class FailureVaccination {
  /**
   * @param {Object} deps
   * @param {Object} [deps.db] - SQLite database instance
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.logger]
   */
  constructor({ db, messageBus, logger } = {}) {
    this._db = db || null;
    this._messageBus = messageBus || null;
    this._logger = logger || console;

    /** @type {Map<string, Object>} in-memory vaccine cache */
    this._cache = new Map();

    this._stats = { vaccinesCreated: 0, applied: 0, successes: 0, misses: 0 };
  }

  // ━━━ 疫苗注册 / Vaccine Registration ━━━

  /**
   * 记录失败模式和对应的修复策略
   * Record a failure pattern and its repair strategy
   *
   * @param {Object} params
   * @param {string} params.failurePattern - 失败模式签名 (e.g., 'ECONNREFUSED:api.example.com')
   * @param {string} [params.toolName] - 相关工具名
   * @param {string} [params.errorCategory] - 错误分类 (network/validation/timeout/logic)
   * @param {string} params.vaccineStrategy - 修复策略描述
   * @param {number} [params.effectiveness=0.5] - 初始有效性评分
   * @returns {Object} vaccine record
   */
  registerVaccine({ failurePattern, toolName, errorCategory, vaccineStrategy, effectiveness = 0.5 }) {
    const key = `${failurePattern}::${vaccineStrategy}`;

    if (this._db) {
      try {
        this._db.prepare(`
          INSERT INTO failure_vaccines (failure_pattern, tool_name, error_category, vaccine_strategy, effectiveness, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(failure_pattern, vaccine_strategy) DO UPDATE SET
            effectiveness = MAX(excluded.effectiveness, failure_vaccines.effectiveness),
            tool_name = COALESCE(excluded.tool_name, failure_vaccines.tool_name)
        `).run(failurePattern, toolName || null, errorCategory || null, vaccineStrategy, effectiveness, Date.now());
      } catch { /* ignore */ }
    }

    const vaccine = { failurePattern, toolName, errorCategory, vaccineStrategy, effectiveness, applications: 0, successes: 0 };
    this._cache.set(key, vaccine);
    this._stats.vaccinesCreated++;

    this._publish(EventTopics.FAILURE_VACCINE_CREATED, { failurePattern, toolName, vaccineStrategy, effectiveness });

    return vaccine;
  }

  // ━━━ 免疫查询 / Immunity Lookup ━━━

  /**
   * 查找失败模式的已知修复策略
   * Find known repair strategies for a failure pattern
   *
   * @param {string} failurePattern - 失败模式签名
   * @param {Object} [options]
   * @param {number} [options.minEffectiveness=0.3] - 最小有效性
   * @param {number} [options.limit=5] - 最多返回数量
   * @returns {Array<Object>} 排序后的修复策略列表
   */
  findVaccines(failurePattern, { minEffectiveness = 0.3, limit = 5 } = {}) {
    // 先查 DB
    if (this._db) {
      try {
        const rows = this._db.prepare(`
          SELECT * FROM failure_vaccines
          WHERE failure_pattern = ? AND effectiveness >= ?
          ORDER BY effectiveness DESC, successes DESC
          LIMIT ?
        `).all(failurePattern, minEffectiveness, limit);

        if (rows.length > 0) {
          return rows.map(r => ({
            failurePattern: r.failure_pattern,
            toolName: r.tool_name,
            errorCategory: r.error_category,
            vaccineStrategy: r.vaccine_strategy,
            effectiveness: r.effectiveness,
            applications: r.applications,
            successes: r.successes,
          }));
        }
      } catch { /* fallback to cache */ }
    }

    // Cache fallback
    const results = [];
    for (const vaccine of this._cache.values()) {
      if (vaccine.failurePattern === failurePattern && vaccine.effectiveness >= minEffectiveness) {
        results.push({ ...vaccine });
      }
    }
    results.sort((a, b) => b.effectiveness - a.effectiveness);
    return results.slice(0, limit);
  }

  /**
   * 模糊匹配查找相似失败模式
   * Fuzzy match for similar failure patterns
   *
   * @param {string} errorSignature
   * @param {string} [toolName]
   * @returns {Array<Object>}
   */
  findSimilar(errorSignature, toolName) {
    if (!this._db) return [];
    try {
      let sql = 'SELECT * FROM failure_vaccines WHERE failure_pattern LIKE ? AND effectiveness >= 0.3';
      const params = [`%${errorSignature.substring(0, Math.min(50, errorSignature.length))}%`];
      if (toolName) {
        sql += ' AND tool_name = ?';
        params.push(toolName);
      }
      sql += ' ORDER BY effectiveness DESC LIMIT 3';
      return this._db.prepare(sql).all(...params).map(r => ({
        failurePattern: r.failure_pattern,
        vaccineStrategy: r.vaccine_strategy,
        effectiveness: r.effectiveness,
      }));
    } catch { return []; }
  }

  // ━━━ 反馈 / Feedback ━━━

  /**
   * 记录疫苗应用结果
   * Record vaccine application outcome
   *
   * @param {string} failurePattern
   * @param {string} vaccineStrategy
   * @param {boolean} success - 是否成功修复
   */
  recordOutcome(failurePattern, vaccineStrategy, success) {
    const key = `${failurePattern}::${vaccineStrategy}`;
    this._stats.applied++;

    if (success) this._stats.successes++;
    else this._stats.misses++;

    // Update DB
    if (this._db) {
      try {
        const effectivenessUpdate = success
          ? 'MIN(1.0, effectiveness + 0.05)'
          : 'MAX(0.0, effectiveness - 0.1)';
        this._db.prepare(`
          UPDATE failure_vaccines
          SET applications = applications + 1,
              successes = successes + ${success ? 1 : 0},
              effectiveness = ${effectivenessUpdate},
              last_applied_at = ?
          WHERE failure_pattern = ? AND vaccine_strategy = ?
        `).run(Date.now(), failurePattern, vaccineStrategy);
      } catch { /* ignore */ }
    }

    // Update cache
    const cached = this._cache.get(key);
    if (cached) {
      cached.applications++;
      if (success) {
        cached.successes++;
        cached.effectiveness = Math.min(1.0, cached.effectiveness + 0.05);
      } else {
        cached.effectiveness = Math.max(0.0, cached.effectiveness - 0.1);
      }
    }

    this._publish(EventTopics.FAILURE_VACCINE_APPLIED, { failurePattern, vaccineStrategy, success });
  }

  // ━━━ 统计 / Stats ━━━

  getStats() {
    return { ...this._stats, cachedVaccines: this._cache.size };
  }

  _publish(topic, payload) {
    if (this._messageBus) {
      try {
        this._messageBus.publish(topic, wrapEvent(topic, payload, SOURCE));
      } catch { /* ignore */ }
    }
  }
}
