/**
 * Forward Decay 纯数学函数
 * Pure mathematical functions for Forward Decay signal attenuation
 *
 * Forward Decay is an efficient time-decay mechanism:
 *   - On write: encode() "pushes" signal strength forward in time
 *   - On read:  decode() "pulls" encoded score back to current time
 *   - Direct:   actualStrength() avoids encode/decode overflow risk
 *
 * IMPORTANT: Lambda values are per-SECOND decay rates, but timestamps
 * from Date.now() are in MILLISECONDS. All functions convert ms→s internally.
 *
 * @module core/field/forward-decay
 * @version 9.2.4
 */

/**
 * Encode: push raw strength forward to emission time
 * @param {number} strength  - Raw signal strength [0,1]
 * @param {number} lambda    - Decay rate per second (>0)
 * @param {number} emitTime  - Emission timestamp in ms
 * @returns {number} Encoded score
 */
export function encode(strength, lambda, emitTime) {
  if (strength <= 0) return 0
  if (lambda <= 0) return strength
  return strength * Math.exp(lambda * (emitTime / 1000))
}

/**
 * Decode: pull encoded score back to read time
 * @param {number} encodedScore - Value from encode()
 * @param {number} lambda       - Decay rate per second
 * @param {number} readTime     - Read timestamp in ms
 * @returns {number} Decoded strength
 */
export function decode(encodedScore, lambda, readTime) {
  if (encodedScore <= 0) return 0
  if (lambda <= 0) return encodedScore
  return encodedScore * Math.exp(-lambda * (readTime / 1000))
}

/**
 * Directly compute actual strength (avoids encode/decode intermediate overflow)
 * Uses formula s * exp(-lambda * ageSec), where ageSec = max(0, (readTime - emitTime) / 1000)
 *
 * @param {number} strength  - Original strength [0,1]
 * @param {number} lambda    - Decay rate per second
 * @param {number} emitTime  - Emission timestamp (ms)
 * @param {number} readTime  - Read timestamp (ms)
 * @returns {number} Actual strength clamped to [0,1]
 */
export function actualStrength(strength, lambda, emitTime, readTime) {
  if (strength <= 0) return 0
  if (lambda <= 0) return Math.min(Math.max(strength, 0), 1)
  const ageSec = Math.max(0, (readTime - emitTime) / 1000)
  const val = strength * Math.exp(-lambda * ageSec)
  return Math.min(Math.max(val, 0), 1)
}

/**
 * Check whether a signal has expired (actual strength below threshold)
 * @param {number} strength   - Original strength
 * @param {number} lambda     - Decay rate per second
 * @param {number} emitTime   - Emission timestamp
 * @param {number} readTime   - Read timestamp
 * @param {number} [threshold=0.001] - Expiry threshold
 * @returns {boolean} true if expired
 */
export function isExpired(strength, lambda, emitTime, readTime, threshold = 0.001) {
  return actualStrength(strength, lambda, emitTime, readTime) < threshold
}

/**
 * Compute the Time-To-Live of a signal with given lambda
 * TTL = ln(1/threshold) / lambda (in seconds) → converted to ms
 *
 * @param {number} lambda     - Decay rate per second
 * @param {number} [threshold=0.001] - Expiry threshold
 * @returns {number} TTL in ms or Infinity
 */
export function computeTTL(lambda, threshold = 0.001) {
  if (lambda <= 0) return Infinity
  return (Math.log(1 / threshold) / lambda) * 1000
}
