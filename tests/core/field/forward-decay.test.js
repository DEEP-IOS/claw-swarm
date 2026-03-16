/**
 * forward-decay.js 单元测试
 * Tests for Forward Decay pure math functions: encode, decode, actualStrength, isExpired, computeTTL
 */
import { describe, it, expect } from 'vitest'
import { encode, decode, actualStrength, isExpired, computeTTL } from '../../../src/core/field/forward-decay.js'

describe('forward-decay', () => {
  // ── encode ──────────────────────────────────────────────────────────────
  describe('encode', () => {
    it('should compute s * exp(lambda * emitTime)', () => {
      const result = encode(0.8, 0.01, 1000)
      expect(result).toBeCloseTo(0.8 * Math.exp(0.01 * 1000), 6)
    })

    it('should return 0 when strength is 0', () => {
      expect(encode(0, 0.01, 1000)).toBe(0)
    })

    it('should return strength unchanged when lambda is 0', () => {
      expect(encode(0.8, 0, 5000)).toBe(0.8)
    })

    it('should return 0 for negative strength', () => {
      expect(encode(-0.5, 0.01, 1000)).toBe(0)
    })
  })

  // ── decode ──────────────────────────────────────────────────────────────
  describe('decode', () => {
    it('should be the inverse of encode: decode(encode(s,l,t),l,t) === s', () => {
      const s = 0.6
      const lambda = 0.01
      const t = 2000
      const encoded = encode(s, lambda, t)
      const decoded = decode(encoded, lambda, t)
      expect(decoded).toBeCloseTo(s, 6)
    })

    it('should return 0 for zero encodedScore', () => {
      expect(decode(0, 0.01, 1000)).toBe(0)
    })

    it('should return encodedScore unchanged when lambda is 0', () => {
      expect(decode(5.0, 0, 1000)).toBe(5.0)
    })
  })

  // ── actualStrength ─────────────────────────────────────────────────────
  describe('actualStrength', () => {
    it('should compute s * exp(-lambda * age) correctly', () => {
      const result = actualStrength(0.8, 0.01, 0, 100)
      expect(result).toBeCloseTo(0.8 * Math.exp(-0.01 * 100), 6)
    })

    it('should clamp to [0,1] when lambda is 0', () => {
      expect(actualStrength(0.8, 0, 0, 10000)).toBeCloseTo(0.8, 6)
      expect(actualStrength(1.5, 0, 0, 10000)).toBe(1)
    })

    it('should treat age as 0 when readTime < emitTime', () => {
      const result = actualStrength(0.8, 0.01, 5000, 3000)
      expect(result).toBeCloseTo(0.8, 6)
    })

    it('should return 0 when strength is 0', () => {
      expect(actualStrength(0, 0.01, 0, 1000)).toBe(0)
    })

    it('should return 0 when strength is negative', () => {
      expect(actualStrength(-0.5, 0.01, 0, 1000)).toBe(0)
    })
  })

  // ── isExpired ──────────────────────────────────────────────────────────
  describe('isExpired', () => {
    it('should return true when signal has decayed below threshold', () => {
      // lambda=0.01, age=1000000 => exp(-10000) ~ 0 < 0.001
      expect(isExpired(0.8, 0.01, 0, 1_000_000)).toBe(true)
    })

    it('should return false when signal is still strong', () => {
      // lambda=0.01, age=10 => 0.8 * exp(-0.1) ~ 0.724 > 0.001
      expect(isExpired(0.8, 0.01, 0, 10)).toBe(false)
    })

    it('should never expire when lambda is 0', () => {
      expect(isExpired(0.8, 0, 0, 999_999_999)).toBe(false)
    })
  })

  // ── computeTTL ─────────────────────────────────────────────────────────
  describe('computeTTL', () => {
    it('should return ln(1/threshold) / lambda', () => {
      const lambda = 0.01
      const threshold = 0.001
      const expected = Math.log(1 / threshold) / lambda
      expect(computeTTL(lambda, threshold)).toBeCloseTo(expected, 6)
    })

    it('should return Infinity when lambda is 0', () => {
      expect(computeTTL(0)).toBe(Infinity)
    })

    it('should use default threshold 0.001', () => {
      const expected = Math.log(1 / 0.001) / 0.05
      expect(computeTTL(0.05)).toBeCloseTo(expected, 6)
    })
  })
})
