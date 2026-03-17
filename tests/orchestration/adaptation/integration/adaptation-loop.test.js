/**
 * Adaptation layer integration tests
 *
 * Tests the interplay between multiple R5 adaptation modules:
 * - ShapleyCredit -> ReputationCRDT flow
 * - SpeciesEvolver population evolution
 * - DualProcessRouter + GlobalModulator collaboration
 * - createAdaptationSystem factory
 *
 * @module tests/orchestration/adaptation/integration/adaptation-loop
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ShapleyCredit } from '../../../../src/orchestration/adaptation/shapley-credit.js'
import { SpeciesEvolver } from '../../../../src/orchestration/adaptation/species-evolver.js'
import { DualProcessRouter } from '../../../../src/orchestration/adaptation/dual-process-router.js'
import { GlobalModulator } from '../../../../src/orchestration/adaptation/global-modulator.js'
import { createAdaptationSystem } from '../../../../src/orchestration/adaptation/index.js'

// ============================================================================
// Mocks
// ============================================================================

function createMockField() {
  return {
    emit: vi.fn(),
    read: vi.fn().mockReturnValue([]),
    query: vi.fn().mockReturnValue([]),
    superpose: vi.fn().mockReturnValue({}),
  }
}

function createMockBus() {
  return {
    publish: vi.fn(),
    subscribe: vi.fn(),
    emit: vi.fn(),
    on: vi.fn(),
  }
}

function createMockStore() {
  return {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
    put: vi.fn(),
  }
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Adaptation Layer Integration', () => {
  let mockField
  let mockBus
  let mockStore
  let mockReputationCRDT
  let mockRoleRegistry
  let mockCapabilityEngine

  beforeEach(() => {
    vi.clearAllMocks()
    mockField = createMockField()
    mockBus = createMockBus()
    mockStore = createMockStore()
    mockReputationCRDT = { increment: vi.fn(), decrement: vi.fn() }
    mockRoleRegistry = {
      get: vi.fn(),
      list: vi.fn().mockReturnValue(['researcher', 'implementer']),
      getAllRoles: vi.fn().mockReturnValue([
        { id: 'researcher', name: 'researcher', tools: ['grep', 'read'], sensitivity: {} },
        { id: 'implementer', name: 'implementer', tools: ['write', 'edit'], sensitivity: {} },
      ]),
      registerDynamic: vi.fn().mockReturnValue(true),
    }
    mockCapabilityEngine = {
      getSkillScore: vi.fn().mockReturnValue(0.7),
      getScore: vi.fn().mockReturnValue(0.6),
    }
  })

  // --------------------------------------------------------------------------
  // ShapleyCredit -> ReputationCRDT update
  // --------------------------------------------------------------------------
  describe('ShapleyCredit -> ReputationCRDT attribution flow', () => {
    it('should compute Shapley values and update ReputationCRDT accordingly', () => {
      const shapley = new ShapleyCredit({
        field: mockField,
        bus: mockBus,
        reputationCRDT: mockReputationCRDT,
        config: { samples: 200 },
      })

      // Create agent contributions
      const contributions = new Map([
        ['agent-A', { quality: 0.9, role: 'implementer' }],
        ['agent-B', { quality: 0.6, role: 'researcher' }],
        ['agent-C', { quality: 0.3, role: 'reviewer' }],
      ])

      const values = shapley.compute('dag-1', contributions)

      // All agents should have Shapley values
      expect(values.size).toBe(3)
      expect(values.has('agent-A')).toBe(true)
      expect(values.has('agent-B')).toBe(true)
      expect(values.has('agent-C')).toBe(true)

      // agent-A (highest quality) should have highest Shapley value
      expect(values.get('agent-A')).toBeGreaterThan(values.get('agent-C'))

      // ReputationCRDT should be incremented for positive contributors
      expect(mockReputationCRDT.increment).toHaveBeenCalled()

      // DIM_REPUTATION signals should be emitted into field
      expect(mockField.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          dimension: 'reputation',
        }),
      )

      // Event should be published
      expect(mockBus.emit).toHaveBeenCalledWith(
        'shapley.computed',
        expect.objectContaining({
          dagId: 'dag-1',
          totalValue: expect.any(Number),
        }),
      )

      // Leaderboard should be populated
      const leaderboard = shapley.getLeaderboard()
      expect(leaderboard.length).toBe(3)
      expect(leaderboard[0].agentId).toBe('agent-A')
    })

    it('should accumulate credits across multiple DAGs', () => {
      const shapley = new ShapleyCredit({
        field: mockField,
        bus: mockBus,
        reputationCRDT: mockReputationCRDT,
        config: { samples: 100 },
      })

      // DAG 1
      shapley.compute('dag-1', new Map([
        ['agent-A', { quality: 0.8 }],
        ['agent-B', { quality: 0.4 }],
      ]))

      // DAG 2
      shapley.compute('dag-2', new Map([
        ['agent-A', { quality: 0.7 }],
        ['agent-B', { quality: 0.9 }],
      ]))

      const leaderboard = shapley.getLeaderboard()
      expect(leaderboard.length).toBe(2)
      // Both agents contributed across 2 DAGs
      expect(leaderboard[0].totalValue).toBeGreaterThan(0)
      expect(leaderboard[1].totalValue).toBeGreaterThan(0)

      // Per-DAG credits should be stored separately
      expect(shapley.getDAGCredits('dag-1')).toBeDefined()
      expect(shapley.getDAGCredits('dag-2')).toBeDefined()
    })
  })

  // --------------------------------------------------------------------------
  // SpeciesEvolver: initial population -> evolve -> fitness
  // --------------------------------------------------------------------------
  describe('Species evolution lifecycle', () => {
    it('should seed initial population from roleRegistry and evolve with reasonable fitness', () => {
      // Field returns moderate reputation signals for fitness evaluation
      mockField.read.mockImplementation(({ dimension }) => {
        if (dimension === 'reputation') {
          return [{ strength: 0.6 }]
        }
        if (dimension === 'learning') {
          return [{ strength: 0.7 }]
        }
        return []
      })

      const evolver = new SpeciesEvolver({
        field: mockField,
        bus: mockBus,
        store: mockStore,
        roleRegistry: mockRoleRegistry,
        config: {
          mutationRate: 0.1,
          tournamentSize: 2,
          cullingRate: 0.3,
          carryingCapacityPerRole: 10,
          evolveInterval: 1,
        },
      })

      // Should have seeded from registry (2 roles -> 2 species)
      const initialPop = evolver.getPopulation()
      expect(initialPop.length).toBe(2)

      // Register additional species to give evolution more to work with
      evolver.registerSpecies('researcher', { preferredModel: 'fast' })
      evolver.registerSpecies('implementer', { preferredModel: 'strong' })
      evolver.registerSpecies('researcher', { preferredModel: 'balanced' })
      evolver.registerSpecies('implementer', { preferredModel: 'balanced' })

      expect(evolver.getPopulation().length).toBe(6)

      // Run evolution
      evolver.evolve()

      // Population should still exist (not all culled)
      const postEvolvePop = evolver.getPopulation()
      expect(postEvolvePop.length).toBeGreaterThan(0)

      // All species should have fitness in [0, 1]
      for (const sp of postEvolvePop) {
        expect(sp.fitness).toBeGreaterThanOrEqual(0)
        expect(sp.fitness).toBeLessThanOrEqual(1)
      }

      // Events should have been emitted
      expect(mockBus.emit).toHaveBeenCalledWith(
        'species.generation.completed',
        expect.objectContaining({
          generation: expect.any(Number),
          populationSize: expect.any(Number),
          averageFitness: expect.any(Number),
        }),
      )
    })

    it('should find best species by role', () => {
      mockField.read.mockReturnValue([{ strength: 0.7 }])

      const evolver = new SpeciesEvolver({
        field: mockField,
        bus: mockBus,
        store: mockStore,
        roleRegistry: mockRoleRegistry,
        config: { carryingCapacityPerRole: 10 },
      })

      const best = evolver.getBestByRole('researcher')
      expect(best).not.toBeNull()
      expect(best.roleId).toBe('researcher')
    })
  })

  // --------------------------------------------------------------------------
  // DualProcessRouter + GlobalModulator collaboration
  // --------------------------------------------------------------------------
  describe('DualProcessRouter + GlobalModulator collaboration', () => {
    it('should route low-complexity tasks to System 1 (fast)', () => {
      const router = new DualProcessRouter({
        field: mockField,
        bus: mockBus,
        config: { complexityThreshold: 0.4 },
      })

      // High confidence, low risk -> low complexity -> System 1
      const result = router.route(
        { confidence: 0.9, riskLevel: 'low' },
        { scope: 'test-scope' },
      )

      expect(result.route.name).toBe('fast')
      expect(result.complexity).toBeLessThan(0.4)
    })

    it('should route high-complexity tasks to System 2 (thorough)', () => {
      // Simulate alarm signal in the field
      mockField.superpose.mockReturnValue({ alarm: 0.5, knowledge: 0.1 })

      const router = new DualProcessRouter({
        field: mockField,
        bus: mockBus,
        config: { complexityThreshold: 0.4 },
      })

      // Low confidence, high risk + alarm -> high complexity -> System 2
      const result = router.route(
        { confidence: 0.3, riskLevel: 'high' },
        { scope: 'critical-scope' },
      )

      expect(result.route.name).toBe('thorough')
      expect(result.complexity).toBeGreaterThanOrEqual(0.4)
    })

    it('should adjust routing threshold based on outcome feedback', () => {
      const router = new DualProcessRouter({
        field: mockField,
        bus: mockBus,
        config: { complexityThreshold: 0.4, thresholdAdjustStep: 0.02 },
      })

      const initialThreshold = router.getStats().threshold

      // System 1 failure -> lower threshold (more cautious)
      router.adjustThreshold({ system: 1, success: false })
      expect(router.getStats().threshold).toBeLessThan(initialThreshold)
      expect(router.getStats().overrideCount).toBe(1)

      // System 2 success -> raise threshold (allow more fast paths)
      router.adjustThreshold({ system: 2, success: true })
      expect(router.getStats().threshold).toBeGreaterThan(initialThreshold - 0.02)
    })

    it('should switch GlobalModulator from EXPLOIT to EXPLORE when success drops', () => {
      const modulator = new GlobalModulator({
        field: mockField,
        bus: mockBus,
      })

      expect(modulator.getMode()).toBe('EXPLOIT')

      // Record many failures with diverse task types to push to EXPLORE
      // successRate < 0.4 OR novelty > 0.7 -> EXPLORE
      for (let i = 0; i < 20; i++) {
        modulator.recordOutcome(false, `unique-task-type-${i}`)
      }

      expect(modulator.getMode()).toBe('EXPLORE')
      expect(modulator.getExplorationRate()).toBe(0.4)

      // Verify mode change event was published
      expect(mockBus.publish).toHaveBeenCalledWith(
        'modulator.mode.changed',
        expect.objectContaining({
          from: 'EXPLOIT',
          to: 'EXPLORE',
        }),
      )
    })

    it('should integrate routing and modulation: modulator drives router feedback', () => {
      const router = new DualProcessRouter({
        field: mockField,
        bus: mockBus,
        config: { complexityThreshold: 0.4 },
      })
      const modulator = new GlobalModulator({
        field: mockField,
        bus: mockBus,
      })

      // Route a task
      const routing = router.route(
        { confidence: 0.9, riskLevel: 'low' },
      )

      // Simulate task outcome feeding both modules
      const success = true
      modulator.recordOutcome(success, 'coding')

      // Feed outcome to router threshold adjustment
      const system = routing.route.name === 'fast' ? 1 : 2
      router.adjustThreshold({ system, success })

      // Both modules should track stats correctly
      const routerStats = router.getStats()
      expect(routerStats.system1Count + routerStats.system2Count).toBe(1)

      const modStats = modulator.getStats()
      expect(modStats.historySize).toBe(1)
    })
  })

  // --------------------------------------------------------------------------
  // createAdaptationSystem returns 10 modules
  // --------------------------------------------------------------------------
  describe('createAdaptationSystem factory', () => {
    it('should return an object with all 10 adaptation modules', () => {
      const system = createAdaptationSystem({
        field: mockField,
        bus: mockBus,
        store: mockStore,
        roleRegistry: mockRoleRegistry,
        capabilityEngine: mockCapabilityEngine,
        reputationCRDT: mockReputationCRDT,
        config: {},
      })

      // Verify all 10 named modules are present
      expect(system.dualProcessRouter).toBeDefined()
      expect(system.globalModulator).toBeDefined()
      expect(system.responseThreshold).toBeDefined()
      expect(system.signalCalibrator).toBeDefined()
      expect(system.shapleyCredit).toBeDefined()
      expect(system.speciesEvolver).toBeDefined()
      expect(system.roleDiscovery).toBeDefined()
      expect(system.skillGovernor).toBeDefined()
      expect(system.budgetTracker).toBeDefined()
      expect(system.budgetForecaster).toBeDefined()

      // allModules should return exactly 10
      const all = system.allModules()
      expect(all).toHaveLength(10)
    })

    it('should start and stop all modules without error', async () => {
      const system = createAdaptationSystem({
        field: mockField,
        bus: mockBus,
        store: mockStore,
        roleRegistry: mockRoleRegistry,
        capabilityEngine: mockCapabilityEngine,
        reputationCRDT: mockReputationCRDT,
      })

      // Start all modules
      await expect(system.start()).resolves.not.toThrow()

      // Stop all modules (reverse order)
      await expect(system.stop()).resolves.not.toThrow()
    })

    it('should allow cross-module interaction after creation', () => {
      const system = createAdaptationSystem({
        field: mockField,
        bus: mockBus,
        store: mockStore,
        roleRegistry: mockRoleRegistry,
        capabilityEngine: mockCapabilityEngine,
        reputationCRDT: mockReputationCRDT,
      })

      // Use budgetTracker to allocate and track
      system.budgetTracker.allocateBudget('dag-x', 10000)
      system.budgetTracker.recordSpend('dag-x', 'n1', 5000)

      // Use budgetForecaster to record and predict
      system.budgetForecaster.recordActual('coding', 0.5, 5000)
      system.budgetForecaster.recordActual('coding', 0.8, 8000)
      const forecast = system.budgetForecaster.predictCost('coding', 0.6)
      expect(forecast.estimatedTokens).toBeGreaterThan(0)

      // Use skillGovernor to track skills
      system.skillGovernor.recordUsage('researcher', 'data-analysis', true)
      const mastery = system.skillGovernor.getMastery('researcher', 'data-analysis')
      expect(mastery).toBeGreaterThan(0)

      // Use dualProcessRouter to route
      const routing = system.dualProcessRouter.route(
        { confidence: 0.8, riskLevel: 'low' },
      )
      expect(routing.route).toBeDefined()
    })
  })
})
