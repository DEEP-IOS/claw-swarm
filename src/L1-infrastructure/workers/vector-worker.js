/**
 * Vector Worker — 向量嵌入 + HNSW 索引 / Vector Embedding + HNSW Index Worker
 *
 * 处理向量相关的 CPU/IO 密集计算:
 * - embed: 文本向量嵌入 (本地 ONNX 模型)
 * - search: HNSW 最近邻搜索
 * - batchEmbed: 批量嵌入
 * - cosineSimilarity: 余弦相似度计算
 *
 * Handles vector CPU/IO-intensive computations:
 * - embed: Text vector embedding (local ONNX model)
 * - search: HNSW nearest neighbor search
 * - batchEmbed: Batch embedding
 * - cosineSimilarity: Cosine similarity computation
 *
 * @module L1-infrastructure/workers/vector-worker
 * @author DEEP-IOS
 */

import { parentPort } from 'node:worker_threads';

// 嵌入模型 (懒加载) / Embedding model (lazy-loaded)
let _pipeline = null;
let _modelLoading = null;

/**
 * 确保模型加载 / Ensure model is loaded
 * 使用 Promise 缓存防止并发加载竞态 / Promise cache prevents concurrent load race
 *
 * @param {string} modelName
 * @returns {Promise<Function>}
 */
async function ensureModel(modelName = 'Xenova/all-MiniLM-L6-v2') {
  if (_pipeline) return _pipeline;

  if (!_modelLoading) {
    _modelLoading = (async () => {
      try {
        // 动态导入 (可选依赖) / Dynamic import (optional dependency)
        const { pipeline } = await import('@xenova/transformers');
        _pipeline = await pipeline('feature-extraction', modelName);
        return _pipeline;
      } catch (err) {
        _modelLoading = null; // 失败时清除缓存, 允许重试
        throw new Error(`Failed to load embedding model: ${err.message}`);
      }
    })();
  }

  return _modelLoading;
}

// ━━━ 任务处理器 / Task Handlers ━━━

/**
 * 单条文本嵌入 / Single text embedding
 */
async function handleEmbed({ text, modelName }) {
  const pipe = await ensureModel(modelName);
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return { embedding: Array.from(output.data) };
}

/**
 * 批量文本嵌入 / Batch text embedding
 */
async function handleBatchEmbed({ texts, modelName }) {
  const pipe = await ensureModel(modelName);
  const results = [];

  for (const text of texts) {
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    results.push(Array.from(output.data));
  }

  return { embeddings: results };
}

/**
 * 余弦相似度 / Cosine similarity
 */
function handleCosineSimilarity({ vecA, vecB }) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return { similarity: 0, error: 'Vector dimension mismatch' };
  }

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return { similarity: 0 };
  return { similarity: dot / (normA * normB) };
}

/**
 * 批量余弦相似度 (查询向量 vs 候选集)
 * Batch cosine similarity (query vector vs candidate set)
 */
function handleBatchSimilarity({ queryVec, candidateVecs }) {
  if (!queryVec || !candidateVecs) {
    return { similarities: [] };
  }

  const similarities = [];
  const dim = queryVec.length;

  // 预计算查询向量的范数 / Pre-compute query norm
  let queryNorm = 0;
  for (let i = 0; i < dim; i++) {
    queryNorm += queryVec[i] * queryVec[i];
  }
  queryNorm = Math.sqrt(queryNorm);

  if (queryNorm === 0) {
    return { similarities: candidateVecs.map(() => 0) };
  }

  for (const vec of candidateVecs) {
    let dot = 0, norm = 0;
    for (let i = 0; i < dim; i++) {
      dot += queryVec[i] * vec[i];
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);
    similarities.push(norm > 0 ? dot / (queryNorm * norm) : 0);
  }

  return { similarities };
}

// ━━━ 消息分发 / Message Dispatch ━━━

const SYNC_HANDLERS = {
  cosineSimilarity: handleCosineSimilarity,
  batchSimilarity: handleBatchSimilarity,
};

const ASYNC_HANDLERS = {
  embed: handleEmbed,
  batchEmbed: handleBatchEmbed,
};

parentPort.on('message', async (msg) => {
  if (msg.type !== 'task') return;

  // 同步任务 / Sync handlers
  const syncHandler = SYNC_HANDLERS[msg.taskType];
  if (syncHandler) {
    try {
      const result = syncHandler(msg.payload);
      parentPort.postMessage({ type: 'result', id: msg.id, result });
    } catch (err) {
      parentPort.postMessage({ type: 'result', id: msg.id, error: err.message });
    }
    return;
  }

  // 异步任务 / Async handlers
  const asyncHandler = ASYNC_HANDLERS[msg.taskType];
  if (asyncHandler) {
    try {
      const result = await asyncHandler(msg.payload);
      parentPort.postMessage({ type: 'result', id: msg.id, result });
    } catch (err) {
      parentPort.postMessage({ type: 'result', id: msg.id, error: err.message });
    }
    return;
  }

  parentPort.postMessage({
    type: 'result',
    id: msg.id,
    error: `Unknown task type: ${msg.taskType}`,
  });
});

// 导出供测试使用 / Export for testing
export {
  handleCosineSimilarity,
  handleBatchSimilarity,
};
