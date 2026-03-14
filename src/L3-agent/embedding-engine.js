/**
 * EmbeddingEngine — 双模式文本嵌入 / Dual-Mode Text Embedding
 *
 * V6.0 新增模块: 支持本地 (Xenova/ONNX) 和 API 两种嵌入模式。
 * V6.0 new module: Supports local (Xenova/ONNX) and API embedding modes.
 *
 * 本地模式: @xenova/transformers, all-MiniLM-L6-v2, 384D, ~50ms/句
 * API 模式: 配置的 LLM embedding endpoint, 1536D
 *
 * 懒加载: 首次 embed() 时初始化模型 (Promise 缓存防竞态)
 *
 * @module L3-agent/embedding-engine
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 默认配置 / Default Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  mode: 'local',                         // 'local' | 'api'
  localModel: 'Xenova/all-MiniLM-L6-v2', // 本地模型 / Local model
  dimensions: 384,                        // 本地维度 / Local dimensions
  apiEndpoint: null,                      // API 端点 / API endpoint
  apiKey: null,                           // API 密钥 / API key
  apiDimensions: 1536,                    // API 维度 / API dimensions
  apiModel: 'text-embedding-ada-002',     // API 模型名 / API model name
};

// ============================================================================
// EmbeddingEngine
// ============================================================================

export class EmbeddingEngine {
  /**
   * @param {Object} deps
   * @param {Object} [deps.config]
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.logger]
   */
  constructor({ config = {}, messageBus, logger } = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._messageBus = messageBus || null;
    this._logger = logger || console;

    /** @type {number} 当前嵌入维度 / Current embedding dimensions */
    this.dimensions = this._config.mode === 'api'
      ? this._config.apiDimensions
      : this._config.dimensions;

    /** @type {Promise<any>|null} 模型加载 Promise (防竞态) / Model loading promise (race prevention) */
    this._modelPromise = null;

    /** @type {any|null} 加载后的 pipeline / Loaded pipeline */
    this._pipeline = null;

    /** @type {boolean} */
    this._ready = false;

    /** @type {number} 嵌入计数 / Embedding count */
    this._embedCount = 0;
  }

  // ━━━ 核心 API / Core API ━━━

  /**
   * 嵌入单个文本 / Embed a single text
   *
   * @param {string} text
   * @returns {Promise<Float32Array>} 嵌入向量 / Embedding vector
   */
  async embed(text) {
    await this._ensureModel();

    if (this._config.mode === 'api') {
      return this._embedViaAPI(text);
    }

    return this._embedLocal(text);
  }

  /**
   * 批量嵌入 / Batch embed
   *
   * @param {string[]} texts
   * @returns {Promise<Float32Array[]>}
   */
  async batchEmbed(texts) {
    await this._ensureModel();

    if (this._config.mode === 'api') {
      // API 模式逐个处理 (避免批量请求过大)
      const results = [];
      for (const text of texts) {
        results.push(await this._embedViaAPI(text));
      }
      return results;
    }

    // 本地模式可批量
    return this._embedLocalBatch(texts);
  }

  /**
   * 获取引擎状态 / Get engine status
   */
  getStatus() {
    return {
      mode: this._config.mode,
      dimensions: this.dimensions,
      ready: this._ready,
      embedCount: this._embedCount,
      model: this._config.mode === 'local' ? this._config.localModel : this._config.apiModel,
    };
  }

  /**
   * 关闭引擎 / Close engine
   */
  destroy() {
    this._pipeline = null;
    this._modelPromise = null;
    this._ready = false;
  }

  // ━━━ 内部方法 / Internal ━━━

  /**
   * 确保模型已加载 (Promise 缓存防竞态)
   * Ensure model is loaded (Promise cache prevents race condition)
   *
   * @private
   */
  async _ensureModel() {
    if (this._ready) return;

    if (!this._modelPromise) {
      this._modelPromise = this._loadModel().catch((err) => {
        this._modelPromise = null; // 加载失败时清除缓存 / Clear cache on failure
        throw err;
      });
    }

    await this._modelPromise;
  }

  /**
   * 加载模型 / Load model
   * @private
   */
  async _loadModel() {
    if (this._config.mode === 'local') {
      try {
        const { pipeline } = await import('@xenova/transformers');
        this._pipeline = await pipeline('feature-extraction', this._config.localModel);
        this._ready = true;

        this._messageBus?.publish?.(EventTopics.EMBEDDING_MODEL_LOADED, {
          mode: 'local',
          model: this._config.localModel,
          dimensions: this._config.dimensions,
        });

        this._logger.info?.(
          `[EmbeddingEngine] Local model loaded: ${this._config.localModel} (${this._config.dimensions}D)`,
        );
      } catch (err) {
        this._logger.warn?.(
          `[EmbeddingEngine] Local model load failed (is @xenova/transformers installed?): ${err.message}`,
        );
        throw err;
      }
    } else {
      // API 模式不需要预加载模型 / API mode doesn't need preloading
      if (!this._config.apiEndpoint) {
        throw new Error('[EmbeddingEngine] API mode requires apiEndpoint config');
      }
      this._ready = true;

      this._messageBus?.publish?.(EventTopics.EMBEDDING_MODEL_LOADED, {
        mode: 'api',
        endpoint: this._config.apiEndpoint,
        dimensions: this._config.apiDimensions,
      });

      this._logger.info?.(`[EmbeddingEngine] API mode ready: ${this._config.apiEndpoint}`);
    }
  }

  /**
   * 本地嵌入 / Local embedding
   * @private
   */
  async _embedLocal(text) {
    const output = await this._pipeline(text, { pooling: 'mean', normalize: true });
    this._embedCount++;
    return new Float32Array(output.data);
  }

  /**
   * 本地批量嵌入 / Local batch embedding
   * @private
   */
  async _embedLocalBatch(texts) {
    const results = [];
    for (const text of texts) {
      const output = await this._pipeline(text, { pooling: 'mean', normalize: true });
      results.push(new Float32Array(output.data));
    }
    this._embedCount += texts.length;
    return results;
  }

  /**
   * API 嵌入 / API embedding
   * @private
   */
  async _embedViaAPI(text) {
    const response = await fetch(this._config.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this._config.apiKey ? { Authorization: `Bearer ${this._config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        input: text,
        model: this._config.apiModel,
      }),
    });

    if (!response.ok) {
      throw new Error(`[EmbeddingEngine] API error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const embedding = data.data?.[0]?.embedding || data.embedding;
    if (!embedding) {
      throw new Error('[EmbeddingEngine] Invalid API response: no embedding data');
    }

    this._embedCount++;
    return new Float32Array(embedding);
  }

  // ━━━ 工具方法 / Utility ━━━

  /**
   * 余弦相似度 / Cosine similarity
   *
   * @param {Float32Array} a
   * @param {Float32Array} b
   * @returns {number} -1 到 1 / -1 to 1
   */
  static cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }
}
