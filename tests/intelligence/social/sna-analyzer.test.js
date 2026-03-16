/**
 * SNAAnalyzer 单元测试
 * @module tests/intelligence/social/sna-analyzer.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SNAAnalyzer } from '../../../src/intelligence/social/sna-analyzer.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'

describe('SNAAnalyzer', () => {
  let sna, field, bus

  beforeEach(() => {
    bus = new EventBus()
    field = new SignalStore({ eventBus: bus })
    sna = new SNAAnalyzer({ field, bus })
    sna.field = field
    sna.bus = bus
  })

  // ── recordCollaboration ──

  it('recordCollaboration 后 edge 正确更新', () => {
    const edge = sna.recordCollaboration('A', 'B', true)
    expect(edge.weight).toBe(1)
    expect(edge.successes).toBe(1)
    expect(edge.failures).toBe(0)
  })

  it('多次 recordCollaboration 累计 weight', () => {
    sna.recordCollaboration('A', 'B', true)
    sna.recordCollaboration('A', 'B', false)
    const edge = sna.recordCollaboration('A', 'B', true)
    expect(edge.weight).toBe(3)
    expect(edge.successes).toBe(2)
    expect(edge.failures).toBe(1)
  })

  // ── key 规范化 ──

  it('key 规范化: (B,A) 和 (A,B) 共享同一边', () => {
    sna.recordCollaboration('B', 'A', true)
    const edge = sna.recordCollaboration('A', 'B', true)
    expect(edge.weight).toBe(2)
  })

  // ── getStrongPairs ──

  it('getStrongPairs 过滤 minWeight 和 minSuccessRate', () => {
    // A-B: 5次, 4成功 = 80% success rate
    for (let i = 0; i < 4; i++) sna.recordCollaboration('A', 'B', true)
    sna.recordCollaboration('A', 'B', false)
    // C-D: 5次, 1成功 = 20% success rate
    sna.recordCollaboration('C', 'D', true)
    for (let i = 0; i < 4; i++) sna.recordCollaboration('C', 'D', false)

    const strong = sna.getStrongPairs(3, 0.6)
    expect(strong.length).toBe(1)
    expect(strong[0].agentA).toBe('A')
  })

  it('getStrongPairs 按 weight 降序排列', () => {
    for (let i = 0; i < 6; i++) sna.recordCollaboration('X', 'Y', true)
    for (let i = 0; i < 4; i++) sna.recordCollaboration('A', 'B', true)

    const strong = sna.getStrongPairs(3, 0.6)
    expect(strong[0].edge.weight).toBeGreaterThanOrEqual(strong[1].edge.weight)
  })

  // ── computeCentrality ──

  it('computeCentrality: 3节点三角形', () => {
    sna.recordCollaboration('A', 'B', true)
    sna.recordCollaboration('B', 'C', true)
    sna.recordCollaboration('A', 'C', true)

    const centrality = sna.computeCentrality()
    expect(centrality.get('A')).toBe(2)
    expect(centrality.get('B')).toBe(2)
    expect(centrality.get('C')).toBe(2)
  })

  it('computeCentrality: 星形拓扑中心节点最高', () => {
    sna.recordCollaboration('center', 'a', true)
    sna.recordCollaboration('center', 'b', true)
    sna.recordCollaboration('center', 'c', true)

    const centrality = sna.computeCentrality()
    expect(centrality.get('center')).toBe(3)
    expect(centrality.get('a')).toBe(1)
  })

  // ── getCollaborators ──

  it('getCollaborators 返回正确的合作者列表', () => {
    sna.recordCollaboration('X', 'A', true)
    sna.recordCollaboration('X', 'B', true)
    sna.recordCollaboration('A', 'B', true)

    const collaborators = sna.getCollaborators('X')
    const ids = collaborators.map(c => c.agentId).sort()
    expect(ids).toEqual(['A', 'B'])
  })

  // ── toFieldSignal ──

  it('toFieldSignal 写入 DIM_SNA', () => {
    for (let i = 0; i < 4; i++) sna.recordCollaboration('A', 'B', true)
    const emitSpy = vi.spyOn(field, 'emit')

    sna.toFieldSignal()
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dimension: 'sna', scope: 'network-summary' })
    )
  })
})
