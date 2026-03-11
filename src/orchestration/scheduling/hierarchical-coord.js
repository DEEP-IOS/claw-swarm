/**
 * HierarchicalCoord -- 分层协调器
 * Manages parent-child DAG relationships, depth-limited subgroup
 * formation, concurrency control per depth level, and result
 * propagation across the hierarchy.
 *
 * @module orchestration/scheduling/hierarchical-coord
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_COORDINATION, DIM_SNA } from '../../core/field/types.js'

// ── defaults ───────────────────────────────────────────────────────

/** @type {Readonly<Object>} */
const DEFAULT_CONFIG = Object.freeze({
  /** Maximum nesting depth for subgroups */
  maxDepth: 3,
  /** Max concurrent active DAGs at each depth level [depth0, depth1, depth2] */
  concurrencyPerDepth: [5, 3, 2],
})

/**
 * @typedef {Object} HierarchyEntry
 * @property {string|null} parentId  - parent DAG id (null for root)
 * @property {string[]}    childIds  - child DAG ids
 * @property {number}      depth     - nesting depth (0 = root)
 * @property {string}      status    - 'active'|'completed'|'cancelled'
 */

// ── main class ─────────────────────────────────────────────────────

export class HierarchicalCoord extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [DIM_COORDINATION] }
  /** @returns {string[]} */
  static consumes() { return [DIM_SNA, DIM_COORDINATION] }
  /** @returns {string[]} */
  static publishes() { return ['hierarchy.subgroup.formed', 'hierarchy.depth.exceeded'] }
  /** @returns {string[]} */
  static subscribes() { return ['dag.created'] }

  /**
   * @param {Object} opts
   * @param {Object} opts.field  - SignalField / SignalStore instance
   * @param {Object} opts.bus    - EventBus instance
   * @param {Object} [opts.config] - override defaults
   */
  constructor({ field, bus, config = {} }) {
    super()
    /** @private */ this._field = field
    /** @private */ this._bus = bus
    /** @private */ this._maxDepth = config.maxDepth ?? DEFAULT_CONFIG.maxDepth
    /** @private */ this._concurrencyPerDepth =
      config.concurrencyPerDepth ?? [...DEFAULT_CONFIG.concurrencyPerDepth]

    /** @private @type {Map<string, HierarchyEntry>} */
    this._hierarchy = new Map()
  }

  // ════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ════════════════════════════════════════════════════════════════

  /**
   * Register a child DAG under a parent.
   *
   * @param {string} parentDagId - parent DAG identifier
   * @param {string} childDagId  - child DAG identifier
   * @param {number} depth       - nesting depth of the child
   * @returns {boolean} true if registered, false if depth exceeded
   */
  registerSubgroup(parentDagId, childDagId, depth) {
    if (depth >= this._maxDepth) {
      if (typeof this._bus?.publish === 'function') {
        this._bus.publish('hierarchy.depth.exceeded', {
          parentDagId, childDagId, depth, maxDepth: this._maxDepth,
        })
      }
      return false
    }

    // ensure parent entry exists
    if (!this._hierarchy.has(parentDagId)) {
      this._hierarchy.set(parentDagId, {
        parentId: null, childIds: [], depth: Math.max(depth - 1, 0), status: 'active',
      })
    }

    const parentEntry = this._hierarchy.get(parentDagId)
    if (!parentEntry.childIds.includes(childDagId)) {
      parentEntry.childIds.push(childDagId)
    }

    this._hierarchy.set(childDagId, {
      parentId: parentDagId,
      childIds: [],
      depth,
      status: 'active',
    })

    if (typeof this._bus?.publish === 'function') {
      this._bus.publish('hierarchy.subgroup.formed', {
        parentDagId, childDagId, depth,
      })
    }

    return true
  }

  /**
   * Check whether an additional DAG can run at the given depth.
   *
   * @param {string} dagId - DAG requesting concurrency
   * @param {number} depth
   * @returns {boolean} true if within concurrency limit
   */
  checkConcurrency(dagId, depth) {
    const limit = this._concurrencyPerDepth[depth] ?? 1
    let activeAtDepth = 0
    for (const entry of this._hierarchy.values()) {
      if (entry.depth === depth && entry.status === 'active') activeAtDepth++
    }
    return activeAtDepth < limit
  }

  /**
   * Get child DAG ids for a given DAG.
   * @param {string} dagId
   * @returns {string[]}
   */
  getSubgroups(dagId) {
    return this._hierarchy.get(dagId)?.childIds ?? []
  }

  /**
   * Get the parent DAG id.
   * @param {string} dagId
   * @returns {string|null}
   */
  getParent(dagId) {
    return this._hierarchy.get(dagId)?.parentId ?? null
  }

  /**
   * Get the nesting depth of a DAG.
   * @param {string} dagId
   * @returns {number} -1 if not found
   */
  getDepth(dagId) {
    const entry = this._hierarchy.get(dagId)
    return entry ? entry.depth : -1
  }

  /**
   * Form a team by reading DIM_SNA to prioritise candidates with
   * existing collaboration history (strong pairs).
   *
   * @param {string}   dagId      - the DAG to form a team for
   * @param {string[]} candidates - candidate agent/role ids
   * @returns {string[]} ordered list (best first)
   */
  formTeam(dagId, candidates) {
    if (!candidates || candidates.length === 0) return []

    // Read SNA signal for collaboration strength
    const snaScores = new Map()
    for (const cid of candidates) {
      let score = 0
      if (typeof this._field?.query === 'function') {
        try {
          const results = this._field.query({ scope: cid, dimension: DIM_SNA, limit: 1 })
          if (Array.isArray(results) && results.length > 0) {
            score = typeof results[0].strength === 'number' ? results[0].strength : 0
          } else if (typeof results === 'number') {
            score = results
          }
        } catch (_) { /* ignore */ }
      }
      snaScores.set(cid, score)
    }

    // Sort by SNA strength descending (strong pairs first)
    return [...candidates].sort((a, b) => (snaScores.get(b) ?? 0) - (snaScores.get(a) ?? 0))
  }

  /**
   * Propagate a child DAG result upward to the parent.
   *
   * @param {string} childDagId - the child that completed
   * @param {*}      result     - result payload
   */
  propagateResult(childDagId, result) {
    const childEntry = this._hierarchy.get(childDagId)
    if (!childEntry) return

    childEntry.status = 'completed'

    if (childEntry.parentId && typeof this._bus?.publish === 'function') {
      this._bus.publish('hierarchy.subgroup.formed', {
        parentDagId: childEntry.parentId,
        childDagId,
        event: 'child.completed',
        result,
      })
    }

    // Emit coordination signal for the parent scope
    if (childEntry.parentId && typeof this._field?.emit === 'function') {
      this._field.emit({
        dimension: DIM_COORDINATION,
        scope: childEntry.parentId,
        strength: 0.5,
        emitterId: 'hierarchical-coord',
        metadata: { childDagId, completed: true },
      })
    }
  }

  /**
   * Recursively cancel a DAG and all its descendants.
   * @param {string} dagId
   */
  cancelSubtree(dagId) {
    const entry = this._hierarchy.get(dagId)
    if (!entry) return

    entry.status = 'cancelled'
    for (const childId of entry.childIds) {
      this.cancelSubtree(childId)
    }
  }
}

export default HierarchicalCoord
