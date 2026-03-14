/**
 * HybridRetrieval — 6 维混合检索 / 6-Dimensional Hybrid Retrieval
 *
 * V6.0 新增模块: 实现 swarm base 设计的混合检索公式。
 * V6.0 new module: Implements the hybrid retrieval formula from swarm base design.
 *
 * 6 维评分:
 *   semantic   = 向量余弦相似度 (0.30)    / Vector cosine similarity
 *   temporal   = 时间衰减 e^(-age/30)     / Time decay (Ebbinghaus λ=30)
 *   importance = 重要性 (0.15)             / Importance score
 *   confidence = 置信度 (0.10)             / Confidence score
 *   frequency  = log(1+accessCount)/log(101) (0.10) / Access frequency
 *   context    = 图谱相关性 (0.15)         / Knowledge graph relevance
 *
 * @module L3-agent/hybrid-retrieval
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 默认权重 / Default Weights
// ============================================================================

const DEFAULT_WEIGHTS = {
  semantic: 0.30,
  temporal: 0.20,
  importance: 0.15,
  confidence: 0.10,
  frequency: 0.10,
  context: 0.15,
};

// ============================================================================
// HybridRetrieval
// ============================================================================

export class HybridRetrieval {
  /**
   * @param {Object} deps
   * @param {import('./embedding-engine.js').EmbeddingEngine} deps.embeddingEngine
   * @param {import('./vector-index.js').VectorIndex} deps.vectorIndex
   * @param {Object} [deps.knowledgeRepo] - 知识图谱仓库 (BFS 遍历)
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.logger]
   * @param {Object} [deps.config]
   */
  constructor({ embeddingEngine, vectorIndex, knowledgeRepo, messageBus, logger, config = {} } = {}) {
    this._embeddingEngine = embeddingEngine || null;
    this._vectorIndex = vectorIndex || null;
    this._knowledgeRepo = knowledgeRepo || null;
    this._messageBus = messageBus || null;
    this._logger = logger || console;

    /** @type {Object} 检索权重 / Retrieval weights */
    this._weights = { ...DEFAULT_WEIGHTS, ...config.weights };

    /** @type {number} 查询计数 / Query count */
    this._queryCount = 0;
  }

  // ━━━ 核心 API / Core API ━━━

  /**
   * 混合检索 / Hybrid retrieval
   *
   * @param {Object} params
   * @param {string} params.query - 查询文本
   * @param {string[]} [params.contextNodeIds] - 上下文知识节点 ID (用于图谱相关性)
   * @param {number} [params.topK=20] - 候选数量
   * @param {number} [params.finalK=10] - 最终返回数量
   * @param {Object} [params.filter] - 过滤条件 { sourceTable?: string }
   * @returns {Promise<Array<{ sourceId: string, sourceTable: string, score: number, breakdown: Object }>>}
   */
  async search({ query, contextNodeIds = [], topK = 20, finalK = 10, filter = {} }) {
    this._queryCount++;

    // Phase 1: 向量候选召回 / Vector candidate recall
    let candidates = [];
    if (this._embeddingEngine && this._vectorIndex) {
      try {
        const queryEmbedding = await this._embeddingEngine.embed(query);
        const vectorResults = this._vectorIndex.search(queryEmbedding, topK);

        candidates = vectorResults.map((r) => ({
          sourceId: r.sourceId,
          sourceTable: r.sourceTable,
          vectorSim: 1 - r.distance, // cosine distance → similarity
          metadata: r.metadata || {},
        }));
      } catch (err) {
        this._logger.debug?.(`[HybridRetrieval] Vector search failed: ${err.message}`);
      }
    }

    if (candidates.length === 0) {
      return []; // 无向量检索能力时返回空 / Return empty when no vector search
    }

    // Phase 2: 图谱相关性 (BFS) / Graph relevance (BFS)
    let graphRelevanceMap = new Map();
    if (this._knowledgeRepo && contextNodeIds.length > 0) {
      graphRelevanceMap = this._computeGraphRelevance(contextNodeIds, candidates);
    }

    // Phase 3: 6 维混合评分 / 6-dimensional hybrid scoring
    const scored = candidates.map((c) => {
      const breakdown = this._computeHybridScore(c, graphRelevanceMap.get(c.sourceId) || 0);
      return {
        sourceId: c.sourceId,
        sourceTable: c.sourceTable,
        score: breakdown.total,
        breakdown,
        metadata: c.metadata,
      };
    });

    // 按分数降序排列 / Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // 过滤 / Filter
    let results = scored;
    if (filter.sourceTable) {
      results = results.filter((r) => r.sourceTable === filter.sourceTable);
    }

    const finalResults = results.slice(0, finalK);

    // 发布事件 / Publish event
    this._messageBus?.publish?.(EventTopics.HYBRID_RETRIEVAL_EXECUTED, {
      queryLength: query.length,
      candidateCount: candidates.length,
      resultCount: finalResults.length,
      topScore: finalResults[0]?.score || 0,
      queryCount: this._queryCount,
    });

    return finalResults;
  }

  /**
   * 获取检索统计 / Get retrieval stats
   */
  getStats() {
    return {
      queryCount: this._queryCount,
      weights: { ...this._weights },
      vectorIndexSize: this._vectorIndex?.size?.() || 0,
    };
  }

  // ━━━ 内部方法 / Internal ━━━

  /**
   * 计算 6 维混合分数 / Compute 6-dimensional hybrid score
   *
   * @param {Object} candidate - 候选记忆
   * @param {number} graphRelevance - 图谱相关性 (0-1)
   * @returns {Object} 分数分解 / Score breakdown
   * @private
   */
  _computeHybridScore(candidate, graphRelevance) {
    const w = this._weights;
    const meta = candidate.metadata || {};

    // 1. semantic: 向量余弦相似度
    const semantic = candidate.vectorSim || 0;

    // 2. temporal: 时间衰减 e^(-age/λ), λ=30 天
    const ageDays = meta.ageDays ?? this._computeAgeDays(meta.timestamp || meta.created_at);
    const temporal = Math.exp(-ageDays / 30);

    // 3. importance: 重要性分数
    const importance = meta.importance ?? 0.5;

    // 4. confidence: 置信度分数
    const confidence = meta.confidence ?? 0.5;

    // 5. frequency: 访问频率 (log 归一化)
    const accessCount = meta.accessCount ?? meta.access_count ?? 0;
    const frequency = Math.log(1 + accessCount) / Math.log(101);

    // 6. context: 图谱相关性
    const context = graphRelevance;

    // 加权求和 / Weighted sum
    const total =
      semantic * w.semantic +
      temporal * w.temporal +
      importance * w.importance +
      confidence * w.confidence +
      frequency * w.frequency +
      context * w.context;

    return {
      total: Math.round(total * 10000) / 10000,
      semantic: Math.round(semantic * 1000) / 1000,
      temporal: Math.round(temporal * 1000) / 1000,
      importance: Math.round(importance * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      frequency: Math.round(frequency * 1000) / 1000,
      context: Math.round(context * 1000) / 1000,
    };
  }

  /**
   * 计算图谱相关性 / Compute graph relevance
   *
   * 基于 BFS 深度: depth=0 → 1.0, depth=1 → 0.7, depth=2 → 0.4, depth=3+ → 0.1
   *
   * @param {string[]} seedNodeIds - 上下文种子节点
   * @param {Array<Object>} candidates - 候选列表
   * @returns {Map<string, number>} sourceId → relevance
   * @private
   */
  _computeGraphRelevance(seedNodeIds, candidates) {
    const relevanceMap = new Map();

    if (!this._knowledgeRepo?.getNode) return relevanceMap;

    // BFS 3 层遍历 / BFS 3-level traversal
    const visited = new Set(seedNodeIds);
    let frontier = [...seedNodeIds];
    const depthMap = new Map();

    for (const id of seedNodeIds) depthMap.set(id, 0);

    for (let depth = 0; depth <= 3 && frontier.length > 0; depth++) {
      const nextFrontier = [];
      for (const nodeId of frontier) {
        depthMap.set(nodeId, depth);
        try {
          const node = this._knowledgeRepo.getNode(nodeId);
          const edges = node?.edges || node?.relatedIds || [];
          for (const neighborId of edges) {
            if (!visited.has(neighborId)) {
              visited.add(neighborId);
              nextFrontier.push(neighborId);
            }
          }
        } catch { /* skip invalid nodes */ }
      }
      frontier = nextFrontier;
    }

    // 深度 → 相关性映射 / Depth → relevance mapping
    const depthToRelevance = [1.0, 0.7, 0.4, 0.1];

    for (const candidate of candidates) {
      const depth = depthMap.get(candidate.sourceId);
      if (depth !== undefined) {
        relevanceMap.set(candidate.sourceId, depthToRelevance[Math.min(depth, 3)]);
      }
    }

    return relevanceMap;
  }

  /**
   * 计算年龄天数 / Compute age in days
   * @private
   */
  _computeAgeDays(timestamp) {
    if (!timestamp) return 30; // 默认 30 天 / Default 30 days
    return (Date.now() - timestamp) / 86400000;
  }
}
