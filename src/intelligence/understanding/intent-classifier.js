/**
 * IntentClassifier — 用户意图分类器
 * Classifies user input into intent categories using keyword matching
 *
 * @module intelligence/understanding/intent-classifier
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_TASK, DIM_KNOWLEDGE } from '../../core/field/types.js'

const INTENTS = Object.freeze({
  BUG_FIX: 'bug_fix',
  NEW_FEATURE: 'new_feature',
  REFACTOR: 'refactor',
  OPTIMIZE: 'optimize',
  EXPLORE: 'explore',
  ANALYZE: 'analyze',
  CONTENT: 'content',
  QUESTION: 'question',
})

const KEYWORD_MAP = Object.freeze({
  bug_fix: ['bug', 'fix', 'error', 'broken', 'crash', 'issue', 'problem', 'debug', '报错', '修复', '出错', '崩溃', '不work', '问题', '故障'],
  new_feature: ['add', 'create', 'implement', 'build', 'new', 'develop', 'design', '新增', '添加', '创建', '实现', '开发', '设计', '搭建', '构建'],
  refactor: ['refactor', 'restructure', 'reorganize', 'clean', 'simplify', '重构', '整理', '优化结构', '简化', '拆分'],
  optimize: ['optimize', 'performance', 'speed', 'slow', 'fast', 'efficient', '优化', '加速', '性能', '慢', '提升', '效率'],
  explore: ['explore', 'investigate', 'understand', 'how', 'why', 'research', 'impact', 'affect', 'review', 'study', '了解', '探索', '调研', '为什么', '影响', '调查', '趋势'],
  analyze: ['analyze', 'analyse', 'evaluate', 'assess', 'compare', 'benchmark', 'audit', 'inspect', '分析', '评估', '对比', '审计', '检查', '评价', '考察', '诊断'],
  content: ['write', 'article', 'blog', 'report', 'essay', 'post', 'draft', 'compose', 'publish', '写', '文章', '报告', '撰写', '草稿', '公众号', '博客', '发布', '内容', '稿'],
  question: ['what', 'where', 'explain', 'describe', 'tell', '什么', '哪里', '解释', '怎么', '是什么', '介绍', '说明', '帮我', '研究'],
})

class IntentClassifier extends ModuleBase {
  /** @param {{ field: object, bus: object }} deps */
  constructor({ field, bus }) {
    super()
    this._field = field
    this._bus = bus
  }

  static produces() { return [DIM_TASK] }
  static consumes() { return [DIM_KNOWLEDGE] }
  static publishes() { return ['intent.classified'] }

  /**
   * Classify a single user input into an intent category
   * @param {string} userInput - raw user message
   * @param {{ recentIntents?: string[] }} [historyContext] - conversation history
   * @returns {{ primary: string, confidence: number, ambiguity: string[], suggestedClarification?: string }}
   */
  classify(userInput, historyContext) {
    if (!userInput || !userInput.trim()) {
      return { primary: INTENTS.QUESTION, confidence: 0.5, ambiguity: [] }
    }

    const lower = userInput.toLowerCase()
    const tokens = lower.split(/[\s,;.!?，。！？；、\-_/\()（）[\]【】]+/).filter(Boolean)

    // Score each intent by keyword hit count (substring match)
    const scores = {}
    for (const [intent, keywords] of Object.entries(KEYWORD_MAP)) {
      let hits = 0
      for (const kw of keywords) {
        if (lower.includes(kw)) hits++
      }
      scores[intent] = hits
    }

    // History boost: consecutive same-intent raises score
    if (historyContext?.recentIntents?.length) {
      const last = historyContext.recentIntents[historyContext.recentIntents.length - 1]
      if (scores[last] !== undefined) {
        scores[last] += 0.5
      }
    }

    // Sort intents by score descending
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
    const [topIntent, topScore] = sorted[0]
    const [, secondScore] = sorted[1] || [null, 0]

    // Zero-match fallback: when no keywords hit, default to 'explore' with low confidence
    if (topScore === 0) {
      return { primary: INTENTS.EXPLORE, confidence: 0.2, ambiguity: [INTENTS.QUESTION] }
    }

    // Confidence: top1 / (top1 + top2 + 1)
    const confidence = Math.round((topScore / (topScore + secondScore + 1)) * 100) / 100

    // Ambiguity detection: second score > top * 0.6
    const ambiguity = []
    if (secondScore > topScore * 0.6 && secondScore > 0) {
      for (const [intent, score] of sorted.slice(1)) {
        if (score > topScore * 0.6) ambiguity.push(intent)
      }
    }

    const result = { primary: topIntent, confidence, ambiguity }

    // Suggest clarification when ambiguous and low confidence
    if (confidence < 0.7 && ambiguity.length > 0) {
      result.suggestedClarification =
        `意图不够明确，可能是 ${topIntent} 或 ${ambiguity.join('/')}, 能否进一步说明？`
    }

    this._bus?.publish('intent.classified', result)
    return result
  }

  /**
   * Classify a batch of inputs
   * @param {string[]} inputs
   * @returns {Array<{ primary: string, confidence: number, ambiguity: string[], suggestedClarification?: string }>}
   */
  classifyBatch(inputs) {
    return inputs.map(input => this.classify(input))
  }
}

export { IntentClassifier, INTENTS, KEYWORD_MAP }
export default IntentClassifier
