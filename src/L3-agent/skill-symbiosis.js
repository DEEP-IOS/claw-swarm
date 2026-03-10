/**
 * SkillSymbiosisTracker — 共生技能配对追踪 / Skill Symbiosis Tracker
 *
 * V5.2: 发现并推荐 agent 间的技能互补配对。
 * 基于 capability-engine 的维度评分，计算 agent 间互补度。
 *
 * V5.2: Discovers and recommends complementary skill pairings between agents.
 * Computes complementarity based on capability-engine dimension scores.
 *
 * 互补度公式 / Complementarity formula:
 *   complementarity = 1 - cosine_similarity(vectorA, vectorB)
 *   高互补度 = 技能差异大，适合协作
 *
 * @module L3-agent/skill-symbiosis
 * @version 5.2.0
 * @author DEEP-IOS
 */

const SOURCE = 'skill-symbiosis';

/** 能力维度 / Capability dimensions */
const DIMENSIONS = ['technical', 'delivery', 'collaboration', 'innovation'];

export class SkillSymbiosisTracker {
  /**
   * @param {Object} deps
   * @param {Object} [deps.capabilityEngine] - CapabilityEngine 实例
   * @param {Object} [deps.db] - SQLite database
   * @param {Object} [deps.logger]
   */
  constructor({ capabilityEngine, db, logger, messageBus } = {}) {
    this._capabilityEngine = capabilityEngine || null;
    this._db = db || null;
    this._logger = logger || console;
    this._messageBus = messageBus || null;

    /** @type {Map<string, Object>} cache: 'agentA::agentB' -> { complementarity, collaborations, avgQuality } */
    this._pairCache = new Map();

    this._stats = { computations: 0, recommendations: 0 };
  }

  // ━━━ V5.7: 维度映射 / Dimension Mapping ━━━

  /**
   * V5.7: 8D → 4D 维度映射 (CapabilityEngine 8D → SkillSymbiosis 4D)
   *
   * technical    = (coding + architecture + security + performance) / 4
   * delivery     = (testing + documentation) / 2
   * collaboration = communication
   * innovation   = domain
   *
   * @param {Object} scores8D
   * @returns {Object} { technical, delivery, collaboration, innovation }
   */
  static mapDimensions8Dto4D(scores8D) {
    if (!scores8D || typeof scores8D !== 'object') {
      return { technical: 0, delivery: 0, collaboration: 0, innovation: 0 };
    }
    return {
      technical: ((scores8D.coding || 0) + (scores8D.architecture || 0) + (scores8D.security || 0) + (scores8D.performance || 0)) / 4,
      delivery: ((scores8D.testing || 0) + (scores8D.documentation || 0)) / 2,
      collaboration: scores8D.communication || 0,
      innovation: scores8D.domain || 0,
    };
  }

  // ━━━ V5.7: 团队互补度 / Team Complementarity ━━━

  /**
   * V5.7: 获取 agent 与当前团队的互补度信号
   *
   * @param {string} agentId - 候选 agent
   * @param {string[]} currentTeam - 当前已分配 agent ID 列表
   * @returns {number} 平均互补度 [0, 1]
   */
  getTeamComplementarity(agentId, currentTeam) {
    if (!currentTeam || currentTeam.length === 0) return 0.5;

    let totalComplementarity = 0;
    let count = 0;

    for (const memberId of currentTeam) {
      if (memberId === agentId) continue;
      const key1 = `${agentId}::${memberId}`;
      const key2 = `${memberId}::${agentId}`;
      const pair = this._pairCache.get(key1) || this._pairCache.get(key2);
      if (pair) {
        totalComplementarity += pair.complementarity;
        count++;
      }
    }

    return count > 0 ? totalComplementarity / count : 0.5;
  }

  // ━━━ 互补度计算 / Complementarity Computation ━━━

  /**
   * 计算两个 agent 的技能互补度
   * Compute skill complementarity between two agents
   *
   * @param {Object} scoresA - { technical, delivery, collaboration, innovation }
   * @param {Object} scoresB - { technical, delivery, collaboration, innovation }
   * @returns {number} complementarity [0, 1] (1 = 完全互补)
   */
  computeComplementarity(scoresA, scoresB) {
    this._stats.computations++;

    const vecA = DIMENSIONS.map(d => scoresA[d] || 0);
    const vecB = DIMENSIONS.map(d => scoresB[d] || 0);

    // Cosine similarity
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0.5; // 无数据时返回中性值

    const cosineSim = dotProduct / (normA * normB);
    // 互补度 = 1 - 相似度
    return Math.round((1 - cosineSim) * 10000) / 10000;
  }

  // ━━━ 配对记录 / Pair Recording ━━━

  /**
   * 记录一次协作结果
   * Record a collaboration outcome
   *
   * @param {string} agentAId
   * @param {string} agentBId
   * @param {number} qualityScore - 协作质量 [0, 1]
   * @param {Object} [scoresA] - Agent A 的能力向量
   * @param {Object} [scoresB] - Agent B 的能力向量
   */
  recordCollaboration(agentAId, agentBId, qualityScore, scoresA, scoresB) {
    // 确保 key 顺序一致
    const [a, b] = agentAId < agentBId ? [agentAId, agentBId] : [agentBId, agentAId];
    const key = `${a}::${b}`;

    let pair = this._pairCache.get(key) || { complementarity: 0, collaborations: 0, avgQuality: 0 };

    // 更新互补度
    if (scoresA && scoresB) {
      pair.complementarity = this.computeComplementarity(scoresA, scoresB);
    }

    // 增量平均
    pair.collaborations++;
    pair.avgQuality = pair.avgQuality + (qualityScore - pair.avgQuality) / pair.collaborations;
    pair.avgQuality = Math.round(pair.avgQuality * 10000) / 10000;

    this._pairCache.set(key, pair);

    // 持久化
    this._persist(a, b, pair);

    // V5.7: 发布协作事件 / Publish collaboration event
    if (this._messageBus) {
      try {
        this._messageBus.publish('symbiosis.collaboration.recorded', {
          agentAId: a, agentBId: b,
          complementarity: pair.complementarity,
          avgQuality: pair.avgQuality,
          collaborations: pair.collaborations,
        }, { senderId: SOURCE });
      } catch { /* non-fatal */ }
    }
  }

  // ━━━ 推荐 / Recommendation ━━━

  /**
   * 为指定 agent 推荐最佳协作伙伴
   * Recommend best collaboration partners for an agent
   *
   * @param {string} agentId
   * @param {number} [topN=3]
   * @returns {Array<{partnerId: string, complementarity: number, avgQuality: number, collaborations: number}>}
   */
  recommendPartners(agentId, topN = 3) {
    this._stats.recommendations++;
    const results = [];

    // 从 DB 查询
    if (this._db) {
      try {
        const rows = this._db.prepare(`
          SELECT agent_a_id, agent_b_id, complementarity, collaborations, avg_quality
          FROM skill_symbiosis
          WHERE agent_a_id = ? OR agent_b_id = ?
          ORDER BY (complementarity * 0.4 + avg_quality * 0.6) DESC
          LIMIT ?
        `).all(agentId, agentId, topN);

        for (const row of rows) {
          const partnerId = row.agent_a_id === agentId ? row.agent_b_id : row.agent_a_id;
          results.push({
            partnerId,
            complementarity: row.complementarity,
            avgQuality: row.avg_quality,
            collaborations: row.collaborations,
          });
        }
        if (results.length > 0) return results;
      } catch { /* fallback */ }
    }

    // Cache fallback
    for (const [key, pair] of this._pairCache) {
      const [a, b] = key.split('::');
      if (a === agentId || b === agentId) {
        results.push({
          partnerId: a === agentId ? b : a,
          complementarity: pair.complementarity,
          avgQuality: pair.avgQuality,
          collaborations: pair.collaborations,
        });
      }
    }

    // 排序: 60% 质量 + 40% 互补度
    results.sort((x, y) => {
      const scoreX = x.complementarity * 0.4 + x.avgQuality * 0.6;
      const scoreY = y.complementarity * 0.4 + y.avgQuality * 0.6;
      return scoreY - scoreX;
    });

    return results.slice(0, topN);
  }

  // ━━━ 统计 / Stats ━━━

  getStats() {
    return { ...this._stats, trackedPairs: this._pairCache.size };
  }

  // ━━━ 内部 / Internal ━━━

  _persist(agentAId, agentBId, pair) {
    if (!this._db) return;
    try {
      this._db.prepare(`
        INSERT INTO skill_symbiosis (agent_a_id, agent_b_id, complementarity, collaborations, avg_quality, last_collaboration, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(agent_a_id, agent_b_id) DO UPDATE SET
          complementarity = excluded.complementarity,
          collaborations = excluded.collaborations,
          avg_quality = excluded.avg_quality,
          last_collaboration = excluded.last_collaboration,
          updated_at = excluded.updated_at
      `).run(agentAId, agentBId, pair.complementarity, pair.collaborations, pair.avgQuality, Date.now(), Date.now());
    } catch { /* ignore */ }
  }
}
