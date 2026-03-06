/**
 * 12 维场向量运算
 * 12-dimensional field vector operations
 *
 * 场向量是某个作用域内所有活跃信号在 12 维度上的叠加结果。
 * 每个 agent 通过场向量感知周围信号场的状态，做出行为决策。
 * A field vector is the superposition of all active signals within a scope
 * across 12 dimensions. Each agent perceives the surrounding signal field
 * via field vectors to make behavioral decisions.
 *
 * @module core/field/field-vector
 * @version 9.0.0
 */

import { actualStrength } from './forward-decay.js'
import { ALL_DIMENSIONS } from './types.js'

// ============================================================================
// 辅助函数 / Helpers
// ============================================================================

/**
 * 创建全零场向量
 * Create a zero-initialized field vector
 * @returns {import('./types.js').FieldVector}
 */
function zeroVector() {
  const v = Object.create(null)
  for (const dim of ALL_DIMENSIONS) {
    v[dim] = 0
  }
  return v
}

// ============================================================================
// 核心运算 / Core Operations
// ============================================================================

/**
 * 叠加：将多个信号在指定维度上求和，结果 clamp 到 [0,1]
 * Superpose: sum signal actual strengths per dimension, clamped to [0,1]
 *
 * @param {import('./types.js').Signal[]} signals - 信号数组 / Array of signals
 * @param {string[]} [dimensions=ALL_DIMENSIONS] - 参与叠加的维度 / Dimensions to include
 * @param {number} [readTime=Date.now()] - 读取时间戳 / Read timestamp
 * @returns {import('./types.js').FieldVector} 叠加后的场向量 / Superposed field vector
 */
export function superpose(signals, dimensions = ALL_DIMENSIONS, readTime = Date.now()) {
  const v = zeroVector()
  const dimSet = new Set(dimensions)

  for (const sig of signals) {
    if (!dimSet.has(sig.dimension)) continue
    const s = actualStrength(sig.strength, sig.lambda, sig.emitTime, readTime)
    v[sig.dimension] += s
  }

  // clamp 每个维度到 [0, 1] / clamp each dimension to [0, 1]
  for (const dim of ALL_DIMENSIONS) {
    v[dim] = Math.min(Math.max(v[dim], 0), 1)
  }

  return v
}

/**
 * 应用灵敏度过滤器：每个维度乘以对应灵敏度系数
 * Apply sensitivity filter: multiply each dimension by its sensitivity coefficient
 *
 * 灵敏度为 0 表示忽略该维度（默认值），为 1 表示完全感知
 * Sensitivity of 0 means ignore (default), 1 means fully perceive
 *
 * @param {import('./types.js').FieldVector} rawVector - 原始场向量 / Raw field vector
 * @param {Record<string, number>} sensitivity - 每维度灵敏度 [0,1]，缺省为 0 / Per-dimension sensitivity
 * @returns {import('./types.js').FieldVector} 过滤后的向量 / Filtered vector
 */
export function applyFilter(rawVector, sensitivity) {
  const v = zeroVector()
  for (const dim of ALL_DIMENSIONS) {
    const s = (sensitivity && typeof sensitivity[dim] === 'number') ? sensitivity[dim] : 0
    v[dim] = rawVector[dim] * s
  }
  return v
}

/**
 * 应用校准权重：每个维度乘以校准系数
 * Apply calibration weights: multiply each dimension by calibration weight
 *
 * 权重默认为 1.0（不改变），可通过系统校准动态调整
 * Weight defaults to 1.0 (no change), adjustable via system calibration
 *
 * @param {import('./types.js').FieldVector} rawVector - 原始场向量 / Raw field vector
 * @param {Record<string, number>} calibrationWeights - 每维度权重，缺省为 1.0 / Per-dim weight
 * @returns {import('./types.js').FieldVector} 校准后的向量 / Calibrated vector
 */
export function applyCalibration(rawVector, calibrationWeights) {
  const v = zeroVector()
  for (const dim of ALL_DIMENSIONS) {
    const w = (calibrationWeights && typeof calibrationWeights[dim] === 'number')
      ? calibrationWeights[dim]
      : 1.0
    v[dim] = rawVector[dim] * w
  }
  return v
}

/**
 * L2 范数（向量长度）
 * L2 norm (vector magnitude)
 *
 * @param {import('./types.js').FieldVector} vector - 场向量 / Field vector
 * @returns {number} L2 范数 / L2 norm
 */
export function magnitude(vector) {
  let sumSq = 0
  for (const dim of ALL_DIMENSIONS) {
    const val = vector[dim] || 0
    sumSq += val * val
  }
  return Math.sqrt(sumSq)
}

/**
 * 找到最强的维度
 * Find the dominant (strongest) dimension
 *
 * @param {import('./types.js').FieldVector} vector - 场向量 / Field vector
 * @returns {{ dimension: string, strength: number }} 最强维度和强度 / Dominant dimension and strength
 */
export function dominant(vector) {
  let bestDim = ALL_DIMENSIONS[0]
  let bestVal = -Infinity
  for (const dim of ALL_DIMENSIONS) {
    const val = vector[dim] || 0
    if (val > bestVal) {
      bestVal = val
      bestDim = dim
    }
  }
  return { dimension: bestDim, strength: bestVal }
}

/**
 * 向量差：v1 - v2（逐维度相减）
 * Vector difference: v1 - v2 (per-dimension subtraction)
 *
 * @param {import('./types.js').FieldVector} v1 - 被减向量 / Minuend vector
 * @param {import('./types.js').FieldVector} v2 - 减向量 / Subtrahend vector
 * @returns {import('./types.js').FieldVector} 差向量 / Difference vector
 */
export function diff(v1, v2) {
  const v = zeroVector()
  for (const dim of ALL_DIMENSIONS) {
    v[dim] = (v1[dim] || 0) - (v2[dim] || 0)
  }
  return v
}

/**
 * 单位化：返回单位向量（L2 范数为 1）
 * Normalize: return unit vector (L2 norm = 1)
 *
 * 零向量返回零向量（避免除零）
 * Zero vector returns zero vector (avoids division by zero)
 *
 * @param {import('./types.js').FieldVector} vector - 场向量 / Field vector
 * @returns {import('./types.js').FieldVector} 单位向量 / Unit vector
 */
export function normalize(vector) {
  const mag = magnitude(vector)
  if (mag === 0) return zeroVector()
  const v = zeroVector()
  for (const dim of ALL_DIMENSIONS) {
    v[dim] = (vector[dim] || 0) / mag
  }
  return v
}
