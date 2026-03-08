/**
 * RoleRegistry — 角色注册表，内置 10 种角色及其 12 维灵敏度向量
 * Role registry with 10 built-in roles and their 12-dimension sensitivity vectors
 *
 * V9 核心: "角色 = 灵敏度过滤器"。每个角色定义了 12 维信号场中的
 * 感知偏好，决定该角色对不同类型信号的敏感程度。
 *
 * @module intelligence/identity/role-registry
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_SPECIES, ALL_DIMENSIONS } from '../../core/field/types.js'

// ============================================================================
// 10 内建角色完整定义 / 10 Built-in Role Definitions
// ============================================================================

const BUILT_IN_ROLES = {
  researcher: {
    id: 'researcher',
    name: 'Researcher',
    description: '探索代码库、收集信息、查找相关资料',
    sensitivity: { trail: 0.3, alarm: 0.2, reputation: 0.1, task: 0.5, knowledge: 0.9, coordination: 0.2, emotion: 0.1, trust: 0.3, sna: 0.2, learning: 0.4, calibration: 0.1, species: 0.1 },
    tools: ['grep', 'glob', 'read', 'web_search', 'web_fetch'],
    preferredModel: 'fast',
    behaviorPrompt: '你是研究型Agent。职责：探索代码库、收集信息、查找相关资料。善于全面搜索和信息汇总。',
    workingMemoryCapacity: 30,
  },
  analyst: {
    id: 'analyst',
    name: 'Analyst',
    description: '深入分析问题、评估方案利弊、提供数据驱动的建议',
    sensitivity: { trail: 0.3, alarm: 0.4, reputation: 0.5, task: 0.8, knowledge: 0.7, coordination: 0.3, emotion: 0.2, trust: 0.4, sna: 0.3, learning: 0.5, calibration: 0.2, species: 0.1 },
    tools: ['grep', 'glob', 'read'],
    preferredModel: 'strong',
    behaviorPrompt: '你是分析型Agent。职责：深入分析问题、评估方案利弊、提供数据驱动的建议。',
    workingMemoryCapacity: 15,
  },
  planner: {
    id: 'planner',
    name: 'Planner',
    description: '制定实施计划、分解任务、确定优先级和依赖关系',
    sensitivity: { trail: 0.3, alarm: 0.3, reputation: 0.4, task: 0.9, knowledge: 0.5, coordination: 0.8, emotion: 0.2, trust: 0.4, sna: 0.6, learning: 0.3, calibration: 0.2, species: 0.2 },
    tools: ['grep', 'glob', 'read'],
    preferredModel: 'strong',
    behaviorPrompt: '你是规划型Agent。职责：制定实施计划、分解任务、确定优先级和依赖关系。',
    workingMemoryCapacity: 15,
  },
  implementer: {
    id: 'implementer',
    name: 'Implementer',
    description: '编写代码、实现功能、修改文件',
    sensitivity: { trail: 0.8, alarm: 0.7, reputation: 0.3, task: 0.9, knowledge: 0.4, coordination: 0.3, emotion: 0.2, trust: 0.3, sna: 0.1, learning: 0.6, calibration: 0.3, species: 0.1 },
    tools: ['grep', 'glob', 'read', 'write', 'edit', 'bash'],
    preferredModel: 'strong',
    behaviorPrompt: '你是实现型Agent。职责：编写代码、实现功能、修改文件。注重代码质量和最佳实践。',
    workingMemoryCapacity: 15,
  },
  debugger: {
    id: 'debugger',
    name: 'Debugger',
    description: '定位和修复Bug、分析错误日志、诊断问题根因',
    sensitivity: { trail: 0.7, alarm: 0.95, reputation: 0.3, task: 0.6, knowledge: 0.5, coordination: 0.2, emotion: 0.3, trust: 0.3, sna: 0.1, learning: 0.5, calibration: 0.2, species: 0.1 },
    tools: ['grep', 'glob', 'read', 'write', 'edit', 'bash'],
    preferredModel: 'strong',
    behaviorPrompt: '你是调试型Agent。职责：定位和修复Bug、分析错误日志、诊断问题根因。',
    workingMemoryCapacity: 15,
  },
  tester: {
    id: 'tester',
    name: 'Tester',
    description: '编写和运行测试、验证功能正确性、确保代码质量',
    sensitivity: { trail: 0.6, alarm: 0.8, reputation: 0.4, task: 0.7, knowledge: 0.3, coordination: 0.2, emotion: 0.1, trust: 0.3, sna: 0.1, learning: 0.4, calibration: 0.3, species: 0.1 },
    tools: ['grep', 'glob', 'read', 'write', 'bash'],
    preferredModel: 'balanced',
    behaviorPrompt: '你是测试型Agent。职责：编写和运行测试、验证功能正确性、确保代码质量。',
    workingMemoryCapacity: 15,
  },
  reviewer: {
    id: 'reviewer',
    name: 'Reviewer',
    description: '代码审查、质量把关、安全审计（只读权限）',
    sensitivity: { trail: 0.6, alarm: 0.9, reputation: 0.8, task: 0.5, knowledge: 0.5, coordination: 0.3, emotion: 0.2, trust: 0.5, sna: 0.3, learning: 0.3, calibration: 0.4, species: 0.1 },
    tools: ['grep', 'glob', 'read'],
    preferredModel: 'strong',
    behaviorPrompt: '你是审查型Agent。职责：代码审查、质量把关、安全审计。只有读取权限，通过反馈影响其他Agent。',
    workingMemoryCapacity: 5,
  },
  consultant: {
    id: 'consultant',
    name: 'Consultant',
    description: '提供专业领域建议、最佳实践推荐、技术选型指导',
    sensitivity: { trail: 0.3, alarm: 0.3, reputation: 0.6, task: 0.7, knowledge: 0.8, coordination: 0.4, emotion: 0.3, trust: 0.5, sna: 0.4, learning: 0.5, calibration: 0.2, species: 0.1 },
    tools: ['grep', 'glob', 'read', 'web_search', 'web_fetch'],
    preferredModel: 'strong',
    behaviorPrompt: '你是咨询型Agent。职责：提供专业领域建议、最佳实践推荐、技术选型指导。',
    workingMemoryCapacity: 15,
  },
  coordinator: {
    id: 'coordinator',
    name: 'Coordinator',
    description: '任务分配、进度跟踪、Agent间通信协调、冲突解决',
    sensitivity: { trail: 0.4, alarm: 0.5, reputation: 0.5, task: 0.8, knowledge: 0.4, coordination: 0.9, emotion: 0.4, trust: 0.6, sna: 0.7, learning: 0.3, calibration: 0.3, species: 0.3 },
    tools: ['grep', 'glob', 'read'],
    preferredModel: 'balanced',
    behaviorPrompt: '你是协调型Agent。职责：任务分配、进度跟踪、Agent间通信协调、冲突解决。',
    workingMemoryCapacity: 15,
  },
  librarian: {
    id: 'librarian',
    name: 'Librarian',
    description: '知识索引、文档管理、信息检索、知识图谱维护',
    sensitivity: { trail: 0.2, alarm: 0.1, reputation: 0.3, task: 0.4, knowledge: 0.95, coordination: 0.2, emotion: 0.1, trust: 0.3, sna: 0.2, learning: 0.6, calibration: 0.1, species: 0.1 },
    tools: ['grep', 'glob', 'read', 'web_search', 'web_fetch'],
    preferredModel: 'fast',
    behaviorPrompt: '你是知识管理型Agent。职责：知识索引、文档管理、信息检索、知识图谱维护。',
    workingMemoryCapacity: 30,
  },
}

// ============================================================================
// RoleRegistry
// ============================================================================

export class RoleRegistry extends ModuleBase {
  static produces()   { return [] }
  static consumes()   { return [DIM_SPECIES] }
  static publishes()  { return ['agent.role.registered'] }
  static subscribes() { return [] }

  /**
   * @param {Object} deps
   * @param {Object} [deps.field]       - SignalStore instance
   * @param {Object} [deps.eventBus]    - EventBus instance
   * @param {Object} [deps.domainStore] - DomainStore instance
   */
  constructor({ field, eventBus, domainStore } = {}) {
    super()
    this._field       = field || null
    this._eventBus    = eventBus || null
    this._domainStore = domainStore || null

    /** @type {Map<string, Object>} */
    this._roles = new Map()
    for (const [id, role] of Object.entries(BUILT_IN_ROLES)) {
      this._roles.set(id, { ...role })
    }
  }

  /**
   * 获取角色定义 / Get role definition
   * 先检查 DIM_SPECIES 信号是否有进化版，否则用内建默认。
   * @param {string} roleId
   * @returns {Object|null}
   */
  get(roleId) {
    const role = this._roles.get(roleId)
    if (!role) return null
    return { ...role, sensitivity: { ...role.sensitivity } }
  }

  /**
   * 返回所有角色 ID / List all role IDs
   * @returns {string[]}
   */
  list() {
    return Array.from(this._roles.keys())
  }

  /**
   * 注册动态角色 / Register a dynamic role
   * @param {string} roleId
   * @param {Object} config
   * @returns {boolean}
   */
  registerDynamic(roleId, config) {
    if (this._roles.has(roleId)) return false

    const sensitivity = {}
    for (const dim of ALL_DIMENSIONS) {
      sensitivity[dim] = (config.sensitivity && typeof config.sensitivity[dim] === 'number')
        ? Math.max(0, Math.min(1, config.sensitivity[dim]))
        : 0.0
    }

    const role = {
      id: roleId,
      name: config.name || roleId,
      description: config.description || '',
      sensitivity,
      tools: Array.isArray(config.tools) ? [...config.tools] : [],
      preferredModel: config.preferredModel || 'balanced',
      behaviorPrompt: config.behaviorPrompt || '',
      workingMemoryCapacity: config.workingMemoryCapacity || 15,
      dynamic: true,
    }

    this._roles.set(roleId, role)

    if (this._eventBus) {
      this._eventBus.publish('agent.role.registered', { roleId, dynamic: true })
    }
    return true
  }

  /**
   * 获取 12 维灵敏度 / Get 12-dim sensitivity vector
   * @param {string} roleId
   * @returns {Object|null}
   */
  getSensitivity(roleId) {
    const role = this._roles.get(roleId)
    return role ? { ...role.sensitivity } : null
  }

  /**
   * 获取工具列表 / Get tool list
   * @param {string} roleId
   * @returns {string[]}
   */
  getTools(roleId) {
    const role = this._roles.get(roleId)
    return role ? [...role.tools] : []
  }

  /**
   * 获取偏好模型 / Get preferred model category
   * @param {string} roleId
   * @returns {string|null}
   */
  getPreferredModel(roleId) {
    const role = this._roles.get(roleId)
    return role ? role.preferredModel : null
  }

  /**
   * 更新灵敏度 / Update sensitivity vector (e.g., via species evolution)
   * @param {string} roleId
   * @param {Object} newSensitivity - 部分或完整的灵敏度对象
   * @returns {boolean}
   */
  updateSensitivity(roleId, newSensitivity) {
    const role = this._roles.get(roleId)
    if (!role) return false

    for (const [dim, val] of Object.entries(newSensitivity)) {
      if (ALL_DIMENSIONS.includes(dim) && typeof val === 'number') {
        role.sensitivity[dim] = Math.max(0, Math.min(1, val))
      }
    }

    if (this._eventBus) {
      this._eventBus.publish('agent.role.registered', { roleId, updated: true })
    }
    return true
  }
}

export default RoleRegistry
