/**
 * PromptBuilder — 中央 prompt 组装点
 * Central prompt assembly point for all agent prompts
 *
 * 12 个 Section 按优先级组装: CRITICAL > HIGH > MEDIUM > LOW > OPTIONAL。
 * 必须调用 HybridRetrieval.searchForPrompt() 和 StigmergicBoard.search()。
 * 输出不包含蜜蜂隐喻或特定 LLM 品牌名称。
 *
 * @module intelligence/identity/prompt-builder
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { ALL_DIMENSIONS } from '../../core/field/types.js'

// ============================================================================
// Priority constants (mirror context-engine)
// ============================================================================
const P_CRITICAL = 1
const P_HIGH     = 2
const P_MEDIUM   = 3
const P_LOW      = 4
const P_OPTIONAL = 5

// ============================================================================
// PromptBuilder
// ============================================================================

export class PromptBuilder extends ModuleBase {
  static produces()   { return [] }
  static consumes()   { return [...ALL_DIMENSIONS] }
  static publishes()  { return [] }
  static subscribes() { return [] }

  /**
   * @param {Object} deps
   * @param {import('./role-registry.js').RoleRegistry}             deps.roleRegistry
   * @param {import('./sensitivity-filter.js').SensitivityFilter}   deps.sensitivityFilter
   * @param {import('../memory/hybrid-retrieval.js').HybridRetrieval} deps.hybridRetrieval
   * @param {import('../../communication/stigmergy/stigmergic-board.js').StigmergicBoard} deps.stigmergicBoard
   * @param {import('../memory/context-engine.js').ContextEngine}   deps.contextEngine
   * @param {import('./soul-designer.js').SoulDesigner}             deps.soulDesigner
   * @param {import('../memory/user-profile.js').UserProfile}       [deps.userProfile]
   * @param {import('../../core/field/signal-store.js').SignalStore} deps.field
   * @param {import('./capability-engine.js').CapabilityEngine}     [deps.capabilityEngine]
   */
  constructor({
    roleRegistry,
    sensitivityFilter,
    hybridRetrieval,
    stigmergicBoard,
    contextEngine,
    soulDesigner,
    userProfile,
    field,
    capabilityEngine,
  } = {}) {
    super()
    this._roleRegistry      = roleRegistry
    this._sensitivityFilter  = sensitivityFilter
    this._hybridRetrieval    = hybridRetrieval
    this._stigmergicBoard    = stigmergicBoard
    this._contextEngine      = contextEngine
    this._soulDesigner       = soulDesigner
    this._userProfile        = userProfile || null
    this._field              = field
    this._capabilityEngine   = capabilityEngine || null
  }

  // --------------------------------------------------------------------------
  // 核心方法 / Core Method
  // --------------------------------------------------------------------------

  /**
   * 组装完整 prompt / Assemble full agent prompt
   *
   * @param {string} agentId
   * @param {string} roleId
   * @param {Object} taskContext
   * @param {string} taskContext.goal
   * @param {string} taskContext.scope
   * @param {string} [taskContext.sessionId]
   * @param {string} [taskContext.parentAgentId]
   * @param {string[]} [taskContext.tools]
   * @param {string} [taskContext.modelId]
   * @param {string} [taskContext.userId]
   * @returns {Promise<string>} 组装后的 prompt
   */
  async build(agentId, roleId, taskContext) {
    const scope = taskContext.scope || 'global'
    const sections = []

    // ---- Section 1: CRITICAL — 角色身份 ----
    sections.push({
      priority: P_CRITICAL,
      content: this._buildRoleSection(roleId, taskContext),
    })

    // ---- Section 2: CRITICAL — 工具权限 ----
    sections.push({
      priority: P_CRITICAL,
      content: this._buildToolSection(roleId),
    })

    // ---- Section 3: HIGH — 场向量上下文 ----
    const fieldCtx = this._buildFieldContext(scope, roleId)
    if (fieldCtx) {
      sections.push({ priority: P_HIGH, content: fieldCtx })
    }

    // ---- Section 4: HIGH — 当前任务 ----
    sections.push({
      priority: P_HIGH,
      content: `## 当前任务\n${taskContext.goal}\n`,
    })

    // ---- Section 5: MEDIUM — 记忆检索结果 (MUST call HybridRetrieval) ----
    if (this._hybridRetrieval) {
      try {
        const memories = await this._hybridRetrieval.searchForPrompt(
          taskContext.goal, scope, roleId, 2000
        )
        if (memories) {
          sections.push({ priority: P_MEDIUM, content: memories })
        }
      } catch (_) { /* 记忆检索失败不阻塞 prompt 构建 */ }
    }

    // ---- Section 6: MEDIUM — 技能推荐 (R5 预留) ----
    // Reserved for R5 SkillGovernor integration

    // ---- Section 7: LOW — 委派指南 ----
    const delegation = this._buildDelegationGuide(roleId)
    if (delegation) {
      sections.push({ priority: P_LOW, content: delegation })
    }

    // ---- Section 8: LOW — 反模式 ----
    const antiPatterns = this._buildAntiPatterns(roleId)
    if (antiPatterns) {
      sections.push({ priority: P_LOW, content: antiPatterns })
    }

    // ---- Section 9: LOW — EILayer 语调调整 (R3 预留) ----
    // Reserved for R3 EILayer

    // ---- Section 10: LOW — 区域上下文 (R4 预留) ----
    // Reserved for R4 ZoneManager

    // ---- Section 11: OPTIONAL — StigmergicBoard 共享知识 (MUST call) ----
    if (this._stigmergicBoard) {
      try {
        const boardEntries = this._stigmergicBoard.search(taskContext.goal, agentId)
        const boardContent = this._formatBoardEntries(boardEntries)
        if (boardContent) {
          sections.push({ priority: P_OPTIONAL, content: boardContent })
        }
      } catch (_) { /* board 检索失败不阻塞 */ }
    }

    // ---- Section 12: OPTIONAL — UserProfile 偏好 ----
    if (this._userProfile && taskContext.userId) {
      try {
        const prefs = this._userProfile.getPreferences(taskContext.userId)
        const prefContent = this._formatUserPrefs(prefs)
        if (prefContent) {
          sections.push({ priority: P_OPTIONAL, content: prefContent })
        }
      } catch (_) { /* 偏好获取失败不阻塞 */ }
    }

    // ---- 最终组装 ----
    const assembled = sections
      .filter(s => s.content && s.content.trim())
      .map(s => ({
        priority: s.priority,
        content: s.content,
        estimatedTokens: this._contextEngine
          ? this._contextEngine.estimateTokens(s.content)
          : Math.ceil(s.content.length / 3),
      }))

    if (this._contextEngine) {
      return this._contextEngine.assemble(assembled)
    }

    // Fallback: 按优先级拼接
    assembled.sort((a, b) => a.priority - b.priority)
    return assembled.map(s => s.content).join('\n\n')
  }

  // --------------------------------------------------------------------------
  // 辅助方法 / Helper Methods
  // --------------------------------------------------------------------------

  /**
   * 构建角色身份 Section
   * @private
   */
  _buildRoleSection(roleId, taskContext) {
    const role = this._roleRegistry.get(roleId)
    if (!role) return `## 你的角色\n角色: ${roleId}\n`

    let content = `## 你的角色\n${role.behaviorPrompt}\n`

    if (this._soulDesigner) {
      try {
        const identity = this._soulDesigner.design(roleId, taskContext)
        if (identity && identity.personalityTraits) {
          content += `\n${identity.personalityTraits}\n`
        }
      } catch (_) { /* soul designer 失败不阻塞 */ }
    }

    return content
  }

  /**
   * 构建工具权限 Section
   * @private
   */
  _buildToolSection(roleId) {
    const tools = this._roleRegistry.getTools(roleId)
    if (!tools || tools.length === 0) {
      return '## 可用工具\n无可用工具。\n'
    }
    return `## 可用工具\n你只能使用以下工具: ${tools.join(', ')}\n`
  }

  /**
   * 构建场向量上下文 / Format perceived field vector
   * @private
   */
  _buildFieldContext(scope, roleId) {
    if (!this._sensitivityFilter) return null

    try {
      const perceived = this._sensitivityFilter.perceive(scope, roleId)
      if (!perceived) return null

      const lines = ['## 场态感知']

      // 描述关键维度
      const dims = [
        { key: 'task',         label: '任务信号' },
        { key: 'knowledge',    label: '知识信号' },
        { key: 'alarm',        label: '警报信号' },
        { key: 'coordination', label: '协调信号' },
        { key: 'emotion',      label: '情绪信号' },
        { key: 'trail',        label: '路径信号' },
      ]

      for (const { key, label } of dims) {
        const val = perceived[key]
        if (typeof val === 'number' && val > 0.01) {
          const level = val > 0.7 ? '强' : val > 0.3 ? '中' : '弱'
          lines.push(`- ${label}: ${level} (${val.toFixed(2)})`)
        }
      }

      // 特殊情境提示
      if (typeof perceived.alarm === 'number' && perceived.alarm > 0.5) {
        lines.push('\n⚠ 注意：检测到异常信号，请优先排查问题')
      }
      if (typeof perceived.emotion === 'number' && perceived.emotion > 0.5) {
        lines.push('\n💡 前几轮遇到困难，请换个思路')
      }

      return lines.length > 1 ? lines.join('\n') + '\n' : null
    } catch (_) {
      return null
    }
  }

  /**
   * 格式化 StigmergicBoard 条目
   * @private
   */
  _formatBoardEntries(entries) {
    if (!entries || entries.length === 0) return null

    const lines = ['## 共享知识板']
    const limit = Math.min(entries.length, 5)
    for (let i = 0; i < limit; i++) {
      const e = entries[i]
      const key = e._key || e.key || '?'
      const val = typeof e.value === 'string' ? e.value : JSON.stringify(e.value)
      const summary = val.length > 100 ? val.slice(0, 100) + '...' : val
      lines.push(`- [${key}] ${summary}`)
    }
    return lines.join('\n') + '\n'
  }

  /**
   * 格式化用户偏好
   * @private
   */
  _formatUserPrefs(prefs) {
    if (!prefs) return null

    const parts = []
    if (prefs.languagePreferences?.primary) {
      const lang = prefs.languagePreferences.primary === 'zh-CN' ? '中文' : prefs.languagePreferences.primary
      parts.push(`回复语言: ${lang}`)
    }
    if (prefs.communicationStyle) {
      parts.push(`沟通风格: ${prefs.communicationStyle}`)
    }
    if (prefs.codeStyle?.indentSize) {
      parts.push(`代码风格: ${prefs.codeStyle.indentSize}空格缩进`)
    }
    if (prefs.expertiseLevel) {
      parts.push(`用户水平: ${prefs.expertiseLevel}`)
    }

    if (parts.length === 0) return null
    return '## 用户偏好\n' + parts.join('; ') + '\n'
  }

  /**
   * 构建委派指南
   * @private
   */
  _buildDelegationGuide(roleId) {
    const guides = {
      researcher:  '当需要编写或修改代码时，请委派给 implementer 角色。',
      analyst:     '当需要编写代码实现分析方案时，请委派给 implementer 角色。',
      planner:     '规划完成后，请委派给 coordinator 分配执行。',
      implementer: '遇到复杂Bug时，请委派给 debugger 角色。代码完成后请委派 tester 验证。',
      debugger:    '修复后请委派 tester 验证修复是否有效。',
      tester:      '发现Bug时请报告给 debugger 角色。',
      reviewer:    '发现问题后，请将修复建议提交给 implementer 角色。',
      consultant:  '提供建议后，请委派相应角色执行实施。',
      coordinator: '根据任务需求，将子任务委派给最合适的角色。',
      librarian:   '发现知识空白时，请委派 researcher 补充调研。',
    }
    const guide = guides[roleId]
    return guide ? `## 委派指南\n${guide}\n` : null
  }

  /**
   * 构建反模式提示
   * @private
   */
  _buildAntiPatterns(roleId) {
    const patterns = {
      researcher:  '避免: 过度搜索而不汇总结论；不要修改代码文件。',
      analyst:     '避免: 分析瘫痪（过度分析不给出结论）。',
      planner:     '避免: 过度规划，忽略实际约束。',
      implementer: '避免: 不写测试就提交；不要一次性大范围修改。',
      debugger:    '避免: 猜测性修复，应先确认根因。',
      tester:      '避免: 只测试正常路径，忽略边界条件。',
      reviewer:    '避免: 只指出问题不给出建议；不要修改代码。',
      consultant:  '避免: 给出过于理论化的建议，忽略项目实际情况。',
      coordinator: '避免: 微管理（过度干预执行细节）。',
      librarian:   '避免: 只索引不总结，知识碎片化。',
    }
    const pattern = patterns[roleId]
    return pattern ? `## 常见错误\n${pattern}\n` : null
  }
}

export default PromptBuilder
