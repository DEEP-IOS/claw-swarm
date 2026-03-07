/**
 * TypeRegistry - 信息素类型注册表
 * Pheromone type registry with 6 default types mapped to field dimensions.
 *
 * @module communication/pheromone/type-registry
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import {
  ALL_DIMENSIONS,
  DIM_TRAIL,
  DIM_ALARM,
  DIM_COORDINATION,
  DIM_KNOWLEDGE,
} from '../../core/field/types.js'

const _dimSet = new Set(ALL_DIMENSIONS)

class TypeRegistry extends ModuleBase {
  static produces() { return [] }
  static consumes() { return [] }

  constructor () {
    super()
    /** @type {Map<string, {lambda:number, fieldDim:string, minBound:number, maxBound:number, description:string}>} */
    this._types = new Map()

    // 6 default pheromone types
    this.register('trail',   { lambda: 0.008, fieldDim: DIM_TRAIL,        minBound: 0.01, maxBound: 1.0, description: '路径/进展 (trail/progress)' })
    this.register('alarm',   { lambda: 0.15,  fieldDim: DIM_ALARM,        minBound: 0.01, maxBound: 1.0, description: '异常/警报 (alarm/anomaly)' })
    this.register('recruit', { lambda: 0.03,  fieldDim: DIM_COORDINATION, minBound: 0.01, maxBound: 1.0, description: '请求增援 (recruit help)' })
    this.register('queen',   { lambda: 0.005, fieldDim: DIM_COORDINATION, minBound: 0.01, maxBound: 1.0, description: '全局指令 (queen directive)' })
    this.register('dance',   { lambda: 0.02,  fieldDim: DIM_KNOWLEDGE,    minBound: 0.01, maxBound: 1.0, description: '知识发现 (knowledge dance)' })
    this.register('food',    { lambda: 0.006, fieldDim: DIM_TRAIL,        minBound: 0.01, maxBound: 1.0, description: '高质量成果 (quality food)' })
  }

  /**
   * 注册信息素类型 / Register a pheromone type
   * @param {string} name
   * @param {{lambda:number, fieldDim:string, minBound:number, maxBound:number, description:string}} config
   */
  register (name, config) {
    if (!name || typeof name !== 'string') {
      throw new Error('TypeRegistry.register: name must be a non-empty string')
    }
    if (!_dimSet.has(config.fieldDim)) {
      throw new Error(`TypeRegistry.register: invalid fieldDim "${config.fieldDim}" — must be one of [${ALL_DIMENSIONS.join(', ')}]`)
    }
    this._types.set(name, { ...config })
  }

  /** @param {string} name @returns {object|undefined} */
  get (name) { return this._types.get(name) }

  /** @param {string} name @returns {boolean} */
  has (name) { return this._types.has(name) }

  /** @returns {string[]} */
  list () { return [...this._types.keys()] }

  /**
   * 返回映射到指定场维度的所有信息素类型名称
   * @param {string} dim
   * @returns {string[]}
   */
  getByFieldDim (dim) {
    const result = []
    for (const [name, cfg] of this._types) {
      if (cfg.fieldDim === dim) result.push(name)
    }
    return result
  }
}

export { TypeRegistry }
export default TypeRegistry
