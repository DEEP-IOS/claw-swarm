/**
 * SNAAnalyzer — 社会网络分析 / Social Network Analysis
 *
 * V6.0 新增模块: 计算 Agent 协作网络的拓扑指标。
 * V6.0 new module: Computes topological metrics of agent collaboration networks.
 *
 * 三个核心指标:
 *   度中心性:   C_D(v) = deg(v) / (n-1)
 *   介数中心性: C_B(v) = Σ_{s≠v≠t} [σ(s,t|v) / σ(s,t)]  (Brandes O(VE))
 *   聚类系数:   C(v) = 2e_v / [k_v(k_v-1)]
 *
 * @module L3-agent/sna-analyzer
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 默认配置 / Default Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  computeIntervalTurns: 50,
  persistSnapshots: true,
};

// ============================================================================
// SNAAnalyzer
// ============================================================================

export class SNAAnalyzer {
  /**
   * @param {Object} deps
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.logger]
   * @param {Object} [deps.db] - DatabaseManager for sna_snapshots
   * @param {Object} [deps.config]
   */
  constructor({ messageBus, logger, db, config = {} } = {}) {
    this._messageBus = messageBus || null;
    this._logger = logger || console;
    this._db = db || null;
    this._config = { ...DEFAULT_CONFIG, ...config };

    /**
     * 协作边: Map<"agentA:agentB", { weight: number, lastSeen: number }>
     * Collaboration edges
     * @type {Map<string, { weight: number, lastSeen: number }>}
     */
    this._edges = new Map();

    /** @type {Set<string>} 已知 Agent ID */
    this._agents = new Set();

    /** @type {number} 总 turn 数 / Turn count */
    this._turnCount = 0;

    /** @type {number} 上次计算 / Last computation turn */
    this._lastComputeAt = 0;
  }

  // ━━━ 数据收集 / Data Collection ━━━

  /**
   * 记录一次协作 / Record a collaboration event
   *
   * @param {string} agentA
   * @param {string} agentB
   * @param {number} [weight=1] - 协作强度
   */
  recordCollaboration(agentA, agentB, weight = 1) {
    if (agentA === agentB) return;

    this._agents.add(agentA);
    this._agents.add(agentB);

    const key = agentA < agentB ? `${agentA}:${agentB}` : `${agentB}:${agentA}`;
    const existing = this._edges.get(key);
    if (existing) {
      existing.weight += weight;
      existing.lastSeen = Date.now();
    } else {
      this._edges.set(key, { weight, lastSeen: Date.now() });
    }
  }

  /**
   * 增加 turn 计数，检查是否需要重新计算
   * Increment turn count, check if recomputation needed
   */
  tick() {
    this._turnCount++;
    if (this._turnCount - this._lastComputeAt >= this._config.computeIntervalTurns) {
      return this.compute();
    }
    return null;
  }

  // ━━━ 计算 / Computation ━━━

  /**
   * 计算全部 SNA 指标 / Compute all SNA metrics
   *
   * @returns {Map<string, { degreeCentrality: number, betweennessCentrality: number, clusteringCoefficient: number }>}
   */
  compute() {
    const agents = [...this._agents];
    const n = agents.length;
    if (n < 2) return new Map();

    // 构建邻接表 / Build adjacency list
    const adj = new Map();
    for (const a of agents) adj.set(a, new Set());

    for (const [key] of this._edges) {
      const [a, b] = key.split(':');
      if (adj.has(a) && adj.has(b)) {
        adj.get(a).add(b);
        adj.get(b).add(a);
      }
    }

    const metrics = new Map();

    for (const agent of agents) {
      const neighbors = adj.get(agent) || new Set();
      const deg = neighbors.size;

      // 度中心性 / Degree centrality
      const degreeCentrality = n > 1 ? deg / (n - 1) : 0;

      // 聚类系数 / Clustering coefficient
      let clusteringCoefficient = 0;
      if (deg >= 2) {
        let triangles = 0;
        const neighborArr = [...neighbors];
        for (let i = 0; i < neighborArr.length; i++) {
          for (let j = i + 1; j < neighborArr.length; j++) {
            const neighborSet = adj.get(neighborArr[i]);
            if (neighborSet && neighborSet.has(neighborArr[j])) {
              triangles++;
            }
          }
        }
        clusteringCoefficient = (2 * triangles) / (deg * (deg - 1));
      }

      metrics.set(agent, {
        degreeCentrality: Math.round(degreeCentrality * 10000) / 10000,
        betweennessCentrality: 0, // 下面计算
        clusteringCoefficient: Math.round(clusteringCoefficient * 10000) / 10000,
      });
    }

    // 介数中心性 (Brandes 算法简化版) / Betweenness centrality (simplified Brandes)
    this._computeBetweenness(agents, adj, metrics);

    this._lastComputeAt = this._turnCount;

    // 持久化 / Persist
    this._persistSnapshots(metrics);

    // 发布事件 / Publish event
    // 构建 edges 数组给前端 / Build edges array for frontend
    const edgesArray = [];
    for (const [key, data] of this._edges) {
      const parts = key.split(':');
      if (parts.length >= 2) {
        edgesArray.push({
          source: parts[0],
          target: parts[1],
          weight: data?.weight ?? 1,
          type: data?.type || 'collaboration',
        });
      }
    }

    this._messageBus?.publish?.(EventTopics.SNA_METRICS_UPDATED, {
      agentCount: n,
      edgeCount: this._edges.size,
      metrics: Object.fromEntries(
        [...metrics].map(([k, v]) => [k, v]),
      ),
      edges: edgesArray,
    });

    this._logger.debug?.(`[SNAAnalyzer] Computed SNA for ${n} agents, ${this._edges.size} edges`);

    return metrics;
  }

  /**
   * 获取单个 Agent 的 SNA 指标 / Get SNA metrics for a single agent
   *
   * @param {string} agentId
   * @returns {{ degreeCentrality: number, betweennessCentrality: number, clusteringCoefficient: number }|null}
   */
  getMetrics(agentId) {
    // 从最近一次计算结果中获取 / From last computation
    if (!this._db) return null;
    try {
      return this._db.get?.(
        'SELECT degree_centrality, betweenness_centrality, clustering_coefficient FROM sna_snapshots WHERE agent_id = ? ORDER BY computed_at DESC LIMIT 1',
        agentId,
      ) || null;
    } catch {
      return null;
    }
  }

  /**
   * 获取网络统计 / Get network statistics
   */
  getNetworkStats() {
    return {
      agentCount: this._agents.size,
      edgeCount: this._edges.size,
      turnCount: this._turnCount,
      lastComputeAt: this._lastComputeAt,
    };
  }

  // ━━━ 内部方法 / Internal ━━━

  /**
   * Brandes 介数中心性 (简化版, 无权图)
   * Simplified Brandes betweenness centrality (unweighted)
   *
   * @private
   */
  _computeBetweenness(agents, adj, metrics) {
    const n = agents.length;
    if (n < 3) return;

    const cb = new Map();
    for (const v of agents) cb.set(v, 0);

    for (const s of agents) {
      // BFS from s
      const stack = [];
      const pred = new Map();
      const sigma = new Map();
      const dist = new Map();

      for (const t of agents) {
        pred.set(t, []);
        sigma.set(t, 0);
        dist.set(t, -1);
      }
      sigma.set(s, 1);
      dist.set(s, 0);

      const queue = [s];
      while (queue.length > 0) {
        const v = queue.shift();
        stack.push(v);
        const neighbors = adj.get(v) || new Set();
        for (const w of neighbors) {
          if (dist.get(w) < 0) {
            dist.set(w, dist.get(v) + 1);
            queue.push(w);
          }
          if (dist.get(w) === dist.get(v) + 1) {
            sigma.set(w, sigma.get(w) + sigma.get(v));
            pred.get(w).push(v);
          }
        }
      }

      // Accumulation
      const delta = new Map();
      for (const t of agents) delta.set(t, 0);

      while (stack.length > 0) {
        const w = stack.pop();
        for (const v of pred.get(w)) {
          const d = (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w));
          delta.set(v, delta.get(v) + d);
        }
        if (w !== s) {
          cb.set(w, cb.get(w) + delta.get(w));
        }
      }
    }

    // 归一化: /(n-1)(n-2) / Normalize
    const normFactor = n > 2 ? (n - 1) * (n - 2) : 1;
    for (const [agent, value] of cb) {
      const m = metrics.get(agent);
      if (m) {
        m.betweennessCentrality = Math.round((value / normFactor) * 10000) / 10000;
      }
    }
  }

  /**
   * 持久化 SNA 快照 / Persist SNA snapshots
   * @private
   */
  _persistSnapshots(metrics) {
    if (!this._db || !this._config.persistSnapshots) return;
    const now = Date.now();
    try {
      for (const [agentId, m] of metrics) {
        this._db.run?.(
          `INSERT INTO sna_snapshots (agent_id, degree_centrality, betweenness_centrality, clustering_coefficient, computed_at)
           VALUES (?, ?, ?, ?, ?)`,
          agentId, m.degreeCentrality, m.betweennessCentrality, m.clusteringCoefficient, now,
        );
      }
    } catch { /* non-fatal */ }
  }
}
