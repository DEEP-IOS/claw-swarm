/**
 * RequirementClarifier — 需求澄清器
 * Generates clarification questions based on classified intent
 *
 * @module intelligence/understanding/requirement-clarifier
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_KNOWLEDGE, DIM_TASK } from '../../core/field/types.js'

const GENERIC_QUESTIONS = Object.freeze({
  bug_fix: [
    { question: '能否提供复现步骤？', impact: 'high' },
    { question: '这个bug是什么时候开始出现的？', impact: 'medium' },
    { question: '有相关的错误日志吗？', impact: 'high' },
  ],
  new_feature: [
    { question: '这个功能的目标用户是谁？', impact: 'medium' },
    { question: '需要支持哪些边界情况？', impact: 'high' },
    { question: '有参考设计或示例吗？', impact: 'medium' },
  ],
  refactor: [
    { question: '重构的主要目标是什么（性能/可读性/可维护性）？', impact: 'high' },
    { question: '有哪些文件需要修改？', impact: 'medium' },
  ],
  optimize: [
    { question: '当前的性能瓶颈在哪里？', impact: 'high' },
    { question: '有性能基准数据吗？', impact: 'medium' },
  ],
  explore: [
    { question: '你想了解哪个方面的信息？', impact: 'high' },
  ],
  question: [
    { question: '能否提供更多上下文？', impact: 'medium' },
  ],
})

const IMPACT_ORDER = Object.freeze({ high: 0, medium: 1, low: 2 })

class RequirementClarifier extends ModuleBase {
  /** @param {{ field: object, bus: object }} deps */
  constructor({ field, bus }) {
    super()
    this._field = field
    this._bus = bus
  }

  static consumes() { return [DIM_KNOWLEDGE, DIM_TASK] }
  static publishes() { return ['clarification.generated'] }
  static subscribes() { return ['intent.classified'] }

  /**
   * Generate clarification questions based on intent classification
   * @param {{ primary: string, confidence: number, ambiguity: string[] }} intentResult
   * @param {{ hasTests?: boolean }} [codebaseContext]
   * @returns {{ question: string, impact: string }[]}
   */
  generateQuestions(intentResult, codebaseContext) {
    const { primary, ambiguity } = intentResult

    // Start with base questions for the primary intent
    const questions = [
      ...(GENERIC_QUESTIONS[primary] || GENERIC_QUESTIONS.question),
    ]

    // Ambiguity resolution: add disambiguation questions
    if (ambiguity && ambiguity.length > 0) {
      const candidates = [primary, ...ambiguity].join(' / ')
      questions.push({
        question: `您的需求似乎涉及多个方面（${candidates}），能否明确主要目标？`,
        impact: 'high',
      })
    }

    // Codebase context: no tests present
    if (codebaseContext && codebaseContext.hasTests === false) {
      questions.push({
        question: '当前缺少测试覆盖，是否需要补充测试？',
        impact: 'medium',
      })
    }

    // Sort by impact: high > medium > low
    questions.sort((a, b) => (IMPACT_ORDER[a.impact] ?? 2) - (IMPACT_ORDER[b.impact] ?? 2))

    this._bus?.publish('clarification.generated', { intent: primary, questions })
    return questions
  }

  /**
   * Refine original requirement by merging user answers
   * @param {string} original - original user input
   * @param {Map<string, string>} answers - question -> answer map
   * @returns {{ original: string, clarifications: object, refined: string, confidence: number }}
   */
  refineRequirement(original, answers) {
    const clarifications = {}
    const parts = [original]

    for (const [question, answer] of answers) {
      clarifications[question] = answer
      if (answer && answer.trim()) {
        parts.push(answer.trim())
      }
    }

    const refined = parts.join('。')
    const answerCount = [...answers.values()].filter(v => v && v.trim()).length
    const confidence = Math.min(0.5 + answerCount * 0.15, 1.0)

    return { original, clarifications, refined, confidence }
  }

  /**
   * Check if an intent result is ambiguous and needs clarification
   * @param {{ confidence: number, ambiguity: string[] }} intentResult
   * @returns {boolean}
   */
  isAmbiguous(intentResult) {
    return intentResult.confidence < 0.7 && intentResult.ambiguity.length > 0
  }
}

export { RequirementClarifier, GENERIC_QUESTIONS }
export default RequirementClarifier
