/**
 * ResourceArbiter -- 资源仲裁器
 * Manages file locks (read-shared / write-exclusive), provider rate
 * limits (shared token bucket), and tool concurrency gates. Lock
 * granularity is determined by the zone manager.
 *
 * @module orchestration/scheduling/resource-arbiter
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_COORDINATION } from '../../core/field/types.js'

// ── defaults ───────────────────────────────────────────────────────

/** @type {Readonly<Object>} */
const DEFAULT_CONFIG = Object.freeze({
  /** Maximum time (ms) a lock can be held before auto-release consideration */
  lockTimeoutMs: 30_000,
  /** Per-provider rate-limit defaults */
  rateLimits: { default: { maxTokens: 60, refillRate: 60 } },
  /** Per-tool concurrency caps */
  toolConcurrency: { bash: 3, write: 1, edit: 1, read: 10, grep: 5, glob: 5 },
})

/**
 * @typedef {Object} LockEntry
 * @property {Set<string>}   holders    - agent ids holding the lock
 * @property {string}        mode       - 'read'|'write'
 * @property {number}        acquiredAt - epoch ms
 * @property {Array<{agentId:string, mode:string, resolve:Function}>} waitQueue
 */

/**
 * @typedef {Object} RateLimitEntry
 * @property {number} tokens      - current available tokens
 * @property {number} maxTokens   - bucket capacity
 * @property {number} lastRefill  - epoch ms of last refill
 * @property {number} refillRate  - tokens per minute
 */

/**
 * @typedef {Object} ToolGate
 * @property {number} maxConcurrent - concurrency limit
 * @property {number} current       - current active count
 */

// ── main class ─────────────────────────────────────────────────────

export class ResourceArbiter extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [DIM_COORDINATION] }
  /** @returns {string[]} */
  static consumes() { return [DIM_COORDINATION] }
  /** @returns {string[]} */
  static publishes() { return ['resource.lock.acquired', 'resource.lock.released', 'resource.conflict'] }
  /** @returns {string[]} */
  static subscribes() { return [] }

  /**
   * @param {Object} opts
   * @param {Object} opts.field        - SignalField / SignalStore instance
   * @param {Object} opts.bus          - EventBus instance
   * @param {Object} [opts.zoneManager]- zone manager for lock granularity
   * @param {Object} [opts.config]     - overrides for DEFAULT_CONFIG
   */
  constructor({ field, bus, zoneManager, config = {} }) {
    super()
    /** @private */ this._field = field
    /** @private */ this._bus = bus
    /** @private */ this._zoneManager = zoneManager ?? null
    /** @private */ this._lockTimeoutMs = config.lockTimeoutMs ?? DEFAULT_CONFIG.lockTimeoutMs

    /** @private @type {Map<string, LockEntry>} lockKey -> entry */
    this._locks = new Map()

    /** @private @type {Map<string, RateLimitEntry>} provider -> entry */
    this._rateLimits = new Map()
    this._initRateLimits(config.rateLimits ?? DEFAULT_CONFIG.rateLimits)

    /** @private @type {Map<string, ToolGate>} toolName -> gate */
    this._toolGates = new Map()
    this._initToolGates(config.toolConcurrency ?? DEFAULT_CONFIG.toolConcurrency)
  }

  // ════════════════════════════════════════════════════════════════
  //  PUBLIC — File Locking
  // ════════════════════════════════════════════════════════════════

  /**
   * Acquire a lock on a file path.
   * - Read locks are shared (multiple readers OK).
   * - Write locks are exclusive (no concurrent readers or writers).
   *
   * @param {string} agentId
   * @param {string} filePath
   * @param {string} mode - 'read'|'write'
   * @returns {{ acquired: boolean, waiters?: number }}
   */
  acquireLock(agentId, filePath, mode) {
    const lockKey = this._resolveLockKey(filePath)
    const existing = this._locks.get(lockKey)

    // No existing lock -> grant immediately
    if (!existing) {
      this._locks.set(lockKey, {
        holders: new Set([agentId]),
        mode,
        acquiredAt: Date.now(),
        waitQueue: [],
      })
      this._publishLockEvent('resource.lock.acquired', agentId, filePath, mode)
      return { acquired: true }
    }

    // Read + existing reads -> share
    if (mode === 'read' && existing.mode === 'read') {
      existing.holders.add(agentId)
      this._publishLockEvent('resource.lock.acquired', agentId, filePath, mode)
      return { acquired: true }
    }

    // Conflict: either write requested on read-held, or any request on write-held
    existing.waitQueue.push({ agentId, mode })
    return { acquired: false, waiters: existing.waitQueue.length }
  }

  /**
   * Release a lock held by an agent on a file path.
   * Wakes up the next waiter if the lock becomes free.
   *
   * @param {string} agentId
   * @param {string} filePath
   */
  releaseLock(agentId, filePath) {
    const lockKey = this._resolveLockKey(filePath)
    const entry = this._locks.get(lockKey)
    if (!entry) return

    entry.holders.delete(agentId)
    this._publishLockEvent('resource.lock.released', agentId, filePath, entry.mode)

    // If no holders remain, try to grant to next waiter
    if (entry.holders.size === 0) {
      if (entry.waitQueue.length > 0) {
        const next = entry.waitQueue.shift()
        entry.holders.add(next.agentId)
        entry.mode = next.mode
        entry.acquiredAt = Date.now()
        this._publishLockEvent('resource.lock.acquired', next.agentId, filePath, next.mode)
      } else {
        this._locks.delete(lockKey)
      }
    }
  }

  /**
   * Detect a conflict between two agents on a file and suggest resolution.
   *
   * @param {string} agentA
   * @param {string} agentB
   * @param {string} filePath
   * @returns {{ conflict: boolean, strategy: string }}
   */
  detectConflict(agentA, agentB, filePath) {
    const lockKey = this._resolveLockKey(filePath)
    const entry = this._locks.get(lockKey)

    if (!entry) return { conflict: false, strategy: 'none' }

    const aHolds = entry.holders.has(agentA)
    const bHolds = entry.holders.has(agentB)
    const bWaits = entry.waitQueue.some((w) => w.agentId === agentB)
    const aWaits = entry.waitQueue.some((w) => w.agentId === agentA)

    if ((aHolds && bWaits) || (bHolds && aWaits)) {
      // Determine strategy: long-held locks -> abort, otherwise wait
      const holdDuration = Date.now() - entry.acquiredAt
      let strategy = 'wait'
      if (holdDuration > this._lockTimeoutMs) {
        strategy = 'abort'
      } else if (entry.mode === 'write') {
        strategy = 'merge'
      }

      if (typeof this._bus?.publish === 'function') {
        this._bus.publish('resource.conflict', {
          agentA, agentB, filePath, strategy, holdDuration,
        })
      }

      return { conflict: true, strategy }
    }

    return { conflict: false, strategy: 'none' }
  }

  // ════════════════════════════════════════════════════════════════
  //  PUBLIC — Rate Limiting
  // ════════════════════════════════════════════════════════════════

  /**
   * Check if a request to a provider is within rate limits.
   * Consumes one token if allowed.
   *
   * @param {string} provider - provider name
   * @returns {boolean} true if the request is allowed
   */
  checkRateLimit(provider) {
    const entry = this._rateLimits.get(provider) ?? this._rateLimits.get('default')
    if (!entry) return true

    this._refillTokens(entry)
    if (entry.tokens > 0) {
      entry.tokens--
      return true
    }
    return false
  }

  // ════════════════════════════════════════════════════════════════
  //  PUBLIC — Tool Concurrency
  // ════════════════════════════════════════════════════════════════

  /**
   * Check if a tool can run (concurrency gate).
   * Increments the current count if allowed.
   *
   * @param {string} toolName
   * @returns {boolean} true if a slot is available
   */
  checkToolConcurrency(toolName) {
    const gate = this._toolGates.get(toolName)
    if (!gate) return true  // no gate configured -> allow

    if (gate.current < gate.maxConcurrent) {
      gate.current++
      return true
    }
    return false
  }

  /**
   * Release one concurrency slot for a tool.
   * @param {string} toolName
   */
  releaseToolSlot(toolName) {
    const gate = this._toolGates.get(toolName)
    if (!gate) return
    gate.current = Math.max(gate.current - 1, 0)
  }

  // ════════════════════════════════════════════════════════════════
  //  PRIVATE — Initialisation
  // ════════════════════════════════════════════════════════════════

  /**
   * Initialise rate-limit buckets.
   * @private
   * @param {Object} limits - provider -> { maxTokens, refillRate }
   */
  _initRateLimits(limits) {
    for (const [provider, cfg] of Object.entries(limits)) {
      this._rateLimits.set(provider, {
        tokens: cfg.maxTokens,
        maxTokens: cfg.maxTokens,
        lastRefill: Date.now(),
        refillRate: cfg.refillRate,  // tokens per minute
      })
    }
  }

  /**
   * Initialise tool concurrency gates.
   * @private
   * @param {Object} gates - toolName -> maxConcurrent
   */
  _initToolGates(gates) {
    for (const [toolName, max] of Object.entries(gates)) {
      this._toolGates.set(toolName, { maxConcurrent: max, current: 0 })
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  PRIVATE — Helpers
  // ════════════════════════════════════════════════════════════════

  /**
   * Resolve the lock key for a file path.
   * Uses zone manager granularity if available.
   *
   * @private
   * @param {string} filePath
   * @returns {string}
   */
  _resolveLockKey(filePath) {
    if (typeof this._zoneManager?.getZoneLockGranularity === 'function') {
      try {
        const granularity = this._zoneManager.getZoneLockGranularity(filePath)
        if (typeof granularity === 'string') return granularity
      } catch (_) { /* ignore */ }
    }
    // default: lock by full file path
    return filePath
  }

  /**
   * Refill tokens based on elapsed time since last refill.
   * @private
   * @param {RateLimitEntry} entry
   */
  _refillTokens(entry) {
    const now = Date.now()
    const elapsedMin = (now - entry.lastRefill) / 60_000
    if (elapsedMin <= 0) return

    const refilled = Math.floor(elapsedMin * entry.refillRate)
    if (refilled > 0) {
      entry.tokens = Math.min(entry.tokens + refilled, entry.maxTokens)
      entry.lastRefill = now
    }
  }

  /**
   * Publish a lock-related event on the bus.
   * @private
   * @param {string} topic
   * @param {string} agentId
   * @param {string} filePath
   * @param {string} mode
   */
  _publishLockEvent(topic, agentId, filePath, mode) {
    if (typeof this._bus?.publish === 'function') {
      this._bus.publish(topic, { agentId, filePath, mode, ts: Date.now() })
    }
  }
}

export default ResourceArbiter
