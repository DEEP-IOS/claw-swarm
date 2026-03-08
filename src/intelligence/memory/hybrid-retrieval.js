/**
 * HybridRetrieval — 混合检索引擎（6维评分）
 * Hybrid retrieval engine with 6-dimensional scoring
 *
 * 融合向量检索、语义推理和信号场信息，通过 recency / relevance / frequency /
 * quality / diversity / novelty 六维加权评分产出最优检索结果。
 *
 * Fuses vector retrieval, semantic inference, and signal-field information.
 * Candidates are scored along six weighted dimensions: recency, relevance,
 * frequency, quality, diversity, and novelty.
 *
 * @module intelligence/memory/hybrid-retrieval
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js';
import { DIM_KNOWLEDGE } from '../../core/field/types.js';
import { EmbeddingEngine } from './embedding-engine.js';

// --- Default weights -----------------------------------------------------
const DEFAULT_WEIGHTS = Object.freeze({
  recency:   0.15,
  relevance: 0.35,
  frequency: 0.10,
  quality:   0.20,
  diversity: 0.10,
  novelty:   0.10,
});

const DAY_MS = 86_400_000;

// --- HybridRetrieval -----------------------------------------------------
export class HybridRetrieval extends ModuleBase {
  static produces()   { return []; }
  static consumes()   { return [DIM_KNOWLEDGE]; }
  static publishes()  { return []; }
  static subscribes() { return []; }

  /**
   * @param {object} opts
   * @param {import('./episodic-memory.js').EpisodicMemory} opts.episodicMemory
   * @param {import('./semantic-memory.js').SemanticMemory} opts.semanticMemory
   * @param {import('./vector-index.js').VectorIndex} opts.vectorIndex
   * @param {import('./embedding-engine.js').EmbeddingEngine} opts.embeddingEngine
   * @param {import('../../core/field/signal-store.js').SignalStore} opts.field
   */
  constructor({ episodicMemory, semanticMemory, vectorIndex, embeddingEngine, field }) {
    super();
    this._episodicMemory  = episodicMemory;
    this._semanticMemory  = semanticMemory;
    this._vectorIndex     = vectorIndex;
    this._embeddingEngine = embeddingEngine;
    this._field           = field;

    /** @type {Map<string, number>} episodeId -> retrieval count */
    this._retrievalCounts = new Map();
  }

  // --- Core Search --------------------------------------------------------

  /**
   * 混合检索 / Hybrid search with 6-dimensional scoring
   *
   * @param {string} query
   * @param {object} [options]
   * @param {number} [options.topK=5]
   * @param {object} [options.weights]     - override default weights
   * @param {string} [options.role]
   * @param {string} [options.scope]
   * @returns {Promise<Array<{ episode: object, score: number, breakdown: object }>>}
   */
  async search(query, options = {}) {
    const { topK = 5, weights: userWeights, role, scope } = options;
    const weights = { ...DEFAULT_WEIGHTS, ...userWeights };

    // 1. Vector retrieval
    const queryEmbedding = await this._embeddingEngine.embed(query);
    const vectorResults  = this._vectorIndex.search(queryEmbedding, topK * 5);

    // 2. Semantic relations (shallow, depth=1)
    const semanticRelated = this._semanticMemory.inferRelated(query, 1);

    // 3. Field signal context
    const fieldSignals = scope
      ? this._field.query({ dimension: DIM_KNOWLEDGE, scope })
      : [];

    // 4. Build candidate map (deduplicate by id)
    const candidateMap = new Map();
    for (const vr of vectorResults) {
      candidateMap.set(vr.id, { vectorScore: vr.score });
    }
    // Enrich with semantic hits
    for (const sr of semanticRelated) {
      if (!candidateMap.has(sr.entity)) {
        candidateMap.set(sr.entity, { vectorScore: 0 });
      }
    }

    // 5. Fetch episodes and compute 6-dim scores
    const now = Date.now();
    const totalRetrievals = this._totalRetrievals();
    const avgRetrievalCount = totalRetrievals > 0
      ? totalRetrievals / Math.max(this._retrievalCounts.size, 1)
      : 1;

    const scored = [];

    for (const [id, meta] of candidateMap) {
      const episodes = await this._episodicMemory.query(id, { topK: 1 });
      const ep = episodes[0];
      if (!ep) continue;
      if (role && ep.role !== role) continue;

      const age = now - (ep.recordedAt || now);
      const retrievalCount = this._retrievalCounts.get(ep.id) || 0;

      const breakdown = {
        recency:   1 / (1 + age / DAY_MS),
        relevance: meta.vectorScore || 0,
        frequency: totalRetrievals > 0 ? retrievalCount / totalRetrievals : 0,
        quality:   ep.quality || 0,
        diversity: 0, // computed in pass 2
        novelty:   1 - (retrievalCount / Math.max(avgRetrievalCount, 1)),
      };

      // Clamp novelty to [0, 1]
      breakdown.novelty = Math.max(0, Math.min(1, breakdown.novelty));

      scored.push({ episode: ep, breakdown });
    }

    // 6. Compute diversity (Jaccard distance from already-scored results)
    for (let i = 0; i < scored.length; i++) {
      if (i === 0) {
        scored[i].breakdown.diversity = 1;
        continue;
      }
      const currentTags = new Set(scored[i].episode.tags || []);
      let maxDist = 0;
      for (let j = 0; j < i; j++) {
        const otherTags = new Set(scored[j].episode.tags || []);
        const intersection = [...currentTags].filter((t) => otherTags.has(t)).length;
        const union = new Set([...currentTags, ...otherTags]).size;
        const jaccard = union > 0 ? intersection / union : 0;
        maxDist = Math.max(maxDist, 1 - jaccard);
      }
      scored[i].breakdown.diversity = maxDist;
    }

    // 7. Weighted sum -> sort -> topK
    for (const item of scored) {
      item.score =
        weights.recency   * item.breakdown.recency   +
        weights.relevance * item.breakdown.relevance +
        weights.frequency * item.breakdown.frequency +
        weights.quality   * item.breakdown.quality   +
        weights.diversity * item.breakdown.diversity +
        weights.novelty   * item.breakdown.novelty;
    }
    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, topK);

    // 8. Update retrieval counts
    for (const { episode } of results) {
      this._retrievalCounts.set(
        episode.id,
        (this._retrievalCounts.get(episode.id) || 0) + 1
      );
    }

    return results;
  }

  /**
   * 检索并格式化为 prompt 片段 / Search and format as prompt fragment
   *
   * @param {string} query
   * @param {string} scope
   * @param {string} role
   * @param {number} [maxTokens=2000]
   * @returns {Promise<string>}
   */
  async searchForPrompt(query, scope, role, maxTokens = 2000) {
    const results = await this.search(query, { topK: 5, role, scope });

    if (results.length === 0) return '';

    const lines = ['## 相关历史经验', ''];
    for (let i = 0; i < results.length; i++) {
      const { episode } = results[i];
      const qualityStr = (episode.quality || 0).toFixed(2);
      const lessonsStr = (episode.lessons || []).join('; ') || '无';
      lines.push(
        (i + 1) + '. [任务: ' + episode.goal + '] (质量: ' + qualityStr +
        ', 角色: ' + (episode.role || 'unknown') + ') -- 经验: ' + lessonsStr
      );
    }

    let text = lines.join('\n');

    // Rough token estimate: ~4 chars per token for mixed CJK/ASCII
    const estimatedTokens = Math.ceil(text.length / 4);
    if (estimatedTokens > maxTokens) {
      const maxChars = maxTokens * 4;
      text = text.slice(0, maxChars) + '\n...(truncated)';
    }

    return text;
  }

  // --- Internal Helpers ---------------------------------------------------

  /**
   * 计算总检索次数 / Total retrieval count across all episodes
   * @returns {number}
   * @private
   */
  _totalRetrievals() {
    let total = 0;
    for (const count of this._retrievalCounts.values()) {
      total += count;
    }
    return total;
  }
}

export default HybridRetrieval;
