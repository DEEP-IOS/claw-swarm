/**
 * RoleRegistry unit tests
 * @module tests/intelligence/identity/role-registry.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { RoleRegistry } from '../../../src/intelligence/identity/role-registry.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'

const ALL_12_DIMS = [
  'trail', 'alarm', 'reputation', 'task', 'knowledge', 'coordination',
  'emotion', 'trust', 'sna', 'learning', 'calibration', 'species',
]

describe('RoleRegistry', () => {
  let registry, eventBus, field

  beforeEach(() => {
    eventBus = new EventBus()
    field = new SignalStore({ eventBus })
    registry = new RoleRegistry({ field, eventBus })
  })

  // --- Built-in roles ---

  it('list() returns 10 built-in roles', () => {
    const roles = registry.list()
    expect(roles).toHaveLength(10)
    expect(roles).toEqual(expect.arrayContaining([
      'researcher', 'analyst', 'planner', 'implementer', 'debugger',
      'tester', 'reviewer', 'consultant', 'coordinator', 'librarian',
    ]))
  })

  it('every role has required fields: id, name, description, sensitivity, tools, preferredModel, behaviorPrompt, workingMemoryCapacity', () => {
    for (const roleId of registry.list()) {
      const role = registry.get(roleId)
      expect(role).toBeTruthy()
      expect(role.id).toBe(roleId)
      expect(typeof role.name).toBe('string')
      expect(typeof role.description).toBe('string')
      expect(role.sensitivity).toBeTruthy()
      expect(Array.isArray(role.tools)).toBe(true)
      expect(typeof role.preferredModel).toBe('string')
      expect(typeof role.behaviorPrompt).toBe('string')
      expect(typeof role.workingMemoryCapacity).toBe('number')
    }
  })

  it('every role has complete 12-dim sensitivity vector with no missing dims', () => {
    for (const roleId of registry.list()) {
      const sensitivity = registry.getSensitivity(roleId)
      const keys = Object.keys(sensitivity)
      expect(keys).toHaveLength(12)
      for (const dim of ALL_12_DIMS) {
        expect(sensitivity).toHaveProperty(dim)
      }
    }
  })

  it('every sensitivity value is in [0, 1]', () => {
    for (const roleId of registry.list()) {
      const sensitivity = registry.getSensitivity(roleId)
      for (const dim of ALL_12_DIMS) {
        expect(sensitivity[dim]).toBeGreaterThanOrEqual(0)
        expect(sensitivity[dim]).toBeLessThanOrEqual(1)
      }
    }
  })

  // --- Specific role properties ---

  it('researcher: tools include web_search and grep', () => {
    const tools = registry.getTools('researcher')
    expect(tools).toContain('web_search')
    expect(tools).toContain('grep')
  })

  it('reviewer: tools are exactly [grep, glob, read] (no write/edit/bash)', () => {
    const tools = registry.getTools('reviewer')
    expect(tools).toEqual(['grep', 'glob', 'read'])
    expect(tools).not.toContain('write')
    expect(tools).not.toContain('edit')
    expect(tools).not.toContain('bash')
  })

  it('reviewer: workingMemoryCapacity === 5', () => {
    const role = registry.get('reviewer')
    expect(role.workingMemoryCapacity).toBe(5)
  })

  it('researcher and librarian: workingMemoryCapacity === 30', () => {
    expect(registry.get('researcher').workingMemoryCapacity).toBe(30)
    expect(registry.get('librarian').workingMemoryCapacity).toBe(30)
  })

  // --- registerDynamic ---

  it('registerDynamic: new role accessible via get after registration', () => {
    const result = registry.registerDynamic('custom-role', {
      name: 'Custom',
      description: 'A custom role',
      sensitivity: { knowledge: 0.8 },
      tools: ['read'],
      preferredModel: 'fast',
      behaviorPrompt: 'Custom behavior.',
      workingMemoryCapacity: 10,
    })
    expect(result).toBe(true)
    const role = registry.get('custom-role')
    expect(role).toBeTruthy()
    expect(role.id).toBe('custom-role')
    expect(role.name).toBe('Custom')
    expect(role.tools).toEqual(['read'])
    expect(role.dynamic).toBe(true)
  })

  it('registerDynamic: duplicate ID returns false', () => {
    registry.registerDynamic('dup-role', { name: 'Dup' })
    const result = registry.registerDynamic('dup-role', { name: 'Dup2' })
    expect(result).toBe(false)
  })

  // --- getSensitivity ---

  it('getSensitivity: returns 12-dim object', () => {
    const sens = registry.getSensitivity('researcher')
    expect(Object.keys(sens)).toHaveLength(12)
    expect(sens.knowledge).toBe(0.9)
  })

  // --- getTools ---

  it('getTools: returns tool array', () => {
    const tools = registry.getTools('implementer')
    expect(Array.isArray(tools)).toBe(true)
    expect(tools).toContain('write')
    expect(tools).toContain('bash')
  })

  // --- getPreferredModel ---

  it('getPreferredModel: researcher=fast, analyst=strong, tester=balanced', () => {
    expect(registry.getPreferredModel('researcher')).toBe('fast')
    expect(registry.getPreferredModel('analyst')).toBe('strong')
    expect(registry.getPreferredModel('tester')).toBe('balanced')
  })

  // --- updateSensitivity ---

  it('updateSensitivity: updated values reflected in getSensitivity', () => {
    registry.updateSensitivity('analyst', { alarm: 0.8 })
    const sens = registry.getSensitivity('analyst')
    expect(sens.alarm).toBe(0.8)
  })

  it('updateSensitivity: values auto-clamped to [0, 1]', () => {
    registry.updateSensitivity('planner', { alarm: 1.5, knowledge: -0.5 })
    const sens = registry.getSensitivity('planner')
    expect(sens.alarm).toBe(1)
    expect(sens.knowledge).toBe(0)
  })

  // --- deep copy ---

  it('get returns copy: modifying returned sensitivity does not affect original', () => {
    const role = registry.get('librarian')
    const origKnowledge = role.sensitivity.knowledge
    role.sensitivity.knowledge = 0.0
    const fresh = registry.get('librarian')
    expect(fresh.sensitivity.knowledge).toBe(origKnowledge)
  })

  // --- boundary ---

  it('get returns null for nonexistent role', () => {
    expect(registry.get('nonexistent')).toBeNull()
  })

  it('getSensitivity returns null for nonexistent role', () => {
    expect(registry.getSensitivity('nonexistent')).toBeNull()
  })
})
