/**
 * ACO Worker — 信息素场计算 / Pheromone Field Computation Worker
 *
 * 在 worker_thread 中运行 ACO 相关的 CPU 密集计算:
 * - acoSelect: 轮盘赌路径选择 [τ^α · η^β]
 * - decayPass: 全量信息素衰减 I(t)=I₀×e^(-λ×Δt)
 * - SharedArrayBuffer 零拷贝信息素场 (V6.0 SeqLock 模式)
 *
 * Runs ACO CPU-intensive computations in worker_thread:
 * - acoSelect: Roulette wheel path selection [τ^α · η^β]
 * - decayPass: Batch pheromone decay I(t)=I₀×e^(-λ×Δt)
 * - SharedArrayBuffer zero-copy pheromone field (V6.0 SeqLock)
 *
 * @module L1-infrastructure/workers/aco-worker
 * @author DEEP-IOS
 */

import { parentPort, workerData } from 'node:worker_threads';

// ━━━ SharedArrayBuffer 信息素场布局 / Pheromone Field Layout ━━━

const RECORD_SLOTS = 9;
const MAX_PHEROMONES = 5000;

const OFFSET = {
  SEQUENCE: 0,
  INTENSITY: 1,
  DECAY_RATE: 2,
  MMAS_MIN: 3,
  MMAS_MAX: 4,
  LAST_UPDATE: 5,
  TYPE_ID: 6,
  SCOPE_HASH: 7,
  FLAGS: 8,
};

// ━━━ SeqLock 读写原语 / SeqLock Read/Write Primitives ━━━

/**
 * SeqLock 写入 (单写者模式: 只有 aco-worker 写)
 * SeqLock write (single-writer mode: only aco-worker writes)
 *
 * @param {SharedArrayBuffer} buffer
 * @param {number} index - 记录索引
 * @param {Object} fields - 要写入的字段
 */
function writePheromone(buffer, index, fields) {
  const view = new Float64Array(buffer);
  const i32 = new Int32Array(buffer);
  const base = index * RECORD_SLOTS;
  const seqOffset = base * 2; // Float64 → Int32 偏移 (×2)

  // 1. 递增序列号为奇数 (正在写入)
  Atomics.add(i32, seqOffset, 1);

  // 2. 写入数据字段
  if (fields.intensity !== undefined) view[base + OFFSET.INTENSITY] = fields.intensity;
  if (fields.decayRate !== undefined) view[base + OFFSET.DECAY_RATE] = fields.decayRate;
  if (fields.mmasMin !== undefined) view[base + OFFSET.MMAS_MIN] = fields.mmasMin;
  if (fields.mmasMax !== undefined) view[base + OFFSET.MMAS_MAX] = fields.mmasMax;
  if (fields.lastUpdate !== undefined) view[base + OFFSET.LAST_UPDATE] = fields.lastUpdate;
  if (fields.typeId !== undefined) view[base + OFFSET.TYPE_ID] = fields.typeId;
  if (fields.scopeHash !== undefined) view[base + OFFSET.SCOPE_HASH] = fields.scopeHash;
  if (fields.flags !== undefined) view[base + OFFSET.FLAGS] = fields.flags;

  // 3. 递增序列号为偶数 (写入完成)
  Atomics.add(i32, seqOffset, 1);
}

/**
 * SeqLock 读取 (可多个读者并发)
 * SeqLock read (multiple concurrent readers)
 *
 * @param {SharedArrayBuffer} buffer
 * @param {number} index
 * @returns {Object|null} - null 表示读取失败 (3次重试耗尽)
 */
function readPheromone(buffer, index) {
  const view = new Float64Array(buffer);
  const i32 = new Int32Array(buffer);
  const base = index * RECORD_SLOTS;
  const seqOffset = base * 2;

  let retries = 0;
  while (retries < 3) {
    const seq1 = Atomics.load(i32, seqOffset);
    if (seq1 & 1) {
      retries++;
      continue; // 奇数=正在写入, 自旋等待
    }

    const intensity = view[base + OFFSET.INTENSITY];
    const decayRate = view[base + OFFSET.DECAY_RATE];
    const mmasMin = view[base + OFFSET.MMAS_MIN];
    const mmasMax = view[base + OFFSET.MMAS_MAX];
    const lastUpdate = view[base + OFFSET.LAST_UPDATE];
    const typeId = view[base + OFFSET.TYPE_ID];
    const scopeHash = view[base + OFFSET.SCOPE_HASH];
    const flags = view[base + OFFSET.FLAGS];

    const seq2 = Atomics.load(i32, seqOffset);
    if (seq1 === seq2) {
      return { intensity, decayRate, mmasMin, mmasMax, lastUpdate, typeId, scopeHash, flags };
    }
    retries++;
  }
  return null; // 3次重试失败, 调用方走 SQLite fallback
}

// ━━━ 任务处理器 / Task Handlers ━━━

/**
 * ACO 轮盘赌选择 / ACO Roulette Wheel Selection
 * P(i) = [τᵢ^α · ηᵢ^β] / Σ[τⱼ^α · ηⱼ^β]
 */
function handleAcoSelect({ candidates, alpha = 1.0, beta = 0 }) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // 计算概率分布 / Compute probability distribution
  const weights = new Float64Array(candidates.length);
  let totalWeight = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const tau = Math.max(c.intensity || 0, 0.001);
    const eta = c.eta !== undefined ? Math.max(c.eta, 0.001) : 1.0;
    const w = Math.pow(tau, alpha) * Math.pow(eta, beta);
    weights[i] = w;
    totalWeight += w;
  }

  if (totalWeight <= 0) {
    // 均匀随机 / Uniform random
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // 轮盘赌 / Roulette wheel
  const r = Math.random() * totalWeight;
  let cumulative = 0;
  for (let i = 0; i < candidates.length; i++) {
    cumulative += weights[i];
    if (r <= cumulative) {
      return candidates[i];
    }
  }

  return candidates[candidates.length - 1];
}

/**
 * 信息素衰减批处理 / Pheromone Decay Batch Pass
 * I(t) = I₀ × e^(-λ × Δt)
 */
function handleDecayPass({ pheromones, now, minIntensity = 0.01 }) {
  if (!pheromones || pheromones.length === 0) {
    return { updated: [], evaporated: [], stats: { updated: 0, evaporated: 0 } };
  }

  const updated = [];
  const evaporated = [];

  for (const p of pheromones) {
    const elapsed = (now - (p.updatedAt || now)) / 1000; // 秒
    if (elapsed <= 0) continue;

    const decayRate = p.decayRate || 0.05;
    const newIntensity = p.intensity * Math.exp(-decayRate * elapsed);

    // 检查过期 / Check expiry
    if (p.expiresAt && now > p.expiresAt) {
      evaporated.push(p.id);
      continue;
    }

    // MMAS 下界保护 / MMAS lower bound protection
    const mmasMin = p.mmasMin || 0;
    const clamped = Math.max(newIntensity, mmasMin);

    if (clamped < minIntensity) {
      evaporated.push(p.id);
    } else {
      updated.push({
        id: p.id,
        intensity: clamped,
        updatedAt: now,
      });
    }
  }

  return {
    updated,
    evaporated,
    stats: { updated: updated.length, evaporated: evaporated.length },
  };
}

/**
 * 批量写入 SharedArrayBuffer / Batch write to SharedArrayBuffer
 */
function handleSabWrite({ records }) {
  const buffer = workerData?.sharedBuffers?.pheromoneField;
  if (!buffer) {
    return { written: 0, error: 'No pheromone SharedArrayBuffer available' };
  }

  let written = 0;
  for (const record of records) {
    if (record.index >= 0 && record.index < MAX_PHEROMONES) {
      writePheromone(buffer, record.index, record.fields);
      written++;
    }
  }
  return { written };
}

/**
 * 批量读取 SharedArrayBuffer / Batch read from SharedArrayBuffer
 */
function handleSabRead({ indices }) {
  const buffer = workerData?.sharedBuffers?.pheromoneField;
  if (!buffer) {
    return { results: [], error: 'No pheromone SharedArrayBuffer available' };
  }

  const results = [];
  for (const index of indices) {
    if (index >= 0 && index < MAX_PHEROMONES) {
      const data = readPheromone(buffer, index);
      results.push({ index, data });
    }
  }
  return { results };
}

// ━━━ 消息分发 / Message Dispatch ━━━

const HANDLERS = {
  acoSelect: handleAcoSelect,
  decayPass: handleDecayPass,
  sabWrite: handleSabWrite,
  sabRead: handleSabRead,
};

parentPort.on('message', (msg) => {
  if (msg.type !== 'task') return;

  const handler = HANDLERS[msg.taskType];
  if (!handler) {
    parentPort.postMessage({
      type: 'result',
      id: msg.id,
      error: `Unknown task type: ${msg.taskType}`,
    });
    return;
  }

  try {
    const result = handler(msg.payload);
    parentPort.postMessage({
      type: 'result',
      id: msg.id,
      result,
    });
  } catch (err) {
    parentPort.postMessage({
      type: 'result',
      id: msg.id,
      error: err.message,
    });
  }
});

// 导出供测试使用 / Export for testing
export {
  handleAcoSelect,
  handleDecayPass,
  readPheromone,
  writePheromone,
  OFFSET,
  RECORD_SLOTS,
  MAX_PHEROMONES,
};
