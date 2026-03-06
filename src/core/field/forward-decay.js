/**
 * Forward Decay 纯数学函数
 * Pure mathematical functions for Forward Decay signal attenuation
 *
 * Forward Decay 是一种高效的时间衰减机制：
 *   - 写入时用 encode() 将信号强度"前推"到未来
 *   - 读取时用 decode() 将编码分数"拉回"到当前时刻
 *   - 直接计算用 actualStrength()，避免 encode/decode 中间溢出
 *
 * Forward Decay is an efficient time-decay mechanism:
 *   - On write: encode() "pushes" signal strength forward in time
 *   - On read:  decode() "pulls" encoded score back to current time
 *   - Direct:   actualStrength() avoids encode/decode overflow risk
 *
 * 公式 / Formulas:
 *   encode(s, λ, t_emit) = s * exp(λ * t_emit)
 *   decode(e, λ, t_read) = e * exp(-λ * t_read)
 *   actual(s, λ, t_emit, t_read) = s * exp(-λ * max(0, t_read - t_emit))
 *
 * @module core/field/forward-decay
 * @version 9.0.0
 */

/**
 * 编码：将原始强度前推到发射时刻
 * Encode: push raw strength forward to emission time
 *
 * @param {number} strength  - 原始信号强度 [0,1] / Raw signal strength
 * @param {number} lambda    - 衰减率（>0 正常衰减，=0 永不衰减） / Decay rate
 * @param {number} emitTime  - 发射时间戳 (ms) / Emission timestamp in ms
 * @returns {number} 编码后的分数 / Encoded score
 */
export function encode(strength, lambda, emitTime) {
  if (strength <= 0) return 0
  if (lambda <= 0) return strength
  return strength * Math.exp(lambda * emitTime)
}

/**
 * 解码：将编码分数拉回到读取时刻
 * Decode: pull encoded score back to read time
 *
 * @param {number} encodedScore - encode() 的返回值 / Value from encode()
 * @param {number} lambda       - 衰减率 / Decay rate
 * @param {number} readTime     - 读取时间戳 (ms) / Read timestamp in ms
 * @returns {number} 解码后的强度 / Decoded strength
 */
export function decode(encodedScore, lambda, readTime) {
  if (encodedScore <= 0) return 0
  if (lambda <= 0) return encodedScore
  return encodedScore * Math.exp(-lambda * readTime)
}

/**
 * 直接计算实际强度（避免 encode/decode 中间值溢出）
 * Directly compute actual strength (avoids encode/decode intermediate overflow)
 *
 * 使用公式 s * exp(-λ * age)，其中 age = max(0, readTime - emitTime)
 * Uses formula s * exp(-lambda * age), where age = max(0, readTime - emitTime)
 *
 * @param {number} strength  - 原始强度 [0,1] / Original strength
 * @param {number} lambda    - 衰减率 / Decay rate
 * @param {number} emitTime  - 发射时间戳 (ms) / Emission timestamp
 * @param {number} readTime  - 读取时间戳 (ms) / Read timestamp
 * @returns {number} 实际强度，clamp 到 [0,1] / Actual strength clamped to [0,1]
 */
export function actualStrength(strength, lambda, emitTime, readTime) {
  if (strength <= 0) return 0
  // λ=0 → 永不衰减 / lambda=0 → never decays
  if (lambda <= 0) return Math.min(Math.max(strength, 0), 1)
  // readTime < emitTime → age 视为 0 / age treated as 0
  const age = Math.max(0, readTime - emitTime)
  const val = strength * Math.exp(-lambda * age)
  // clamp [0, 1]
  return Math.min(Math.max(val, 0), 1)
}

/**
 * 判断信号是否已过期
 * Check whether a signal has expired (actual strength below threshold)
 *
 * @param {number} strength   - 原始强度 / Original strength
 * @param {number} lambda     - 衰减率 / Decay rate
 * @param {number} emitTime   - 发射时间戳 / Emission timestamp
 * @param {number} readTime   - 读取时间戳 / Read timestamp
 * @param {number} [threshold=0.001] - 过期阈值 / Expiry threshold
 * @returns {boolean} true 表示已过期 / true if expired
 */
export function isExpired(strength, lambda, emitTime, readTime, threshold = 0.001) {
  return actualStrength(strength, lambda, emitTime, readTime) < threshold
}

/**
 * 计算信号的存活时间（TTL）
 * Compute the Time-To-Live of a signal with given lambda
 *
 * TTL = ln(1/threshold) / lambda
 * 当 lambda <= 0 时返回 Infinity（永不过期）
 * Returns Infinity when lambda <= 0 (never expires)
 *
 * @param {number} lambda     - 衰减率 / Decay rate
 * @param {number} [threshold=0.001] - 过期阈值 / Expiry threshold
 * @returns {number} TTL (ms) 或 Infinity / TTL in ms or Infinity
 */
export function computeTTL(lambda, threshold = 0.001) {
  if (lambda <= 0) return Infinity
  return Math.log(1 / threshold) / lambda
}
