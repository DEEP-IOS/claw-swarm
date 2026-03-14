/**
 * ShapleyCredit — 蒙特卡洛 Shapley 信用分配 / Monte Carlo Shapley Credit Attribution
 *
 * V6.0 新增模块: DAG 完成后计算各 Agent 的边际贡献。
 * V6.0 new module: Compute marginal contributions of agents after DAG completion.
 *
 * 公式:
 *   φᵢ ≈ (1/M) × Σ_{m=1}^{M} [v(Sₘ∪{i}) - v(Sₘ)]
 *
 * 联盟价值函数:
 *   v(S) = qualityScore × completionRate × (1 - latencyPenalty)
 *
 * @module L4-orchestration/shapley-credit
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 默认配置 / Default Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  monteCarloSamples: 100,  // 蒙特卡洛采样数 / MC sample count
  maxAgents: 20,           // 超过此数量使用近似 / Approximate above this
  targetLatencyMs: 5000,   // 目标延迟 (用于惩罚) / Target latency for penalty
};

// ============================================================================
// ShapleyCredit
// ============================================================================

export class ShapleyCredit {
  /**
   * @param {Object} deps
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.logger]
   * @param {Object} [deps.db] - DatabaseManager for shapley_credits
   * @param {Object} [deps.config]
   */
  constructor({ messageBus, logger, db, config = {} } = {}) {
    this._messageBus = messageBus || null;
    this._logger = logger || console;
    this._db = db || null;
    this._config = { ...DEFAULT_CONFIG, ...config };

    // V7.0 §8: 增量贡献收集 (subagent_ended auto-hook 调用)
    // V7.0 §8: Incremental contribution collection (from subagent_ended auto-hook)
    /** @type {Map<string, Array<Object>>} dagId → contributions[] */
    this._pendingContributions = new Map();
  }

  // ━━━ 核心 API / Core API ━━━

  /**
   * 计算 Shapley 信用分配 / Compute Shapley credit attribution
   *
   * @param {Object} dagResult
   * @param {string} dagResult.dagId - DAG ID
   * @param {Array<{ agentId: string, qualityScore: number, completionRate: number, latencyMs: number }>} dagResult.contributions
   * @returns {Map<string, number>} agentId → Shapley credit (0-1)
   */
  compute(dagResult) {
    const { dagId, contributions = [] } = dagResult;
    if (contributions.length === 0) return new Map();

    const agents = contributions.map((c) => c.agentId);
    const n = agents.length;

    // 2 个 agent 时用精确公式 / Exact for 2 agents
    if (n === 2) {
      return this._exactTwo(dagId, contributions);
    }

    // 蒙特卡洛近似 / Monte Carlo approximation
    const M = Math.min(this._config.monteCarloSamples, Math.max(50, n * 10));
    const credits = new Map();
    for (const a of agents) credits.set(a, 0);

    for (let m = 0; m < M; m++) {
      // Fisher-Yates 随机排列 / Random permutation
      const perm = [...agents];
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }

      // 逐个加入联盟计算边际贡献 / Compute marginal contributions
      const coalition = new Set();
      let prevValue = 0;

      for (const agentId of perm) {
        coalition.add(agentId);
        const currentValue = this._coalitionValue(coalition, contributions);
        const marginal = currentValue - prevValue;
        credits.set(agentId, credits.get(agentId) + marginal);
        prevValue = currentValue;
      }
    }

    // 归一化 / Normalize
    const result = new Map();
    for (const [agentId, totalMarginal] of credits) {
      result.set(agentId, Math.round((totalMarginal / M) * 10000) / 10000);
    }

    // 持久化 / Persist
    this._persist(dagId, result, n);

    // 发布事件 / Publish event
    this._messageBus?.publish?.(EventTopics.SHAPLEY_CREDIT_COMPUTED, {
      dagId,
      credits: Object.fromEntries(result),
      sampleCount: M,
      agentCount: n,
    });

    this._logger.debug?.(
      `[ShapleyCredit] DAG ${dagId}: ${n} agents, ${M} samples`,
    );

    return result;
  }

  // ━━━ V7.0: 增量收集 + 信用查询 / Incremental collection + credit query ━━━

  /**
   * V7.0 §8: 记录单个 agent 的贡献 (由 subagent_ended auto-hook 调用)
   * Record a single agent's contribution (called from subagent_ended auto-hook)
   *
   * 贡献按 dagId 分组存储, DAG_COMPLETED 时批量计算 Shapley 值。
   * 如果没有 dagId, 使用 taskId 作为分组键。
   *
   * @param {{ agentId: string, taskId: string, dagId?: string, qualityScore: number, completionRate?: number, latencyMs?: number }} contribution
   */
  recordContribution(contribution) {
    const groupId = contribution.dagId || contribution.taskId || 'default';
    if (!this._pendingContributions.has(groupId)) {
      this._pendingContributions.set(groupId, []);
    }
    this._pendingContributions.get(groupId).push({
      agentId: contribution.agentId,
      qualityScore: contribution.qualityScore ?? 0.5,
      completionRate: contribution.completionRate ?? 1.0,
      latencyMs: contribution.latencyMs ?? 0,
    });
    this._logger.debug?.(
      `[ShapleyCredit] Recorded contribution: agent=${contribution.agentId}, group=${groupId}`,
    );
  }

  /**
   * V7.0 §8: 获取最近的信用排名 (用于 prompt 注入, 创建激励对齐)
   * Get latest credit rankings for prompt injection (incentive alignment)
   *
   * 查询最近 1 小时内的平均 Shapley 信用, 按信用降序排列。
   *
   * @param {number} [limit=10]
   * @returns {Array<{ agentId: string, credit: number }>}
   */
  getLatestCredits(limit = 10) {
    if (!this._db) return [];
    try {
      const oneHourAgo = Date.now() - 3600_000;
      const rows = this._db.all?.(
        `SELECT agent_id AS agentId, AVG(credit) AS credit
         FROM shapley_credits
         WHERE computed_at > ?
         GROUP BY agent_id
         ORDER BY credit DESC
         LIMIT ?`,
        oneHourAgo,
        limit,
      ) || [];
      return rows;
    } catch {
      return [];
    }
  }

  /**
   * 查询历史信用 / Query historical credits
   *
   * @param {Object} [options]
   * @param {string} [options.agentId]
   * @param {string} [options.dagId]
   * @param {number} [options.limit=50]
   * @returns {Array<Object>}
   */
  getHistory(options = {}) {
    if (!this._db) return [];
    try {
      let sql = 'SELECT * FROM shapley_credits WHERE 1=1';
      const params = [];

      if (options.agentId) {
        sql += ' AND agent_id = ?';
        params.push(options.agentId);
      }
      if (options.dagId) {
        sql += ' AND dag_id = ?';
        params.push(options.dagId);
      }

      sql += ' ORDER BY computed_at DESC LIMIT ?';
      params.push(options.limit || 50);

      return this._db.all?.(sql, ...params) || [];
    } catch {
      return [];
    }
  }

  // ━━━ 内部方法 / Internal ━━━

  /**
   * 联盟价值函数 / Coalition value function
   *
   * v(S) = avg(qualityScore) × completionRate × (1 - latencyPenalty)
   *
   * @param {Set<string>} coalition - 联盟成员
   * @param {Array<Object>} contributions - 所有贡献
   * @returns {number} 联盟价值 (0-1)
   * @private
   */
  _coalitionValue(coalition, contributions) {
    if (coalition.size === 0) return 0;

    const members = contributions.filter((c) => coalition.has(c.agentId));
    if (members.length === 0) return 0;

    const avgQuality = members.reduce((s, c) => s + (c.qualityScore || 0.5), 0) / members.length;
    const avgCompletion = members.reduce((s, c) => s + (c.completionRate || 0), 0) / members.length;
    const avgLatency = members.reduce((s, c) => s + (c.latencyMs || 0), 0) / members.length;

    const latencyPenalty = Math.min(1, avgLatency / (this._config.targetLatencyMs * 3));

    return avgQuality * avgCompletion * (1 - latencyPenalty * 0.3);
  }

  /**
   * 2-agent 精确 Shapley / Exact Shapley for 2 agents
   * @private
   */
  _exactTwo(dagId, contributions) {
    const [a, b] = contributions;
    const vEmpty = 0;
    const vA = this._coalitionValue(new Set([a.agentId]), contributions);
    const vB = this._coalitionValue(new Set([b.agentId]), contributions);
    const vAB = this._coalitionValue(new Set([a.agentId, b.agentId]), contributions);

    const phiA = 0.5 * (vA - vEmpty) + 0.5 * (vAB - vB);
    const phiB = 0.5 * (vB - vEmpty) + 0.5 * (vAB - vA);

    const result = new Map([
      [a.agentId, Math.round(phiA * 10000) / 10000],
      [b.agentId, Math.round(phiB * 10000) / 10000],
    ]);

    this._persist(dagId, result, 2);

    this._messageBus?.publish?.(EventTopics.SHAPLEY_CREDIT_COMPUTED, {
      dagId,
      credits: Object.fromEntries(result),
      sampleCount: 'exact',
      agentCount: 2,
    });

    return result;
  }

  /**
   * 持久化到 DB / Persist to DB
   * @private
   */
  _persist(dagId, credits, coalitionSize) {
    if (!this._db) return;
    const now = Date.now();
    try {
      for (const [agentId, credit] of credits) {
        this._db.run?.(
          `INSERT INTO shapley_credits (dag_id, agent_id, credit, coalition_size, computed_at)
           VALUES (?, ?, ?, ?, ?)`,
          dagId, agentId, credit, coalitionSize, now,
        );
      }
    } catch { /* non-fatal */ }
  }
}
