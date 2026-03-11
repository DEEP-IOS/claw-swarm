/**
 * SpeciesEvolver -- 遗传算法驱动的种群进化器
 * Genetic-algorithm-driven species evolution engine
 *
 * 每个 Species 是一组信号场敏感度参数 + 首选模型 + fitness 的集合体。
 * 通过锦标赛选择、交叉、变异和 Lotka-Volterra 容量控制，
 * 让代理种群在任务执行中持续进化。
 *
 * Each Species is a bundle of signal-field sensitivity weights, a preferred
 * model tier, and a fitness score. Tournament selection, crossover, mutation,
 * and Lotka-Volterra carrying capacity enforcement drive continuous evolution
 * of agent populations during task execution.
 *
 * @module orchestration/adaptation/species-evolver
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import {
  DIM_SPECIES, DIM_REPUTATION, DIM_LEARNING,
  ALL_DIMENSIONS,
} from '../../core/field/types.js'

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  /** Mutation probability per sensitivity dimension / 每维变异概率 */
  mutationRate: 0.1,
  /** Tournament selection pool size / 锦标赛选择池大小 */
  tournamentSize: 3,
  /** Fraction of population culled each generation / 每代淘汰比例 */
  cullingRate: 0.3,
  /** Max species per role (Lotka-Volterra cap) / 同角色最大种群数 */
  carryingCapacityPerRole: 5,
  /** DAGs between automatic evolution triggers / 自动进化间隔 (DAG 数) */
  evolveInterval: 5,
}

// ============================================================================
// Helpers
// ============================================================================

const clamp = (v, min, max) => Math.min(Math.max(v, min), max)

let _nextSpeciesId = 0
const genSpeciesId = () => `sp-${Date.now().toString(36)}-${(++_nextSpeciesId).toString(36)}`

// ============================================================================
// SpeciesEvolver
// ============================================================================

/**
 * @typedef {Object} Species
 * @property {string}  id             - unique species identifier
 * @property {string}  roleId         - associated role
 * @property {Object<string, number>} sensitivity - dimension -> weight [0,1]
 * @property {string}  preferredModel - model tier ('strong'|'balanced'|'fast')
 * @property {number}  fitness        - current fitness score [0,1]
 * @property {number}  generation     - birth generation
 * @property {number}  taskCount      - tasks completed by this species
 */

export class SpeciesEvolver extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [DIM_SPECIES] }
  /** @returns {string[]} */
  static consumes() { return [DIM_REPUTATION, DIM_LEARNING] }
  /** @returns {string[]} */
  static publishes() { return ['species.evolved', 'species.culled', 'species.generation.completed'] }
  /** @returns {string[]} */
  static subscribes() { return ['dag.completed'] }

  /**
   * @param {Object}  opts
   * @param {Object}  opts.field         - SignalField instance
   * @param {Object}  opts.bus           - EventBus instance
   * @param {Object}  [opts.store]       - persistence store
   * @param {Object}  [opts.roleRegistry] - role registry for built-in roles
   * @param {Object}  [opts.config]      - optional overrides
   */
  constructor({ field, bus, store, roleRegistry, config = {} }) {
    super()
    /** @private */ this._field = field
    /** @private */ this._bus = bus
    /** @private */ this._store = store ?? null
    /** @private */ this._roleRegistry = roleRegistry ?? null
    /** @private */ this._config = { ...DEFAULT_CONFIG, ...config }

    /** @private @type {Map<string, Species>} */
    this._population = new Map()
    /** @private */ this._generationCounter = 0
    /** @private */ this._completedDAGs = 0

    // Seed initial population from roleRegistry
    this._seedFromRegistry()
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start() {
    this._unsub = this._bus?.on?.('dag.completed', () => {
      this._completedDAGs++
      if (this._completedDAGs % this._config.evolveInterval === 0) {
        this.evolve()
      }
    })
  }

  async stop() {
    if (typeof this._unsub === 'function') this._unsub()
  }

  // --------------------------------------------------------------------------
  // Seed initial population
  // --------------------------------------------------------------------------

  /** @private */
  _seedFromRegistry() {
    if (!this._roleRegistry) return
    const roles = this._roleRegistry.getAllRoles?.() ?? this._roleRegistry.list?.() ?? []
    for (const role of roles) {
      const roleId = typeof role === 'string' ? role : role?.id ?? role?.name
      if (!roleId) continue
      const sensitivity = {}
      for (const dim of ALL_DIMENSIONS) {
        // Pull from roleRegistry if available, otherwise default 0.5
        sensitivity[dim] = role?.sensitivity?.[dim] ?? 0.5
      }
      this._population.set(genSpeciesId(), {
        id: null, // patched below
        roleId,
        sensitivity,
        preferredModel: role?.preferredModel ?? 'balanced',
        fitness: 0.5,
        generation: 0,
        taskCount: 0,
      })
    }
    // Patch IDs
    for (const [id, sp] of this._population) sp.id = id
  }

  // --------------------------------------------------------------------------
  // Fitness evaluation
  // --------------------------------------------------------------------------

  /**
   * Evaluate fitness for a single species by reading reputation and learning
   * signals from the field.
   *
   * fitness = reputation_ratio * 0.6 + improving * 0.3 + survival_bonus * 0.1
   *
   * @param {string} speciesId
   * @returns {number} fitness in [0, 1]
   */
  evaluateFitness(speciesId) {
    const sp = this._population.get(speciesId)
    if (!sp) return 0

    // Read DIM_REPUTATION signal for this species' role scope
    const repSignals = this._field?.read?.({ dimension: DIM_REPUTATION, scope: sp.roleId }) ?? []
    const repStrength = repSignals.length > 0
      ? repSignals.reduce((sum, s) => sum + (s.strength ?? 0), 0) / repSignals.length
      : 0.5

    // Read DIM_LEARNING signal
    const learnSignals = this._field?.read?.({ dimension: DIM_LEARNING, scope: sp.roleId }) ?? []
    const improving = learnSignals.length > 0
      ? learnSignals.some(s => (s.strength ?? 0) > 0.5)
      : false

    // Survival bonus: longer-lived species get a small edge
    const survivalBonus = Math.min(sp.generation / 50, 1.0)

    const fitness = clamp(
      repStrength * 0.6 + (improving ? 0.3 : 0) + survivalBonus * 0.1,
      0, 1,
    )

    sp.fitness = fitness
    return fitness
  }

  // --------------------------------------------------------------------------
  // Genetic algorithm: evolve
  // --------------------------------------------------------------------------

  /**
   * Run one generation of the genetic algorithm:
   * 1. Evaluate fitness for all species
   * 2. Tournament selection + crossover + mutation -> offspring
   * 3. Culling (bottom cullingRate fraction)
   * 4. Lotka-Volterra carrying capacity enforcement
   * 5. Emit DIM_SPECIES signals and publish events
   */
  evolve() {
    this._generationCounter++
    const pop = [...this._population.values()]
    if (pop.length < 2) return

    // 1. Evaluate fitness
    for (const sp of pop) this.evaluateFitness(sp.id)

    // 2. Produce offspring via tournament selection + crossover + mutation
    const offspring = []
    const offspringCount = Math.max(1, Math.floor(pop.length * this._config.cullingRate))

    for (let i = 0; i < offspringCount; i++) {
      const parentA = this._tournamentSelect(pop)
      const parentB = this._tournamentSelect(pop)
      if (!parentA || !parentB) continue

      const child = this._crossover(parentA, parentB)
      this._mutate(child)
      offspring.push(child)
    }

    // 3. Culling: remove bottom cullingRate fraction by fitness
    const sorted = [...this._population.entries()].sort((a, b) => a[1].fitness - b[1].fitness)
    const cullCount = Math.floor(sorted.length * this._config.cullingRate)
    const culled = []

    for (let i = 0; i < cullCount && i < sorted.length; i++) {
      const [id, sp] = sorted[i]
      this._population.delete(id)
      culled.push(sp)
    }

    if (culled.length > 0) {
      this._bus?.emit?.('species.culled', {
        generation: this._generationCounter,
        culledIds: culled.map(s => s.id),
      })
    }

    // 4. Add offspring
    for (const child of offspring) {
      this._population.set(child.id, child)

      this._bus?.emit?.('species.evolved', {
        speciesId: child.id,
        roleId: child.roleId,
        generation: this._generationCounter,
      })
    }

    // 5. Lotka-Volterra: enforce carrying capacity per role
    this._enforceCarryingCapacity()

    // 6. Emit DIM_SPECIES signals for high-fitness species
    for (const sp of this._population.values()) {
      if (sp.fitness > 0.6) {
        this._field?.emit?.({
          dimension: DIM_SPECIES,
          scope: sp.roleId,
          strength: sp.fitness,
          emitterId: `species:${sp.id}`,
          metadata: {
            speciesId: sp.id,
            generation: this._generationCounter,
            sensitivity: { ...sp.sensitivity },
          },
        })
      }
    }

    // 7. Publish generation-completed event
    this._bus?.emit?.('species.generation.completed', {
      generation: this._generationCounter,
      populationSize: this._population.size,
      averageFitness: this._averageFitness(),
    })
  }

  // --------------------------------------------------------------------------
  // Selection, crossover, mutation
  // --------------------------------------------------------------------------

  /**
   * Tournament selection: pick k random species, return the fittest.
   * @private
   * @param {Species[]} pop
   * @returns {Species|null}
   */
  _tournamentSelect(pop) {
    if (pop.length === 0) return null
    const k = Math.min(this._config.tournamentSize, pop.length)
    let best = null

    for (let i = 0; i < k; i++) {
      const candidate = pop[Math.floor(Math.random() * pop.length)]
      if (!best || candidate.fitness > best.fitness) best = candidate
    }
    return best
  }

  /**
   * Crossover: for each dimension, 50% chance from parentA or parentB.
   * @private
   * @param {Species} parentA
   * @param {Species} parentB
   * @returns {Species}
   */
  _crossover(parentA, parentB) {
    const sensitivity = {}
    for (const dim of ALL_DIMENSIONS) {
      sensitivity[dim] = Math.random() < 0.5
        ? (parentA.sensitivity[dim] ?? 0.5)
        : (parentB.sensitivity[dim] ?? 0.5)
    }

    return {
      id: genSpeciesId(),
      roleId: Math.random() < 0.5 ? parentA.roleId : parentB.roleId,
      sensitivity,
      preferredModel: Math.random() < 0.5 ? parentA.preferredModel : parentB.preferredModel,
      fitness: 0,
      generation: this._generationCounter,
      taskCount: 0,
    }
  }

  /**
   * Mutation: with mutationRate probability, perturb each sensitivity +/- 0.1.
   * @private
   * @param {Species} sp
   */
  _mutate(sp) {
    const rate = this._config.mutationRate
    for (const dim of ALL_DIMENSIONS) {
      if (Math.random() < rate) {
        const delta = (Math.random() < 0.5 ? -0.1 : 0.1)
        sp.sensitivity[dim] = clamp((sp.sensitivity[dim] ?? 0.5) + delta, 0, 1)
      }
    }
  }

  // --------------------------------------------------------------------------
  // Lotka-Volterra carrying capacity
  // --------------------------------------------------------------------------

  /** @private */
  _enforceCarryingCapacity() {
    const cap = this._config.carryingCapacityPerRole
    // Group by roleId
    const byRole = new Map()
    for (const sp of this._population.values()) {
      if (!byRole.has(sp.roleId)) byRole.set(sp.roleId, [])
      byRole.get(sp.roleId).push(sp)
    }

    for (const [roleId, members] of byRole) {
      if (members.length <= cap) continue
      // Sort ascending by fitness, cull lowest
      members.sort((a, b) => a.fitness - b.fitness)
      const excess = members.length - cap
      for (let i = 0; i < excess; i++) {
        this._population.delete(members[i].id)
      }
      this._bus?.emit?.('species.culled', {
        generation: this._generationCounter,
        reason: 'lotka-volterra',
        roleId,
        culledIds: members.slice(0, excess).map(s => s.id),
      })
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Manually register a new species for a given role.
   * @param {string} roleId
   * @param {{ sensitivity?: Object, preferredModel?: string }} [config]
   * @returns {string} speciesId
   */
  registerSpecies(roleId, config = {}) {
    const id = genSpeciesId()
    const sensitivity = {}
    for (const dim of ALL_DIMENSIONS) {
      sensitivity[dim] = config.sensitivity?.[dim] ?? 0.5
    }
    const sp = {
      id,
      roleId,
      sensitivity,
      preferredModel: config.preferredModel ?? 'balanced',
      fitness: 0.5,
      generation: this._generationCounter,
      taskCount: 0,
    }
    this._population.set(id, sp)
    return id
  }

  /**
   * Get the full current population.
   * @returns {Species[]}
   */
  getPopulation() {
    return [...this._population.values()]
  }

  /**
   * Get the best species for a specific role by fitness.
   * @param {string} roleId
   * @returns {Species|null}
   */
  getBestByRole(roleId) {
    let best = null
    for (const sp of this._population.values()) {
      if (sp.roleId === roleId && (!best || sp.fitness > best.fitness)) {
        best = sp
      }
    }
    return best
  }

  /**
   * Persist the current population to the store.
   * @returns {Promise<void>}
   */
  async persist() {
    if (!this._store) return
    const data = {
      population: Object.fromEntries(this._population),
      generationCounter: this._generationCounter,
      completedDAGs: this._completedDAGs,
    }
    await this._store.set?.('species-evolver:state', JSON.stringify(data))
  }

  /**
   * Restore population from the store.
   * @returns {Promise<void>}
   */
  async restore() {
    if (!this._store) return
    const raw = await this._store.get?.('species-evolver:state')
    if (!raw) return
    try {
      const data = JSON.parse(raw)
      this._population.clear()
      if (data.population) {
        for (const [id, sp] of Object.entries(data.population)) {
          this._population.set(id, sp)
        }
      }
      this._generationCounter = data.generationCounter ?? 0
      this._completedDAGs = data.completedDAGs ?? 0
    } catch { /* ignore corrupt data */ }
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  /** @private @returns {number} */
  _averageFitness() {
    const pop = [...this._population.values()]
    if (pop.length === 0) return 0
    return pop.reduce((sum, sp) => sum + sp.fitness, 0) / pop.length
  }
}

export default SpeciesEvolver
