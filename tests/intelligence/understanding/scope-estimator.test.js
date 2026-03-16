/**
 * ScopeEstimator 单元测试
 * @module tests/intelligence/understanding/scope-estimator.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { ScopeEstimator } from '../../../src/intelligence/understanding/scope-estimator.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'

describe('ScopeEstimator', () => {
  let estimator, field

  beforeEach(() => {
    field = new SignalStore()
    estimator = new ScopeEstimator({ field })
  })

  // ── bug_fix → 低风险, 少 agent ──

  it('bug_fix → riskLevel=low, estimatedAgents=1', () => {
    const result = estimator.estimate({ primary: 'bug_fix' })
    expect(result.riskLevel).toBe('low')
    expect(result.estimatedAgents).toBe(1)
  })

  // ── new_feature → 中风险, 多 agent ──

  it('new_feature → riskLevel=medium, estimatedAgents=2', () => {
    const result = estimator.estimate({ primary: 'new_feature' })
    expect(result.riskLevel).toBe('medium')
    expect(result.estimatedAgents).toBe(2)
  })

  // ── refactor → 高风险 ──

  it('refactor → riskLevel=high', () => {
    const result = estimator.estimate({ primary: 'refactor' })
    expect(result.riskLevel).toBe('high')
  })

  // ── affectedFiles > 10 → risk 上调 ──

  it('affectedFiles > 10 → risk 上调一级', () => {
    const files = Array.from({ length: 15 }, (_, i) => `file${i}.js`)
    const result = estimator.estimate({ primary: 'bug_fix' }, { affectedFiles: files })
    // bug_fix base risk = 'low' → 上调到 'medium'
    expect(result.riskLevel).toBe('medium')
  })

  // ── hasStrongPairs → agents 减少 ──

  it('hasStrongPairs → agents 减少', () => {
    const result = estimator.estimate(
      { primary: 'new_feature' },
      { hasStrongPairs: true }
    )
    // new_feature base agents=2, with strong pairs → 1
    expect(result.estimatedAgents).toBe(1)
  })

  // ── trend improving → phases 减少 ──

  it('trend improving → phases 减少', () => {
    const base = estimator.estimate({ primary: 'new_feature' })
    const improved = estimator.estimate(
      { primary: 'new_feature' },
      { trend: 'improving' }
    )
    expect(improved.estimatedPhases).toBeLessThanOrEqual(base.estimatedPhases)
  })

  // ── trend declining → phases 增加 ──

  it('trend declining → phases 增加', () => {
    const base = estimator.estimate({ primary: 'new_feature' })
    const declined = estimator.estimate(
      { primary: 'new_feature' },
      { trend: 'declining' }
    )
    expect(declined.estimatedPhases).toBeGreaterThanOrEqual(base.estimatedPhases)
  })

  // ── 测试文件 → 增加 phase ──

  it('affectedFiles 含 test 文件 → 增加 phase', () => {
    const base = estimator.estimate({ primary: 'bug_fix' })
    const withTests = estimator.estimate(
      { primary: 'bug_fix' },
      { affectedFiles: ['app.js', 'app.test.js'] }
    )
    expect(withTests.estimatedPhases).toBe(base.estimatedPhases + 1)
  })

  // ── recommendation 包含任务类型 ──

  it('recommendation 包含任务类型和风险等级', () => {
    const result = estimator.estimate({ primary: 'bug_fix' })
    expect(result.recommendation).toContain('bug_fix')
    expect(result.recommendation).toContain('low')
  })

  // ── estimatedTimeMinutes = phases * 15 ──

  it('estimatedTimeMinutes = phases * 15', () => {
    const result = estimator.estimate({ primary: 'new_feature' })
    expect(result.estimatedTimeMinutes).toBe(result.estimatedPhases * 15)
  })

  // ── 未知 intent → 使用 question 模板 ──

  it('未知 intent → 使用 question 模板', () => {
    const result = estimator.estimate({ primary: 'unknown_intent' })
    expect(result.riskLevel).toBe('low')
    expect(result.estimatedAgents).toBe(1)
  })
})
