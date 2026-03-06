/**
 * StruggleDetector — 挣扎检测器 / Struggle Detector
 *
 * 分析 Agent 工具调用的连续失败模式，在检测到挣扎时
 * 自动发射 RECRUIT 信息素请求帮助。
 *
 * Analyzes consecutive tool call failure patterns and auto-emits
 * RECRUIT pheromones when struggle is detected.
 *
 * [WHY] 纯粹的连续失败计数会误判"正常探索性失败"。
 * 结合 pheromone 密度判断：如果周围已有多个 ALARM，
 * 说明是系统性问题（如 API 挂了），不算个体 struggle。
 *
 * Pure consecutive failure counting misidentifies "normal exploratory failures".
 * Combined with pheromone density: if multiple ALARMs exist nearby,
 * it's a systemic issue (e.g. API down), not individual struggle.
 *
 * @module collaboration/struggle-detector
 * @author DEEP-IOS
 */

export class StruggleDetector {
  /**
   * @param {Object} config - 插件配置 / Plugin configuration
   * @param {number} [config.collaboration.struggleWindowSize=5]
   *   滑动窗口大小 / Sliding window size
   * @param {number} [config.collaboration.struggleFailureThreshold=3]
   *   判定挣扎的失败次数阈值 / Failure count threshold to declare struggle
   */
  constructor(config) {
    this._windowSize = config.collaboration?.struggleWindowSize ?? 5;
    this._failureThreshold = config.collaboration?.struggleFailureThreshold ?? 3;

    /**
     * @private
     * 每个 Agent 的工具调用结果滑动窗口
     * Per-agent sliding window of tool call outcomes
     * @type {Map<string, Array<{toolName: string, success: boolean, error: any, timestamp: number}>>}
     */
    this._agentHistory = new Map();
  }

  // ─────────────────────────────────────────────────────────────────
  // 核心方法 / Core Methods
  // ─────────────────────────────────────────────────────────────────

  /**
   * 记录工具调用结果并检查挣扎模式 / Record a tool call outcome and check for struggle pattern
   *
   * @param {string} agentId  - Agent 标识 / Agent identifier
   * @param {string} toolName - 工具名称 / Tool name
   * @param {boolean} success - 调用是否成功 / Whether the call succeeded
   * @param {any}    [error]  - 错误信息（如有）/ Error info (if any)
   * @returns {{
   *   struggling: boolean,
   *   suggestion: string|null,
   *   failureCount: number,
   *   windowSize: number,
   * }}
   */
  recordAndCheck(agentId, toolName, success, error) {
    if (!this._agentHistory.has(agentId)) {
      this._agentHistory.set(agentId, []);
    }

    const history = this._agentHistory.get(agentId);
    history.push({ toolName, success, error, timestamp: Date.now() });

    // 保持窗口大小 / Keep only window size
    if (history.length > this._windowSize) {
      history.shift();
    }

    // 计算最近失败数 / Count recent failures
    const recentFailures = history.filter(h => !h.success).length;

    return {
      struggling: recentFailures >= this._failureThreshold,
      suggestion: recentFailures >= this._failureThreshold
        ? `Agent ${agentId} has failed ${recentFailures}/${this._windowSize} recent tool calls. Consider requesting help.`
        : null,
      failureCount: recentFailures,
      windowSize: this._windowSize,
    };
  }

  /**
   * 结合信息素上下文判断是否真正挣扎 / Check if struggling considering pheromone context
   *
   * 如果当前 scope 已有 >=2 个 ALARM 信息素，说明是系统性问题，
   * 不判定为个体挣扎。
   *
   * If current scope already has >=2 ALARM pheromones,
   * it's a systemic issue, not individual struggle.
   *
   * @param {string} agentId          - Agent 标识
   * @param {number} recentFailures   - 最近失败次数
   * @param {Object} [pheromoneEngine] - 信息素引擎实例
   * @returns {boolean}
   */
  isStruggling(agentId, recentFailures, pheromoneEngine) {
    const localAlarms = pheromoneEngine
      ? pheromoneEngine.read(`/agent/${agentId}`, { type: 'alarm' })
      : [];
    return recentFailures >= this._failureThreshold && localAlarms.length < 2;
  }

  /**
   * 处理检测到的挣扎：发射 RECRUIT 信息素 / Handle detected struggle: emit RECRUIT pheromone
   *
   * @param {string} agentId         - 挣扎中的 Agent 标识
   * @param {Object} pheromoneEngine - 信息素引擎实例
   * @param {string} toolName        - 最后失败的工具名称
   * @param {Object} [logger]        - 日志器
   */
  handleStruggle(agentId, pheromoneEngine, toolName, logger) {
    if (!pheromoneEngine) return;

    try {
      pheromoneEngine.emitPheromone({
        type: 'recruit',
        sourceId: agentId,
        targetScope: '/global',
        intensity: 0.9,
        payload: { reason: 'struggle_detected', failedTool: toolName, agentId },
      });
      if (logger) logger.info(`RECRUIT pheromone emitted for struggling agent ${agentId}`);
    } catch (err) {
      if (logger) logger.warn('Failed to emit struggle pheromone:', err.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 辅助方法 / Utility Methods
  // ─────────────────────────────────────────────────────────────────

  /**
   * 清除指定 Agent 的历史记录 / Clear history for an agent
   * @param {string} agentId
   */
  clearHistory(agentId) {
    this._agentHistory.delete(agentId);
  }

  /**
   * 获取指定 Agent 的当前状态（调试用）/ Get current state for debugging
   * @param {string} agentId
   * @returns {Array}
   */
  getState(agentId) {
    return this._agentHistory.get(agentId) || [];
  }
}
