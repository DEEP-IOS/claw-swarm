/**
 * CapabilityEngine 单元测试
 * @module tests/intelligence/identity/capability-engine.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CapabilityEngine } from '../../../src/intelligence/identity/capability-engine.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'
import { DomainStore } from '../../../src/core/store/domain-store.js'

describe('CapabilityEngine', () => {
  let engine, signalStore, eventBus, domainStore

  beforeEach(() => {
    eventBus = new EventBus()
    signalStore = new SignalStore({ eventBus })
    domainStore = new DomainStore({ domain: 'cap-test', snapshotDir: '/tmp/cap-test' })
    engine = new CapabilityEngine({ signalStore, domainStore, eventBus })
  })

  it('initializeProfile + updateSkill 正确更新 mastery', () => {
    engine.initializeProfile('a1', { javascript: 0.6 })
    engine.updateSkill('a1', 'javascript', 1.0)
    const profile = engine.getSkillProfile('a1')
    // EMA: 0.3 * 1.0 + 0.7 * 0.6 = 0.72
    expect(profile.javascript).toBeCloseTo(0.72, 2)
  })

  it('mastery clamp [0, 1]: 极大 delta 不超过 1', () => {
    engine.initializeProfile('a2', { python: 0.9 })
    engine.updateSkill('a2', 'python', 100) // clamped to 1.0 inside
    const profile = engine.getSkillProfile('a2')
    expect(profile.python).toBeLessThanOrEqual(1)
    expect(profile.python).toBeGreaterThan(0.9)
  })

  it('getCapabilityScore: 有记录的 domain 返回 > 0', () => {
    engine.initializeProfile('a3', { react: 0.8 })
    expect(engine.getCapabilityScore('a3', 'react')).toBe(0.8)
  })

  it('getCapabilityScore: 模糊匹配 typescript->javascript (衰减后)', () => {
    engine.initializeProfile('a4', { typescript: 0.8 })
    // javascript is related to typescript with decay 0.4
    const score = engine.getCapabilityScore('a4', 'javascript')
    expect(score).toBeCloseTo(0.8 * 0.4, 2)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(0.8)
  })

  it('getTopSkills: 返回 mastery 最高的', () => {
    engine.initializeProfile('a5', { javascript: 0.9, python: 0.4, css: 0.7 })
    const top = engine.getTopSkills('a5', 2)
    expect(top).toHaveLength(2)
    expect(top[0].domain).toBe('javascript')
    expect(top[0].score).toBe(0.9)
  })

  it('getWeaknesses: 返回 mastery < threshold 的', () => {
    engine.initializeProfile('a6', { javascript: 0.1, python: 0.8, css: 0.3 })
    const weak = engine.getWeaknesses('a6', 0.4)
    expect(weak.length).toBeGreaterThanOrEqual(2)
    expect(weak.every(w => w.score < 0.4)).toBe(true)
  })

  it('eventBus 接收 capability.updated 事件', () => {
    const handler = vi.fn()
    eventBus.subscribe('capability.updated', handler)
    engine.initializeProfile('a7', {})
    engine.updateSkill('a7', 'go', 0.6)
    expect(handler).toHaveBeenCalled()
    const data = handler.mock.calls[0][0].data
    expect(data.domain).toBe('go')
  })

  it('signalStore.emit(DIM_LEARNING) 被调用', () => {
    const emitSpy = vi.spyOn(signalStore, 'emit')
    engine.initializeProfile('a8', {})
    engine.updateSkill('a8', 'rust', 0.7)
    const learningCall = emitSpy.mock.calls.find(
      c => c[0] && c[0].dimension === 'learning'
    )
    expect(learningCall).toBeTruthy()
  })

  it('getCapabilityScore: 完全未知 domain 返回 baseline 0.3', () => {
    engine.initializeProfile('a9', { javascript: 0.8 })
    expect(engine.getCapabilityScore('a9', 'cobol')).toBe(0.3)
  })

  it('无 profile 的 agent: getCapabilityScore 返回 0.3', () => {
    expect(engine.getCapabilityScore('unknown-agent', 'javascript')).toBe(0.3)
  })
})
