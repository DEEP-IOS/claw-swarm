/**
 * ResultSynthesizer -- DAG 节点结果合并与冲突解决
 * Merges results from completed DAG nodes: conflict detection, trust-weighted
 * resolution, Jaccard bigram deduplication, artifact extraction, and quality
 * aggregation.
 *
 * [RESEARCH R4] Jaccard bigram similarity: J(A,B) = |A intersect B| / |A union B|
 * Uses character-level bigrams as set elements with a configurable threshold.
 * Trust-weighted conflict resolution prefers the agent with the higher trust
 * score read from the signal field's DIM_TRUST dimension.
 *
 * @module orchestration/planning/result-synthesizer
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_TRAIL, DIM_KNOWLEDGE, DIM_TRUST } from '../../core/field/types.js'

// ============================================================================
// Constants
// ============================================================================

/** Jaccard bigram 相似度阈值 / Default Jaccard bigram similarity threshold */
const DEFAULT_SIMILARITY_THRESHOLD = 0.6

/** 最低文本长度 (低于此值跳过去重) / Min text length for dedup eligibility */
const MIN_TEXT_LENGTH = 30

/** 默认信任分 (无信号时的回退值) / Default trust score fallback */
const DEFAULT_TRUST_SCORE = 0.5

// ============================================================================
// ResultSynthesizer
// ============================================================================

export class ResultSynthesizer extends ModuleBase {
  /**
   * 该模块向信号场发射的维度
   * Dimensions emitted: trail (execution path) and knowledge (discoveries)
   * @returns {string[]}
   */
  static produces() { return [DIM_TRAIL, DIM_KNOWLEDGE] }

  /**
   * 该模块从信号场读取的维度
   * Reads trust signals for conflict resolution weighting
   * @returns {string[]}
   */
  static consumes() { return [DIM_TRUST] }

  /**
   * 发布的事件主题
   * @returns {string[]}
   */
  static publishes() { return ['synthesis.completed', 'synthesis.conflict.detected'] }

  /**
   * 订阅的事件主题
   * @returns {string[]}
   */
  static subscribes() { return ['dag.completed'] }

  /**
   * @param {object} opts
   * @param {object} opts.field            - SignalField / SignalStore 实例
   * @param {object} opts.bus              - EventBus 实例
   * @param {object} [opts.artifactRegistry] - ArtifactRegistry (可选，有则注册产物)
   * @param {number} [opts.similarityThreshold=0.6] - Jaccard 去重阈值
   */
  constructor({ field, bus, artifactRegistry, similarityThreshold }) {
    super()
    /** @private */ this._field = field
    /** @private */ this._bus = bus
    /** @private */ this._artifactRegistry = artifactRegistry ?? null
    /** @private */ this._threshold = similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD
    /** @private */ this._unsubscribers = []
  }

  async start() {
    const listen = this._bus?.on?.bind(this._bus)
    if (!listen) return

    this._unsubscribers.push(
      listen('dag.completed', async (payload) => {
        const dagId = payload?.dagId
        const nodes = Array.isArray(payload?.nodes) ? payload.nodes : []
        if (!dagId || nodes.length === 0) return

        const nodeResults = new Map()
        for (const node of nodes) {
          if (!node?.id || node.result == null) continue
          nodeResults.set(node.id, node.result)
        }

        if (nodeResults.size === 0) return
        await this.merge(dagId, nodeResults)
      }),
    )
  }

  async stop() {
    for (const unsubscribe of this._unsubscribers.splice(0)) {
      unsubscribe?.()
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * 合并 DAG 各节点的执行结果
   * Merge execution results from all completed DAG nodes.
   *
   * @param {string} dagId - DAG 标识
   * @param {Map<string, object>} nodeResults - nodeId -> result 映射
   *   每个 result 可含 `{ files: [{ path, content, agentId }], text, quality }`
   * @returns {Promise<{
   *   mergedResult: object,
   *   conflicts: object[],
   *   deduplicatedCount: number,
   *   artifacts: object[],
   *   avgQuality: number
   * }>}
   */
  async merge(dagId, nodeResults) {
    // 1. 提取所有文件变更并按 path 分组
    const filesByPath = this._groupFilesByPath(nodeResults)

    // 2. 冲突检测
    const conflicts = this._detectConflicts(filesByPath)

    // 3. Trust-weighted 冲突解决
    const resolved = await this._resolveAllConflicts(conflicts, filesByPath)

    // 4. 合并所有文本结果并做 Jaccard bigram 去重
    const { texts: dedupTexts, deduplicatedCount } = this._deduplicateTexts(nodeResults)

    // 5. 提取产物并注册
    const artifacts = await this._extractAndRegisterArtifacts(dagId, resolved, dedupTexts)

    // 6. 质量聚合
    const avgQuality = this._aggregateQuality(nodeResults)

    // 7. 发射信号
    this._emitSignals(dagId, avgQuality)

    // 8. 发布事件
    if (conflicts.length > 0 && this._bus) {
      this._bus.publish('synthesis.conflict.detected', { dagId, count: conflicts.length, conflicts })
    }

    const mergedResult = {
      dagId,
      files: resolved,
      texts: dedupTexts,
      avgQuality,
    }
    const summary = dedupTexts[0]
      || (resolved.length > 0 ? `${resolved.length} file(s) merged.` : `DAG ${dagId} completed.`)

    if (this._bus) {
      this._bus.publish('synthesis.completed', {
        dagId,
        fileCount: resolved.length,
        textCount: dedupTexts.length,
        conflictCount: conflicts.length,
        deduplicatedCount,
        avgQuality,
        summary,
        mergedResult,
        conflicts,
        artifacts,
      })
    }

    return { mergedResult, conflicts, deduplicatedCount, artifacts, avgQuality }
  }

  // --------------------------------------------------------------------------
  // Internal — Bigram Utilities
  // --------------------------------------------------------------------------

  /**
   * 生成字符级 bigram 集合
   * Generate a Set of character-level bigrams from text.
   * @param {string} text
   * @returns {Set<string>}
   */
  _toBigrams(text) {
    const s = text.toLowerCase().replace(/\s+/g, ' ').trim()
    const bigrams = new Set()
    for (let i = 0; i < s.length - 1; i++) {
      bigrams.add(s.slice(i, i + 2))
    }
    return bigrams
  }

  /**
   * 计算两段文本的 Jaccard bigram 相似度
   * Compute Jaccard similarity over character bigram sets.
   * @param {string} textA
   * @param {string} textB
   * @returns {number} similarity in [0, 1]
   */
  _jaccardBigram(textA, textB) {
    if (!textA || !textB) return 0
    const a = this._toBigrams(textA)
    const b = this._toBigrams(textB)
    if (a.size === 0 && b.size === 0) return 1
    if (a.size === 0 || b.size === 0) return 0

    let intersectionSize = 0
    for (const bg of a) {
      if (b.has(bg)) intersectionSize++
    }
    const unionSize = a.size + b.size - intersectionSize
    return unionSize === 0 ? 0 : intersectionSize / unionSize
  }

  // --------------------------------------------------------------------------
  // Internal — Conflict Detection & Resolution
  // --------------------------------------------------------------------------

  /**
   * 按文件 path 分组所有变更
   * @param {Map<string, object>} nodeResults
   * @returns {Map<string, object[]>} path -> [{ path, content, agentId, quality, nodeId }]
   * @private
   */
  _groupFilesByPath(nodeResults) {
    /** @type {Map<string, object[]>} */
    const groups = new Map()
    for (const [nodeId, result] of nodeResults) {
      const files = result?.files
      if (!Array.isArray(files)) continue
      for (const f of files) {
        if (!f.path) continue
        const entry = { ...f, nodeId, quality: result.quality ?? 0 }
        const arr = groups.get(f.path) || []
        arr.push(entry)
        groups.set(f.path, arr)
      }
    }
    return groups
  }

  /**
   * 检测同一文件被多个节点修改的冲突
   * Detect conflicts where multiple nodes modify the same file path.
   * @param {Map<string, object[]>} filesByPath
   * @returns {object[]} conflict descriptors
   * @private
   */
  _detectConflicts(filesByPath) {
    const conflicts = []
    for (const [path, entries] of filesByPath) {
      if (entries.length <= 1) continue
      // 提取所有参与方
      for (let i = 0; i < entries.length - 1; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          conflicts.push({
            path,
            agentA: entries[i].agentId,
            agentB: entries[j].agentId,
            nodeA: entries[i].nodeId,
            nodeB: entries[j].nodeId,
            entryA: entries[i],
            entryB: entries[j],
          })
        }
      }
    }
    return conflicts
  }

  /**
   * 基于信任分解决单个冲突 — 信任高者胜出
   * Resolve a single file conflict using trust-weighted scoring.
   * @param {object} conflict
   * @returns {Promise<object>} winning entry
   * @private
   */
  async _resolveConflict(conflict) {
    let trustA = DEFAULT_TRUST_SCORE
    let trustB = DEFAULT_TRUST_SCORE

    if (this._field?.superpose) {
      const vecA = this._field.superpose(conflict.agentA, [DIM_TRUST])
      const vecB = this._field.superpose(conflict.agentB, [DIM_TRUST])
      trustA = vecA?.trust ?? DEFAULT_TRUST_SCORE
      trustB = vecB?.trust ?? DEFAULT_TRUST_SCORE
    }

    // 信任分更高者胜出；若相同则取 quality 更高者
    if (trustA > trustB) return conflict.entryA
    if (trustB > trustA) return conflict.entryB
    return (conflict.entryA.quality ?? 0) >= (conflict.entryB.quality ?? 0)
      ? conflict.entryA
      : conflict.entryB
  }

  /**
   * 解决所有冲突，返回最终的文件列表（每个 path 仅保留一份）
   * @param {object[]} conflicts
   * @param {Map<string, object[]>} filesByPath
   * @returns {Promise<object[]>} resolved file list
   * @private
   */
  async _resolveAllConflicts(conflicts, filesByPath) {
    /** @type {Map<string, object>} path -> winning entry */
    const winners = new Map()

    // 先放入无冲突的文件
    for (const [path, entries] of filesByPath) {
      if (entries.length === 1) {
        winners.set(path, entries[0])
      }
    }

    // 解决冲突
    for (const conflict of conflicts) {
      if (winners.has(conflict.path)) continue // 已解决
      const winner = await this._resolveConflict(conflict)
      winners.set(conflict.path, winner)
    }

    return [...winners.values()]
  }

  // --------------------------------------------------------------------------
  // Internal — Text Deduplication
  // --------------------------------------------------------------------------

  /**
   * 去重所有节点的文本输出，保留 quality 更高的版本
   * Deduplicate text outputs across nodes using Jaccard bigram similarity.
   * @param {Map<string, object>} nodeResults
   * @returns {{ texts: string[], deduplicatedCount: number }}
   * @private
   */
  _deduplicateTexts(nodeResults) {
    /** @type {{ text: string, quality: number }[]} */
    const candidates = []
    for (const [, result] of nodeResults) {
      if (typeof result?.text === 'string' && result.text.length >= MIN_TEXT_LENGTH) {
        candidates.push({ text: result.text, quality: result.quality ?? 0 })
      }
    }

    const kept = []
    let deduplicatedCount = 0

    for (const candidate of candidates) {
      let isDuplicate = false
      for (let i = 0; i < kept.length; i++) {
        const sim = this._jaccardBigram(candidate.text, kept[i].text)
        if (sim > this._threshold) {
          isDuplicate = true
          deduplicatedCount++
          // 保留 quality 更高的
          if (candidate.quality > kept[i].quality) {
            kept[i] = candidate
          }
          break
        }
      }
      if (!isDuplicate) {
        kept.push(candidate)
      }
    }

    return { texts: kept.map(k => k.text), deduplicatedCount }
  }

  // --------------------------------------------------------------------------
  // Internal — Artifact Extraction & Quality
  // --------------------------------------------------------------------------

  /**
   * 从合并结果中提取产物并通过 ArtifactRegistry 注册
   * @param {string} dagId
   * @param {object[]} resolvedFiles
   * @param {string[]} texts
   * @returns {Promise<object[]>}
   * @private
   */
  async _extractAndRegisterArtifacts(dagId, resolvedFiles, texts) {
    const artifacts = []
    for (const file of resolvedFiles) {
      const artifact = { type: 'file', path: file.path, agentId: file.agentId }
      artifacts.push(artifact)
      if (this._artifactRegistry?.register) {
        await this._artifactRegistry.register(dagId, artifact)
      }
    }
    for (const text of texts) {
      const artifact = { type: 'text', preview: text.slice(0, 120) }
      artifacts.push(artifact)
      if (this._artifactRegistry?.register) {
        await this._artifactRegistry.register(dagId, artifact)
      }
    }
    return artifacts
  }

  /**
   * 计算所有节点的平均质量分
   * Aggregate average quality across all node results.
   * @param {Map<string, object>} nodeResults
   * @returns {number}
   * @private
   */
  _aggregateQuality(nodeResults) {
    let sum = 0
    let count = 0
    for (const [, result] of nodeResults) {
      if (typeof result?.quality === 'number') {
        sum += result.quality
        count++
      }
    }
    return count === 0 ? 0 : sum / count
  }

  // --------------------------------------------------------------------------
  // Internal — Signal Emission
  // --------------------------------------------------------------------------

  /**
   * 向信号场发射 DIM_TRAIL 和 DIM_KNOWLEDGE 信号
   * Emit trail and knowledge signals into the field.
   * @param {string} dagId
   * @param {number} avgQuality
   * @private
   */
  _emitSignals(dagId, avgQuality) {
    if (!this._field?.emit) return

    this._field.emit({
      dimension: DIM_TRAIL,
      scope: dagId,
      strength: Math.max(0, Math.min(1, avgQuality)),
      emitterId: 'result-synthesizer',
    })

    this._field.emit({
      dimension: DIM_KNOWLEDGE,
      scope: dagId,
      strength: 0.5,
      emitterId: 'result-synthesizer',
    })
  }
}

export default ResultSynthesizer
