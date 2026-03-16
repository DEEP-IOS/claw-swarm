/**
 * EILayer 单元测试
 * @module tests/intelligence/social/ei-layer.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { EILayer } from '../../../src/intelligence/social/ei-layer.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'

describe('EILayer', () => {
  let ei, field

  beforeEach(() => {
    field = new SignalStore()
    ei = new EILayer({ field })
  })

  // ── adjustPromptTone ──

  it('高 emotion + 低 trust → prompt 追加两条提示', () => {
    const base = 'Do the task.'
    const result = ei.adjustPromptTone(base, { emotion: 0.8, trust: 0.2 })
    expect(result).not.toBe(base)
    // Should contain hints about difficulty analysis and stricter review
    expect(result).toContain('分析失败原因')
    expect(result).toContain('更严格的审查')
  })

  it('低 emotion + 高 trust → 追加保持节奏提示', () => {
    const base = 'Do the task.'
    const result = ei.adjustPromptTone(base, { emotion: 0.1, trust: 0.8 })
    expect(result).toContain('保持节奏')
  })

  it('无 perceivedField → 返回原始 prompt', () => {
    const base = 'Do the task.'
    expect(ei.adjustPromptTone(base, null)).toBe(base)
  })

  it('中性 emotion/trust → 不追加内容', () => {
    const base = 'Do the task.'
    const result = ei.adjustPromptTone(base, { emotion: 0.4, trust: 0.5 })
    expect(result).toBe(base)
  })

  // ── suggestTone ──

  it('suggestTone: frustration > 0.6 → encouraging', () => {
    expect(ei.suggestTone({ frustration: 0.7, confidence: 0.3, fatigue: 0.2 }))
      .toBe('encouraging')
  })

  it('suggestTone: confidence > 0.8 → cautious', () => {
    expect(ei.suggestTone({ frustration: 0.2, confidence: 0.9, fatigue: 0.2 }))
      .toBe('cautious')
  })

  it('suggestTone: fatigue > 0.7 → focused', () => {
    expect(ei.suggestTone({ frustration: 0.2, confidence: 0.5, fatigue: 0.8 }))
      .toBe('focused')
  })

  it('suggestTone: 均低 → neutral', () => {
    expect(ei.suggestTone({ frustration: 0.2, confidence: 0.5, fatigue: 0.3 }))
      .toBe('neutral')
  })

  it('suggestTone: null → neutral', () => {
    expect(ei.suggestTone(null)).toBe('neutral')
  })

  // ── adjustPresentation ──

  it('adjustPresentation: concise 截断到首段且<=500字符', () => {
    const longText = 'First paragraph.\n\nSecond paragraph with more detail.\n\nThird.'
    const result = ei.adjustPresentation(longText, { communicationStyle: 'concise' })
    expect(result).toBe('First paragraph.')
  })

  it('adjustPresentation: structured 包裹 markdown', () => {
    const plainText = 'Some result without headers.'
    const result = ei.adjustPresentation(plainText, { communicationStyle: 'structured' })
    expect(result).toContain('## Result')
    expect(result).toContain(plainText)
  })

  it('adjustPresentation: 无 userProfile → 原样返回', () => {
    const text = 'hello'
    expect(ei.adjustPresentation(text, null)).toBe(text)
  })
})
