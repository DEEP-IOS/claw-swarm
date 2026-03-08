/**
 * SensitivityFilter — 角色敏感度对信号场感知的过滤
 * Role-specific sensitivity filtering of signal field perception
 *
 * perceived = raw * sensitivity (per dimension)
 *
 * @module intelligence/identity/sensitivity-filter
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { ALL_DIMENSIONS } from '../../core/field/types.js'

export class SensitivityFilter extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [] }
  /** @returns {string[]} */
  static consumes() { return [...ALL_DIMENSIONS] }
  /** @returns {string[]} */
  static publishes() { return [] }
  /** @returns {string[]} */
  static subscribes() { return [] }

  /**
   * @param {Object} deps
   * @param {Object} deps.signalStore - SignalStore instance
   * @param {Object} deps.roleRegistry - RoleRegistry instance
   */
  constructor({ signalStore, roleRegistry } = {}) {
    super()
    this._signalStore = signalStore
    this._roleRegistry = roleRegistry
  }

  async start() {}
  async stop() {}

  /**
   * Apply role-specific sensitivity filter to a raw field vector
   * perceived[dim] = raw[dim] * sensitivity[dim]
   *
   * @param {Object} rawFieldVector - { trail: number, alarm: number, ... } raw 12D vector
   * @param {string} roleId - Role ID to get sensitivity from
   * @returns {Object} Filtered 12D vector with perceived strengths
   */
  applyFilter(rawFieldVector, roleId) {
    const sensitivity = this._roleRegistry ? this._roleRegistry.getSensitivity(roleId) : null
    const result = {}

    for (const dim of ALL_DIMENSIONS) {
      const raw = (rawFieldVector && typeof rawFieldVector[dim] === 'number') ? rawFieldVector[dim] : 0
      const sens = (sensitivity && typeof sensitivity[dim] === 'number') ? sensitivity[dim] : 1.0
      result[dim] = raw * sens
    }

    return result
  }

  /**
   * Perceive the current signal field through a role sensitivity lens
   * Reads superposed field for a given scope and applies sensitivity filter
   *
   * @param {string} scope - Signal scope (e.g. agentId, taskId)
   * @param {string} roleId - Role ID
   * @returns {Object} Perceived 12D field vector
   */
  perceive(scope, roleId) {
    let rawVector = {}

    if (this._signalStore) {
      // Build raw vector by querying superposition for each dimension
      const superposed = this._signalStore.superpose(scope)
      if (superposed) {
        rawVector = superposed
      } else {
        // Fallback: query individual dimensions
        for (const dim of ALL_DIMENSIONS) {
          const signals = this._signalStore.query({ scope, dimension: dim, limit: 1, sortBy: 'strength' })
          rawVector[dim] = (signals && signals.length > 0) ? (signals[0].strength || 0) : 0
        }
      }
    }

    return this.applyFilter(rawVector, roleId)
  }

  /**
   * Compare how different roles perceive the same signal field scope
   * Useful for understanding role-specific information asymmetry
   *
   * @param {string} scope - Signal scope
   * @param {string[]} roleIds - Array of role IDs to compare
   * @returns {Object} { [roleId]: { [dim]: number } } perceived vectors per role
   */
  comparePerceptions(scope, roleIds) {
    // Get raw vector once
    let rawVector = {}
    if (this._signalStore) {
      const superposed = this._signalStore.superpose(scope)
      if (superposed) {
        rawVector = superposed
      } else {
        for (const dim of ALL_DIMENSIONS) {
          const signals = this._signalStore.query({ scope, dimension: dim, limit: 1, sortBy: 'strength' })
          rawVector[dim] = (signals && signals.length > 0) ? (signals[0].strength || 0) : 0
        }
      }
    }

    const result = {}
    for (const roleId of roleIds) {
      result[roleId] = this.applyFilter(rawVector, roleId)
    }
    return result
  }
}

export default SensitivityFilter
