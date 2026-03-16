/**
 * TrustDynamics 单元测试
 * @module tests/intelligence/social/trust-dynamics.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TrustDynamics } from '../../../src/intelligence/social/trust-dynamics.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'
import { DomainStore } from '../../../src/core/store/domain-store.js'

describe('TrustDynamics', () => {
  let trust, field, bus, store

  beforeEach(() => {
    bus = new EventBus()
    field = new SignalStore({ eventBus: bus })
    store = new DomainStore({ domain: 'trust-test', snapshotDir: '/tmp/trust-test' })
    trust = new TrustDynamics({ field, bus, store })
    trust.field = field
    trust.bus = bus
    trust.store = store
  })

  // ── 连续高 quality → score 趋近 1.0 ──

  it('连续高 quality 成功 → score 趋近 1.0', () => {
    for (let i = 0; i < 20; i++) {
      trust.update('a1', 1.0, true)
    }
    const t = trust.getTrust('a1')
    expect(t.score).toBeGreaterThan(0.95)
  })

  // ── 连续低 quality → score 趋近 0.0 ──

  it('连续低 quality 失败 → score 趋近 0.0', () => {
    for (let i = 0; i < 20; i++) {
      trust.update('a1', 0.0, false)
    }
    const t = trust.getTrust('a1')
    expect(t.score).toBeLessThan(0.05)
  })

  // ── 稳定 quality → consistency 上升 ──

  it('稳定 quality → consistency 上升', () => {
    const initial = trust.getTrust('a1').consistency // 0.5
    for (let i = 0; i < 15; i++) {
      trust.update('a1', 0.8, true)
    }
    const t = trust.getTrust('a1')
    expect(t.consistency).toBeGreaterThan(initial)
  })

  // ── 不稳定 quality → consistency 下降 ──

  it('不稳定 quality → consistency 下降', () => {
    // 先稳定到高 consistency
    for (let i = 0; i < 10; i++) {
      trust.update('a1', 0.8, true)
    }
    const before = trust.getTrust('a1').consistency

    // 然后大幅波动
    for (let i = 0; i < 10; i++) {
      trust.update('a1', i % 2 === 0 ? 1.0 : 0.0, i % 2 === 0)
    }
    const after = trust.getTrust('a1').consistency
    expect(after).toBeLessThan(before)
  })

  // ── field.emit DIM_TRUST ──

  it('update 后 field.emit DIM_TRUST', () => {
    const emitSpy = vi.spyOn(field, 'emit')
    trust.update('a1', 0.8, true)
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dimension: 'trust', scope: 'a1' })
    )
  })

  // ── getReliable 过滤 ──

  it('getReliable 过滤 minScore 和 minInteractions', () => {
    for (let i = 0; i < 10; i++) trust.update('a1', 0.9, true)
    for (let i = 0; i < 10; i++) trust.update('a2', 0.1, false)
    trust.update('a3', 0.9, true)
    trust.update('a3', 0.9, true)

    const reliable = trust.getReliable(0.7, 5)
    expect(reliable.length).toBe(1)
    expect(reliable[0].agentId).toBe('a1')
  })

  it('getReliable 按 score 降序排列', () => {
    for (let i = 0; i < 10; i++) trust.update('a1', 0.95, true)
    for (let i = 0; i < 10; i++) trust.update('a2', 0.85, true)

    const reliable = trust.getReliable(0.7, 5)
    expect(reliable.length).toBe(2)
    expect(reliable[0].score).toBeGreaterThanOrEqual(reliable[1].score)
  })

  // ── persist / restore ──

  it('persist + restore 完整性', () => {
    for (let i = 0; i < 5; i++) trust.update('a1', 0.9, true)
    trust.persist()

    const trust2 = new TrustDynamics({ field, bus, store })
    trust2.store = store
    trust2.restore()
    const t = trust2.getTrust('a1')
    expect(t.interactions).toBe(5)
    expect(t.score).toBeGreaterThan(0.5)
  })
})
