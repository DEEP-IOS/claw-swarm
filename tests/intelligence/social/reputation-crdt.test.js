/**
 * ReputationCRDT 单元测试
 * @module tests/intelligence/social/reputation-crdt.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReputationCRDT } from '../../../src/intelligence/social/reputation-crdt.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'
import { DomainStore } from '../../../src/core/store/domain-store.js'

describe('ReputationCRDT', () => {
  let crdt, field, bus, store

  beforeEach(() => {
    bus = new EventBus()
    field = new SignalStore({ eventBus: bus })
    store = new DomainStore({ domain: 'rep-test', snapshotDir: '/tmp/rep-test' })
    crdt = new ReputationCRDT({ field, bus, store })
    // ModuleBase 不存储参数，手动注入
    crdt.field = field
    crdt.bus = bus
    crdt.store = store
  })

  // ── increment / decrement ──

  it('increment 正确更新 positive 计数', () => {
    crdt.increment('agent-1')
    crdt.increment('agent-1')
    const score = crdt.getScore('agent-1')
    expect(score.positive).toBe(2)
    expect(score.negative).toBe(0)
    expect(score.net).toBe(2)
    expect(score.total).toBe(2)
  })

  it('decrement 正确更新 negative 计数', () => {
    crdt.decrement('agent-1')
    crdt.decrement('agent-1')
    crdt.decrement('agent-1')
    const score = crdt.getScore('agent-1')
    expect(score.positive).toBe(0)
    expect(score.negative).toBe(3)
    expect(score.net).toBe(-3)
  })

  it('increment + decrement 混合更新正确', () => {
    crdt.increment('a')
    crdt.increment('a')
    crdt.decrement('a')
    const score = crdt.getScore('a')
    expect(score.positive).toBe(2)
    expect(score.negative).toBe(1)
    expect(score.net).toBe(1)
    expect(score.ratio).toBeCloseTo(2 / 3, 5)
  })

  // ── getScore ratio ──

  it('getScore: 无数据时 ratio = 0.5', () => {
    const score = crdt.getScore('unknown')
    expect(score.ratio).toBe(0.5)
    expect(score.total).toBe(0)
  })

  it('getScore: ratio = positive / total', () => {
    crdt.increment('x')
    crdt.increment('x')
    crdt.increment('x')
    crdt.decrement('x')
    const score = crdt.getScore('x')
    expect(score.ratio).toBeCloseTo(3 / 4, 5)
  })

  // ── merge 幂等性 ──

  it('merge 幂等: 同一远端状态 merge 两次结果不变', () => {
    crdt.increment('a')
    const remote = { agentId: 'a', positive: 5, negative: 2 }
    crdt.merge(remote)
    const after1 = crdt.getScore('a')
    crdt.merge(remote)
    const after2 = crdt.getScore('a')
    expect(after1.positive).toBe(after2.positive)
    expect(after1.negative).toBe(after2.negative)
  })

  // ── merge 交换性 ──

  it('merge 交换性: A.merge(B) 和 B.merge(A) 最终一致', () => {
    const crdtA = new ReputationCRDT({ field, bus, store })
    const crdtB = new ReputationCRDT({ field, bus, store })

    crdtA.increment('x')
    crdtA.increment('x')
    crdtB.increment('x')
    crdtB.decrement('x')
    crdtB.decrement('x')

    // A merges B's state
    const bState = crdtB.exportAll()
    crdtA.merge({ agentId: 'x', ...bState['x'] })

    // B merges A's state
    const aState = crdtA.exportAll()
    crdtB.merge({ agentId: 'x', ...aState['x'] })

    expect(crdtA.getScore('x').positive).toBe(crdtB.getScore('x').positive)
    expect(crdtA.getScore('x').negative).toBe(crdtB.getScore('x').negative)
  })

  // ── field.emit ──

  it('increment 后 field.emit 被调用(DIM_REPUTATION)', () => {
    const emitSpy = vi.spyOn(field, 'emit')
    crdt.increment('z')
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dimension: 'reputation', scope: 'z' })
    )
  })

  it('decrement 后 field.emit 被调用', () => {
    const emitSpy = vi.spyOn(field, 'emit')
    crdt.decrement('z')
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dimension: 'reputation', scope: 'z' })
    )
  })

  // ── getTop / getBottom ──

  it('getTop 按 net 降序排列且尊重 minTotal', () => {
    // agent-a: +5, -1 = net 4, total 6
    for (let i = 0; i < 5; i++) crdt.increment('agent-a')
    crdt.decrement('agent-a')
    // agent-b: +3, -0 = net 3, total 3
    for (let i = 0; i < 3; i++) crdt.increment('agent-b')
    // agent-c: +1, -0 = net 1, total 1 (below minTotal=3)
    crdt.increment('agent-c')

    const top = crdt.getTop(10, 3)
    expect(top.length).toBe(2) // agent-c excluded
    expect(top[0].agentId).toBe('agent-a')
    expect(top[1].agentId).toBe('agent-b')
  })

  it('getBottom 按 net 升序排列', () => {
    for (let i = 0; i < 5; i++) crdt.decrement('agent-bad')
    for (let i = 0; i < 3; i++) crdt.increment('agent-ok')

    const bottom = crdt.getBottom(10, 3)
    expect(bottom[0].agentId).toBe('agent-bad')
  })

  // ── persist / restore ──

  it('persist + restore 完整性', () => {
    crdt.increment('p')
    crdt.increment('p')
    crdt.decrement('p')
    crdt.persist()

    const crdt2 = new ReputationCRDT({ field, bus, store })
    crdt2.store = store
    crdt2.restore()
    const score = crdt2.getScore('p')
    expect(score.positive).toBe(2)
    expect(score.negative).toBe(1)
  })
})
