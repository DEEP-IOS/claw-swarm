/**
 * RoleDiscovery -- DRDA 数据驱动角色发现算法 / Data-driven Role Discovery Algorithm
 *
 * V5.0 新增模块, 基于 k-means++ 聚类从 Agent 行为轨迹中自动发现角色:
 * V5.0 new module, auto-discovers roles from agent behavior via k-means++ clustering:
 *
 * Step 1: 编码 Agent 行动轨迹 → 特征向量
 *         Encode agent action trajectories → feature vectors
 * Step 2: K-means++ 聚类 (L2 距离, 收敛阈值 0.001)
 *         K-means++ clustering (L2 distance, convergence threshold 0.001)
 * Step 3: 从簇质心推导角色模板
 *         Derive role templates from cluster centroids
 *
 * 设计来源 / Design source:
 * - design_role_creation.md: DRDA 角色发现算法
 * - Orchestration layer: role templates integrated with RoleManager
 *
 * @module L4-orchestration/role-discovery
 * @author DEEP-IOS
 */

import { nanoid } from 'nanoid';
import { CapabilityDimension } from '../L1-infrastructure/types.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认聚类数 / Default cluster count */
const DEFAULT_K = 3;

/** 默认最大迭代次数 / Default maximum iterations */
const DEFAULT_MAX_ITERATIONS = 100;

/** 默认收敛阈值 / Default convergence threshold */
const DEFAULT_CONVERGENCE_THRESHOLD = 0.001;

/**
 * 特征向量维度名 (8D 能力维度)
 * Feature vector dimension names (8D capability dimensions)
 * @type {string[]}
 */
const FEATURE_DIMENSIONS = [
  CapabilityDimension.coding,
  CapabilityDimension.architecture,
  CapabilityDimension.testing,
  CapabilityDimension.documentation,
  CapabilityDimension.security,
  CapabilityDimension.performance,
  CapabilityDimension.communication,
  CapabilityDimension.domain,
];

/** 特征向量长度 / Feature vector length */
const VECTOR_LENGTH = FEATURE_DIMENSIONS.length;

// ============================================================================
// 内部类型 / Internal Types
// ============================================================================

/**
 * @typedef {Object} DiscoveredRole
 * 发现的角色模板 / Discovered role template
 * @property {string} id - 角色 ID / Role ID
 * @property {string} name - 自动命名 / Auto-generated name
 * @property {number[]} centroid - 质心向量 / Centroid vector
 * @property {Record<string, number>} capabilities - 8D 能力分数 / 8D capability scores
 * @property {string[]} memberAgentIds - 成员 Agent ID / Member agent IDs
 * @property {number} clusterSize - 簇大小 / Cluster size
 */

/**
 * @typedef {Object} ClusteringResult
 * 聚类结果 / Clustering result
 * @property {number[][]} centroids - 质心向量列表 / Centroid vector list
 * @property {number[]} assignments - 每个数据点的簇分配 / Cluster assignment per data point
 * @property {boolean} converged - 是否收敛 / Whether converged
 * @property {number} iterations - 实际迭代次数 / Actual iterations
 */

// ============================================================================
// RoleDiscovery 主类 / Main Class
// ============================================================================

export class RoleDiscovery {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {import('../L1-infrastructure/database/repositories/agent-repo.js').AgentRepository} deps.agentRepo
   *   Agent 数据仓库, 用于获取 Agent 能力数据 / Agent repo for capability data
   * @param {import('./role-manager.js').RoleManager} [deps.roleManager]
   *   角色管理器, 用于注册发现的模板 / Role manager for registering templates
   * @param {import('../L2-communication/message-bus.js').MessageBus} [deps.messageBus]
   *   消息总线 / Message bus for event broadcasting
   * @param {Object} [deps.logger]
   */
  constructor({ agentRepo, roleManager, messageBus, logger } = {}) {
    /** @type {import('../L1-infrastructure/database/repositories/agent-repo.js').AgentRepository} */
    this._agentRepo = agentRepo;

    /** @type {import('./role-manager.js').RoleManager | null} */
    this._roleManager = roleManager || null;

    /** @type {import('../L2-communication/message-bus.js').MessageBus | null} */
    this._messageBus = messageBus || null;

    /** @type {Object} */
    this._logger = logger || console;
  }

  // ━━━ 核心 API / Core API ━━━

  /**
   * 执行角色发现 (主入口)
   * Execute role discovery (main entry point)
   *
   * 流程 / Flow:
   * 1. 编码每个 Agent 的能力+行为 → 特征向量 / Encode agents → feature vectors
   * 2. K-means++ 聚类 / K-means++ clustering
   * 3. 从质心推导角色模板 / Derive role templates from centroids
   * 4. (可选) 注册到 RoleManager / Optionally register to RoleManager
   *
   * @param {Array<Object>} agents - Agent 配置列表 / Agent profile list
   * @param {Object} [options]
   * @param {number} [options.k=3] - 聚类数 / Number of clusters
   * @param {number} [options.maxIterations=100] - 最大迭代 / Max iterations
   * @param {number} [options.convergenceThreshold=0.001] - 收敛阈值 / Convergence threshold
   * @returns {DiscoveredRole[]} 发现的角色列表 / List of discovered roles
   */
  discover(agents, options = {}) {
    const k = options.k ?? DEFAULT_K;
    const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const convergenceThreshold = options.convergenceThreshold ?? DEFAULT_CONVERGENCE_THRESHOLD;

    if (!agents || agents.length === 0) {
      this._logger.warn?.('[RoleDiscovery] 无 Agent 可聚类 / No agents to cluster');
      return [];
    }

    // K 不能大于样本数 / K cannot exceed sample count
    const effectiveK = Math.min(k, agents.length);

    if (effectiveK < 2) {
      this._logger.info?.('[RoleDiscovery] Agent 数量不足, 直接返回单一角色 / Too few agents, returning single role');
      const vector = this.encodeAgent(agents[0]);
      const role = this.centroidToTemplate(vector, agents);
      return [role];
    }

    this._logger.info?.(
      `[RoleDiscovery] 开始 DRDA 角色发现: ${agents.length} agents, k=${effectiveK} / Starting DRDA role discovery`,
    );

    // Step 1: 编码 / Encode
    const vectors = agents.map(agent => this.encodeAgent(agent));

    // Step 2: K-means++ 聚类 / Clustering
    const { centroids, assignments, converged, iterations } = this.kMeansClustering(
      vectors,
      effectiveK,
      { maxIterations, threshold: convergenceThreshold },
    );

    this._logger.info?.(
      `[RoleDiscovery] 聚类完成: converged=${converged}, iterations=${iterations} / Clustering done`,
    );

    // Step 3: 推导角色模板 / Derive role templates
    const discoveredRoles = [];

    for (let c = 0; c < centroids.length; c++) {
      // 收集属于该簇的 Agent / Collect agents in this cluster
      const clusterMembers = agents.filter((_, idx) => assignments[idx] === c);
      if (clusterMembers.length === 0) continue;

      const role = this.centroidToTemplate(centroids[c], clusterMembers);
      discoveredRoles.push(role);

      // 注册到 RoleManager / Register with RoleManager
      if (this._roleManager && typeof this._roleManager.registerTemplate === 'function') {
        try {
          this._roleManager.registerTemplate(role);
        } catch (err) {
          this._logger.warn?.(`[RoleDiscovery] 注册角色模板失败 / Template registration failed: ${err.message}`);
        }
      }
    }

    // 广播事件 / Broadcast event
    this._emit('roleDiscovery.completed', {
      agentCount: agents.length,
      k: effectiveK,
      rolesDiscovered: discoveredRoles.length,
      converged,
      iterations,
      roles: discoveredRoles.map(r => ({ id: r.id, name: r.name, clusterSize: r.clusterSize })),
    });

    return discoveredRoles;
  }

  /**
   * 编码 Agent 为特征向量
   * Encode agent profile into feature vector
   *
   * 将 Agent 的 8D 能力维度编码为固定长度数值向量。
   * Encodes the agent's 8D capability dimensions into a fixed-length numeric vector.
   *
   * @param {Object} agentProfile - Agent 配置 / Agent profile
   * @returns {number[]} 特征向量 (长度=8) / Feature vector (length=8)
   */
  encodeAgent(agentProfile) {
    const capabilities = agentProfile.capabilities || {};
    const vector = new Array(VECTOR_LENGTH);

    for (let i = 0; i < VECTOR_LENGTH; i++) {
      const dim = FEATURE_DIMENSIONS[i];
      const value = capabilities[dim];

      if (typeof value === 'number' && isFinite(value)) {
        // 归一化到 [0, 1] / Normalize to [0, 1]
        vector[i] = Math.max(0, Math.min(1, value));
      } else {
        // 默认中间值 / Default midpoint
        vector[i] = 0.5;
      }
    }

    return vector;
  }

  // ━━━ K-Means++ 聚类 / K-Means++ Clustering ━━━

  /**
   * K-Means++ 聚类算法
   * K-Means++ clustering algorithm
   *
   * 初始化: K-means++ (D^2 加权概率选取初始质心)
   * Initialization: K-means++ (D^2 weighted probability for initial centroids)
   *
   * 迭代: Lloyd's 算法 (分配→更新质心→检查收敛)
   * Iteration: Lloyd's algorithm (assign → update centroids → check convergence)
   *
   * 距离: L2 欧氏距离 / Distance metric: L2 Euclidean
   *
   * @param {number[][]} vectors - 特征向量集合 / Feature vector set
   * @param {number} k - 聚类数 / Number of clusters
   * @param {Object} [options]
   * @param {number} [options.maxIterations=100] - 最大迭代次数 / Max iterations
   * @param {number} [options.threshold=0.001] - 收敛阈值 / Convergence threshold
   * @returns {ClusteringResult}
   */
  kMeansClustering(vectors, k, options = {}) {
    const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const threshold = options.threshold ?? DEFAULT_CONVERGENCE_THRESHOLD;

    // K-means++ 初始化 / K-means++ initialization
    let centroids = this._kMeansPPInit(vectors, k);
    let assignments = new Array(vectors.length).fill(0);
    let converged = false;
    let iterations = 0;

    // Lloyd's 迭代 / Lloyd's iterations
    for (let iter = 0; iter < maxIterations; iter++) {
      iterations++;

      // 分配阶段: 每个点分配到最近质心 / Assignment: each point to nearest centroid
      const newAssignments = vectors.map(v => this._findNearestCentroid(v, centroids));

      // 更新阶段: 重新计算质心 / Update: recompute centroids
      const newCentroids = this._computeCentroids(vectors, newAssignments, k);

      // 检查收敛 / Check convergence
      const maxShift = this._computeMaxCentroidShift(centroids, newCentroids);

      centroids = newCentroids;
      assignments = newAssignments;

      if (maxShift < threshold) {
        converged = true;
        break;
      }
    }

    return { centroids, assignments, converged, iterations };
  }

  /**
   * 从质心推导角色模板
   * Derive role template from cluster centroid
   *
   * @param {number[]} centroid - 质心向量 / Centroid vector
   * @param {Array<Object>} clusterMembers - 簇内成员 / Cluster members
   * @returns {DiscoveredRole}
   */
  centroidToTemplate(centroid, clusterMembers) {
    // 构建 8D 能力映射 / Build 8D capability mapping
    const capabilities = {};
    for (let i = 0; i < VECTOR_LENGTH; i++) {
      capabilities[FEATURE_DIMENSIONS[i]] = Number(centroid[i].toFixed(4));
    }

    // 寻找主导维度以命名 / Find dominant dimension for naming
    const dominantIdx = centroid.reduce(
      (maxIdx, val, idx, arr) => (val > arr[maxIdx] ? idx : maxIdx),
      0,
    );
    const dominantDim = FEATURE_DIMENSIONS[dominantIdx];

    // 提取成员 ID / Extract member IDs
    const memberAgentIds = clusterMembers.map(m => m.id).filter(Boolean);

    return {
      id: `drda-${nanoid(8)}`,
      name: `discovered-${dominantDim}`,
      centroid: [...centroid],
      capabilities,
      memberAgentIds,
      clusterSize: clusterMembers.length,
    };
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * K-means++ 初始化: D^2 加权概率选择初始质心
   * K-means++ initialization: D^2 weighted probability for initial centroids
   *
   * @param {number[][]} vectors
   * @param {number} k
   * @returns {number[][]} 初始质心 / Initial centroids
   * @private
   */
  _kMeansPPInit(vectors, k) {
    const n = vectors.length;
    const centroids = [];

    // 随机选第一个质心 / Random first centroid
    const firstIdx = Math.floor(Math.random() * n);
    centroids.push([...vectors[firstIdx]]);

    // D^2 加权选取后续质心 / D^2 weighted selection for remaining
    for (let c = 1; c < k; c++) {
      // 计算每个点到最近质心的距离平方 / Compute D^2 for each point
      const distances = vectors.map(v => {
        let minDist = Infinity;
        for (const centroid of centroids) {
          const d = this._l2Distance(v, centroid);
          if (d < minDist) minDist = d;
        }
        return minDist * minDist;
      });

      // 按 D^2 概率选取 / Select by D^2 probability
      const totalDist = distances.reduce((sum, d) => sum + d, 0);

      if (totalDist <= 0) {
        // 所有点重合, 随机选 / All points coincide, random pick
        const randIdx = Math.floor(Math.random() * n);
        centroids.push([...vectors[randIdx]]);
        continue;
      }

      const rand = Math.random() * totalDist;
      let cumulative = 0;
      let selectedIdx = n - 1;

      for (let i = 0; i < n; i++) {
        cumulative += distances[i];
        if (rand <= cumulative) {
          selectedIdx = i;
          break;
        }
      }

      centroids.push([...vectors[selectedIdx]]);
    }

    return centroids;
  }

  /**
   * 寻找最近质心索引
   * Find nearest centroid index
   *
   * @param {number[]} vector
   * @param {number[][]} centroids
   * @returns {number} 质心索引 / Centroid index
   * @private
   */
  _findNearestCentroid(vector, centroids) {
    let minDist = Infinity;
    let minIdx = 0;

    for (let c = 0; c < centroids.length; c++) {
      const dist = this._l2Distance(vector, centroids[c]);
      if (dist < minDist) {
        minDist = dist;
        minIdx = c;
      }
    }

    return minIdx;
  }

  /**
   * 重新计算每个簇的质心
   * Recompute centroid for each cluster
   *
   * @param {number[][]} vectors
   * @param {number[]} assignments
   * @param {number} k
   * @returns {number[][]}
   * @private
   */
  _computeCentroids(vectors, assignments, k) {
    const dim = vectors[0]?.length || VECTOR_LENGTH;
    const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
    const counts = new Array(k).fill(0);

    for (let i = 0; i < vectors.length; i++) {
      const cluster = assignments[i];
      counts[cluster]++;
      for (let d = 0; d < dim; d++) {
        sums[cluster][d] += vectors[i][d];
      }
    }

    // 计算均值; 空簇保持不变 / Compute mean; empty clusters stay unchanged
    return sums.map((sum, c) => {
      if (counts[c] === 0) return sum;
      return sum.map(v => v / counts[c]);
    });
  }

  /**
   * 计算质心的最大位移量 (用于收敛判定)
   * Compute maximum centroid shift (for convergence check)
   *
   * @param {number[][]} oldCentroids
   * @param {number[][]} newCentroids
   * @returns {number}
   * @private
   */
  _computeMaxCentroidShift(oldCentroids, newCentroids) {
    let maxShift = 0;
    const len = Math.min(oldCentroids.length, newCentroids.length);

    for (let c = 0; c < len; c++) {
      const shift = this._l2Distance(oldCentroids[c], newCentroids[c]);
      if (shift > maxShift) maxShift = shift;
    }

    return maxShift;
  }

  /**
   * L2 欧氏距离
   * L2 Euclidean distance
   *
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number}
   * @private
   */
  _l2Distance(a, b) {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
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
        this._messageBus.publish(topic, data, { senderId: 'role-discovery' });
      } catch {
        // 忽略消息总线错误 / Ignore message bus errors
      }
    }
  }
}
