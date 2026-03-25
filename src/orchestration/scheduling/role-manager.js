/**
 * RoleManager -- 角色分配与轮换管理器
 * Manages role assignment / release lifecycle for agents, tracks
 * consecutive assignment counts and suggests rotation when an
 * agent has been assigned the same role too many times.
 *
 * @module orchestration/scheduling/role-manager
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_COORDINATION, DIM_SPECIES } from '../../core/field/types.js'

/** Maximum consecutive same-role assignments before rotation is suggested */
const ROTATION_THRESHOLD = 5

/**
 * @typedef {Object} Assignment
 * @property {string} roleId      - assigned role id
 * @property {number} assignedAt  - timestamp (ms)
 * @property {string} status      - 'active'|'released'
 * @property {number} consecutive - consecutive count for this role
 */

// ── main class ─────────────────────────────────────────────────────

export class RoleManager extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [DIM_COORDINATION] }
  /** @returns {string[]} */
  static consumes() { return [DIM_SPECIES] }
  /** @returns {string[]} */
  static publishes() { return ['role.assigned', 'role.released', 'role.dynamic.registered'] }
  /** @returns {string[]} */
  static subscribes() { return ['agent.lifecycle.completed', 'agent.lifecycle.failed'] }

  /**
   * @param {Object} opts
   * @param {Object} opts.field         - SignalField / SignalStore instance
   * @param {Object} opts.bus           - EventBus instance
   * @param {Object} [opts.roleRegistry] - role registry for dynamic registration
   */
  constructor({ field, bus, roleRegistry }) {
    super()
    /** @private */ this._field = field
    /** @private */ this._bus = bus
    /** @private */ this._roleRegistry = roleRegistry ?? null

    /** @private @type {Map<string, Assignment>} agentId -> current assignment */
    this._assignments = new Map()
    /** @private @type {Map<string, string[]>} agentId -> ordered history of roleIds */
    this._roleHistory = new Map()
    /** @private @type {Function[]} */
    this._unsubscribers = []
  }

  async start() {
    const listen = this._bus?.on?.bind(this._bus)
    if (!listen) return

    this._unsubscribers.push(
      listen('agent.lifecycle.completed', (payload) => {
        if (payload?.agentId) this.releaseRole(payload.agentId)
      }),
      listen('agent.lifecycle.failed', (payload) => {
        if (payload?.agentId) this.releaseRole(payload.agentId)
      }),
    )
  }

  async stop() {
    for (const unsubscribe of this._unsubscribers.splice(0)) {
      unsubscribe?.()
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ════════════════════════════════════════════════════════════════

  /**
   * Assign a role to an agent.
   *
   * Reads DIM_SPECIES to check if the species evolution version
   * imposes any restrictions before finalising the assignment.
   *
   * @param {string} agentId
   * @param {string} roleId
   * @returns {Assignment}
   */
  assignRole(agentId, roleId) {
    // Read species evolution signal (advisory, non-blocking)
    let speciesStrength = 0
    if (typeof this._field?.query === 'function') {
      try {
        const r = this._field.query({ scope: agentId, dimension: DIM_SPECIES, limit: 1 })
        if (Array.isArray(r) && r.length > 0 && typeof r[0].strength === 'number') {
          speciesStrength = r[0].strength
        } else if (typeof r === 'number') {
          speciesStrength = r
        }
      } catch (_) { /* ignore */ }
    }

    // Track consecutive same-role count
    const history = this._roleHistory.get(agentId) ?? []
    const lastRole = history.length > 0 ? history[history.length - 1] : null
    const prevAssignment = this._assignments.get(agentId)
    const consecutive = (lastRole === roleId && prevAssignment)
      ? (prevAssignment.consecutive + 1)
      : 1

    const assignment = {
      roleId,
      assignedAt: Date.now(),
      status: 'active',
      consecutive,
    }

    this._assignments.set(agentId, assignment)
    history.push(roleId)
    this._roleHistory.set(agentId, history)

    if (typeof this._bus?.publish === 'function') {
      this._bus.publish('role.assigned', {
        agentId, roleId, consecutive, speciesStrength,
      })
    }

    return assignment
  }

  /**
   * Release an agent's current role.
   * @param {string} agentId
   */
  releaseRole(agentId) {
    const assignment = this._assignments.get(agentId)
    if (!assignment) return

    assignment.status = 'released'

    if (typeof this._bus?.publish === 'function') {
      this._bus.publish('role.released', {
        agentId, roleId: assignment.roleId,
      })
    }
  }

  /**
   * Get all agents with active role assignments.
   * @returns {Map<string, string>} agentId -> roleId
   */
  getActiveRoles() {
    const result = new Map()
    for (const [agentId, assignment] of this._assignments) {
      if (assignment.status === 'active') {
        result.set(agentId, assignment.roleId)
      }
    }
    return result
  }

  /**
   * Register a dynamic role at runtime.
   *
   * @param {Object} roleConfig
   * @param {string} roleConfig.id          - unique role id
   * @param {string} [roleConfig.systemPrompt]
   * @param {string} [roleConfig.preferredModel]
   * @returns {boolean} true if registered successfully
   */
  registerDynamicRole(roleConfig) {
    if (!roleConfig?.id) return false

    if (typeof this._roleRegistry?.registerDynamic === 'function') {
      this._roleRegistry.registerDynamic(roleConfig.id, roleConfig)
    }

    if (typeof this._bus?.publish === 'function') {
      this._bus.publish('role.dynamic.registered', { roleId: roleConfig.id })
    }
    return true
  }

  /**
   * Suggest whether an agent should rotate to a different role.
   *
   * @param {string} agentId
   * @returns {{ shouldRotate: boolean, consecutive: number, suggestion: string }}
   */
  getRotationSuggestion(agentId) {
    const assignment = this._assignments.get(agentId)
    if (!assignment) {
      return { shouldRotate: false, consecutive: 0, suggestion: 'No active assignment' }
    }

    if (assignment.consecutive > ROTATION_THRESHOLD) {
      return {
        shouldRotate: true,
        consecutive: assignment.consecutive,
        suggestion: `Agent ${agentId} has been ${assignment.roleId} for ${assignment.consecutive} consecutive runs; consider rotation`,
      }
    }

    return {
      shouldRotate: false,
      consecutive: assignment.consecutive,
      suggestion: `OK (${assignment.consecutive}/${ROTATION_THRESHOLD})`,
    }
  }

  getStats() {
    return {
      activeAssignments: [...this._assignments.entries()]
        .filter(([, assignment]) => assignment.status === 'active')
        .map(([agentId, assignment]) => ({
          agentId,
          roleId: assignment.roleId,
          assignedAt: assignment.assignedAt,
          consecutive: assignment.consecutive,
        })),
      activeCount: [...this._assignments.values()].filter((assignment) => assignment.status === 'active').length,
      totalAgentsSeen: this._roleHistory.size,
      roleHistoryDepth: Object.fromEntries(
        [...this._roleHistory.entries()].map(([agentId, history]) => [agentId, history.length]),
      ),
    }
  }
}

export default RoleManager
