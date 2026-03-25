/**
 * ABCClassifier — Artificial Bee Colony role classifier
 * Classifies agents as scout/employed/onlooker based on behavioral metrics
 *
 * @module intelligence/identity/abc-classifier
 * @version 9.2.0
 */

import { ModuleBase } from '../../core/module-base.js';
import { DIM_COORDINATION, DIM_TASK, DIM_REPUTATION } from '../../core/field/types.js';

export class ABCClassifier extends ModuleBase {
  static produces() { return [DIM_COORDINATION]; }
  static consumes() { return [DIM_TASK, DIM_REPUTATION]; }

  constructor({ bus, store } = {}) {
    super();
    this._bus = bus;
    this._store = store;
    /** @type {Map<string, string>} agentId → 'scout'|'employed'|'onlooker' */
    this._roles = new Map();
  }

  async start() {}
  async stop() {}

  /**
   * Classify an agent based on behavioral metrics
   * @param {string} agentId
   * @param {Object} [metrics={}]
   * @returns {string} 'scout'|'employed'|'onlooker'
   */
  classify(agentId, metrics = {}) {
    const successRate = metrics.successRate ?? 0.5;
    const explorationCount = metrics.explorationCount ?? 0;
    const totalTasks = metrics.totalTasks ?? 0;

    let role;
    if (totalTasks > 0 && explorationCount > totalTasks * 0.4) {
      role = 'scout';
    } else if (successRate > 0.7) {
      role = 'employed';
    } else {
      role = 'onlooker';
    }

    this._roles.set(agentId, role);
    return role;
  }

  /**
   * Get current ABC role for an agent
   * @param {string} agentId
   * @returns {string}
   */
  getRole(agentId) {
    return this._roles.get(agentId) ?? 'employed';
  }

  /**
   * Get all agent→role mappings
   * @returns {Object}
   */
  getAllRoles() {
    return Object.fromEntries(this._roles);
  }

  /**
   * Remove agent from tracking
   * @param {string} agentId
   */
  remove(agentId) {
    this._roles.delete(agentId);
  }
}
