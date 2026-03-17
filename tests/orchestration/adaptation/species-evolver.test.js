/**
 * Unit tests for SpeciesEvolver
 * Genetic-algorithm-driven species evolution engine
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SpeciesEvolver } from '../../../src/orchestration/adaptation/species-evolver.js'

// ============================================================================
// Mocks
// ============================================================================

const mockField = {
  emit: vi.fn(),
  query: vi.fn().mockReturnValue([]),
  superpose: vi.fn().mockReturnValue({}),
  read: vi.fn().mockReturnValue([]),
}
const mockBus = { publish: vi.fn(), subscribe: vi.fn(), emit: vi.fn(), on: vi.fn() }

// ============================================================================
// Tests
// ============================================================================

describe('SpeciesEvolver', () => {
  let evolver

  beforeEach(() => {
    vi.clearAllMocks()
    evolver = new SpeciesEvolver({
      field: mockField,
      bus: mockBus,
      config: {
        mutationRate: 0.5,    // high mutation for test coverage
        tournamentSize: 2,
        cullingRate: 0.3,
        carryingCapacityPerRole: 5,
        evolveInterval: 5,
      },
    })
  })

  // --------------------------------------------------------------------------
  // Helper: seed population manually
  // --------------------------------------------------------------------------

  function seedPopulation(evolver, roleId, count, fitnesses) {
    const ids = []
    for (let i = 0; i < count; i++) {
      const id = evolver.registerSpecies(roleId, {
        preferredModel: 'balanced',
      })
      // Manually set fitness by accessing internal population
      const sp = evolver.getPopulation().find((s) => s.id === id)
      if (sp && fitnesses?.[i] !== undefined) {
        sp.fitness = fitnesses[i]
      }
      ids.push(id)
    }
    return ids
  }

  // --------------------------------------------------------------------------
  // evolve() produces next generation
  // --------------------------------------------------------------------------

  it('evolve() produces next generation with offspring', () => {
    seedPopulation(evolver, 'coder', 4, [0.8, 0.7, 0.3, 0.2])

    const popBefore = evolver.getPopulation().length
    evolver.evolve()

    // After evolve: some species culled, some offspring added
    // Population should still have members
    const popAfter = evolver.getPopulation()
    expect(popAfter.length).toBeGreaterThan(0)

    // Generation counter should have incremented
    // Check that at least one offspring has generation = 1
    const hasNewGen = popAfter.some((sp) => sp.generation >= 1)
    expect(hasNewGen).toBe(true)
  })

  // --------------------------------------------------------------------------
  // High fitness species survive
  // --------------------------------------------------------------------------

  it('high fitness species survive culling', () => {
    // Seed 6 species: 3 high fitness, 3 low fitness
    seedPopulation(evolver, 'coder', 3, [0.9, 0.85, 0.8])
    seedPopulation(evolver, 'planner', 3, [0.1, 0.05, 0.02])

    // Mock field.read to return high reputation for coders (high fitness)
    mockField.read.mockImplementation(({ dimension, scope }) => {
      if (scope === 'coder') return [{ strength: 0.9 }]
      return [{ strength: 0.1 }]
    })

    evolver.evolve()

    const survivors = evolver.getPopulation()
    // At least some high-fitness coder species should survive
    const coderSurvivors = survivors.filter((sp) => sp.roleId === 'coder')
    expect(coderSurvivors.length).toBeGreaterThan(0)
  })

  // --------------------------------------------------------------------------
  // Mutation keeps sensitivity in [0, 1]
  // --------------------------------------------------------------------------

  it('mutated offspring have sensitivity values in [0, 1]', () => {
    seedPopulation(evolver, 'coder', 4, [0.8, 0.7, 0.6, 0.5])

    // Run multiple generations to accumulate mutations
    for (let gen = 0; gen < 5; gen++) {
      evolver.evolve()
    }

    const pop = evolver.getPopulation()
    for (const sp of pop) {
      for (const [dim, val] of Object.entries(sp.sensitivity)) {
        expect(val, `sensitivity[${dim}] of species ${sp.id}`).toBeGreaterThanOrEqual(0)
        expect(val, `sensitivity[${dim}] of species ${sp.id}`).toBeLessThanOrEqual(1)
      }
    }
  })

  // --------------------------------------------------------------------------
  // Carrying capacity per role enforced
  // --------------------------------------------------------------------------

  it('enforces carryingCapacityPerRole limit', () => {
    // Seed 8 species for role 'coder' (capacity = 5)
    seedPopulation(evolver, 'coder', 8, [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2])

    evolver.evolve()

    const pop = evolver.getPopulation()
    const coderCount = pop.filter((sp) => sp.roleId === 'coder').length
    expect(coderCount).toBeLessThanOrEqual(5)
  })

  // --------------------------------------------------------------------------
  // DIM_SPECIES signal emitted for high-fitness species
  // --------------------------------------------------------------------------

  it('emits DIM_SPECIES signal for species with fitness > 0.6', () => {
    seedPopulation(evolver, 'coder', 4, [0.9, 0.8, 0.7, 0.65])

    // Mock field.read to return high reputation so evaluateFitness yields > 0.6
    mockField.read.mockReturnValue([{ strength: 0.9 }])

    evolver.evolve()

    // At least one DIM_SPECIES signal should have been emitted
    const speciesEmissions = mockField.emit.mock.calls.filter(
      (call) => call[0]?.dimension === 'species',
    )
    expect(speciesEmissions.length).toBeGreaterThan(0)

    // Verify signal structure
    const signal = speciesEmissions[0][0]
    expect(signal).toMatchObject({
      dimension: 'species',
      scope: expect.any(String),
      emitterId: expect.stringMatching(/^species:/),
      metadata: expect.objectContaining({
        speciesId: expect.any(String),
        generation: expect.any(Number),
        sensitivity: expect.any(Object),
      }),
    })
  })

  // --------------------------------------------------------------------------
  // Generation completed event
  // --------------------------------------------------------------------------

  it('emits species.generation.completed event', () => {
    seedPopulation(evolver, 'coder', 4, [0.8, 0.7, 0.6, 0.5])
    evolver.evolve()

    expect(mockBus.emit).toHaveBeenCalledWith(
      'species.generation.completed',
      expect.objectContaining({
        generation: expect.any(Number),
        populationSize: expect.any(Number),
        averageFitness: expect.any(Number),
      }),
    )
  })
})
