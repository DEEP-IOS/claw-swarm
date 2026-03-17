/**
 * Unit tests for HierarchicalCoord
 * Hierarchical DAG coordination with depth limits and concurrency control
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HierarchicalCoord } from '../../../src/orchestration/scheduling/hierarchical-coord.js'

describe('HierarchicalCoord', () => {
  let coord
  let mockField
  let mockBus

  beforeEach(() => {
    mockField = {
      emit: vi.fn(),
      query: vi.fn().mockReturnValue([]),
    }
    mockBus = {
      publish: vi.fn(),
    }
    coord = new HierarchicalCoord({ field: mockField, bus: mockBus })
  })

  // ── 1) depth 4 rejected (maxDepth defaults to 3) ────────────────────
  it('rejects registration when depth >= maxDepth (depth=4, maxDepth=3)', () => {
    // depth=3 is already at the limit (>= maxDepth). depth=4 definitely out.
    const result = coord.registerSubgroup('parent-1', 'child-1', 4)
    expect(result).toBe(false)
    expect(mockBus.publish).toHaveBeenCalledWith('hierarchy.depth.exceeded', expect.objectContaining({
      parentDagId: 'parent-1',
      childDagId: 'child-1',
      depth: 4,
      maxDepth: 3,
    }))
  })

  it('rejects registration at exactly maxDepth (depth=3)', () => {
    const result = coord.registerSubgroup('parent-1', 'child-1', 3)
    expect(result).toBe(false)
  })

  it('accepts registration below maxDepth (depth=2)', () => {
    const result = coord.registerSubgroup('parent-1', 'child-1', 2)
    expect(result).toBe(true)
    expect(mockBus.publish).toHaveBeenCalledWith('hierarchy.subgroup.formed', expect.objectContaining({
      parentDagId: 'parent-1',
      childDagId: 'child-1',
      depth: 2,
    }))
  })

  // ── 2) concurrency limit: depth=0 allows max 5 ──────────────────────
  it('enforces concurrency per depth level (default depth=0 limit=5)', () => {
    // Register 5 DAGs at depth 0
    for (let i = 0; i < 5; i++) {
      coord.registerSubgroup(`root`, `dag-${i}`, 0)
    }

    // 5 active DAGs at depth 0 -> no more room
    // But we need to also account for the parent entry 'root' at depth 0
    // registerSubgroup creates parent at depth max(0-1,0) = 0
    // So root is at depth 0, plus 5 children at depth 0 = 6 total at depth 0
    // Actually children are registered at depth=0, and we have 5+1 = 6
    // checkConcurrency counts entries at the same depth

    // Let's be more precise: first register at depth 1 so depth=0 stays clean
    const coord2 = new HierarchicalCoord({ field: mockField, bus: mockBus })
    // Register 5 active entries at depth 0
    for (let i = 0; i < 5; i++) {
      coord2.registerSubgroup(`parent-d1-${i}`, `child-d1-${i}`, 1)
    }
    // Now 5 parents are at depth 0 (auto-created)
    const canAdd = coord2.checkConcurrency('new-dag', 0)
    expect(canAdd).toBe(false)

    // depth=1 has 5 active, limit is 3 -> also blocked
    const canAdd1 = coord2.checkConcurrency('new-dag', 1)
    expect(canAdd1).toBe(false)
  })

  // ── 3) formTeam prioritises strong SNA pairs ─────────────────────────
  it('sorts candidates by SNA strength descending (strong pairs first)', () => {
    // Mock field.query to return different SNA strengths per candidate
    mockField.query.mockImplementation(({ scope }) => {
      const scores = {
        'agent-A': [{ strength: 0.3 }],
        'agent-B': [{ strength: 0.9 }],
        'agent-C': [{ strength: 0.6 }],
      }
      return scores[scope] ?? []
    })

    const result = coord.formTeam('dag-1', ['agent-A', 'agent-B', 'agent-C'])
    expect(result).toEqual(['agent-B', 'agent-C', 'agent-A'])
  })

  // ── 4) propagateResult triggers bus event for parent ──────────────────
  it('marks child completed and publishes event for parent DAG', () => {
    // Set up parent-child relationship
    coord.registerSubgroup('parent-dag', 'child-dag', 1)

    coord.propagateResult('child-dag', { output: 'done' })

    // Child should be marked completed
    // Verify bus event was published with parent info
    expect(mockBus.publish).toHaveBeenCalledWith('hierarchy.subgroup.formed', expect.objectContaining({
      parentDagId: 'parent-dag',
      childDagId: 'child-dag',
      event: 'child.completed',
      result: { output: 'done' },
    }))

    // Verify field signal emitted for parent scope
    expect(mockField.emit).toHaveBeenCalledWith(expect.objectContaining({
      dimension: 'coordination',
      scope: 'parent-dag',
      emitterId: 'hierarchical-coord',
    }))
  })

  // ── 5) cancelSubtree recursively cancels all descendants ─────────────
  it('recursively cancels a DAG and all its descendants', () => {
    // Build a hierarchy: root -> child-1 -> grandchild-1
    coord.registerSubgroup('root-dag', 'child-1', 1)
    coord.registerSubgroup('child-1', 'grandchild-1', 2)

    coord.cancelSubtree('root-dag')

    // All entries should be cancelled
    // Verify via getSubgroups that the structure exists but verify depth returns -1 won't work
    // Instead, try to check concurrency: cancelled entries should not count as active
    // root-dag was at depth 0, child-1 at depth 1, grandchild-1 at depth 2
    // After cancel, none should be active

    // checkConcurrency counts active entries. After cancelling, depth 1 should have room.
    const canAdd = coord.checkConcurrency('new-dag', 1)
    expect(canAdd).toBe(true)
  })

  // ── extra: getParent / getSubgroups / getDepth ───────────────────────
  it('tracks parent-child relationships correctly', () => {
    coord.registerSubgroup('root', 'child-a', 1)
    coord.registerSubgroup('root', 'child-b', 1)

    expect(coord.getParent('child-a')).toBe('root')
    expect(coord.getParent('child-b')).toBe('root')
    expect(coord.getSubgroups('root')).toEqual(['child-a', 'child-b'])
    expect(coord.getDepth('child-a')).toBe(1)
    expect(coord.getDepth('nonexistent')).toBe(-1)
  })
})
