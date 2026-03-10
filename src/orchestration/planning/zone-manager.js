/**
 * ZoneManager -- 文件区域识别与约束管理
 * Identifies which zone a file belongs to (test, config, core, ui, etc.)
 * and provides zone-specific constraints and lock granularity.
 *
 * Zone classification drives two key orchestration decisions:
 * 1. Agent constraints — each zone carries a list of rules agents must follow.
 * 2. Lock granularity — determines whether resource locks are per-file or
 *    per-directory, used by ResourceArbiter to prevent concurrent edits.
 *
 * @module orchestration/planning/zone-manager
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_KNOWLEDGE } from '../../core/field/types.js'

// ============================================================================
// Zone Type Constants
// ============================================================================

/**
 * 区域类型枚举 / Zone type constants
 * @type {Readonly<Record<string, string>>}
 */
export const ZONES = Object.freeze({
  TEST:           'test',
  CONFIG:         'config',
  CORE:           'core',
  UI:             'ui',
  INFRASTRUCTURE: 'infrastructure',
  DOCS:           'docs',
})

// ============================================================================
// Zone Pattern Matchers (order matters — first match wins)
// ============================================================================

/** @type {Array<{ pattern: RegExp, zone: string }>} */
const ZONE_PATTERNS = [
  { pattern: /(test|spec|__tests__)/i,             zone: ZONES.TEST },
  { pattern: /\.(config|env)|\/config\//i,         zone: ZONES.CONFIG },
  { pattern: /(\/|^)(core|lib)\//i,                zone: ZONES.CORE },
  { pattern: /(\/|^)(components|pages|views)\//i,   zone: ZONES.UI },
  { pattern: /(\/|^)(docker|ci|scripts)\//i,        zone: ZONES.INFRASTRUCTURE },
  { pattern: /(\/|^)docs\/|\.md$/i,                 zone: ZONES.DOCS },
]

// ============================================================================
// ZoneManager
// ============================================================================

export class ZoneManager extends ModuleBase {
  /**
   * 向信号场发射知识维度信号 (zone 识别结果)
   * @returns {string[]}
   */
  static produces() { return [DIM_KNOWLEDGE] }

  /** @returns {string[]} */
  static consumes() { return [] }

  /**
   * 发布 zone 识别事件
   * @returns {string[]}
   */
  static publishes() { return ['zone.identified'] }

  /** @returns {string[]} */
  static subscribes() { return [] }

  /**
   * @param {object} opts
   * @param {object} opts.field - SignalField / SignalStore 实例
   * @param {object} opts.store - 持久化存储
   */
  constructor({ field, store }) {
    super()
    /** @private */ this._field = field
    /** @private */ this._store = store
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * 按路径模式匹配文件所属区域
   * Identify the zone for a given file path using pattern matching.
   * @param {string} filePath - 文件路径 (相对或绝对均可)
   * @returns {string} zone name (from ZONES) or 'unknown'
   */
  identifyZone(filePath) {
    if (!filePath || typeof filePath !== 'string') return 'unknown'
    const normalized = filePath.replace(/\\/g, '/')
    for (const { pattern, zone } of ZONE_PATTERNS) {
      if (pattern.test(normalized)) return zone
    }
    return 'unknown'
  }

  /**
   * 返回指定区域的约束列表（中文描述）
   * Return a list of constraints (in Chinese) agents must follow in the zone.
   * @param {string} zone - zone 名称
   * @returns {string[]} 约束列表
   */
  getZoneConstraints(zone) {
    /** @type {Record<string, string[]>} */
    const constraints = {
      [ZONES.TEST]: [
        '你正在测试区域，不要修改源代码，只写测试',
        '确保测试独立可运行',
      ],
      [ZONES.CONFIG]: [
        '配置文件修改需要格外小心',
        '确认环境变量含义后再修改',
        '修改前先备份',
      ],
      [ZONES.CORE]: [
        '核心代码修改需要充分理由',
        '确保向后兼容',
        '必须有对应测试',
      ],
      [ZONES.UI]: [
        '关注视觉一致性',
        '检查响应式布局',
        '注意无障碍访问',
      ],
      [ZONES.INFRASTRUCTURE]: [
        '不要直接修改 CI 配置',
        'Docker 修改需要本地验证',
      ],
      [ZONES.DOCS]: [
        '保持文档与代码同步',
        '使用项目统一的文档风格',
      ],
    }
    return constraints[zone] ?? []
  }

  /**
   * 返回区域的锁粒度级别
   * Return lock granularity for the zone — either 'file' or 'directory'.
   * @param {string} zone
   * @returns {'file' | 'directory'}
   */
  getZoneLockGranularity(zone) {
    if (zone === ZONES.CORE || zone === ZONES.CONFIG) return 'file'
    return 'directory'
  }

  /**
   * 批量分析文件列表，返回 zone -> filePaths 的映射
   * Analyze a list of file paths and group them by zone.
   * @param {string[]} filePaths
   * @returns {Map<string, string[]>} zone -> file paths
   */
  analyzeProject(filePaths) {
    /** @type {Map<string, string[]>} */
    const zoneMap = new Map()
    if (!Array.isArray(filePaths)) return zoneMap

    for (const fp of filePaths) {
      const zone = this.identifyZone(fp)
      const arr = zoneMap.get(zone) || []
      arr.push(fp)
      zoneMap.set(zone, arr)
    }
    return zoneMap
  }
}

export default ZoneManager
