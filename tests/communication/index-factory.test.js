/**
 * Communication System Factory tests
 * Validates createCommunicationSystem returns a properly wired facade
 * with all 7 modules, lifecycle methods, and dashboard query accessors.
 *
 * @module tests/communication/index-factory.test
 */
import { describe, it, expect } from 'vitest'
import { createCommunicationSystem } from '../../src/communication/index.js'

// ---------------------------------------------------------------------------
// Minimal mock dependencies
// ---------------------------------------------------------------------------

function createMockDeps() {
  return {
    field: {
      emit: () => {},
      query: () => [],
      superpose: () => ({ dimensions: {} }),
      on: () => {},
    },
    bus: {
      publish: () => {},
      subscribe: () => {},
      unsubscribe: () => {},
    },
    store: {
      put: () => {},
      get: () => null,
      query: () => [],
      delete: () => {},
    },
    config: {},
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createCommunicationSystem', () => {
  it('returns a facade with all expected properties', () => {
    const deps = createMockDeps()
    const system = createCommunicationSystem(deps)

    expect(system.pheromone).toBeDefined()
    expect(typeof system.pheromone).toBe('object')

    expect(system.channelManager).toBeDefined()
    expect(typeof system.channelManager).toBe('object')

    expect(system.board).toBeDefined()
    expect(typeof system.board).toBe('object')

    expect(system.gossip).toBeDefined()
    expect(typeof system.gossip).toBe('object')

    expect(system.taskChannel).toBeDefined()
    expect(typeof system.taskChannel).toBe('object')
  })

  it('allModules() returns array of 7 modules', () => {
    const deps = createMockDeps()
    const system = createCommunicationSystem(deps)
    const modules = system.allModules()

    expect(Array.isArray(modules)).toBe(true)
    expect(modules.length).toBe(7)
  })

  it('allModules() returns ModuleBase instances with produces/consumes', () => {
    const deps = createMockDeps()
    const system = createCommunicationSystem(deps)
    const modules = system.allModules()

    for (const mod of modules) {
      expect(typeof mod.constructor.produces).toBe('function')
      expect(typeof mod.constructor.consumes).toBe('function')
      expect(Array.isArray(mod.constructor.produces())).toBe(true)
      expect(Array.isArray(mod.constructor.consumes())).toBe(true)
    }
  })

  it('getPheromoneState() returns object', () => {
    const deps = createMockDeps()
    const system = createCommunicationSystem(deps)

    const state = system.getPheromoneState()
    expect(state).toBeDefined()
    expect(typeof state).toBe('object')
  })

  it('getActiveChannels() returns object', () => {
    const deps = createMockDeps()
    const system = createCommunicationSystem(deps)

    const channels = system.getActiveChannels()
    expect(channels).toBeDefined()
    expect(typeof channels).toBe('object')
  })

  it('getStigmergy() returns object', () => {
    const deps = createMockDeps()
    const system = createCommunicationSystem(deps)

    const stigmergy = system.getStigmergy()
    expect(stigmergy).toBeDefined()
    expect(typeof stigmergy).toBe('object')
  })

  it('start() and stop() complete without error', async () => {
    const deps = createMockDeps()
    const system = createCommunicationSystem(deps)

    await expect(system.start()).resolves.not.toThrow()
    await expect(system.stop()).resolves.not.toThrow()
  })

  it('all modules have non-null constructor', () => {
    const deps = createMockDeps()
    const system = createCommunicationSystem(deps)
    const modules = system.allModules()

    for (const mod of modules) {
      expect(mod).toBeDefined()
      expect(mod).not.toBeNull()
      expect(mod.constructor).toBeDefined()
      expect(mod.constructor).not.toBeNull()
    }
  })
})
