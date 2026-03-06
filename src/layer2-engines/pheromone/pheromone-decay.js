/**
 * PheromoneDecay — 信息素衰减模型 / Pheromone Decay Model
 *
 * 实现指数衰减公式: intensity(t) = initial × e^(-decayRate × elapsedMinutes)
 * 这模拟了真实信息素的自然挥发过程。
 *
 * Implements exponential decay: intensity(t) = initial × e^(-decayRate × elapsedMinutes)
 * This models the natural evaporation of real pheromones.
 *
 * [WHY] 衰减是信息素区别于 Memory 的核心特性：
 * - Memory 是永久的（写入即存在）
 * - Pheromone 是短暂的（自然消退，创造时效性语境）
 * Decay is the core differentiator between pheromones and memory:
 * - Memory is permanent (persists once written)
 * - Pheromones are ephemeral (naturally fade, creating time-sensitive context)
 *
 * @module pheromone-decay
 * @author DEEP-IOS
 */

import { MIN_INTENSITY } from './pheromone-types.js';

/**
 * 计算信息素在当前时刻的实际强度（不修改 DB）
 * Calculate the real-time intensity of a pheromone without DB modification
 *
 * @param {number} initialIntensity - 初始强度 / Initial intensity when last updated
 * @param {number} decayRate - 每分钟衰减率 / Per-minute decay rate
 * @param {number} lastUpdatedMs - 上次更新时间（epoch ms）/ Last update time
 * @param {number} [nowMs=Date.now()] - 当前时间 / Current time
 * @returns {number} 当前实际强度 / Current real-time intensity
 */
export function calculateCurrentIntensity(initialIntensity, decayRate, lastUpdatedMs, nowMs = Date.now()) {
  const elapsedMinutes = (nowMs - lastUpdatedMs) / 60000;
  if (elapsedMinutes <= 0) return initialIntensity;

  const currentIntensity = initialIntensity * Math.exp(-decayRate * elapsedMinutes);
  return currentIntensity < MIN_INTENSITY ? 0 : currentIntensity;
}

/**
 * 判断信息素是否已过期（硬过期或软衰减至零）
 * Check if a pheromone has expired (hard expiry or soft-decayed to zero)
 *
 * @param {import('../../layer1-core/types.js').PheromoneSignal} pheromone
 * @param {number} [nowMs=Date.now()]
 * @returns {boolean}
 */
export function isExpired(pheromone, nowMs = Date.now()) {
  // 硬过期检查 / Hard expiry check
  if (pheromone.expiresAt && nowMs >= pheromone.expiresAt) return true;

  // 软衰减检查 / Soft decay check
  const current = calculateCurrentIntensity(
    pheromone.intensity, pheromone.decayRate, pheromone.updatedAt, nowMs
  );
  return current <= 0;
}

/**
 * 将信息素信号格式化为人类可读的快照行
 * Format a pheromone signal as a human-readable snapshot line
 *
 * @param {object} pheromone - DB row with real-time intensity applied
 * @returns {string} e.g. "- ALARM(0.82): 'Build failure in /api/auth' from agent-2"
 */
export function formatPheromoneForSnapshot(pheromone) {
  const intensityStr = pheromone.currentIntensity.toFixed(2);
  const payloadStr = typeof pheromone.payload === 'string'
    ? pheromone.payload
    : JSON.stringify(pheromone.payload);
  const truncated = payloadStr.length > 80 ? payloadStr.slice(0, 77) + '...' : payloadStr;
  return `- ${pheromone.type.toUpperCase()}(${intensityStr}): '${truncated}' from ${pheromone.source_id}`;
}
