/**
 * ResponseMatrix - 信息素-角色响应矩阵
 * Pheromone-role response matrix for computing agent urgency from field concentrations
 *
 * 6 种信息素 x 10 种角色的响应系数矩阵，用于将信号场浓度转化为
 * 各角色的紧急度评分，驱动任务分配和协调决策。
 *
 * @module communication/pheromone/response-matrix
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import {
  DIM_TRAIL,
  DIM_ALARM,
  DIM_KNOWLEDGE,
  DIM_COORDINATION,
} from '../../core/field/types.js'

// ============================================================================
// ResponseMatrix
// ============================================================================

export class ResponseMatrix extends ModuleBase {
  // --------------------------------------------------------------------------
  // 静态声明 / Static declarations
  // --------------------------------------------------------------------------

  static produces() { return [] }
  static consumes() { return [DIM_TRAIL, DIM_ALARM, DIM_KNOWLEDGE, DIM_COORDINATION] }
  static publishes() { return [] }
  static subscribes() { return [] }

  // --------------------------------------------------------------------------
  // 构造函数 / Constructor
  // --------------------------------------------------------------------------

  /**
   * @param {Object} opts
   * @param {import('./pheromone-engine.js').PheromoneEngine} opts.pheromoneEngine - 信息素引擎引用 / PheromoneEngine reference
   */
  constructor({ pheromoneEngine }) {
    super()

    /** @private */
    this._pheromoneEngine = pheromoneEngine

    /**
     * 6 信息素 x 10 角色 响应系数矩阵
     * 值域 [0, 1]：0 = 完全不响应，1 = 最大响应
     * @private
     */
    this._matrix = {
      trail:   { researcher: 0.3, implementer: 0.8, reviewer: 0.4, debugger: 0.5, coordinator: 0.6, architect: 0.4, tester: 0.5, analyst: 0.3, optimizer: 0.7, mentor: 0.3 },
      alarm:   { researcher: 0.2, implementer: 0.5, reviewer: 0.9, debugger: 0.95, coordinator: 0.7, architect: 0.3, tester: 0.8, analyst: 0.4, optimizer: 0.3, mentor: 0.2 },
      recruit: { researcher: 0.6, implementer: 0.3, reviewer: 0.2, debugger: 0.4, coordinator: 0.9, architect: 0.5, tester: 0.2, analyst: 0.3, optimizer: 0.2, mentor: 0.7 },
      queen:   { researcher: 0.8, implementer: 0.8, reviewer: 0.8, debugger: 0.8, coordinator: 1.0, architect: 0.9, tester: 0.8, analyst: 0.8, optimizer: 0.8, mentor: 0.9 },
      dance:   { researcher: 0.9, implementer: 0.4, reviewer: 0.3, debugger: 0.3, coordinator: 0.5, architect: 0.7, tester: 0.2, analyst: 0.8, optimizer: 0.4, mentor: 0.6 },
      food:    { researcher: 0.4, implementer: 0.7, reviewer: 0.5, debugger: 0.3, coordinator: 0.6, architect: 0.5, tester: 0.4, analyst: 0.4, optimizer: 0.8, mentor: 0.3 },
    }
  }

  // --------------------------------------------------------------------------
  // 核心方法 / Core Methods
  // --------------------------------------------------------------------------

  /**
   * 计算单一信息素对特定角色的响应梯度
   * Compute the response gradient of a single pheromone type for a given role
   *
   * @param {string} pheromoneType - 信息素类型 / Pheromone type (e.g. 'trail')
   * @param {string} role          - 角色名 / Role name (e.g. 'debugger')
   * @param {number} concentration - 信息素浓度 [0, 1] / Pheromone concentration
   * @returns {number} 响应梯度值 / Response gradient value
   */
  getResponseGradient(pheromoneType, role, concentration) {
    const baseResponse = this._matrix[pheromoneType]?.[role] ?? 0.5
    return baseResponse * concentration
  }

  /**
   * 计算指定 scope 和角色的综合紧急度
   * Compute aggregated urgency for a given scope and role
   *
   * @param {string} scope - 作用域 / Scope
   * @param {string} role  - 角色名 / Role name
   * @returns {number} 归一化紧急度 [0, 1] / Normalized urgency in [0, 1]
   */
  computeUrgency(scope, role) {
    const concentrations = this._pheromoneEngine.readAll(scope)
    const types = Object.keys(concentrations)
    const typeCount = types.length || 1

    let urgency = 0
    for (const type of types) {
      urgency += this.getResponseGradient(type, role, concentrations[type])
    }

    return Math.min(urgency / typeCount, 1)
  }

  /**
   * 获取对指定角色响应最强的 top-K 信息素
   * Get the top-K pheromone types with highest response gradient for a role
   *
   * @param {string} scope   - 作用域 / Scope
   * @param {string} role    - 角色名 / Role name
   * @param {number} [topK=3] - 返回前 K 个 / Return top K
   * @returns {Array<{ type: string, gradient: number }>}
   */
  getTopPheromones(scope, role, topK = 3) {
    const concentrations = this._pheromoneEngine.readAll(scope)
    const entries = []

    for (const type of Object.keys(concentrations)) {
      const gradient = this.getResponseGradient(type, role, concentrations[type])
      entries.push({ type, gradient })
    }

    entries.sort((a, b) => b.gradient - a.gradient)
    return entries.slice(0, topK)
  }

  /**
   * 返回矩阵中定义的所有角色列表
   * Return the list of all roles defined in the matrix
   *
   * @returns {string[]}
   */
  getRoles() {
    // 所有信息素行共享同一角色集，取第一行的 keys 即可
    const firstRow = this._matrix.trail
    return firstRow ? Object.keys(firstRow) : []
  }

  /**
   * 返回响应矩阵的深拷贝
   * Return a deep copy of the response matrix
   *
   * @returns {Record<string, Record<string, number>>}
   */
  getMatrix() {
    const copy = {}
    for (const [type, roleMap] of Object.entries(this._matrix)) {
      copy[type] = { ...roleMap }
    }
    return copy
  }
}
