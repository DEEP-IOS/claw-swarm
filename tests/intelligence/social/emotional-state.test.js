/**
 * EmotionalState 单元测试
 * @module tests/intelligence/social/emotional-state.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EmotionalState } from '../../../src/intelligence/social/emotional-state.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'

describe('EmotionalState', () => {
  let emo, field, bus

  beforeEach(() => {
    bus = new EventBus()
    field = new SignalStore({ eventBus: bus })
    emo = new EmotionalState({ field, bus })
    emo.field = field
    emo.bus = bus
  })

  // ── 连续失败 ──

  it('连续4次失败 → frustration=1.0, confidence=0.0', () => {
    for (let i = 0; i < 4; i++) emo.recordOutcome('a1', false)
    const e = emo.getEmotion('a1')
    expect(e.frustration).toBe(1.0)
    expect(e.confidence).toBe(0.0)
  })

  // ── 连续成功 ──

  it('连续4次成功 → frustration=0.0, confidence=1.0', () => {
    for (let i = 0; i < 4; i++) emo.recordOutcome('a1', true)
    const e = emo.getEmotion('a1')
    expect(e.frustration).toBe(0.0)
    expect(e.confidence).toBe(1.0)
  })

  // ── 混合结果 ──

  it('混合结果 → 中间值', () => {
    emo.recordOutcome('a1', true)
    emo.recordOutcome('a1', false)
    emo.recordOutcome('a1', true)
    emo.recordOutcome('a1', false)
    const e = emo.getEmotion('a1')
    expect(e.frustration).toBeGreaterThan(0)
    expect(e.frustration).toBeLessThan(1)
    expect(e.confidence).toBeGreaterThan(0)
    expect(e.confidence).toBeLessThan(1)
  })

  // ── field.emit ──

  it('recordOutcome 后 field.emit DIM_EMOTION', () => {
    const emitSpy = vi.spyOn(field, 'emit')
    emo.recordOutcome('a1', true)
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dimension: 'emotion', scope: 'a1' })
    )
  })

  // ── emotion.changed 事件 ──

  it('delta > 0.15 时 publish emotion.changed', () => {
    const publishSpy = vi.spyOn(bus, 'publish')
    // 从默认 {frustration:0, confidence:0.5, fatigue:0} → 4次失败
    // frustration: 0→0.25→0.5→0.75→1.0, confidence: 0.5→0.25→0.0...
    // 每次 delta 都大, 应该至少有一次 emotion.changed
    emo.recordOutcome('a1', false)
    emo.recordOutcome('a1', false)
    emo.recordOutcome('a1', false)
    emo.recordOutcome('a1', false)

    const emotionChangedCalls = publishSpy.mock.calls.filter(c => c[0] === 'emotion.changed')
    expect(emotionChangedCalls.length).toBeGreaterThan(0)
  })

  it('微小变化不触发 emotion.changed', () => {
    // 先稳定到全失败
    for (let i = 0; i < 5; i++) emo.recordOutcome('a1', false)
    const publishSpy = vi.spyOn(bus, 'publish')
    // 再来一次失败, delta 应该很小 (已经是 frustration=1, confidence=0)
    emo.recordOutcome('a1', false)
    const emotionChangedCalls = publishSpy.mock.calls.filter(c => c[0] === 'emotion.changed')
    expect(emotionChangedCalls.length).toBe(0)
  })

  // ── history 最大 10 条 ──

  it('history 不超过 10 条', () => {
    for (let i = 0; i < 15; i++) emo.recordOutcome('a1', true)
    const e = emo.getEmotion('a1')
    expect(e.historyLength).toBeLessThanOrEqual(10)
  })

  // ── cleanup ──

  it('cleanup 删除 agent 状态', () => {
    emo.recordOutcome('a1', true)
    emo.cleanup('a1')
    const e = emo.getEmotion('a1')
    expect(e.historyLength).toBe(0)
    expect(e.confidence).toBe(0.5)
  })
})
