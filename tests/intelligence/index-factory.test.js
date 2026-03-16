/**
 * Intelligence System Factory tests
 * Validates createIntelligenceSystem returns a properly wired facade
 * with all sub-domains (social, artifacts, understanding), identity modules,
 * memory modules, cross-domain accessors, and dashboard query methods.
 *
 * @module tests/intelligence/index-factory.test
 */
import { describe, it, expect } from 'vitest'
import { createIntelligenceSystem } from '../../src/intelligence/index.js'

// ---------------------------------------------------------------------------
// Permissive mock dependencies
// The constructors may vary in what they read from deps, so the mocks
// return safe defaults for any access pattern.
// ---------------------------------------------------------------------------

function createMockDeps() {
  const noopFn = () => {}
  const noopAsync = async () => {}
  return {
    field: {
      emit: noopFn,
      query: () => [],
      superpose: () => ({ dimensions: {} }),
      on: noopFn,
      off: noopFn,
    },
    bus: {
      publish: noopFn,
      subscribe: noopFn,
      unsubscribe: noopFn,
    },
    store: {
      put: noopAsync,
      get: () => null,
      query: () => [],
      delete: noopAsync,
    },
    config: {},
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createIntelligenceSystem', () => {
  it('returns a facade with sub-systems', () => {
    const deps = createMockDeps()
    const system = createIntelligenceSystem(deps)

    expect(system.social).toBeDefined()
    expect(typeof system.social).toBe('object')

    expect(system.artifacts).toBeDefined()
    expect(typeof system.artifacts).toBe('object')

    expect(system.understanding).toBeDefined()
    expect(typeof system.understanding).toBe('object')
  })

  it('facade has identity modules', () => {
    const deps = createMockDeps()
    const system = createIntelligenceSystem(deps)

    const identityNames = [
      'capabilityEngine', 'roleRegistry', 'lifecycleManager',
      'modelCapability', 'promptBuilder', 'sensitivityFilter',
      'soulDesigner', 'crossProvider',
    ]

    for (const name of identityNames) {
      expect(system[name]).toBeDefined()
      expect(typeof system[name]).toBe('object')
    }
  })

  it('facade has memory modules', () => {
    const deps = createMockDeps()
    const system = createIntelligenceSystem(deps)

    const memoryNames = [
      'contextEngine', 'embeddingEngine', 'episodicMemory',
      'hybridRetrieval', 'semanticMemory', 'userProfile',
      'vectorIndex', 'workingMemory',
    ]

    for (const name of memoryNames) {
      expect(system[name]).toBeDefined()
      expect(typeof system[name]).toBe('object')
    }
  })

  it('allModules() returns array of all modules (>= 28)', () => {
    const deps = createMockDeps()
    const system = createIntelligenceSystem(deps)
    const modules = system.allModules()

    expect(Array.isArray(modules)).toBe(true)
    // 8 social + 3 artifacts + 3 understanding + 8 identity + 8 memory = 30
    expect(modules.length).toBeGreaterThanOrEqual(28)
  })

  it('cross-domain accessors work', () => {
    const deps = createMockDeps()
    const system = createIntelligenceSystem(deps)

    expect(system.getCapabilityEngine()).toBeDefined()
    expect(typeof system.getCapabilityEngine()).toBe('object')

    expect(system.getHybridRetrieval()).toBeDefined()
    expect(typeof system.getHybridRetrieval()).toBe('object')

    expect(system.getRoleRegistry()).toBeDefined()
    expect(typeof system.getRoleRegistry()).toBe('object')

    expect(system.getModelCapability()).toBeDefined()
    expect(typeof system.getModelCapability()).toBe('object')

    expect(system.getArtifactRegistry()).toBeDefined()
    expect(typeof system.getArtifactRegistry()).toBe('object')

    expect(system.getReputationCRDT()).toBeDefined()
    expect(typeof system.getReputationCRDT()).toBe('object')
  })

  it('dashboard query methods return values', () => {
    const deps = createMockDeps()
    const system = createIntelligenceSystem(deps)

    // These should all return without throwing
    const activeAgents = system.getActiveAgents()
    expect(activeAgents).toBeDefined()

    const reputation = system.getReputation()
    expect(reputation).toBeDefined()

    const sna = system.getSNA()
    expect(sna).toBeDefined()

    const emotional = system.getEmotionalStates()
    expect(emotional).toBeDefined()

    const trust = system.getTrust()
    expect(trust).toBeDefined()

    const memStats = system.getMemoryStats()
    expect(memStats).toBeDefined()
    expect(typeof memStats).toBe('object')
  })

  it('start() and stop() complete without error', async () => {
    const deps = createMockDeps()
    const system = createIntelligenceSystem(deps)

    await expect(system.start()).resolves.not.toThrow()
    await expect(system.stop()).resolves.not.toThrow()
  })

  it('all modules have produces/consumes declarations', () => {
    const deps = createMockDeps()
    const system = createIntelligenceSystem(deps)
    const modules = system.allModules()

    for (const mod of modules) {
      expect(mod.constructor).toBeDefined()
      expect(typeof mod.constructor.produces).toBe('function')
      expect(typeof mod.constructor.consumes).toBe('function')
      expect(Array.isArray(mod.constructor.produces())).toBe(true)
      expect(Array.isArray(mod.constructor.consumes())).toBe(true)
    }
  })
})
