/**
 * SensitivityFilter 单元测试
 * @module tests/intelligence/identity/sensitivity-filter.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { SensitivityFilter } from '../../../src/intelligence/identity/sensitivity-filter.js'
import { RoleRegistry } from '../../../src/intelligence/identity/role-registry.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'

const ALL_12_DIMS = [
  'trail', 'alarm', 'reputation', 'task', 'knowledge', 'coordination',
  'emotion', 'trust', 'sna', 'learning', 'calibration', 'species',
]

describe('SensitivityFilter', () => {
  let filter, registry, signalStore, eventBus

  beforeEach(() => {
    eventBus = new EventBus()
    signalStore = new SignalStore({ eventBus })
    registry = new RoleRegistry({ field: signalStore, eventBus })
    filter = new SensitivityFilter({ signalStore, roleRegistry: registry })
  })

  it('applyFilter: researcher 的 knowledge 维度感知强 (sensitivity=0.9)', () => {
    const raw = {}
    for (const dim of ALL_12_DIMS) raw[dim] = 1.0
    const perceived = filter.applyFilter(raw, 'researcher')
    expect(perceived.knowledge).toBeCloseTo(0.9, 2)
  })

  it('applyFilter: implementer 的 task 维度感知强 (sensitivity=0.9)', () => {
    const raw = {}
    for (const dim of ALL_12_DIMS) raw[dim] = 1.0
    const perceived = filter.applyFilter(raw, 'implementer')
    expect(perceived.task).toBeCloseTo(0.9, 2)
  })

  it('applyFilter: 乘法关系正确 perceived = raw * sensitivity', () => {
    const raw = {}
    for (const dim of ALL_12_DIMS) raw[dim] = 0.5
    const perceived = filter.applyFilter(raw, 'researcher')
    // researcher knowledge sensitivity = 0.9, raw = 0.5 => 0.45
    expect(perceived.knowledge).toBeCloseTo(0.45, 2)
    // researcher alarm sensitivity = 0.2, raw = 0.5 => 0.10
    expect(perceived.alarm).toBeCloseTo(0.10, 2)
  })

  it('perceive: 返回 12 维过滤后向量', () => {
    // 先往 signalStore 写入一些信号
    signalStore.emit({ dimension: 'knowledge', scope: 'test-scope', strength: 0.8, emitterId: 'test' })
    const perceived = filter.perceive('test-scope', 'researcher')
    expect(Object.keys(perceived)).toHaveLength(12)
    for (const dim of ALL_12_DIMS) {
      expect(typeof perceived[dim]).toBe('number')
    }
  })

  it('comparePerceptions: 多角色返回不同结果', () => {
    signalStore.emit({ dimension: 'knowledge', scope: 'cmp-scope', strength: 0.8, emitterId: 'test' })
    signalStore.emit({ dimension: 'task', scope: 'cmp-scope', strength: 0.7, emitterId: 'test' })
    const result = filter.comparePerceptions('cmp-scope', ['researcher', 'implementer'])
    expect(result).toHaveProperty('researcher')
    expect(result).toHaveProperty('implementer')
    // researcher sees knowledge more, implementer sees task more
    expect(result.researcher.knowledge).not.toBe(result.implementer.knowledge)
  })

  it('零信号: perceived 也是零', () => {
    const raw = {}
    for (const dim of ALL_12_DIMS) raw[dim] = 0
    const perceived = filter.applyFilter(raw, 'researcher')
    for (const dim of ALL_12_DIMS) {
      expect(perceived[dim]).toBe(0)
    }
  })

  it('applyFilter: 不存在维度的原始值按 0 处理', () => {
    // raw 中缺少部分维度
    const perceived = filter.applyFilter({ knowledge: 0.5 }, 'researcher')
    expect(perceived.knowledge).toBeCloseTo(0.45, 2)
    expect(perceived.alarm).toBe(0)
  })

  it('perceive: 空 scope 返回 12 维零或近零向量', () => {
    const perceived = filter.perceive('empty-scope', 'researcher')
    for (const dim of ALL_12_DIMS) {
      expect(perceived[dim]).toBeGreaterThanOrEqual(0)
    }
  })
})
