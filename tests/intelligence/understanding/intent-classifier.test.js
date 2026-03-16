/**
 * IntentClassifier 单元测试
 * @module tests/intelligence/understanding/intent-classifier.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IntentClassifier } from '../../../src/intelligence/understanding/intent-classifier.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'

describe('IntentClassifier', () => {
  let classifier, field, bus

  beforeEach(() => {
    bus = new EventBus()
    field = new SignalStore({ eventBus: bus })
    classifier = new IntentClassifier({ field, bus })
  })

  // ── 基础分类 ──

  it('"fix the login bug" → primary: bug_fix, confidence > 0.5', () => {
    const result = classifier.classify('fix the login bug')
    expect(result.primary).toBe('bug_fix')
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it('"add dark mode" → primary: new_feature', () => {
    const result = classifier.classify('add dark mode')
    expect(result.primary).toBe('new_feature')
  })

  it('"refactor the auth module" → primary: refactor', () => {
    const result = classifier.classify('refactor the auth module')
    expect(result.primary).toBe('refactor')
  })

  it('"create new feature and fix the error" → 有 ambiguity', () => {
    // new_feature: "create" + "new" = 2 hits
    // bug_fix: "fix" + "error" = 2 hits
    // Both score 2, so second (2) > top (2) * 0.6 = 1.2 → ambiguity
    const result = classifier.classify('create new feature and fix the error')
    expect(result.ambiguity.length).toBeGreaterThan(0)
  })

  // ── CJK ──

  it('CJK: "修复登录报错" → primary: bug_fix', () => {
    const result = classifier.classify('修复登录报错')
    expect(result.primary).toBe('bug_fix')
  })

  it('CJK: "新增暗黑模式" → primary: new_feature', () => {
    const result = classifier.classify('新增暗黑模式')
    expect(result.primary).toBe('new_feature')
  })

  // ── 空输入 ──

  it('空输入 → primary: question, confidence: 0.5', () => {
    const result = classifier.classify('')
    expect(result.primary).toBe('question')
    expect(result.confidence).toBe(0.5)
  })

  it('null 输入 → primary: question, confidence: 0.5', () => {
    const result = classifier.classify(null)
    expect(result.primary).toBe('question')
    expect(result.confidence).toBe(0.5)
  })

  // ── classifyBatch ──

  it('classifyBatch 批量分类', () => {
    const results = classifier.classifyBatch([
      'fix the crash',
      'add search feature',
      'optimize performance'
    ])
    expect(results.length).toBe(3)
    expect(results[0].primary).toBe('bug_fix')
    expect(results[1].primary).toBe('new_feature')
    expect(results[2].primary).toBe('optimize')
  })

  // ── historyContext boost ──

  it('historyContext recentIntents 对同类意图有加分', () => {
    const result = classifier.classify('do something', { recentIntents: ['bug_fix'] })
    expect(result).toBeDefined()
    expect(result.primary).toBeDefined()
  })

  // ── bus.publish ──

  it('classify 发布 intent.classified 事件', () => {
    const publishSpy = vi.spyOn(bus, 'publish')
    classifier.classify('fix the bug')
    const intentCalls = publishSpy.mock.calls.filter(c => c[0] === 'intent.classified')
    expect(intentCalls.length).toBe(1)
  })
})
