/**
 * EpisodeLearner 单元测试
 * @module tests/intelligence/social/episode-learner.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EpisodeLearner } from '../../../src/intelligence/social/episode-learner.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'
import { DomainStore } from '../../../src/core/store/domain-store.js'

describe('EpisodeLearner', () => {
  let learner, field, bus, store

  beforeEach(() => {
    bus = new EventBus()
    field = new SignalStore({ eventBus: bus })
    store = new DomainStore({ domain: 'episode-test', snapshotDir: '/tmp/episode-test' })
    learner = new EpisodeLearner({ field, bus, store })
    learner.field = field
    learner.bus = bus
    learner.store = store
  })

  // ── 递增序列 → improving ──

  it('递增序列 [0.5,0.6,0.7,0.8,0.9] → improving', () => {
    const values = [0.5, 0.6, 0.7, 0.8, 0.9]
    for (const v of values) {
      learner.recordEpisode('role-1', 'quality', v)
    }
    const trend = learner.detectTrend('role-1', 'quality')
    expect(trend.direction).toBe('improving')
    expect(trend.slope).toBeGreaterThan(0.05)
  })

  // ── 递减序列 → declining ──

  it('递减序列 [0.9,0.8,0.7,0.6,0.5] → declining', () => {
    const values = [0.9, 0.8, 0.7, 0.6, 0.5]
    for (const v of values) {
      learner.recordEpisode('role-1', 'quality', v)
    }
    const trend = learner.detectTrend('role-1', 'quality')
    expect(trend.direction).toBe('declining')
    expect(trend.slope).toBeLessThan(-0.05)
  })

  // ── 波动序列 → plateau ──

  it('波动/平坦序列 → plateau', () => {
    const values = [0.5, 0.5, 0.5, 0.5, 0.5]
    for (const v of values) {
      learner.recordEpisode('role-1', 'quality', v)
    }
    const trend = learner.detectTrend('role-1', 'quality')
    expect(trend.direction).toBe('plateau')
  })

  // ── 不足5条 → insufficient-data ──

  it('不足5条 → insufficient-data', () => {
    learner.recordEpisode('role-1', 'quality', 0.5)
    learner.recordEpisode('role-1', 'quality', 0.6)
    learner.recordEpisode('role-1', 'quality', 0.7)
    const trend = learner.detectTrend('role-1', 'quality')
    expect(trend.direction).toBe('insufficient-data')
  })

  // ── field.emit DIM_LEARNING ──

  it('emitToField 写入 DIM_LEARNING', () => {
    for (const v of [0.5, 0.6, 0.7, 0.8, 0.9]) {
      learner.recordEpisode('role-1', 'quality', v)
    }
    const emitSpy = vi.spyOn(field, 'emit')

    learner.emitToField('role-1')
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dimension: 'learning', scope: 'role-1' })
    )
  })

  // ── learning.trend.detected 事件 ──

  it('趋势非 plateau 时发布 learning.trend.detected', () => {
    const publishSpy = vi.spyOn(bus, 'publish')
    for (const v of [0.5, 0.6, 0.7, 0.8, 0.9]) {
      learner.recordEpisode('role-1', 'quality', v)
    }
    const trendCalls = publishSpy.mock.calls.filter(c => c[0] === 'learning.trend.detected')
    expect(trendCalls.length).toBeGreaterThan(0)
  })

  // ── persist / restore ──

  it('persist + restore 完整性', () => {
    for (const v of [0.5, 0.6, 0.7, 0.8, 0.9]) {
      learner.recordEpisode('role-1', 'quality', v)
    }
    learner.persist()

    const learner2 = new EpisodeLearner({ field, bus, store })
    learner2.store = store
    learner2.restore()
    const trend = learner2.detectTrend('role-1', 'quality')
    expect(trend.direction).toBe('improving')
    expect(trend.count).toBe(5)
  })

  // ── history 上限 20 ──

  it('history 上限 20 条', () => {
    for (let i = 0; i < 25; i++) {
      learner.recordEpisode('role-1', 'metric', i * 0.01)
    }
    const trend = learner.detectTrend('role-1', 'metric')
    expect(trend.count).toBeLessThanOrEqual(20)
  })
})
