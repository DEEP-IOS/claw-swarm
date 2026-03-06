/**
 * CircuitBreaker — 熔断器 / Circuit Breaker
 *
 * 保护系统免受级联故障影响。当连续失败次数超过阈值时打开熔断器，
 * 拒绝新请求直到冷却期结束。状态持久化到 SQLite，重启后恢复。
 *
 * Protects the system from cascading failures. Opens the circuit when
 * consecutive failures exceed a threshold, rejecting new requests until
 * the cooldown period expires. State is persisted to SQLite for restart recovery.
 *
 * [WHY] 从 orchestrator.js 中提取为独立模块，降低 orchestrator 复杂度，
 * 并允许其他子系统（如 pheromone）复用熔断能力。
 * Extracted from orchestrator.js as a standalone module to reduce complexity
 * and allow reuse by other subsystems (e.g., pheromone engine).
 *
 * @module circuit-breaker
 * @author DEEP-IOS
 */

import { CircuitOpenError } from './errors.js';

// ---------------------------------------------------------------------------
// 熔断器状态常量 / Circuit breaker state constants
// ---------------------------------------------------------------------------

/** @enum {string} */
const State = Object.freeze({
  /** 正常运行 — 所有请求通过 / Normal — all requests pass through */
  CLOSED: 'closed',

  /** 熔断打开 — 拒绝所有请求 / Open — all requests rejected */
  OPEN: 'open',

  /** 半开 — 允许有限探测请求 / Half-open — limited probe requests allowed */
  HALF_OPEN: 'half-open',
});

// ---------------------------------------------------------------------------
// 持久化键 / Persistence keys
// ---------------------------------------------------------------------------

/** swarm_meta 表中使用的键前缀 / Key used in the swarm_meta table */
const META_KEY = 'circuit_breaker_state';

// ---------------------------------------------------------------------------
// CircuitBreaker 类 / CircuitBreaker class
// ---------------------------------------------------------------------------

export class CircuitBreaker {
  /**
   * 创建熔断器实例 / Create a circuit breaker instance.
   *
   * @param {Object} db  — 数据库模块，需提供 getMeta / setMeta 方法
   *                        DB module; must expose getMeta / setMeta helpers.
   * @param {Object} [config={}]
   * @param {number} [config.failureThreshold=5]
   *   连续失败多少次后打开熔断器 / Consecutive failures before tripping open.
   * @param {number} [config.cooldownMs=30000]
   *   熔断器打开后的冷却时间（毫秒）/ Cooldown duration (ms) while open.
   * @param {number} [config.halfOpenMaxAttempts=3]
   *   半开状态下允许的最大连续成功次数，达到后关闭熔断器
   *   Max consecutive successes in half-open before transitioning to closed.
   */
  constructor(db, config = {}) {
    /** @private */
    this._db = db;

    /** @private */
    this._failureThreshold = config.failureThreshold ?? 5;

    /** @private */
    this._cooldownMs = config.cooldownMs ?? 30_000;

    /** @private */
    this._halfOpenMaxAttempts = config.halfOpenMaxAttempts ?? 3;

    // --- 内部状态 / Internal state ---

    /** 连续失败计数 / Consecutive failure count */
    this.failureCount = 0;

    /** 最近一次失败的时间戳（epoch ms），null 表示无失败
     *  Timestamp of last failure (epoch ms); null if none */
    this.lastFailureTime = null;

    /**
     * 当前状态 / Current state.
     * @type {'closed' | 'open' | 'half-open'}
     */
    this.state = State.CLOSED;

    /** 半开状态下的连续成功计数
     *  Consecutive successes while in half-open state */
    this.consecutiveSuccesses = 0;

    // 从数据库恢复持久化状态 / Restore persisted state from DB
    this._loadState();
  }

  // -----------------------------------------------------------------------
  // 公共方法 / Public API
  // -----------------------------------------------------------------------

  /**
   * 记录一次成功 / Record a successful execution.
   *
   * - CLOSED  → 重置失败计数 / reset failure count.
   * - HALF_OPEN → 累计成功次数，达到阈值后关闭熔断器
   *               Accumulate successes; transition to CLOSED when threshold met.
   */
  recordSuccess() {
    if (this.state === State.HALF_OPEN) {
      this.consecutiveSuccesses++;

      if (this.consecutiveSuccesses >= this._halfOpenMaxAttempts) {
        // 探测成功次数足够，恢复正常 / Enough probes succeeded — close the circuit
        this.state = State.CLOSED;
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.consecutiveSuccesses = 0;
        this._persistState();
      }
      return;
    }

    // CLOSED 状态：重置失败计数 / CLOSED: reset counters
    this.failureCount = 0;
    this.consecutiveSuccesses = 0;
    this._persistState();
  }

  /**
   * 记录一次失败 / Record a failed execution.
   *
   * 增加失败计数；如果达到阈值则打开熔断器。
   * 半开状态下的失败会立即重新打开熔断器。
   *
   * Increments the failure counter. If the threshold is reached the circuit
   * trips open. A failure in half-open immediately re-opens the circuit.
   */
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.consecutiveSuccesses = 0;

    if (this.state === State.HALF_OPEN) {
      // 半开探测失败 — 重新打开 / Half-open probe failed — reopen
      this.state = State.OPEN;
      this._persistState();
      return;
    }

    if (this.failureCount >= this._failureThreshold) {
      // 失败次数达到阈值 — 打开熔断器 / Threshold reached — trip open
      this.state = State.OPEN;
      this._persistState();
    }
  }

  /**
   * 检查熔断器是否允许执行 / Check whether the circuit allows execution.
   *
   * - CLOSED    → true
   * - HALF_OPEN → true （允许探测 / allows probe）
   * - OPEN      → 冷却期结束则转为 HALF_OPEN 并返回 true，否则 false
   *               Transitions to HALF_OPEN if cooldown elapsed, otherwise false.
   *
   * @returns {boolean}
   */
  canExecute() {
    if (this.state === State.CLOSED) {
      return true;
    }

    if (this.state === State.HALF_OPEN) {
      // 允许有限探测 / Allow limited probes
      return true;
    }

    // state === OPEN
    const elapsed = Date.now() - (this.lastFailureTime || 0);

    if (elapsed >= this._cooldownMs) {
      // 冷却期已过 — 转为半开，允许探测 / Cooldown elapsed — transition to half-open
      this.state = State.HALF_OPEN;
      this.consecutiveSuccesses = 0;
      this._persistState();
      return true;
    }

    // 仍在冷却期内 — 拒绝执行 / Still cooling down — reject
    return false;
  }

  /**
   * 返回当前熔断器状态信息 / Return current circuit breaker state info.
   *
   * @returns {{
   *   state: string,
   *   failureCount: number,
   *   lastFailureTime: number|null,
   *   consecutiveSuccesses: number,
   *   failureThreshold: number,
   *   cooldownMs: number,
   *   halfOpenMaxAttempts: number,
   * }}
   */
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      consecutiveSuccesses: this.consecutiveSuccesses,
      failureThreshold: this._failureThreshold,
      cooldownMs: this._cooldownMs,
      halfOpenMaxAttempts: this._halfOpenMaxAttempts,
    };
  }

  // -----------------------------------------------------------------------
  // 内部方法 — 持久化 / Internal — Persistence
  // -----------------------------------------------------------------------

  /**
   * 将当前状态保存到 swarm_meta 表 / Save current state to the swarm_meta table.
   *
   * 序列化为 JSON 字符串，以单个键存储。
   * Serialized as a JSON string under a single key.
   *
   * @private
   */
  _persistState() {
    try {
      const payload = JSON.stringify({
        state: this.state,
        failureCount: this.failureCount,
        lastFailureTime: this.lastFailureTime,
        consecutiveSuccesses: this.consecutiveSuccesses,
      });

      this._db.setMeta(META_KEY, payload);
    } catch {
      // 持久化失败不影响核心逻辑 / Persistence failure is non-fatal
    }
  }

  /**
   * 从 swarm_meta 表加载持久化状态 / Load persisted state from the swarm_meta table.
   *
   * 如果熔断器曾处于 OPEN 状态且冷却期已过，则自动重置为 CLOSED。
   * If the circuit was OPEN and the cooldown has since elapsed, resets to CLOSED.
   *
   * @private
   */
  _loadState() {
    try {
      const raw = this._db.getMeta(META_KEY);
      if (!raw) return; // 无持久化数据 — 使用默认值 / No persisted data — use defaults

      const saved = JSON.parse(raw);

      if (!saved || saved.state === State.CLOSED) {
        // 已关闭或无效 — 保持默认 / Already closed or invalid — keep defaults
        return;
      }

      if (saved.state === State.OPEN && saved.lastFailureTime) {
        const elapsed = Date.now() - saved.lastFailureTime;

        if (elapsed >= this._cooldownMs) {
          // 冷却期已过 — 重置为关闭 / Cooldown elapsed — reset to closed
          this.state = State.CLOSED;
          this.failureCount = 0;
          this.lastFailureTime = null;
          this.consecutiveSuccesses = 0;
          this._persistState();
        } else {
          // 恢复打开状态 / Restore open state
          this.state = State.OPEN;
          this.failureCount = saved.failureCount ?? this._failureThreshold;
          this.lastFailureTime = saved.lastFailureTime;
          this.consecutiveSuccesses = 0;
        }
        return;
      }

      if (saved.state === State.HALF_OPEN) {
        // 半开状态不可靠（进程可能崩溃过）— 重置为关闭更安全
        // Half-open is unreliable after restart — safer to reset to closed
        this.state = State.CLOSED;
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.consecutiveSuccesses = 0;
        this._persistState();
        return;
      }

      // 未知状态 — 重置 / Unknown state — reset
      this.state = State.CLOSED;
      this.failureCount = 0;
      this.lastFailureTime = null;
      this.consecutiveSuccesses = 0;
    } catch {
      // 数据库未初始化或读取失败 — 使用干净状态
      // DB not initialized or read failure — start clean
      this.state = State.CLOSED;
      this.failureCount = 0;
      this.lastFailureTime = null;
      this.consecutiveSuccesses = 0;
    }
  }
}

// 导出状态常量供外部使用 / Export state constants for external use
export { State as CircuitState };
