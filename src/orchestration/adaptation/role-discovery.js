/**
 * RoleDiscovery -- 数据驱动角色发现
 * Data-driven role discovery from agent behavioral patterns
 *
 * 分析会话历史中的工具使用和动作分布，当行为向量与现有角色的
 * 欧几里得距离超过阈值时，识别出新的潜在角色。当置信度和观察次数
 * 满足条件后，将发现的角色正式注册到 roleRegistry。
 *
 * Analyzes tool usage and action distribution from session histories.
 * When the Euclidean distance of a behavioral vector from existing roles
 * exceeds a threshold, a potential new role is identified. Once confidence
 * and observation count meet thresholds, the discovered role is promoted
 * and registered in the roleRegistry.
 *
 * @module orchestration/adaptation/role-discovery
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_TRAIL, DIM_KNOWLEDGE } from '../../core/field/types.js'

// ============================================================================
// Constants
// ============================================================================

/** Distance threshold for "novel" behavior / 新行为距离阈值 */
const DISTANCE_THRESHOLD = 0.5
/** Confidence required for promotion / 提升所需置信度 */
const PROMOTE_CONFIDENCE = 0.8
/** Observations required for promotion / 提升所需观察次数 */
const PROMOTE_OBSERVATIONS = 10
/** Confidence increment per repeated observation / 每次观察增量 */
const CONFIDENCE_INCREMENT = 0.05

// ============================================================================
// RoleDiscovery
// ============================================================================

export class RoleDiscovery extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [] }
  /** @returns {string[]} */
  static consumes() { return [DIM_TRAIL, DIM_KNOWLEDGE] }
  /** @returns {string[]} */
  static publishes() { return ['role.discovered'] }
  /** @returns {string[]} */
  static subscribes() { return ['dag.completed'] }

  /**
   * @param {Object}  opts
   * @param {Object}  opts.field         - SignalField instance
   * @param {Object}  opts.bus           - EventBus instance
   * @param {Object}  [opts.store]       - persistence store
   * @param {Object}  [opts.roleRegistry] - role registry for existing role lookups
   */
  constructor({ field, bus, store, roleRegistry }) {
    super()
    /** @private */ this._field = field
    /** @private */ this._bus = bus
    /** @private */ this._store = store ?? null
    /** @private */ this._roleRegistry = roleRegistry ?? null

    /**
     * Pending discoveries not yet promoted
     * @private @type {Map<string, {name:string, sensitivity:Object, tools:string[], confidence:number, observations:number}>}
     */
    this._discoveries = new Map()
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start() {
    this._unsub = this._bus?.on?.('dag.completed', (payload) => {
      const history = payload?.sessionHistory ?? payload?.history ?? []
      if (history.length > 0) {
        this.analyze(history)
        this.promoteIfReady()
      }
    })
  }

  async stop() {
    if (typeof this._unsub === 'function') this._unsub()
  }

  // --------------------------------------------------------------------------
  // Core: behavioral analysis
  // --------------------------------------------------------------------------

  /**
   * Analyze a session history to detect novel behavioral patterns.
   *
   * Extracts a tool-usage frequency vector, computes Euclidean distance
   * to every known role, and if all distances exceed DISTANCE_THRESHOLD,
   * registers a new discovery or increments an existing one.
   *
   * @param {Array<{tool?: string, action?: string}>} sessionHistory
   *   Array of action records from a completed session
   * @returns {{ name: string, isNew: boolean }|null}
   */
  analyze(sessionHistory) {
    if (!sessionHistory || sessionHistory.length === 0) return null

    // Extract behavioral vector
    const toolFreq = this._extractToolFrequency(sessionHistory)
    const behaviorVec = this._normalizeVector(toolFreq)

    // Compute distance to all known roles
    const existingRoles = this._getExistingRoleVectors()
    let minDistance = Infinity

    for (const roleVec of existingRoles.values()) {
      const dist = this._euclideanDistance(behaviorVec, roleVec)
      if (dist < minDistance) minDistance = dist
    }

    // If close to an existing role, not novel
    if (minDistance < DISTANCE_THRESHOLD && existingRoles.size > 0) return null

    // Generate a name for this behavioral pattern
    const name = this._generateName(sessionHistory)

    // Check if we already have this discovery
    if (this._discoveries.has(name)) {
      const existing = this._discoveries.get(name)
      existing.observations++
      existing.confidence = Math.min(
        existing.confidence + CONFIDENCE_INCREMENT,
        1.0,
      )
      return { name, isNew: false }
    }

    // New discovery
    const discovery = {
      name,
      sensitivity: this._inferSensitivity(sessionHistory),
      tools: this._inferTools(sessionHistory),
      confidence: CONFIDENCE_INCREMENT * 2,
      observations: 1,
    }
    this._discoveries.set(name, discovery)
    return { name, isNew: true }
  }

  // --------------------------------------------------------------------------
  // Promotion
  // --------------------------------------------------------------------------

  /**
   * Check all discoveries and promote those that meet confidence and
   * observation thresholds by registering them in the roleRegistry.
   *
   * @returns {string|null} the promoted roleId, or null if none qualified
   */
  promoteIfReady() {
    for (const [name, disc] of this._discoveries) {
      if (disc.confidence > PROMOTE_CONFIDENCE && disc.observations > PROMOTE_OBSERVATIONS) {
        // Promote to roleRegistry
        const roleId = this._roleRegistry?.registerDynamic?.(name, {
          sensitivity: disc.sensitivity,
          tools: disc.tools,
          origin: 'role-discovery',
        })

        // Publish event
        this._bus?.emit?.('role.discovered', {
          roleId: roleId ?? name,
          name,
          confidence: disc.confidence,
          observations: disc.observations,
          tools: disc.tools,
        })

        // Remove from pending discoveries
        this._discoveries.delete(name)
        return roleId ?? name
      }
    }
    return null
  }

  // --------------------------------------------------------------------------
  // Inference helpers
  // --------------------------------------------------------------------------

  /**
   * Infer signal-field sensitivity from tool usage patterns.
   * write/edit tools -> high trail; grep/read tools -> high knowledge
   * @private
   * @param {Array<{tool?: string, action?: string}>} history
   * @returns {Object<string, number>}
   */
  _inferSensitivity(history) {
    const sensitivity = { trail: 0.5, knowledge: 0.5 }
    let writeCount = 0
    let readCount = 0
    let total = 0

    for (const entry of history) {
      const t = (entry.tool ?? entry.action ?? '').toLowerCase()
      total++
      if (t.includes('write') || t.includes('edit') || t.includes('create')) writeCount++
      if (t.includes('grep') || t.includes('read') || t.includes('search') || t.includes('find')) readCount++
    }

    if (total > 0) {
      sensitivity.trail = Math.min(writeCount / total + 0.3, 1.0)
      sensitivity.knowledge = Math.min(readCount / total + 0.3, 1.0)
    }

    return sensitivity
  }

  /**
   * Infer the tool set from the session history.
   * @private
   * @param {Array<{tool?: string}>} history
   * @returns {string[]}
   */
  _inferTools(history) {
    const toolSet = new Set()
    for (const entry of history) {
      if (entry.tool) toolSet.add(entry.tool)
    }
    return [...toolSet]
  }

  /**
   * Generate a descriptive name from dominant behaviors.
   * e.g. 'hybrid-coder-researcher' based on the mix of actions.
   * @private
   * @param {Array<{tool?: string, action?: string}>} history
   * @returns {string}
   */
  _generateName(history) {
    const categories = { code: 0, research: 0, review: 0, ops: 0 }

    for (const entry of history) {
      const t = (entry.tool ?? entry.action ?? '').toLowerCase()
      if (t.includes('write') || t.includes('edit') || t.includes('create')) categories.code++
      if (t.includes('grep') || t.includes('read') || t.includes('search')) categories.research++
      if (t.includes('review') || t.includes('check') || t.includes('lint')) categories.review++
      if (t.includes('deploy') || t.includes('build') || t.includes('run')) categories.ops++
    }

    const sorted = Object.entries(categories)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])

    if (sorted.length === 0) return 'unknown-role'
    if (sorted.length === 1) return sorted[0][0]
    return `hybrid-${sorted[0][0]}-${sorted[1][0]}`
  }

  // --------------------------------------------------------------------------
  // Vector math
  // --------------------------------------------------------------------------

  /**
   * Extract tool frequency map from history.
   * @private
   * @param {Array<{tool?: string, action?: string}>} history
   * @returns {Map<string, number>}
   */
  _extractToolFrequency(history) {
    const freq = new Map()
    for (const entry of history) {
      const key = entry.tool ?? entry.action ?? 'unknown'
      freq.set(key, (freq.get(key) ?? 0) + 1)
    }
    return freq
  }

  /**
   * Normalize a frequency map to [0,1] range per key.
   * @private
   * @param {Map<string, number>} freq
   * @returns {Map<string, number>}
   */
  _normalizeVector(freq) {
    const max = Math.max(...freq.values(), 1)
    const normalized = new Map()
    for (const [k, v] of freq) {
      normalized.set(k, v / max)
    }
    return normalized
  }

  /**
   * Compute Euclidean distance between two sparse vectors (Maps).
   * @private
   * @param {Map<string, number>} a
   * @param {Map<string, number>} b
   * @returns {number}
   */
  _euclideanDistance(a, b) {
    const allKeys = new Set([...a.keys(), ...b.keys()])
    let sumSq = 0
    for (const k of allKeys) {
      const diff = (a.get(k) ?? 0) - (b.get(k) ?? 0)
      sumSq += diff * diff
    }
    return Math.sqrt(sumSq)
  }

  /**
   * Build normalized tool-usage vectors for all existing roles.
   * @private
   * @returns {Map<string, Map<string, number>>}
   */
  _getExistingRoleVectors() {
    const result = new Map()
    if (!this._roleRegistry) return result

    const roles = this._roleRegistry.getAllRoles?.() ?? this._roleRegistry.list?.() ?? []
    for (const role of roles) {
      const roleId = typeof role === 'string' ? role : role?.id ?? role?.name
      const tools = role?.tools ?? []
      if (roleId && tools.length > 0) {
        const vec = new Map()
        for (const t of tools) vec.set(t, 1.0)
        result.set(roleId, vec)
      }
    }
    return result
  }

  // --------------------------------------------------------------------------
  // Query
  // --------------------------------------------------------------------------

  /**
   * Get all pending (not-yet-promoted) discoveries.
   * @returns {Array<{name:string, sensitivity:Object, tools:string[], confidence:number, observations:number}>}
   */
  getDiscoveries() {
    return [...this._discoveries.values()]
  }

  /**
   * Get a dashboard-friendly snapshot of pending discoveries.
   * @returns {{ pendingCount: number, discoveries: Array }}
   */
  getState() {
    return {
      pendingCount: this._discoveries.size,
      discoveries: this.getDiscoveries(),
    }
  }
}

export default RoleDiscovery
