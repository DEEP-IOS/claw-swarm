/**
 * Unit tests for RoleManager
 * Role assignment, release, dynamic registration, and rotation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RoleManager } from '../../../src/orchestration/scheduling/role-manager.js'

describe('RoleManager', () => {
  let manager
  let mockField
  let mockBus
  let mockRoleRegistry

  beforeEach(() => {
    mockField = {
      emit: vi.fn(),
      query: vi.fn().mockReturnValue([]),
    }
    mockBus = {
      publish: vi.fn(),
    }
    mockRoleRegistry = {
      get: vi.fn().mockReturnValue({ id: 'implementer', sensitivity: {} }),
      registerDynamic: vi.fn().mockReturnValue(true),
      list: vi.fn().mockReturnValue(['researcher', 'implementer', 'debugger', 'tester']),
    }
    manager = new RoleManager({
      field: mockField,
      bus: mockBus,
      roleRegistry: mockRoleRegistry,
    })
  })

  // ── 1) assign -> release full lifecycle ──────────────────────────────
  it('assigns and releases a role correctly', () => {
    // Assign
    const assignment = manager.assignRole('agent-1', 'implementer')
    expect(assignment.roleId).toBe('implementer')
    expect(assignment.status).toBe('active')
    expect(assignment.consecutive).toBe(1)
    expect(mockBus.publish).toHaveBeenCalledWith('role.assigned', expect.objectContaining({
      agentId: 'agent-1',
      roleId: 'implementer',
      consecutive: 1,
    }))

    // Check active roles
    const active = manager.getActiveRoles()
    expect(active.get('agent-1')).toBe('implementer')

    // Release
    manager.releaseRole('agent-1')
    expect(mockBus.publish).toHaveBeenCalledWith('role.released', expect.objectContaining({
      agentId: 'agent-1',
      roleId: 'implementer',
    }))

    // After release, should not appear in active roles
    const activeAfter = manager.getActiveRoles()
    expect(activeAfter.has('agent-1')).toBe(false)
  })

  // ── 2) getActiveRoles returns correct mapping ────────────────────────
  it('returns correct active role mapping for multiple agents', () => {
    manager.assignRole('agent-a', 'researcher')
    manager.assignRole('agent-b', 'debugger')
    manager.assignRole('agent-c', 'tester')
    manager.releaseRole('agent-b')

    const active = manager.getActiveRoles()
    expect(active.size).toBe(2)
    expect(active.get('agent-a')).toBe('researcher')
    expect(active.get('agent-c')).toBe('tester')
    expect(active.has('agent-b')).toBe(false)
  })

  // ── 3) registerDynamicRole triggers roleRegistry.registerDynamic ─────
  it('registers a dynamic role and calls roleRegistry.registerDynamic', () => {
    const result = manager.registerDynamicRole({
      id: 'custom-analyst',
      systemPrompt: 'You are a custom analyst',
      preferredModel: 'balanced',
    })
    expect(result).toBe(true)
    expect(mockRoleRegistry.registerDynamic).toHaveBeenCalledWith('custom-analyst', expect.objectContaining({
      id: 'custom-analyst',
    }))
    expect(mockBus.publish).toHaveBeenCalledWith('role.dynamic.registered', expect.objectContaining({
      roleId: 'custom-analyst',
    }))
  })

  it('returns false when roleConfig has no id', () => {
    expect(manager.registerDynamicRole({})).toBe(false)
    expect(manager.registerDynamicRole(null)).toBe(false)
  })

  // ── 4) 6 consecutive same-role -> rotation suggestion ────────────────
  it('suggests rotation after more than 5 consecutive same-role assignments', () => {
    // ROTATION_THRESHOLD is 5, suggestion triggers when consecutive > 5 (i.e. 6+)
    for (let i = 0; i < 6; i++) {
      manager.assignRole('agent-x', 'implementer')
    }

    const suggestion = manager.getRotationSuggestion('agent-x')
    expect(suggestion.shouldRotate).toBe(true)
    expect(suggestion.consecutive).toBe(6)
    expect(suggestion.suggestion).toContain('agent-x')
    expect(suggestion.suggestion).toContain('implementer')
  })

  it('does not suggest rotation for 5 or fewer consecutive assignments', () => {
    for (let i = 0; i < 5; i++) {
      manager.assignRole('agent-y', 'researcher')
    }

    const suggestion = manager.getRotationSuggestion('agent-y')
    expect(suggestion.shouldRotate).toBe(false)
    expect(suggestion.consecutive).toBe(5)
  })

  it('resets consecutive count when role changes', () => {
    manager.assignRole('agent-z', 'implementer')
    manager.assignRole('agent-z', 'implementer')
    manager.assignRole('agent-z', 'debugger')  // different role
    manager.assignRole('agent-z', 'debugger')

    const suggestion = manager.getRotationSuggestion('agent-z')
    expect(suggestion.shouldRotate).toBe(false)
    expect(suggestion.consecutive).toBe(2)
  })

  // ── extra: getRotationSuggestion for non-existent agent ──────────────
  it('returns no rotation for agent without assignment', () => {
    const suggestion = manager.getRotationSuggestion('unknown-agent')
    expect(suggestion.shouldRotate).toBe(false)
    expect(suggestion.consecutive).toBe(0)
  })

  // ── extra: releaseRole on non-existent agent is safe ─────────────────
  it('handles releasing role for non-existent agent gracefully', () => {
    expect(() => manager.releaseRole('non-existent')).not.toThrow()
  })
})
