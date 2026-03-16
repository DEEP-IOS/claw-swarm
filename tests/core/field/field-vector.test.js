/**
 * field-vector.js 单元测试
 * Tests for 12-dimensional field vector operations: superpose, applyFilter, applyCalibration,
 * magnitude, dominant, diff, normalize
 */
import { describe, it, expect } from 'vitest'
import {
  superpose,
  applyFilter,
  applyCalibration,
  magnitude,
  dominant,
  diff,
  normalize,
} from '../../../src/core/field/field-vector.js'
import { ALL_DIMENSIONS } from '../../../src/core/field/types.js'

/** helper: create a zero FieldVector */
function zeroVec() {
  const v = {}
  for (const d of ALL_DIMENSIONS) v[d] = 0
  return v
}

/** helper: build a minimal Signal object */
function makeSig(dim, strength, emitTime, lambda = 0) {
  return {
    id: `sig-${Math.random().toString(36).slice(2, 8)}`,
    dimension: dim,
    scope: 'test',
    strength,
    lambda,
    emitTime,
    encodedScore: 0,
    emitterId: 'unit-test',
  }
}

describe('field-vector', () => {
  const NOW = 1_000_000

  // ── superpose ──────────────────────────────────────────────────────────
  describe('superpose', () => {
    it('should return a 12-dim zero vector for empty signals', () => {
      const v = superpose([], ALL_DIMENSIONS, NOW)
      expect(Object.keys(v)).toHaveLength(ALL_DIMENSIONS.length)
      for (const d of ALL_DIMENSIONS) {
        expect(v[d]).toBe(0)
      }
    })

    it('should reflect a single trail signal close to its strength', () => {
      const sig = makeSig('trail', 0.8, NOW, 0)
      const v = superpose([sig], ALL_DIMENSIONS, NOW)
      expect(v.trail).toBeCloseTo(0.8, 4)
    })

    it('should clamp superposed values to [0,1]', () => {
      const s1 = makeSig('alarm', 0.7, NOW, 0)
      const s2 = makeSig('alarm', 0.6, NOW, 0)
      const v = superpose([s1, s2], ALL_DIMENSIONS, NOW)
      expect(v.alarm).toBe(1) // 0.7+0.6 = 1.3 -> clamped to 1
    })

    it('should superpose signals across multiple dimensions', () => {
      const s1 = makeSig('trail', 0.5, NOW, 0)
      const s2 = makeSig('alarm', 0.3, NOW, 0)
      const s3 = makeSig('trust', 0.9, NOW, 0)
      const v = superpose([s1, s2, s3], ALL_DIMENSIONS, NOW)
      expect(v.trail).toBeCloseTo(0.5, 4)
      expect(v.alarm).toBeCloseTo(0.3, 4)
      expect(v.trust).toBeCloseTo(0.9, 4)
      expect(v.knowledge).toBe(0)
    })
  })

  // ── applyFilter ────────────────────────────────────────────────────────
  describe('applyFilter', () => {
    it('should multiply dimensions by their sensitivity and zero unset dims', () => {
      const raw = zeroVec()
      raw.trail = 0.8
      raw.alarm = 0.6
      raw.trust = 0.4

      const filtered = applyFilter(raw, { trail: 1, alarm: 0.5 })
      expect(filtered.trail).toBeCloseTo(0.8, 6)
      expect(filtered.alarm).toBeCloseTo(0.3, 6)
      expect(filtered.trust).toBe(0) // sensitivity not set -> defaults to 0
    })
  })

  // ── applyCalibration ───────────────────────────────────────────────────
  describe('applyCalibration', () => {
    it('should leave dimensions unchanged when no calibration weight is given', () => {
      const raw = zeroVec()
      raw.trail = 0.4
      const calibrated = applyCalibration(raw, {})
      expect(calibrated.trail).toBeCloseTo(0.4, 6)
    })

    it('should multiply dimension by the specified weight', () => {
      const raw = zeroVec()
      raw.trail = 0.3
      const calibrated = applyCalibration(raw, { trail: 2.0 })
      expect(calibrated.trail).toBeCloseTo(0.6, 6)
    })
  })

  // ── magnitude ──────────────────────────────────────────────────────────
  describe('magnitude', () => {
    it('should return 0 for the zero vector', () => {
      expect(magnitude(zeroVec())).toBe(0)
    })

    it('should return the value of a single non-zero dimension', () => {
      const v = zeroVec()
      v.trail = 0.7
      expect(magnitude(v)).toBeCloseTo(0.7, 6)
    })

    it('should compute L2 norm for multi-dim vector', () => {
      const v = zeroVec()
      v.trail = 0.3
      v.alarm = 0.4
      expect(magnitude(v)).toBeCloseTo(0.5, 6) // sqrt(0.09+0.16) = 0.5
    })
  })

  // ── dominant ───────────────────────────────────────────────────────────
  describe('dominant', () => {
    it('should return the dimension with the highest value', () => {
      const v = zeroVec()
      v.alarm = 0.9
      v.trail = 0.2
      const d = dominant(v)
      expect(d.dimension).toBe('alarm')
      expect(d.strength).toBeCloseTo(0.9, 6)
    })
  })

  // ── diff ───────────────────────────────────────────────────────────────
  describe('diff', () => {
    it('should subtract v2 from v1 per dimension', () => {
      const v1 = zeroVec()
      v1.trail = 0.8
      v1.alarm = 0.3
      const v2 = zeroVec()
      v2.trail = 0.3
      v2.alarm = 0.5

      const d = diff(v1, v2)
      expect(d.trail).toBeCloseTo(0.5, 6)
      expect(d.alarm).toBeCloseTo(-0.2, 6)
      expect(d.knowledge).toBe(0)
    })
  })

  // ── normalize ──────────────────────────────────────────────────────────
  describe('normalize', () => {
    it('should return a unit vector (magnitude 1)', () => {
      const v = zeroVec()
      v.trail = 3
      v.alarm = 4
      const n = normalize(v)
      expect(magnitude(n)).toBeCloseTo(1, 6)
      expect(n.trail).toBeCloseTo(0.6, 6)
      expect(n.alarm).toBeCloseTo(0.8, 6)
    })

    it('should return zero vector when input is zero vector', () => {
      const n = normalize(zeroVec())
      for (const d of ALL_DIMENSIONS) {
        expect(n[d]).toBe(0)
      }
    })
  })
})
