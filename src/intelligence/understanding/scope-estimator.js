/**
 * ScopeEstimator — 任务范围估算器
 * Estimates scope, risk, and resource needs for a classified intent
 *
 * @module intelligence/understanding/scope-estimator
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_LEARNING, DIM_SNA, DIM_KNOWLEDGE } from '../../core/field/types.js'

const BASE = Object.freeze({
  bug_fix:      { agents: 1, phases: 2, risk: 'low' },
  new_feature:  { agents: 2, phases: 4, risk: 'medium' },
  refactor:     { agents: 2, phases: 3, risk: 'high' },
  optimize:     { agents: 1, phases: 3, risk: 'medium' },
  explore:      { agents: 1, phases: 1, risk: 'low' },
  question:     { agents: 1, phases: 1, risk: 'low' },
})

const RISK_LEVELS = ['low', 'medium', 'high', 'critical']
const MINUTES_PER_PHASE = 15

class ScopeEstimator extends ModuleBase {
  /** @param {{ field: object }} deps */
  constructor({ field }) {
    super()
    this._field = field
  }

  static consumes() { return [DIM_LEARNING, DIM_SNA, DIM_KNOWLEDGE] }
  static publishes() { return ['scope.estimated'] }

  /**
   * Estimate scope for a given intent
   * @param {{ primary: string }} intentResult
   * @param {{ affectedFiles?: string[], hasStrongPairs?: boolean, trend?: string }} [codebaseInfo]
   * @returns {{ affectedFiles: string[], estimatedAgents: number, estimatedPhases: number, estimatedTimeMinutes: number, riskLevel: string, recommendation: string }}
   */
  estimate(intentResult, codebaseInfo) {
    const template = BASE[intentResult.primary] || BASE.question
    let agents = template.agents
    let phases = template.phases
    let riskIdx = RISK_LEVELS.indexOf(template.risk)

    const affectedFiles = codebaseInfo?.affectedFiles || []

    // DIM_LEARNING signal adjustment
    if (codebaseInfo?.trend === 'improving') {
      phases = Math.max(1, Math.round(phases * 0.9))
    } else if (codebaseInfo?.trend === 'declining') {
      phases = Math.round(phases * 1.2)
    }

    // DIM_SNA: strong agent pairs reduce needed agents
    if (codebaseInfo?.hasStrongPairs && agents > 1) {
      agents = Math.max(1, agents - 1)
    }

    // File count affects risk
    if (affectedFiles.length > 10) {
      riskIdx = Math.min(riskIdx + 1, RISK_LEVELS.length - 1)
    }

    // Test involvement adds a phase
    if (affectedFiles.some(f => /test|spec/i.test(f))) {
      phases += 1
    }

    const riskLevel = RISK_LEVELS[riskIdx]
    const estimatedTimeMinutes = phases * MINUTES_PER_PHASE

    const recommendation = this._buildRecommendation(intentResult.primary, riskLevel, agents, affectedFiles.length)

    return {
      affectedFiles,
      estimatedAgents: agents,
      estimatedPhases: phases,
      estimatedTimeMinutes,
      riskLevel,
      recommendation,
    }
  }

  /**
   * Adjust an existing estimate with new information
   * @param {object} original - previous estimate
   * @param {{ affectedFiles?: string[], trend?: string, hasStrongPairs?: boolean }} newInfo
   * @returns {object} adjusted estimate
   */
  adjustEstimate(original, newInfo) {
    const merged = {
      affectedFiles: newInfo.affectedFiles || original.affectedFiles,
      trend: newInfo.trend,
      hasStrongPairs: newInfo.hasStrongPairs,
    }
    return this.estimate({ primary: original._intent || 'question' }, merged)
  }

  /**
   * Build a human-readable recommendation string
   * @private
   */
  _buildRecommendation(intent, risk, agents, fileCount) {
    const parts = [`任务类型: ${intent}, 风险等级: ${risk}`]
    if (agents > 1) parts.push(`建议使用 ${agents} 个代理并行处理`)
    if (fileCount > 10) parts.push(`涉及 ${fileCount} 个文件，建议分批修改`)
    if (risk === 'high' || risk === 'critical') parts.push('建议在独立分支进行，并做充分测试')
    return parts.join('。')
  }
}

export { ScopeEstimator, BASE, RISK_LEVELS }
export default ScopeEstimator
