/**
 * CircuitBreaker -- 熔断器模式 / Circuit Breaker Pattern
 *
 * V5.0 应用层熔断器, 保护外部调用免受级联故障影响:
 * - 三态切换: CLOSED (正常) -> OPEN (熔断) -> HALF_OPEN (探测)
 * - 失败/成功计数追踪
 * - 可配置阈值与超时
 * - 可选降级回退函数
 *
 * V5.0 application layer circuit breaker, protects external calls from cascading failures:
 * - Three-state transitions: CLOSED (normal) -> OPEN (failing) -> HALF_OPEN (testing)
 * - Failure/success count tracking
 * - Configurable thresholds and timeouts
 * - Optional fallback function for graceful degradation
 *
 * 状态转换 / State transitions:
 *   CLOSED  -> OPEN      : failureCount >= failureThreshold
 *   OPEN    -> HALF_OPEN : 经过 resetTimeoutMs / after resetTimeoutMs elapsed
 *   HALF_OPEN -> CLOSED  : successCount >= successThreshold
 *   HALF_OPEN -> OPEN    : 任何失败 / any failure
 *
 * @module L5-application/circuit-breaker
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

/**
 * 熔断器状态枚举 / Circuit breaker state enum
 * @enum {string}
 */
const State = Object.freeze({
  /** 正常 — 所有请求通过 / Normal — all requests pass */
  CLOSED: 'CLOSED',

  /** 熔断 — 拒绝所有请求 / Open — all requests rejected */
  OPEN: 'OPEN',

  /** 半开 — 允许有限探测 / Half-open — limited probes allowed */
  HALF_OPEN: 'HALF_OPEN',
});

/** 默认配置 / Default configuration */
const DEFAULTS = {
  failureThreshold: 5,
  successThreshold: 3,
  resetTimeoutMs: 30000,
};

// ============================================================================
// CircuitBreaker 类 / CircuitBreaker Class
// ============================================================================

export class CircuitBreaker {
  /**
   * @param {Object} [options]
   * @param {number} [options.failureThreshold=5] - 连续失败阈值, 达到后打开熔断 / Consecutive failures before opening
   * @param {number} [options.successThreshold=3] - 半开状态下连续成功阈值, 达到后关闭 / Consecutive successes in HALF_OPEN to close
   * @param {number} [options.resetTimeoutMs=30000] - 熔断打开后的重置超时 (ms) / Reset timeout after opening (ms)
   * @param {Object} [options.logger] - pino logger 实例 / pino logger instance
   */
  constructor({
    failureThreshold = DEFAULTS.failureThreshold,
    successThreshold = DEFAULTS.successThreshold,
    resetTimeoutMs = DEFAULTS.resetTimeoutMs,
    logger,
    messageBus,
  } = {}) {
    /** @type {number} 失败阈值 / Failure threshold */
    this._failureThreshold = failureThreshold;

    /** @type {number} 成功阈值 (半开恢复) / Success threshold (half-open recovery) */
    this._successThreshold = successThreshold;

    /** @type {number} 重置超时 / Reset timeout */
    this._resetTimeoutMs = resetTimeoutMs;

    /** @type {Object} */
    this._logger = logger || console;

    /** @type {Object|null} V7.1: MessageBus for transition events */
    this._messageBus = messageBus || null;

    // ── 内部状态 / Internal state ────────────────────────────────────────

    /** @type {string} 当前状态 / Current state */
    this._state = State.CLOSED;

    /** @type {number} 连续失败计数 / Consecutive failure count */
    this._failures = 0;

    /** @type {number} 半开状态连续成功计数 / Consecutive success count in HALF_OPEN */
    this._successes = 0;

    /** @type {number} 总调用次数 / Total call count */
    this._totalCalls = 0;

    /** @type {number | null} 最近失败时间戳 / Last failure timestamp */
    this._lastFailure = null;
  }

  // ━━━ 核心执行 / Core Execution ━━━

  /**
   * 通过熔断器执行函数
   * Execute a function through the circuit breaker
   *
   * 如果熔断器打开且未到超时时间, 直接调用 fallback (如果提供) 或抛出错误。
   * 如果熔断器关闭或半开, 执行 fn 并追踪成功/失败。
   *
   * If circuit is OPEN and timeout not elapsed, call fallback (if provided) or throw.
   * If circuit is CLOSED or HALF_OPEN, execute fn and track success/failure.
   *
   * @param {() => Promise<*>} fn - 要执行的异步函数 / Async function to execute
   * @param {(() => Promise<*>) | null} [fallback=null] - 降级回退函数 / Fallback function for degradation
   * @returns {Promise<*>} 函数执行结果 / Function result
   * @throws {Error} 熔断器打开且无回退 / Circuit open with no fallback
   */
  async execute(fn, fallback = null) {
    this._totalCalls++;

    // 检查状态转换: OPEN -> HALF_OPEN (超时后)
    // Check state transition: OPEN -> HALF_OPEN (after timeout)
    if (this._state === State.OPEN) {
      if (this._shouldAttemptReset()) {
        this._transitionTo(State.HALF_OPEN);
        this._successes = 0;
        this._logger.info?.('[CircuitBreaker] OPEN -> HALF_OPEN (超时到期, 尝试探测 / timeout elapsed, attempting probe)');
      } else {
        // 仍在熔断中 / Still tripped
        this._logger.debug?.('[CircuitBreaker] 请求被拒绝 (熔断打开) / Request rejected (circuit OPEN)');

        if (fallback) {
          return fallback();
        }
        throw new Error(
          `CircuitBreaker OPEN: 熔断器打开, 拒绝执行 / Circuit is open, rejecting execution. ` +
          `Failures: ${this._failures}, last failure: ${this._lastFailure}`,
        );
      }
    }

    // 执行函数 / Execute the function
    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();

      // 熔断打开后, 如果有回退则尝试回退
      // After tripping, try fallback if available
      if (this._state === State.OPEN && fallback) {
        this._logger.warn?.('[CircuitBreaker] 执行失败, 使用降级回退 / Execution failed, using fallback');
        return fallback();
      }

      throw err;
    }
  }

  // ━━━ 状态查询 / State Queries ━━━

  /**
   * 获取当前状态
   * Get current state
   *
   * @returns {string} 'CLOSED' | 'OPEN' | 'HALF_OPEN'
   */
  getState() {
    // 检查是否应从 OPEN 转换到 HALF_OPEN
    // Check if should transition from OPEN to HALF_OPEN
    if (this._state === State.OPEN && this._shouldAttemptReset()) {
      this._transitionTo(State.HALF_OPEN);
      this._successes = 0;
    }
    return this._state;
  }

  /**
   * 获取统计信息
   * Get statistics
   *
   * @returns {{ state: string, failures: number, successes: number, totalCalls: number, lastFailure: number | null }}
   */
  getStats() {
    return {
      state: this.getState(),
      failures: this._failures,
      successes: this._successes,
      totalCalls: this._totalCalls,
      lastFailure: this._lastFailure,
    };
  }

  /**
   * 检查熔断器是否打开
   * Check if circuit breaker is open
   *
   * @returns {boolean}
   */
  isOpen() {
    // 需要先检查超时转换 / Need to check timeout transition first
    const currentState = this.getState();
    return currentState === State.OPEN;
  }

  /**
   * 强制重置为 CLOSED 状态
   * Force reset to CLOSED state
   *
   * 清零所有计数器。用于手动恢复或测试。
   * Resets all counters to zero. Used for manual recovery or testing.
   */
  reset() {
    this._state = State.CLOSED;
    this._failures = 0;
    this._successes = 0;
    this._lastFailure = null;
    this._logger.info?.('[CircuitBreaker] 手动重置为 CLOSED / Manually reset to CLOSED');
  }

  // ━━━ V7.1: 公开状态记录 / Public State Recording ━━━

  /**
   * 记录成功执行（供外部调用，如 ToolResilience）
   * Record successful execution (called externally, e.g. by ToolResilience)
   */
  recordSuccess() {
    this._onSuccess();
  }

  /**
   * 记录失败执行（供外部调用，如 ToolResilience）
   * Record failed execution (called externally, e.g. by ToolResilience)
   */
  recordFailure() {
    this._onFailure();
  }

  // ━━━ V6.0: 状态持久化 / State Persistence ━━━

  /**
   * V6.0: 导出状态快照 (用于持久化到 breaker_state 表)
   * V6.0: Export state snapshot (for persisting to breaker_state table)
   *
   * @returns {Object} 可序列化的状态快照 / Serializable state snapshot
   */
  exportState() {
    return {
      state: this._state,
      failures: this._failures,
      successes: this._successes,
      totalCalls: this._totalCalls,
      lastFailure: this._lastFailure,
    };
  }

  /**
   * V6.0: 从持久化快照恢复状态
   * V6.0: Restore state from persisted snapshot
   *
   * @param {Object} snapshot - 持久化的状态快照 / Persisted state snapshot
   */
  restoreState(snapshot) {
    if (!snapshot) return;

    // 仅恢复 CLOSED 和 HALF_OPEN, OPEN 状态需要检查超时
    // Only restore CLOSED and HALF_OPEN; OPEN requires timeout check
    if (snapshot.state === State.CLOSED || snapshot.state === State.HALF_OPEN) {
      this._state = snapshot.state;
    } else if (snapshot.state === State.OPEN && snapshot.lastFailure) {
      // OPEN 状态: 检查是否已超时应转为 HALF_OPEN
      const elapsed = Date.now() - snapshot.lastFailure;
      if (elapsed >= this._resetTimeout) {
        this._state = State.HALF_OPEN;
      } else {
        this._state = State.OPEN;
      }
    }

    this._failures = snapshot.failures || 0;
    this._successes = snapshot.successes || 0;
    this._totalCalls = snapshot.totalCalls || 0;
    this._lastFailure = snapshot.lastFailure || null;

    this._logger.info?.(`[CircuitBreaker] 状态恢复为 ${this._state} / State restored to ${this._state}`);
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 处理成功执行
   * Handle successful execution
   *
   * CLOSED: 重置失败计数 / Reset failure count
   * HALF_OPEN: 累计成功, 达到阈值则关闭熔断 / Accumulate successes, close if threshold met
   *
   * @private
   */
  _onSuccess() {
    if (this._state === State.HALF_OPEN) {
      this._successes++;
      this._logger.debug?.(
        `[CircuitBreaker] HALF_OPEN 探测成功 / probe success (${this._successes}/${this._successThreshold})`,
      );

      if (this._successes >= this._successThreshold) {
        // 成功次数足够, 恢复正常 / Enough successes, recover
        this._transitionTo(State.CLOSED);
        this._failures = 0;
        this._successes = 0;
        this._lastFailure = null;
        this._logger.info?.('[CircuitBreaker] HALF_OPEN -> CLOSED (恢复正常 / recovered)');
      }
      return;
    }

    // CLOSED: 重置失败计数 / Reset failure count
    if (this._state === State.CLOSED) {
      this._failures = 0;
    }
  }

  /**
   * 处理失败执行
   * Handle failed execution
   *
   * HALF_OPEN: 任何失败立即重新打开 / Any failure immediately reopens
   * CLOSED: 累加失败, 达到阈值则打开 / Accumulate failures, open if threshold met
   *
   * @private
   */
  _onFailure() {
    this._failures++;
    this._lastFailure = Date.now();
    this._successes = 0;

    if (this._state === State.HALF_OPEN) {
      // 半开探测失败 — 立即重新打开 / Half-open probe failed — reopen immediately
      this._transitionTo(State.OPEN);
      this._logger.warn?.('[CircuitBreaker] HALF_OPEN -> OPEN (探测失败 / probe failed)');
      return;
    }

    if (this._state === State.CLOSED && this._failures >= this._failureThreshold) {
      // 失败次数达到阈值 — 打开熔断器 / Failure threshold reached — trip open
      this._transitionTo(State.OPEN);
      this._logger.warn?.(
        `[CircuitBreaker] CLOSED -> OPEN (失败次数 ${this._failures} >= 阈值 ${this._failureThreshold} / ` +
        `failures ${this._failures} >= threshold ${this._failureThreshold})`,
      );
    }
  }

  /**
   * 检查是否应从 OPEN 尝试重置 (超时是否已过)
   * Check if should attempt reset from OPEN (timeout elapsed)
   *
   * @returns {boolean}
   * @private
   */
  _shouldAttemptReset() {
    if (!this._lastFailure) return true;
    const elapsed = Date.now() - this._lastFailure;
    return elapsed >= this._resetTimeoutMs;
  }

  /**
   * 状态转换 (内部)
   * State transition (internal)
   *
   * @param {string} newState
   * @private
   */
  _transitionTo(newState) {
    const oldState = this._state;
    this._state = newState;

    this._logger.debug?.(`[CircuitBreaker] 状态转换 / State transition: ${oldState} -> ${newState}`);

    // V7.1: Publish transition event to SSE pipeline
    try {
      this._messageBus?.publish?.('circuit_breaker.transition', {
        from: oldState,
        to: newState,
        failures: this._failures,
        totalCalls: this._totalCalls,
        timestamp: Date.now(),
      });
    } catch { /* non-fatal */ }
  }
}

// 导出状态常量供外部使用 / Export state constants for external use
export { State as CircuitState };
