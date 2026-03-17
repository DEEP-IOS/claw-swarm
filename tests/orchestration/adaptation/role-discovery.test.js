/**
 * RoleDiscovery unit tests
 * @module tests/orchestration/adaptation/role-discovery.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RoleDiscovery } from '../../../src/orchestration/adaptation/role-discovery.js'

// ============================================================================
// Mocks
// ============================================================================

const mockField = {
  emit: vi.fn(),
  query: vi.fn().mockReturnValue([]),
  superpose: vi.fn().mockReturnValue({}),
}
const mockBus = {
  publish: vi.fn(),
  subscribe: vi.fn(),
  emit: vi.fn(),
  on: vi.fn(),
}
const mockStore = { get: vi.fn().mockReturnValue(null), put: vi.fn() }
const mockRoleRegistry = {
  get: vi.fn(),
  list: vi.fn().mockReturnValue([]),
  getAllRoles: vi.fn().mockReturnValue([]),
  registerDynamic: vi.fn().mockReturnValue('dynamic-role-1'),
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a session history that triggers a specific name pattern.
 * The name generation uses categories: code (write/edit/create),
 * research (grep/read/search), review (review/check/lint), ops (deploy/build/run).
 */
function buildHistory(tools, count = 1) {
  const history = []
  for (let i = 0; i < count; i++) {
    for (const tool of tools) {
      history.push({ tool })
    }
  }
  return history
}

// ============================================================================
// Tests
// ============================================================================

describe('RoleDiscovery', () => {
  /** @type {RoleDiscovery} */
  let rd

  beforeEach(() => {
    vi.clearAllMocks()
    // No existing roles -> any behavioral pattern is "novel"
    mockRoleRegistry.getAllRoles.mockReturnValue([])
    mockRoleRegistry.list.mockReturnValue([])

    rd = new RoleDiscovery({
      field: mockField,
      bus: mockBus,
      store: mockStore,
      roleRegistry: mockRoleRegistry,
    })
  })

  // --------------------------------------------------------------------------
  // Repeated observation -> confidence accumulates
  // --------------------------------------------------------------------------
  describe('confidence accumulation on repeated observation', () => {
    it('should increment confidence when the same behavioral pattern is observed repeatedly', () => {
      const history = buildHistory(['write-file', 'edit-code'], 3)

      // First observation -> isNew=true
      const first = rd.analyze(history)
      expect(first).not.toBeNull()
      expect(first.isNew).toBe(true)

      // Subsequent observations -> isNew=false, confidence increments
      const second = rd.analyze(history)
      expect(second).not.toBeNull()
      expect(second.isNew).toBe(false)

      const third = rd.analyze(history)
      expect(third).not.toBeNull()
      expect(third.isNew).toBe(false)

      // Verify confidence grew: initial = 0.05*2 = 0.10, after 2 more -> 0.10 + 0.05 + 0.05 = 0.20
      const discoveries = rd.getDiscoveries()
      expect(discoveries).toHaveLength(1)
      expect(discoveries[0].confidence).toBeGreaterThan(0.1)
      expect(discoveries[0].observations).toBe(3)
    })
  })

  // --------------------------------------------------------------------------
  // confidence > 0.8 + observations > 10 -> promoteIfReady succeeds
  // --------------------------------------------------------------------------
  describe('promotion when confidence and observations thresholds are met', () => {
    it('should promote a discovery when confidence > 0.8 and observations > 10', () => {
      const history = buildHistory(['write-file', 'edit-code'], 3)

      // First call creates the discovery (confidence = 0.1, observations = 1)
      rd.analyze(history)

      // We need confidence > 0.8 and observations > 10
      // Each subsequent call: confidence += 0.05, observations += 1
      // After first: conf = 0.10, obs = 1
      // We need conf > 0.8 -> (0.8 - 0.10) / 0.05 = 14 more calls minimum
      // We need obs > 10 -> at least 11 total
      // So 15 more calls should suffice for both
      for (let i = 0; i < 16; i++) {
        rd.analyze(history)
      }

      const discoveries = rd.getDiscoveries()
      expect(discoveries).toHaveLength(1)
      expect(discoveries[0].confidence).toBeGreaterThan(0.8)
      expect(discoveries[0].observations).toBeGreaterThan(10)

      // Now promote
      const roleId = rd.promoteIfReady()
      expect(roleId).toBe('dynamic-role-1')
      expect(mockRoleRegistry.registerDynamic).toHaveBeenCalledTimes(1)
      expect(mockBus.emit).toHaveBeenCalledWith(
        'role.discovered',
        expect.objectContaining({
          roleId: 'dynamic-role-1',
          confidence: expect.any(Number),
          observations: expect.any(Number),
        }),
      )

      // Discovery should be removed from pending after promotion
      expect(rd.getDiscoveries()).toHaveLength(0)
    })
  })

  // --------------------------------------------------------------------------
  // Low confidence -> promoteIfReady returns null
  // --------------------------------------------------------------------------
  describe('no promotion when confidence is low', () => {
    it('should return null from promoteIfReady when confidence is below threshold', () => {
      const history = buildHistory(['write-file'], 2)

      // Only a few observations -> low confidence
      rd.analyze(history)
      rd.analyze(history)
      rd.analyze(history)

      const discoveries = rd.getDiscoveries()
      expect(discoveries).toHaveLength(1)
      expect(discoveries[0].confidence).toBeLessThanOrEqual(0.8)

      const result = rd.promoteIfReady()
      expect(result).toBeNull()
      expect(mockRoleRegistry.registerDynamic).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Similar to existing role -> no new discovery
  // --------------------------------------------------------------------------
  describe('no discovery when behavior is similar to existing role', () => {
    it('should return null when behavioral vector is close to an existing role', () => {
      // Set up roleRegistry to return a role with tools matching our history
      mockRoleRegistry.getAllRoles.mockReturnValue([
        { id: 'coder', name: 'coder', tools: ['write-file', 'edit-code'] },
      ])

      // Recreate with the role registry that has existing roles with tools
      rd = new RoleDiscovery({
        field: mockField,
        bus: mockBus,
        store: mockStore,
        roleRegistry: mockRoleRegistry,
      })

      // History uses the same tools as the existing 'coder' role
      const history = buildHistory(['write-file', 'edit-code'], 5)
      const result = rd.analyze(history)

      // Distance to existing role should be below threshold -> null
      expect(result).toBeNull()
    })

    it('should discover a new role when behavioral vector differs from existing roles', () => {
      // Existing role only has 'write-file'
      mockRoleRegistry.getAllRoles.mockReturnValue([
        { id: 'coder', name: 'coder', tools: ['write-file'] },
      ])

      rd = new RoleDiscovery({
        field: mockField,
        bus: mockBus,
        store: mockStore,
        roleRegistry: mockRoleRegistry,
      })

      // History uses completely different tools: grep, search, read
      const history = buildHistory(['grep-codebase', 'search-docs', 'read-file'], 5)
      const result = rd.analyze(history)

      // Should be novel because tools differ significantly
      expect(result).not.toBeNull()
      expect(result.isNew).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------
  describe('edge cases', () => {
    it('should return null for empty session history', () => {
      expect(rd.analyze([])).toBeNull()
      expect(rd.analyze(null)).toBeNull()
      expect(rd.analyze(undefined)).toBeNull()
    })

    it('should cap confidence at 1.0', () => {
      const history = buildHistory(['deploy-app', 'build-project'], 3)
      // Analyze many times to push confidence toward 1.0
      for (let i = 0; i < 30; i++) {
        rd.analyze(history)
      }
      const discoveries = rd.getDiscoveries()
      expect(discoveries[0].confidence).toBeLessThanOrEqual(1.0)
    })

    it('should have correct static metadata', () => {
      expect(RoleDiscovery.produces()).toEqual([])
      expect(RoleDiscovery.consumes()).toContain('trail')
      expect(RoleDiscovery.consumes()).toContain('knowledge')
      expect(RoleDiscovery.publishes()).toContain('role.discovered')
      expect(RoleDiscovery.subscribes()).toContain('dag.completed')
    })
  })
})
