/**
 * RequirementClarifier 单元测试
 * @module tests/intelligence/understanding/requirement-clarifier.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RequirementClarifier } from '../../../src/intelligence/understanding/requirement-clarifier.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'

describe('RequirementClarifier', () => {
  let clarifier, field, bus

  beforeEach(() => {
    bus = new EventBus()
    field = new SignalStore({ eventBus: bus })
    clarifier = new RequirementClarifier({ field, bus })
  })

  // ── bug_fix 意图 → 至少2个 high-impact 问题 ──

  it('bug_fix 意图 → 至少2个 high-impact 问题', () => {
    const questions = clarifier.generateQuestions({ primary: 'bug_fix', confidence: 0.8, ambiguity: [] })
    const highImpact = questions.filter(q => q.impact === 'high')
    expect(highImpact.length).toBeGreaterThanOrEqual(2)
  })

  // ── ambiguity → 生成歧义消解问题 ──

  it('有 ambiguity → 生成歧义消解问题', () => {
    const questions = clarifier.generateQuestions({
      primary: 'bug_fix',
      confidence: 0.5,
      ambiguity: ['optimize']
    })
    const disambiguationQ = questions.find(q => q.question.includes('多个方面'))
    expect(disambiguationQ).toBeDefined()
    expect(disambiguationQ.impact).toBe('high')
  })

  // ── 无 ambiguity → 无歧义消解问题 ──

  it('无 ambiguity → 无歧义消解问题', () => {
    const questions = clarifier.generateQuestions({
      primary: 'new_feature',
      confidence: 0.9,
      ambiguity: []
    })
    const disambiguationQ = questions.find(q => q.question.includes('多个方面'))
    expect(disambiguationQ).toBeUndefined()
  })

  // ── 问题按 impact 排序 ──

  it('问题按 impact 排序: high 在前', () => {
    const questions = clarifier.generateQuestions({
      primary: 'new_feature',
      confidence: 0.5,
      ambiguity: ['bug_fix']
    })
    // 第一个问题应该是 high impact
    const firstHighIdx = questions.findIndex(q => q.impact === 'high')
    const firstMediumIdx = questions.findIndex(q => q.impact === 'medium')
    if (firstHighIdx >= 0 && firstMediumIdx >= 0) {
      expect(firstHighIdx).toBeLessThan(firstMediumIdx)
    }
  })

  // ── refineRequirement ──

  it('refineRequirement 合并答案', () => {
    const answers = new Map([
      ['能否提供复现步骤？', '登录后点击设置页面就崩溃'],
      ['有相关的错误日志吗？', 'TypeError: undefined is not a function']
    ])
    const result = clarifier.refineRequirement('修复登录报错', answers)
    expect(result.original).toBe('修复登录报错')
    expect(result.refined).toContain('修复登录报错')
    expect(result.refined).toContain('登录后点击设置页面就崩溃')
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it('refineRequirement: 更多答案 → 更高 confidence', () => {
    const oneAnswer = new Map([['q1', 'a1']])
    const threeAnswers = new Map([['q1', 'a1'], ['q2', 'a2'], ['q3', 'a3']])
    const r1 = clarifier.refineRequirement('task', oneAnswer)
    const r3 = clarifier.refineRequirement('task', threeAnswers)
    expect(r3.confidence).toBeGreaterThan(r1.confidence)
  })

  // ── codebase context ──

  it('codebaseContext.hasTests=false → 补充测试问题', () => {
    const questions = clarifier.generateQuestions(
      { primary: 'bug_fix', confidence: 0.8, ambiguity: [] },
      { hasTests: false }
    )
    const testQ = questions.find(q => q.question.includes('测试'))
    expect(testQ).toBeDefined()
  })

  // ── isAmbiguous ──

  it('isAmbiguous: 低 confidence + ambiguity → true', () => {
    expect(clarifier.isAmbiguous({ confidence: 0.4, ambiguity: ['optimize'] })).toBe(true)
  })

  it('isAmbiguous: 高 confidence → false', () => {
    expect(clarifier.isAmbiguous({ confidence: 0.8, ambiguity: ['optimize'] })).toBe(false)
  })
})
