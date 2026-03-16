/**
 * SelfReflection 单元测试
 * @module tests/intelligence/social/self-reflection.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SelfReflection } from '../../../src/intelligence/social/self-reflection.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'
import { DomainStore } from '../../../src/core/store/domain-store.js'

describe('SelfReflection', () => {
  let reflection, field, bus, store, mockCapEngine, mockRepCRDT

  beforeEach(() => {
    bus = new EventBus()
    field = new SignalStore({ eventBus: bus })
    store = new DomainStore({ domain: 'reflect-test', snapshotDir: '/tmp/reflect-test' })
    mockCapEngine = {
      updateSkill: vi.fn()
    }
    mockRepCRDT = {
      increment: vi.fn(),
      decrement: vi.fn()
    }
    reflection = new SelfReflection({
      field, bus, store,
      capabilityEngine: mockCapEngine,
      reputationCRDT: mockRepCRDT
    })
    // ModuleBase 不存储 field/bus/store，手动注入
    reflection.field = field
    reflection.bus = bus
    reflection.store = store
  })

  // ── 成功任务 → capabilityEngine.updateSkill 正向 ──

  it('成功任务 → capabilityEngine.updateSkill 正向调用', () => {
    reflection.reflect('agent-1', 'coder', {
      success: true,
      files: ['a.js'],
      tools: ['read', 'write'],
      errors: [],
      duration: 5000
    })
    expect(mockCapEngine.updateSkill).toHaveBeenCalledWith('coder', 'task-completion', 0.1)
    expect(mockCapEngine.updateSkill).toHaveBeenCalledWith('coder', 'clean-output', 0.1)
  })

  it('成功任务 → reputationCRDT.increment 被调用', () => {
    reflection.reflect('agent-1', 'coder', { success: true, files: [], tools: [], errors: [], duration: 1000 })
    expect(mockRepCRDT.increment).toHaveBeenCalledWith('agent-1')
  })

  // ── 失败任务 → weaknesses ──

  it('失败任务 → capabilityEngine.updateSkill 负向调用', () => {
    reflection.reflect('agent-1', 'coder', {
      success: false,
      files: [],
      tools: [],
      errors: ['timeout occurred', 'timeout again', 'timeout 3', 'other error'],
      duration: 30000
    })
    expect(mockCapEngine.updateSkill).toHaveBeenCalledWith('coder', 'error-prone', -0.1)
    expect(mockCapEngine.updateSkill).toHaveBeenCalledWith('coder', 'task-failure', -0.1)
    expect(mockCapEngine.updateSkill).toHaveBeenCalledWith('coder', 'slow-execution', -0.1)
  })

  it('失败任务 → reputationCRDT.decrement 被调用', () => {
    reflection.reflect('agent-1', 'coder', { success: false, files: [], tools: [], errors: [], duration: 0 })
    expect(mockRepCRDT.decrement).toHaveBeenCalledWith('agent-1')
  })

  // ── 持久化到 store ──

  it('reflect 将结果持久化到 store', () => {
    reflection.reflect('agent-1', 'coder', { success: true, files: ['a.js'], tools: [], errors: [], duration: 1000 })
    const data = store.get('social', 'reflections-agent-1')
    expect(data).toBeDefined()
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBe(1)
    expect(data[0].success).toBe(true)
  })

  // ── reflection.completed 事件 ──

  it('reflect 发布 reflection.completed 事件', () => {
    const publishSpy = vi.spyOn(bus, 'publish')
    reflection.reflect('agent-1', 'coder', { success: true, files: [], tools: [], errors: [], duration: 1000 })

    const reflectionCalls = publishSpy.mock.calls.filter(c => c[0] === 'reflection.completed')
    expect(reflectionCalls.length).toBe(1)
    expect(reflectionCalls[0][1]).toHaveProperty('strengths')
  })

  // ── getReflectionHistory ──

  it('getReflectionHistory 返回最近的记录', () => {
    for (let i = 0; i < 5; i++) {
      reflection.reflect('agent-1', 'coder', { success: i % 2 === 0, files: [], tools: [], errors: [], duration: 1000 })
    }
    const history = reflection.getReflectionHistory('agent-1', 3)
    expect(history.length).toBe(3)
  })
})
