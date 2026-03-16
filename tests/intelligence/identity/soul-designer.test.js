/**
 * SoulDesigner 单元测试
 * @module tests/intelligence/identity/soul-designer.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { SoulDesigner } from '../../../src/intelligence/identity/soul-designer.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'

const FORBIDDEN_RE = /蜜蜂|bee|scout|employed|onlooker|Claude/i

const ARCHETYPE_IDS = [
  'analytical', 'creative', 'cautious', 'decisive', 'empathetic',
  'systematic', 'explorer', 'mentor', 'pragmatic', 'guardian',
]

describe('SoulDesigner', () => {
  let designer, signalStore, eventBus

  beforeEach(() => {
    eventBus = new EventBus()
    signalStore = new SignalStore({ eventBus })
    designer = new SoulDesigner({ signalStore })
  })

  it('10 个原型都可获取: getArchetype 非空', () => {
    for (const id of ARCHETYPE_IDS) {
      const archetype = designer.getArchetype(id)
      expect(archetype).toBeTruthy()
      expect(archetype.description).toBeTruthy()
      expect(archetype.traits).toBeTruthy()
    }
  })

  it('design 返回包含 archetype, traits, numericTraits, systemPromptModifier, behaviorBlend', () => {
    const result = designer.design('analytical')
    expect(result.archetype).toBe('analytical')
    expect(result.traits).toBeTruthy()
    expect(result.numericTraits).toBeTruthy()
    expect(typeof result.systemPromptModifier).toBe('string')
    expect(typeof result.behaviorBlend).toBe('string')
  })

  it('systemPromptModifier 是非空字符串', () => {
    for (const id of ARCHETYPE_IDS) {
      const result = designer.design(id)
      expect(result.systemPromptModifier.length).toBeGreaterThan(0)
    }
  })

  it('不含蜜蜂隐喻', () => {
    for (const id of ARCHETYPE_IDS) {
      const result = designer.design(id)
      expect(FORBIDDEN_RE.test(result.systemPromptModifier)).toBe(false)
      expect(FORBIDDEN_RE.test(result.behaviorBlend)).toBe(false)
    }
  })

  it('不含 "Claude"', () => {
    for (const id of ARCHETYPE_IDS) {
      const result = designer.design(id)
      expect(result.systemPromptModifier).not.toContain('Claude')
      expect(result.behaviorBlend).not.toContain('Claude')
    }
  })

  it('adjustForContext: 紧急任务调整 speed 上升, caution 下降', () => {
    const base = { creativity: 0.5, caution: 0.5, speed: 0.5, empathy: 0.5 }
    const adjusted = designer.adjustForContext(base, { urgent: true })
    expect(adjusted.speed).toBeGreaterThan(0.5)
    expect(adjusted.caution).toBeLessThan(0.5)
  })

  it('adjustForContext: 复杂任务调整 caution 上升, speed 下降', () => {
    const base = { creativity: 0.5, caution: 0.5, speed: 0.5, empathy: 0.5 }
    const adjusted = designer.adjustForContext(base, { complex: true })
    expect(adjusted.caution).toBeGreaterThan(0.5)
    expect(adjusted.speed).toBeLessThan(0.5)
  })

  it('design: 未知 archetype 回退到 pragmatic', () => {
    const result = designer.design('nonexistent-archetype')
    expect(result.archetype).toBe('pragmatic')
  })
})
