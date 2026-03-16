/**
 * ModelCapability 单元测试
 * @module tests/intelligence/identity/model-capability.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { ModelCapability } from '../../../src/intelligence/identity/model-capability.js'

describe('ModelCapability', () => {
  let mc

  beforeEach(() => {
    mc = new ModelCapability()
  })

  it('内建模型可获取: getCapability(sonnet-4) 非空', () => {
    const cap = mc.getCapability('sonnet-4')
    expect(cap).toBeTruthy()
    expect(cap.provider).toBe('anthropic')
  })

  it('getCapability 返回 provider, contextWindow, costPer1kInput, costPer1kOutput, categories, latencyClass, qualityTier', () => {
    const cap = mc.getCapability('opus-4')
    expect(typeof cap.provider).toBe('string')
    expect(typeof cap.contextWindow).toBe('number')
    expect(typeof cap.costPer1kInput).toBe('number')
    expect(typeof cap.costPer1kOutput).toBe('number')
    expect(Array.isArray(cap.categories)).toBe(true)
    expect(typeof cap.latencyClass).toBe('string')
    expect(typeof cap.qualityTier).toBe('string')
  })

  it('selectByCategory(fast-response) 返回包含 haiku', () => {
    const results = mc.selectByCategory('fast-response')
    expect(results).toContain('haiku-3.5')
  })

  it('selectByCategory(reasoning) 返回包含 opus', () => {
    const results = mc.selectByCategory('reasoning')
    expect(results).toContain('opus-4')
  })

  it('selectByCategory(general) 返回包含 sonnet', () => {
    const results = mc.selectByCategory('general')
    expect(results).toContain('sonnet-4')
  })

  it('registerModel: 注册新模型后可获取', () => {
    const ok = mc.registerModel('custom-llm', {
      provider: 'custom',
      contextWindow: 32000,
      costPer1kInput: 0.001,
      costPer1kOutput: 0.003,
      categories: ['general'],
      latencyClass: 'low',
      qualityTier: 'medium',
    })
    expect(ok).toBe(true)
    const cap = mc.getCapability('custom-llm')
    expect(cap).toBeTruthy()
    expect(cap.provider).toBe('custom')
  })

  it('estimateTokenCost: 返回 > 0 的数值', () => {
    const cost = mc.estimateTokenCost('sonnet-4', 1000, 500)
    expect(cost).toBeGreaterThan(0)
    // sonnet-4: 0.003/1k input + 0.015/1k output
    // 1000/1000 * 0.003 + 500/1000 * 0.015 = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105, 4)
  })

  it('无效 modelId: getCapability 返回 null', () => {
    expect(mc.getCapability('nonexistent-model')).toBeNull()
  })

  it('estimateTokenCost: 无效 modelId 返回 -1', () => {
    expect(mc.estimateTokenCost('fake', 100, 100)).toBe(-1)
  })

  it('5 个内建模型都可获取', () => {
    for (const id of ['sonnet-4', 'haiku-3.5', 'opus-4', 'gpt-4o', 'gemini-pro']) {
      expect(mc.getCapability(id)).toBeTruthy()
    }
  })
})
