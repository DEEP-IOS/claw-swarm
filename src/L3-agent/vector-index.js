/**
 * VectorIndex — HNSW 向量索引封装 / HNSW Vector Index Wrapper
 *
 * V6.0 新增模块: 基于 usearch 的高性能向量近似最近邻搜索。
 * V6.0 new module: High-performance approximate nearest neighbor search using usearch.
 *
 * Graceful degradation: 当 usearch 不可用时降级到暴力线性搜索。
 * When usearch is unavailable, falls back to brute-force linear search.
 *
 * @module L3-agent/vector-index
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 默认配置 / Default Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  maxElements: 50000,
  metric: 'cos',       // 'cos' | 'l2' | 'ip'
  dimensions: 384,
  connectivity: 16,    // HNSW M parameter
  efConstruction: 200, // HNSW ef_construction
};

// ============================================================================
// VectorIndex
// ============================================================================

export class VectorIndex {
  /**
   * @param {Object} deps
   * @param {Object} [deps.config]
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.logger]
   * @param {Object} [deps.db] - DatabaseManager for vector_index_meta
   */
  constructor({ config = {}, messageBus, logger, db } = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._messageBus = messageBus || null;
    this._logger = logger || console;
    this._db = db || null;

    /** @type {any|null} usearch Index instance */
    this._index = null;

    /** @type {boolean} usearch 可用 / usearch available */
    this._useHNSW = false;

    /** @type {Map<number, { sourceTable: string, sourceId: string, metadata: Object }>} ID → metadata */
    this._metadata = new Map();

    /** @type {Map<number, Float32Array>} fallback: ID → vector (当 usearch 不可用时) */
    this._vectors = new Map();

    /** @type {number} 自增 ID / Auto-increment ID */
    this._nextId = 0;

    /** @type {Map<string, number>} sourceKey → vectorId (防重复) / Dedup map */
    this._sourceIndex = new Map();
  }

  // ━━━ 生命周期 / Lifecycle ━━━

  /**
   * 初始化索引 / Initialize index
   */
  async init() {
    try {
      const usearch = await import('usearch');
      this._index = new usearch.Index({
        metric: this._config.metric,
        dimensions: this._config.dimensions,
        connectivity: this._config.connectivity,
        efConstruction: this._config.efConstruction,
      });
      this._index.reserve(this._config.maxElements);
      this._useHNSW = true;
      this._logger.info?.(
        `[VectorIndex] HNSW initialized — dim=${this._config.dimensions}, max=${this._config.maxElements}`,
      );
    } catch {
      this._useHNSW = false;
      this._logger.info?.('[VectorIndex] usearch not available — using brute-force fallback');
    }

    // 恢复元数据 / Restore metadata from DB
    this._restoreMetadata();
  }

  /**
   * 获取当前索引维度 / Get current index dimensions
   */
  getDimensions() {
    return this._config.dimensions;
  }

  /**
   * 获取索引大小 / Get index size
   */
  size() {
    return this._useHNSW ? (this._index?.size?.() || 0) : this._vectors.size;
  }

  // ━━━ 核心操作 / Core Operations ━━━

  /**
   * 插入或更新向量 / Upsert vector
   *
   * @param {Object} entry
   * @param {string} entry.sourceTable - 来源表 (e.g., 'memories', 'knowledge_nodes')
   * @param {string} entry.sourceId - 来源 ID
   * @param {Float32Array} entry.embedding - 嵌入向量
   * @param {Object} [entry.metadata] - 附加元数据
   * @returns {number} vectorId
   */
  upsert({ sourceTable, sourceId, embedding, metadata = {} }) {
    const sourceKey = `${sourceTable}:${sourceId}`;
    let vectorId = this._sourceIndex.get(sourceKey);

    if (vectorId === undefined) {
      vectorId = this._nextId++;
      this._sourceIndex.set(sourceKey, vectorId);
    }

    // 存储向量
    if (this._useHNSW) {
      try {
        this._index.add(vectorId, embedding);
      } catch (err) {
        this._logger.debug?.(`[VectorIndex] HNSW add failed: ${err.message}`);
        // fallback to brute force for this entry
        this._vectors.set(vectorId, embedding);
      }
    } else {
      this._vectors.set(vectorId, embedding);
    }

    // 存储元数据
    this._metadata.set(vectorId, { sourceTable, sourceId, ...metadata });

    // 持久化到 DB
    this._persistMeta(vectorId, sourceTable, sourceId, embedding.length);

    return vectorId;
  }

  /**
   * 搜索最近邻 / Search nearest neighbors
   *
   * @param {Float32Array} queryEmbedding - 查询向量
   * @param {number} [topK=20] - 返回数量
   * @returns {Array<{ vectorId: number, distance: number, sourceTable: string, sourceId: string, metadata: Object }>}
   */
  search(queryEmbedding, topK = 20) {
    if (this._useHNSW && this._index && this._index.size() > 0) {
      return this._searchHNSW(queryEmbedding, topK);
    }
    return this._searchBruteForce(queryEmbedding, topK);
  }

  /**
   * 清空索引 / Clear index
   */
  async clear() {
    if (this._useHNSW && this._index) {
      try {
        // 重新初始化 / Re-initialize
        const usearch = await import('usearch');
        this._index = new usearch.Index({
          metric: this._config.metric,
          dimensions: this._config.dimensions,
          connectivity: this._config.connectivity,
          efConstruction: this._config.efConstruction,
        });
        this._index.reserve(this._config.maxElements);
      } catch {
        this._useHNSW = false;
      }
    }

    this._vectors.clear();
    this._metadata.clear();
    this._sourceIndex.clear();
    this._nextId = 0;

    // 清除 DB 元数据
    if (this._db) {
      try {
        this._db.run?.('DELETE FROM vector_index_meta');
      } catch { /* non-fatal */ }
    }

    this._logger.info?.('[VectorIndex] Index cleared');
  }

  /**
   * 销毁索引 / Destroy index
   */
  destroy() {
    this._index = null;
    this._vectors.clear();
    this._metadata.clear();
    this._sourceIndex.clear();
  }

  // ━━━ 内部方法 / Internal ━━━

  /**
   * HNSW 搜索 / HNSW search
   * @private
   */
  _searchHNSW(queryEmbedding, topK) {
    try {
      const results = this._index.search(queryEmbedding, topK);
      const matches = [];

      // usearch 返回 { keys, distances }
      const keys = results.keys || [];
      const distances = results.distances || [];

      for (let i = 0; i < keys.length; i++) {
        const vectorId = keys[i];
        const meta = this._metadata.get(vectorId);
        if (!meta) continue;

        matches.push({
          vectorId,
          distance: distances[i],
          sourceTable: meta.sourceTable,
          sourceId: meta.sourceId,
          metadata: meta,
        });
      }

      return matches;
    } catch (err) {
      this._logger.debug?.(`[VectorIndex] HNSW search failed, fallback: ${err.message}`);
      return this._searchBruteForce(queryEmbedding, topK);
    }
  }

  /**
   * 暴力搜索 (fallback) / Brute-force search (fallback)
   * @private
   */
  _searchBruteForce(queryEmbedding, topK) {
    const scored = [];

    for (const [vectorId, vector] of this._vectors) {
      const similarity = this._cosineSimilarity(queryEmbedding, vector);
      scored.push({ vectorId, distance: 1 - similarity }); // cosine distance
    }

    scored.sort((a, b) => a.distance - b.distance);
    const topResults = scored.slice(0, topK);

    return topResults.map(({ vectorId, distance }) => {
      const meta = this._metadata.get(vectorId) || {};
      return {
        vectorId,
        distance,
        sourceTable: meta.sourceTable || '',
        sourceId: meta.sourceId || '',
        metadata: meta,
      };
    });
  }

  /**
   * 余弦相似度 / Cosine similarity
   * @private
   */
  _cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  /**
   * 持久化元数据 / Persist metadata to DB
   * @private
   */
  _persistMeta(vectorId, sourceTable, sourceId, dimensions) {
    if (!this._db) return;
    try {
      this._db.run?.(
        `INSERT OR REPLACE INTO vector_index_meta (vector_id, source_table, source_id, dimensions, embedded_at)
         VALUES (?, ?, ?, ?, ?)`,
        vectorId, sourceTable, sourceId, dimensions, Date.now(),
      );
    } catch { /* non-fatal */ }
  }

  /**
   * 从 DB 恢复元数据 / Restore metadata from DB
   * @private
   */
  _restoreMetadata() {
    if (!this._db) return;
    try {
      const rows = this._db.all?.('SELECT * FROM vector_index_meta') || [];
      for (const row of rows) {
        const vectorId = row.vector_id;
        this._metadata.set(vectorId, {
          sourceTable: row.source_table,
          sourceId: row.source_id,
        });
        this._sourceIndex.set(`${row.source_table}:${row.source_id}`, vectorId);
        if (vectorId >= this._nextId) this._nextId = vectorId + 1;
      }
      this._logger.debug?.(`[VectorIndex] Restored ${rows.length} metadata entries from DB`);
    } catch { /* non-fatal */ }
  }
}
