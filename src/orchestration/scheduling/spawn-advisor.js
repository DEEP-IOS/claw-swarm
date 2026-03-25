/**
 * SpawnAdvisor -- 向量空间多维加权生成建议器
 * Multi-dimensional vector-space weighted spawn advisor.
 *
 * Reads all 12 signal-field dimensions and computes spawn advice
 * (role, model, priority, companions, constraints) via weighted
 * vector scoring instead of linear if-else chains. Supports
 * EXPLOIT / EXPLORE mode toggling with exponential-moving-average
 * outcome tracking.
 *
 * @module orchestration/scheduling/spawn-advisor
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import {
  DIM_TASK, DIM_COORDINATION, DIM_ALARM, DIM_KNOWLEDGE,
  DIM_EMOTION, DIM_TRUST, DIM_SNA, DIM_LEARNING,
  DIM_CALIBRATION, DIM_SPECIES, DIM_REPUTATION, DIM_TRAIL,
  ALL_DIMENSIONS,
} from '../../core/field/types.js'

// ── helpers ────────────────────────────────────────────────────────
/**
 * Clamp a number to [min, max].
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
const clamp = (v, min, max) => Math.min(Math.max(v, min), max)

/**
 * Safely read a dimension value from a field vector.
 * @param {Object} fv - field vector keyed by dimension name
 * @param {string} dim - dimension constant
 * @returns {number} 0-1
 */
const dimVal = (fv, dim) => {
  const v = fv?.[dim]
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : 0
}

// ── main class ─────────────────────────────────────────────────────

/**
 * @typedef {Object} SpawnAdvice
 * @property {string}   role        - recommended role id
 * @property {string}   model       - recommended model tier ('strong'|'balanced'|'fast')
 * @property {string}   priority    - 'urgent'|'high'|'normal'
 * @property {string[]} companions  - recommended companion agent ids / roles
 * @property {Object}   constraints - spawn constraints (budget, tools, etc.)
 * @property {string}   reason      - human-readable decision rationale
 */

export class SpawnAdvisor extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [DIM_TASK, DIM_COORDINATION] }
  /** @returns {string[]} */
  static consumes() { return [...ALL_DIMENSIONS] }
  /** @returns {string[]} */
  static publishes() { return ['spawn.advised', 'spawn.override'] }
  /** @returns {string[]} */
  static subscribes() { return [] }

  /**
   * @param {Object}  opts
   * @param {Object}  opts.field            - SignalField / SignalStore instance
   * @param {Object}  opts.bus              - EventBus instance
   * @param {Object}  [opts.roleRegistry]   - role registry for lookups
   * @param {Object}  [opts.modelCapability]- model capability reference
   * @param {Object}  [opts.config]         - optional overrides
   */
  constructor({ field, bus, roleRegistry, modelCapability, speciesEvolver, globalModulator, budgetTracker, config = {} }) {
    super()
    /** @private */ this._field = field
    /** @private */ this._bus = bus
    /** @private */ this._roleRegistry = roleRegistry ?? null
    /** @private */ this._modelCapability = modelCapability ?? null
    /** @private */ this._speciesEvolver = speciesEvolver ?? null
    /** @private */ this._globalModulator = globalModulator ?? null
    /** @private */ this._budgetTracker = budgetTracker ?? null

    // ── mutable state ──────────────────────────────────────────────
    /** @private @type {'EXPLOIT'|'EXPLORE'} */
    this._mode = 'EXPLOIT'
    /** @private */ this._recentSuccessRate = 0.5
    /** @private */ this._modeThreshold = {
      exploit: config.exploitThreshold ?? 0.7,
      explore: config.exploreThreshold ?? 0.3,
    }
    /** @private @type {Map<string, number>} roleId -> adaptive threshold [0,1] */
    this._roleThresholds = new Map()
    /** @private */ this._adviceCount = 0
    /** @private */ this._overrideCount = 0
  }

  // ════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ════════════════════════════════════════════════════════════════

  /**
   * Compute a spawn advice for the given task scope.
   *
   * @param {string}  taskScope      - scope key used for field queries
   * @param {string}  requestedRole  - caller-preferred role id
   * @param {Object}  [taskContext]   - extra task metadata
   * @returns {SpawnAdvice}
   */
  advise(taskScope, requestedRole, taskContext) {
    const fv = this._readFieldVector(taskScope)

    // apply calibration weight overlay
    const calibrationWeight = dimVal(fv, DIM_CALIBRATION)
    const speciesWeight = dimVal(fv, DIM_SPECIES)

    const advice = {
      role: this._selectRole(fv, requestedRole, taskContext),
      model: this._selectModel(fv, requestedRole, taskContext),
      priority: this._selectPriority(fv),
      companions: this._selectCompanions(fv),
      constraints: this._selectConstraints(fv, calibrationWeight, speciesWeight),
      reason: this._generateReason(fv),
    }

    this._adviceCount++

    // emit signal into field
    if (typeof this._field?.emit === 'function') {
      this._field.emit({
        dimension: DIM_COORDINATION,
        scope: taskScope,
        strength: 0.6 + calibrationWeight * 0.2,
        emitterId: 'spawn-advisor',
        metadata: { advisedRole: advice.role, priority: advice.priority },
      })
    }

    // publish bus event
    if (typeof this._bus?.publish === 'function') {
      this._bus.publish('spawn.advised', {
        taskScope,
        advice,
        mode: this._mode,
        ts: Date.now(),
      })
    }

    return advice
  }

  /**
   * Record the outcome of a spawned agent to adjust adaptive thresholds.
   *
   * @param {string}  agentId  - the agent that finished
   * @param {string}  roleId   - the role it was running
   * @param {boolean} success  - whether it succeeded
   * @param {Object}  [metrics]- optional performance metrics
   */
  recordOutcome(agentId, roleId, success, metrics) {
    // EMA update: rate = 0.8 * old + 0.2 * new
    const value = success ? 1 : 0
    this._recentSuccessRate = 0.8 * this._recentSuccessRate + 0.2 * value

    // Mode toggle
    if (this._recentSuccessRate >= this._modeThreshold.exploit) {
      this._mode = 'EXPLOIT'
    } else if (this._recentSuccessRate <= this._modeThreshold.explore) {
      this._mode = 'EXPLORE'
    }

    // Role-specific ResponseThreshold adjustment
    const prev = this._roleThresholds.get(roleId) ?? 0.5
    const delta = success ? -0.02 : 0.05
    this._roleThresholds.set(roleId, clamp(prev + delta, 0.1, 0.9))
  }

  /**
   * @returns {'EXPLOIT'|'EXPLORE'}
   */
  getMode() {
    return this._globalModulator?.getMode?.() ?? this._mode
  }

  /**
   * @returns {Map<string, number>} roleId -> adaptive threshold
   */
  getThresholds() {
    return new Map(this._roleThresholds)
  }

  /**
   * @returns {{ adviceCount: number, overrideCount: number, mode: string, successRate: number }}
   */
  getStats() {
    return {
      adviceCount: this._adviceCount,
      overrideCount: this._overrideCount,
      mode: this._mode,
      successRate: this._recentSuccessRate,
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  PRIVATE — Field Reading
  // ════════════════════════════════════════════════════════════════

  /**
   * Read the 12-dimensional field vector for a scope.
   * Falls back to dimension-by-dimension query if superpose is unavailable.
   *
   * @private
   * @param {string} scope
   * @returns {Object} map of dimension -> number
   */
  _readFieldVector(scope) {
    // prefer superpose (returns { trail: 0.3, alarm: 0.7, ... })
    if (typeof this._field?.superpose === 'function') {
      try {
        const result = this._field.superpose(scope, ALL_DIMENSIONS)
        if (result && typeof result === 'object') return result
      } catch (_) { /* fall through */ }
    }
    // fallback: query each dimension individually
    const fv = {}
    for (const dim of ALL_DIMENSIONS) {
      fv[dim] = this._querySingleDim(scope, dim)
    }
    return fv
  }

  /**
   * Query a single dimension from the field.
   * @private
   * @param {string} scope
   * @param {string} dim
   * @returns {number}
   */
  _querySingleDim(scope, dim) {
    if (typeof this._field?.query !== 'function') return 0
    try {
      const r = this._field.query({ scope, dimension: dim, limit: 1 })
      if (Array.isArray(r) && r.length > 0) {
        return typeof r[0].strength === 'number' ? clamp(r[0].strength, 0, 1) : 0
      }
      if (typeof r === 'number') return clamp(r, 0, 1)
    } catch (_) { /* ignore */ }
    return 0
  }

  // ════════════════════════════════════════════════════════════════
  //  PRIVATE — Multi-dimension Selectors
  // ════════════════════════════════════════════════════════════════

  /**
   * Select the optimal role using weighted multi-dimension scoring.
   * @private
   * @param {Object} fv - field vector
   * @param {string} requestedRole
   * @param {Object} [taskContext]
   * @returns {string} roleId
   */
  _selectRole(fv, requestedRole, taskContext) {
    // 优先使用物种进化器的最佳物种推荐
    // Prefer species evolver's best species recommendation
    if (this._speciesEvolver) {
      try {
        const bestSpecies = this._speciesEvolver.getBestByRole?.(requestedRole)
        if (bestSpecies?.sensitivity) {
          // Species evolution has converged — use evolved sensitivity as role scoring boost
          // The evolved species' preferred role is authoritative when fitness is high
          if (bestSpecies.fitness > 0.7 && bestSpecies.roleId) {
            return bestSpecies.roleId
          }
        }
      } catch (_) { /* fall through to vector scoring */ }
    }

    const knowledge = dimVal(fv, DIM_KNOWLEDGE)
    const alarm     = dimVal(fv, DIM_ALARM)
    const task      = dimVal(fv, DIM_TASK)
    const learning  = dimVal(fv, DIM_LEARNING)
    const emotion   = dimVal(fv, DIM_EMOTION)

    // Weighted score per candidate role
    const scores = new Map()

    // researcher: high weight on low-knowledge (need to investigate)
    scores.set('researcher', (1 - knowledge) * 0.4 + learning * 0.3 + task * 0.2 + (1 - alarm) * 0.1)
    // debugger: high alarm indicates problems
    scores.set('debugger', alarm * 0.5 + (1 - emotion) * 0.2 + task * 0.2 + knowledge * 0.1)
    // coder: balanced task execution
    scores.set('coder', task * 0.4 + knowledge * 0.25 + (1 - alarm) * 0.2 + learning * 0.15)
    // reviewer: trust/quality oriented
    scores.set('reviewer', dimVal(fv, DIM_TRUST) * 0.3 + dimVal(fv, DIM_REPUTATION) * 0.3 + task * 0.2 + knowledge * 0.2)

    // If the requested role exceeds its adaptive threshold, honour it
    const requestedThreshold = this._roleThresholds.get(requestedRole) ?? 0.5
    const requestedScore = scores.get(requestedRole) ?? 0
    if (requestedScore >= requestedThreshold || !scores.has(requestedRole)) {
      // honour caller's preference when score is above threshold or role is unknown
      return requestedRole
    }

    // Otherwise, pick the highest-scoring role
    let best = requestedRole
    let bestScore = -1
    for (const [roleId, score] of scores) {
      const threshold = this._roleThresholds.get(roleId) ?? 0.5
      const effective = score - threshold * 0.1
      if (effective > bestScore) {
        bestScore = effective
        best = roleId
      }
    }

    if (best !== requestedRole) {
      this._overrideCount++
      if (typeof this._bus?.publish === 'function') {
        this._bus.publish('spawn.override', {
          requestedRole,
          selectedRole: best,
          reason: `Vector scoring overrode ${requestedRole} (${requestedScore.toFixed(2)}) with ${best} (${bestScore.toFixed(2)})`,
        })
      }
    }

    return best
  }

  /**
   * Select model tier based on field vector and mode.
   * @private
   * @param {Object} fv
   * @param {string} roleId
   * @returns {string} 'strong'|'balanced'|'fast'
   */
  _selectModel(fv, roleId, taskContext) {
    // 预算约束优先：BudgetTracker 建议降级时遵守
    // Budget constraint first: honour BudgetTracker downgrade suggestion
    const dagId = taskContext?.dagId
    if (this._budgetTracker && dagId) {
      try {
        const suggestion = this._budgetTracker.suggestModel?.(dagId)
        if (suggestion?.model) return suggestion.model
      } catch (_) { /* ignore */ }
    }

    // 物种进化器的模型偏好
    // Species evolver's preferred model
    if (this._speciesEvolver) {
      try {
        const bestSpecies = this._speciesEvolver.getBestByRole?.(roleId)
        if (bestSpecies?.preferredModel && bestSpecies.fitness > 0.5) {
          return bestSpecies.preferredModel
        }
      } catch (_) { /* ignore */ }
    }

    const emotion  = dimVal(fv, DIM_EMOTION)
    const trust    = dimVal(fv, DIM_TRUST)
    const learning = dimVal(fv, DIM_LEARNING)

    // High emotion or low trust -> need reliable strong model
    if (emotion > 0.7 || trust < 0.3) return 'strong'
    // Improving learning -> can use fast model
    if (learning > 0.6) return 'fast'

    // 使用 GlobalModulator 的模式代替内部模式
    // Use GlobalModulator's mode instead of internal mode
    const mode = this._globalModulator?.getMode?.() ?? this._mode
    if (mode === 'EXPLORE') {
      const hash = (roleId || '').length % 3
      return ['fast', 'balanced', 'strong'][hash]
    }

    return 'balanced'
  }

  /**
   * Select spawn priority from alarm and task signals.
   * @private
   * @param {Object} fv
   * @returns {string} 'urgent'|'high'|'normal'
   */
  _selectPriority(fv) {
    const alarm = dimVal(fv, DIM_ALARM)
    const task  = dimVal(fv, DIM_TASK)
    if (alarm > 0.7) return 'urgent'
    if (task > 0.7)  return 'high'
    return 'normal'
  }

  /**
   * Select companion agents/roles based on SNA and trust.
   * @private
   * @param {Object} fv
   * @returns {string[]} companion ids or role suggestions
   */
  _selectCompanions(fv) {
    const companions = []
    const sna   = dimVal(fv, DIM_SNA)
    const trust = dimVal(fv, DIM_TRUST)

    // Strong SNA pair signal -> recommend pairing
    if (sna > 0.5) companions.push('pair:strong-collaborator')
    // Low trust -> attach a reviewer
    if (trust < 0.4) companions.push('role:reviewer')

    return companions
  }

  /**
   * Derive constraints from species and calibration signals.
   * @private
   * @param {Object} fv
   * @param {number} calibrationWeight
   * @param {number} speciesWeight
   * @returns {Object} constraints object
   */
  _selectConstraints(fv, calibrationWeight, speciesWeight) {
    const constraints = {}

    // Species evolution may restrict tool usage
    if (speciesWeight > 0.6) {
      constraints.allowExperimentalTools = true
      constraints.maxRetries = 5
    } else {
      constraints.allowExperimentalTools = false
      constraints.maxRetries = 3
    }

    // Calibration tunes budget
    constraints.budgetMultiplier = 0.8 + calibrationWeight * 0.4  // [0.8, 1.2]

    // High alarm -> tighter timeout
    if (dimVal(fv, DIM_ALARM) > 0.6) {
      constraints.timeoutMultiplier = 0.7
    } else {
      constraints.timeoutMultiplier = 1.0
    }

    return constraints
  }

  /**
   * Generate a human-readable reason string summarising the field vector.
   * @private
   * @param {Object} fv
   * @returns {string}
   */
  _generateReason(fv) {
    const parts = []
    const alarm = dimVal(fv, DIM_ALARM)
    const task  = dimVal(fv, DIM_TASK)
    const knowledge = dimVal(fv, DIM_KNOWLEDGE)
    const trust = dimVal(fv, DIM_TRUST)

    if (alarm > 0.5)      parts.push(`alarm=${alarm.toFixed(2)}(elevated)`)
    if (task > 0.5)        parts.push(`task=${task.toFixed(2)}(active)`)
    if (knowledge < 0.3)   parts.push(`knowledge=${knowledge.toFixed(2)}(low)`)
    if (trust < 0.4)       parts.push(`trust=${trust.toFixed(2)}(low)`)

    parts.push(`mode=${this._mode}`)
    parts.push(`successRate=${this._recentSuccessRate.toFixed(2)}`)

    return `SpawnAdvice[${parts.join(', ')}]`
  }
}

export default SpawnAdvisor
