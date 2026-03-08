/**
 * EmbeddingEngine — 文本向量化引擎（支持 ONNX / API / Mock 三种模式）
 * Text embedding engine supporting ONNX (local), API (remote), and Mock modes
 *
 * 惰性加载：首次调用 embed() 时才加载模型/建立连接。
 * Mock 模式使用确定性 hash 生成 384 维向量，相同文本始终产生相同向量。
 *
 * Lazy-loading: model / connection is only initialized on first embed() call.
 * Mock mode uses a deterministic hash to produce 384-dim vectors —
 * identical text always yields an identical vector.
 *
 * @module intelligence/memory/embedding-engine
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js';

const DIMENSIONS = 384;

// ─── 确定性 hash 向量生成 / Deterministic hash vector generation ─────
/**
 * 对文本生成确定性 384 维单位向量（仅用于 mock 模式）
 * Generate a deterministic 384-dim unit vector from text (mock mode only)
 * @param {string} text
 * @returns {Float32Array}
 */
function deterministicHashVector(text) {
  const vec = new Float32Array(DIMENSIONS);
  // seed: 简单 hash 初始化 / simple hash seed
  let h = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }

  // 用 seed 驱动伪随机序列填充每一维 / fill each dimension with seeded PRNG
  for (let d = 0; d < DIMENSIONS; d++) {
    // xorshift32
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    // 映射到 [-1, 1] / map to [-1, 1]
    vec[d] = (h >>> 0) / 0xffffffff * 2 - 1;
  }

  // 归一化到单位向量 / normalize to unit vector
  let norm = 0;
  for (let d = 0; d < DIMENSIONS; d++) norm += vec[d] * vec[d];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let d = 0; d < DIMENSIONS; d++) vec[d] /= norm;
  }
  return vec;
}

// ─── EmbeddingEngine ────────────────────────────────────────────────
export class EmbeddingEngine extends ModuleBase {
  static produces() { return []; }
  static consumes() { return []; }
  static publishes() { return []; }
  static subscribes() { return []; }

  /**
   * @param {object} [opts]
   * @param {'onnx'|'api'|'auto'|'mock'} [opts.mode='auto']
   * @param {string} [opts.modelPath]
   * @param {{ endpoint: string, headers?: Record<string,string> }} [opts.apiConfig]
   */
  constructor({ mode = 'auto', modelPath, apiConfig } = {}) {
    super();
    this._mode = mode;
    this._modelPath = modelPath;
    this._apiConfig = apiConfig;
    this._model = null;
    this._loading = null;
    this._loadTimeMs = 0;
    this._resolvedMode = mode === 'auto' ? null : mode;
  }

  /**
   * 惰性初始化模型 / Lazy-init model
   * @returns {Promise<void>}
   */
  async _ensureReady() {
    if (this._model) return;
    if (this._loading) return this._loading;

    this._loading = (async () => {
      const t0 = Date.now();

      if (this._mode === 'mock') {
        this._resolvedMode = 'mock';
        this._model = { type: 'mock' };
        this._loadTimeMs = Date.now() - t0;
        return;
      }

      if (this._mode === 'onnx' || this._mode === 'auto') {
        try {
          const { pipeline } = await import('@xenova/transformers');
          const modelName = this._modelPath || 'Xenova/all-MiniLM-L6-v2';
          this._model = await pipeline('feature-extraction', modelName);
          this._resolvedMode = 'onnx';
          this._loadTimeMs = Date.now() - t0;
          return;
        } catch (err) {
          if (this._mode === 'onnx') throw err;
          // auto fallback
        }
      }

      if (this._mode === 'api' || this._mode === 'auto') {
        if (this._apiConfig?.endpoint) {
          this._resolvedMode = 'api';
          this._model = { type: 'api' };
          this._loadTimeMs = Date.now() - t0;
          return;
        }
        if (this._mode === 'api') {
          throw new Error('EmbeddingEngine: API mode requires apiConfig.endpoint');
        }
      }

      // auto 模式所有后端都不可用，退回 mock / auto fallback to mock
      this._resolvedMode = 'mock';
      this._model = { type: 'mock' };
      this._loadTimeMs = Date.now() - t0;
    })();

    return this._loading;
  }

  /**
   * 对单条文本生成嵌入向量 / Embed a single text
   * @param {string} text
   * @returns {Promise<Float32Array>}
   */
  async embed(text) {
    if (!text || text.trim().length === 0) {
      return new Float32Array(DIMENSIONS);
    }

    await this._ensureReady();

    if (this._resolvedMode === 'mock') {
      return deterministicHashVector(text);
    }

    if (this._resolvedMode === 'onnx') {
      const output = await this._model(text, { pooling: 'mean', normalize: true });
      return new Float32Array(output.data);
    }

    if (this._resolvedMode === 'api') {
      const res = await fetch(this._apiConfig.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this._apiConfig.headers || {}),
        },
        body: JSON.stringify({ input: text }),
      });
      if (!res.ok) throw new Error(`EmbeddingEngine API error: ${res.status}`);
      const json = await res.json();
      const arr = json.data?.[0]?.embedding ?? json.embedding ?? json;
      return new Float32Array(arr);
    }

    throw new Error(`EmbeddingEngine: unknown resolved mode '${this._resolvedMode}'`);
  }

  /**
   * 批量嵌入 / Batch embed
   * @param {string[]} texts
   * @param {number} [batchSize=32]
   * @returns {Promise<Float32Array[]>}
   */
  async embedBatch(texts, batchSize = 32) {
    const results = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await Promise.all(batch.map((t) => this.embed(t)));
      results.push(...embeddings);
    }
    return results;
  }

  /**
   * 余弦相似度 / Cosine similarity between two vectors
   * @param {Float32Array} a
   * @param {Float32Array} b
   * @returns {number} similarity in [-1, 1]
   */
  static cosineSimilarity(a, b) {
    if (a.length !== b.length) throw new Error('Vector dimension mismatch');
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /** 模型是否就绪 / Is the model ready */
  isReady() {
    return this._model !== null;
  }

  /** 模型信息 / Model metadata */
  getModelInfo() {
    return {
      mode: this._resolvedMode || this._mode,
      modelName: this._modelPath || 'default',
      dimensions: DIMENSIONS,
      loadTimeMs: this._loadTimeMs,
    };
  }
}

export default EmbeddingEngine;
