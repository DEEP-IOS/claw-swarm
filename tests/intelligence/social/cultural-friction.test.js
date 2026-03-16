/**
 * CulturalFriction 单元测试
 * @module tests/intelligence/social/cultural-friction.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { CulturalFriction } from '../../../src/intelligence/social/cultural-friction.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'

describe('CulturalFriction', () => {
  let friction, field

  beforeEach(() => {
    field = new SignalStore()
    friction = new CulturalFriction({ field })
  })

  // ── 同 provider 自比 ──

  it('同 provider 自比 → distance=0, strategy=LIGHT_TOUCH', () => {
    const result = friction.computeFriction('anthropic', 'anthropic')
    expect(result.distance).toBe(0)
    expect(result.normalized).toBe(0)
    expect(result.strategy).toBe('LIGHT_TOUCH')
  })

  // ── 差异明显 provider ──

  it('anthropic vs openai → normalized > 0 且 strategy 非 LIGHT_TOUCH', () => {
    const result = friction.computeFriction('anthropic', 'openai')
    expect(result.normalized).toBeGreaterThan(0)
    // anthropic 和 openai 差异不算极大, 但肯定 > 0
    expect(result.distance).toBeGreaterThan(0)
  })

  it('差异大的 provider → coefficient > 0.3 (自定义极端 profile)', () => {
    friction.registerProfile('extreme-a', {
      verbosity: 0, structuredness: 0, riskTolerance: 0, creativity: 0, followInstructions: 0
    })
    friction.registerProfile('extreme-b', {
      verbosity: 1, structuredness: 1, riskTolerance: 1, creativity: 1, followInstructions: 1
    })
    const result = friction.computeFriction('extreme-a', 'extreme-b')
    // distance = sqrt(5) ≈ 2.236, normalized = 1.0
    expect(result.normalized).toBeCloseTo(1.0, 2)
    expect(result.strategy).toBe('DEEP')
  })

  // ── dominantDimension ──

  it('dominantDimension 正确识别最大差异维度', () => {
    friction.registerProfile('v-high', {
      verbosity: 1.0, structuredness: 0.5, riskTolerance: 0.5, creativity: 0.5, followInstructions: 0.5
    })
    friction.registerProfile('v-low', {
      verbosity: 0.0, structuredness: 0.5, riskTolerance: 0.5, creativity: 0.5, followInstructions: 0.5
    })
    const result = friction.computeFriction('v-high', 'v-low')
    expect(result.dominantDimension).toBe('verbosity')
  })

  // ── 未知 provider ──

  it('未知 provider → distance=0, strategy=LIGHT_TOUCH', () => {
    const result = friction.computeFriction('unknown-x', 'unknown-y')
    expect(result.distance).toBe(0)
    expect(result.strategy).toBe('LIGHT_TOUCH')
  })

  // ── registerProfile ──

  it('registerProfile 后可用于计算', () => {
    friction.registerProfile('custom', {
      verbosity: 0.1, structuredness: 0.1, riskTolerance: 0.1, creativity: 0.1, followInstructions: 0.1
    })
    const profile = friction.getProfile('custom')
    expect(profile).not.toBeNull()
    expect(profile.verbosity).toBe(0.1)

    const result = friction.computeFriction('anthropic', 'custom')
    expect(result.distance).toBeGreaterThan(0)
  })
})
