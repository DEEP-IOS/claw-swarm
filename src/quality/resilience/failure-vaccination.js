/**
 * FailureVaccination - 失败免疫系统，从历史故障中提取抗原并预防重复失败
 * Failure vaccination system — extract antigens from historical failures and prevent recurrence
 *
 * 类比生物免疫：每次失败被分析后生成"抗原"（关键词模式+预防提示词），
 * 后续任务执行前通过抗原匹配检测免疫性，命中则注入预防性指令。
 *
 * @module quality/resilience/failure-vaccination
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_KNOWLEDGE, DIM_ALARM } from '../../core/field/types.js'

// ============================================================================
// FailureVaccination
// ============================================================================

export class FailureVaccination extends ModuleBase {
  // --------------------------------------------------------------------------
  // Static declarations
  // --------------------------------------------------------------------------

  static produces() { return [DIM_KNOWLEDGE] }
  static consumes() { return [DIM_ALARM] }
  static publishes() { return ['quality.vaccination.matched'] }
  static subscribes() { return ['quality.failure.classified'] }

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  /**
   * @param {Object} opts
   * @param {import('../../core/field/signal-store.js').SignalStore} opts.field
   * @param {import('../../core/bus/event-bus.js').EventBus} opts.bus
   * @param {import('../../core/store/domain-store.js').DomainStore} opts.store
   * @param {Object} [opts.config={}]
   */
  constructor({ field, bus, store, config = {} }) {
    super()

    /** @private */ this._field = field
    /** @private */ this._bus = bus
    /** @private */ this._store = store
    /** @private */ this._matchThreshold = config.matchThreshold ?? 0.5

    /** @private @type {Function|null} bound handler for bus subscription */
    this._onFailureClassified = null
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start() {
    this._onFailureClassified = (envelope) => {
      const data = envelope?.data
      if (!data) return
      // The quality.failure.classified event wraps the error inside failureContext
      const ctx = {
        error: data.failureContext?.error || data.error || '',
        taskDescription: data.failureContext?.taskDescription || data.taskDescription || '',
        severity: data.severity,
        preventionPrompt: data.suggestedStrategy
          ? `Recovery strategy: ${data.suggestedStrategy}. Avoid repeating: ${data.class}`
          : undefined,
      }
      if (ctx.error) {
        try { this.learn(ctx) } catch { /* swallow errors */ }
      }
    }
    this._bus?.subscribe?.('quality.failure.classified', this._onFailureClassified)
  }

  async stop() {
    if (this._onFailureClassified) {
      this._bus?.unsubscribe?.('quality.failure.classified', this._onFailureClassified)
      this._onFailureClassified = null
    }
  }

  // --------------------------------------------------------------------------
  // Immunity Check
  // --------------------------------------------------------------------------

  /**
   * Check if a task description triggers any known failure antigens
   * @param {string} taskDescription
   * @returns {{ immune: boolean, antigens: Object[], preventionPrompts: string[] }}
   */
  checkImmunity(taskDescription) {
    const allAntigens = this._store.queryAll('vaccination-antigens')
    const matched = []

    for (const antigen of allAntigens) {
      const score = this._calculateMatchScore(taskDescription, antigen.keywords)
      if (score >= this._matchThreshold) {
        antigen.matchCount = (antigen.matchCount || 0) + 1
        this._store.put('vaccination-antigens', antigen.id, antigen)
        matched.push({ ...antigen, matchScore: score })
      }
    }

    // Sort by severity descending (critical > high > medium > low)
    matched.sort((a, b) => this._severityOrder(b.severity) - this._severityOrder(a.severity))

    if (matched.length > 0) {
      this._field?.emit?.({
        dimension: DIM_KNOWLEDGE,
        scope: 'vaccination',
        strength: 0.7,
        emitterId: 'FailureVaccination',
        metadata: {
          event: 'immunity_check',
          matchedCount: matched.length,
          topSeverity: matched[0].severity,
        },
      })

      this._bus?.publish?.('quality.vaccination.matched', {
        taskDescription,
        matchedCount: matched.length,
        antigens: matched.map(a => ({ id: a.id, pattern: a.pattern, severity: a.severity })),
        timestamp: Date.now(),
      }, 'FailureVaccination')

      return {
        immune: true,
        antigens: matched,
        preventionPrompts: matched.map(a => a.preventionPrompt),
      }
    }

    return { immune: false, antigens: [], preventionPrompts: [] }
  }

  // --------------------------------------------------------------------------
  // Learning
  // --------------------------------------------------------------------------

  /**
   * Learn from a failure context and create or merge an antigen
   * @param {{ error: string, taskDescription?: string, severity?: string, preventionPrompt?: string }} failureContext
   * @returns {Object} the created or updated antigen
   */
  learn(failureContext) {
    const errorText = failureContext.error || ''
    const taskText = failureContext.taskDescription || ''
    const combinedText = errorText + ' ' + taskText
    const newKeywords = this._extractKeywords(combinedText)

    if (newKeywords.length === 0) {
      // Nothing meaningful to learn
      return null
    }

    // Check for existing similar antigens (keyword overlap > 70%)
    const allAntigens = this._store.queryAll('vaccination-antigens')
    for (const existing of allAntigens) {
      const overlap = this._keywordOverlap(existing.keywords, newKeywords)
      if (overlap > 0.7) {
        // Merge keywords into existing antigen
        const merged = new Set([...existing.keywords, ...newKeywords])
        existing.keywords = Array.from(merged)
        existing.matchCount = (existing.matchCount || 0) + 1
        if (failureContext.severity) {
          // Upgrade severity if new context is higher
          if (this._severityOrder(failureContext.severity) > this._severityOrder(existing.severity)) {
            existing.severity = failureContext.severity
          }
        }
        if (failureContext.preventionPrompt) {
          existing.preventionPrompt = failureContext.preventionPrompt
        }
        this._store.put('vaccination-antigens', existing.id, existing)
        return existing
      }
    }

    // Create new antigen
    const antigen = {
      id: 'ag-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      pattern: errorText.slice(0, 120),
      keywords: newKeywords,
      severity: failureContext.severity || 'medium',
      preventionPrompt: failureContext.preventionPrompt ||
        `Previous failure: "${errorText.slice(0, 80)}". Avoid similar patterns.`,
      matchCount: 0,
      createdAt: Date.now(),
    }

    this._store.put('vaccination-antigens', antigen.id, antigen)
    return antigen
  }

  // --------------------------------------------------------------------------
  // Internal Helpers
  // --------------------------------------------------------------------------

  /**
   * Calculate match score: ratio of keywords found in text
   * @private
   * @param {string} text
   * @param {string[]} keywords
   * @returns {number} 0..1
   */
  _calculateMatchScore(text, keywords) {
    if (!keywords || keywords.length === 0) return 0
    const lowerText = text.toLowerCase()
    let matchedCount = 0
    for (const kw of keywords) {
      if (lowerText.includes(kw.toLowerCase())) {
        matchedCount++
      }
    }
    return matchedCount / keywords.length
  }

  /**
   * Calculate keyword overlap ratio between two keyword arrays
   * @private
   * @param {string[]} existing
   * @param {string[]} incoming
   * @returns {number} 0..1
   */
  _keywordOverlap(existing, incoming) {
    if (!existing || existing.length === 0 || !incoming || incoming.length === 0) return 0
    const existingSet = new Set(existing.map(k => k.toLowerCase()))
    let overlapCount = 0
    for (const kw of incoming) {
      if (existingSet.has(kw.toLowerCase())) {
        overlapCount++
      }
    }
    // Overlap relative to the smaller set
    const minLen = Math.min(existing.length, incoming.length)
    return overlapCount / minLen
  }

  /**
   * Map severity string to numeric order for sorting
   * @private
   * @param {string} sev
   * @returns {number}
   */
  _severityOrder(sev) {
    switch (sev) {
      case 'critical': return 4
      case 'high': return 3
      case 'medium': return 2
      case 'low': return 1
      default: return 0
    }
  }

  /**
   * Extract meaningful keywords from text
   * Splits on whitespace and common punctuation, filters short tokens,
   * supports CJK characters (treated as individual keywords if length >= 2)
   * @private
   * @param {string} text
   * @returns {string[]}
   */
  _extractKeywords(text) {
    if (!text) return []

    // Split on whitespace, punctuation, and common separators
    const tokens = text
      .toLowerCase()
      .split(/[\s,.:;!?(){}[\]"'`\-_/\\|<>@#$%^&*+=~]+/)
      .filter(Boolean)

    // Filter: keep tokens with length >= 3 (handles both ASCII and CJK)
    // Also keep CJK tokens >= 2 chars
    const cjkPattern = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/
    const meaningful = tokens.filter(t => {
      if (cjkPattern.test(t)) return t.length >= 2
      return t.length >= 3
    })

    // Deduplicate
    return Array.from(new Set(meaningful))
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  /**
   * Return stored antigens (up to limit)
   * @param {number} [limit=20]
   * @returns {Object[]}
   */
  getAntigens(limit = 20) {
    const all = this._store.queryAll('vaccination-antigens')
    return all.slice(0, limit)
  }

  /**
   * Return statistics summary
   * @returns {{ totalAntigens: number, totalMatches: number, topPatterns: Object[] }}
   */
  getStats() {
    const all = this._store.queryAll('vaccination-antigens')
    let totalMatches = 0
    for (const ag of all) {
      totalMatches += ag.matchCount || 0
    }

    // Top 5 patterns by match count
    const sorted = [...all].sort((a, b) => (b.matchCount || 0) - (a.matchCount || 0))
    const topPatterns = sorted.slice(0, 5).map(a => ({
      id: a.id,
      pattern: a.pattern,
      matchCount: a.matchCount || 0,
      severity: a.severity,
    }))

    return {
      totalAntigens: all.length,
      totalMatches,
      topPatterns,
    }
  }
}
