/**
 * StagnationDetector — 检测 agent 或 DAG 执行停滞
 *
 * 当 agent 连续 N 轮没有新的 tool call、文件变更或有意义的输出时，
 * 触发停滞事件，由上层决定是否终止该分支。
 *
 * 防止场景:
 *   - Agent 陷入循环对话 (500 轮空转)
 *   - Agent 重复同一个失败的 tool call
 *   - DAG 某节点长时间无进展
 *
 * @module orchestration/adaptation/stagnation-detector
 * @version 9.2.0
 */

const DEFAULT_MAX_IDLE_ROUNDS = 15;       // 连续无进展轮数阈值
const DEFAULT_REPEAT_THRESHOLD = 5;       // 相同 tool call 重复次数阈值
const DEFAULT_CHECK_INTERVAL_MS = 10000;  // 检查间隔
const DEFAULT_MAX_TOTAL_ROUNDS = 300;     // 单个 agent 绝对轮数上限

export class StagnationDetector {
  /**
   * @param {Object} opts
   * @param {import('../../core/bus/event-bus.js').EventBus} opts.bus
   * @param {Object} [opts.config]
   * @param {number} [opts.config.maxIdleRounds=15]
   * @param {number} [opts.config.repeatThreshold=5]
   * @param {number} [opts.config.maxTotalRounds=300]
   */
  constructor({ bus, config = {} }) {
    this._bus = bus;
    this._maxIdleRounds = config.maxIdleRounds ?? DEFAULT_MAX_IDLE_ROUNDS;
    this._repeatThreshold = config.repeatThreshold ?? DEFAULT_REPEAT_THRESHOLD;
    this._maxTotalRounds = config.maxTotalRounds ?? DEFAULT_MAX_TOTAL_ROUNDS;

    /**
     * 每个 agent/session 的跟踪状态
     * @type {Map<string, AgentTracker>}
     */
    this._trackers = new Map();

    /** @type {Array<Function>} */
    this._unsubs = [];

    this._stats = { detected: 0, terminated: 0, totalRoundsTracked: 0 };
  }

  /**
   * 启动: 订阅相关事件
   */
  start() {
    // 监听 tool 执行事件
    this._unsubs.push(
      this._bus.on('tool.executed', (data) => this._onToolExecuted(data)),
    );

    // 监听 agent 消息事件
    this._unsubs.push(
      this._bus.on('runtime.session.transcript', (data) => this._onTranscript(data)),
    );

    // 监听 agent 结束事件 (清理)
    this._unsubs.push(
      this._bus.on('agent.lifecycle.completed', (data) => this._cleanup(data?.agentId)),
    );
    this._unsubs.push(
      this._bus.on('agent.lifecycle.failed', (data) => this._cleanup(data?.agentId)),
    );
    this._unsubs.push(
      this._bus.on('agent.lifecycle.ended', (data) => this._cleanup(data?.agentId)),
    );
  }

  /**
   * 停止: 取消订阅，清理状态
   */
  stop() {
    for (const unsub of this._unsubs) {
      try { unsub?.(); } catch { /* ignore */ }
    }
    this._unsubs.length = 0;
    this._trackers.clear();
  }

  /**
   * 手动注册 agent 跟踪
   * @param {string} agentId
   * @param {Object} [meta] - 额外元数据 (dagId, role 等)
   */
  track(agentId, meta = {}) {
    if (!this._trackers.has(agentId)) {
      this._trackers.set(agentId, {
        agentId,
        dagId: meta.dagId || null,
        totalRounds: 0,
        idleRounds: 0,
        lastToolCalls: [],   // 最近的 tool call 名称 (用于重复检测)
        lastActivityTs: Date.now(),
        stagnant: false,
      });
    }
  }

  /**
   * 检查特定 agent 是否停滞
   * @param {string} agentId
   * @returns {{ stagnant: boolean, reason?: string }}
   */
  check(agentId) {
    const tracker = this._trackers.get(agentId);
    if (!tracker) return { stagnant: false };

    // 检查 1: 绝对轮数上限
    if (tracker.totalRounds >= this._maxTotalRounds) {
      return {
        stagnant: true,
        reason: `absolute_round_limit: ${tracker.totalRounds}/${this._maxTotalRounds}`,
      };
    }

    // 检查 2: 连续空闲轮数
    if (tracker.idleRounds >= this._maxIdleRounds) {
      return {
        stagnant: true,
        reason: `idle_rounds: ${tracker.idleRounds}/${this._maxIdleRounds}`,
      };
    }

    // 检查 3: 重复 tool call
    if (tracker.lastToolCalls.length >= this._repeatThreshold) {
      const recent = tracker.lastToolCalls.slice(-this._repeatThreshold);
      const allSame = recent.every(t => t === recent[0]);
      if (allSame) {
        return {
          stagnant: true,
          reason: `repeated_tool: "${recent[0]}" × ${this._repeatThreshold}`,
        };
      }
    }

    return { stagnant: false };
  }

  /**
   * 检查所有被跟踪的 agent，发布停滞事件
   * 通常由 tick 机制调用
   */
  checkAll() {
    for (const [agentId, tracker] of this._trackers) {
      if (tracker.stagnant) continue; // 已标记的不重复检测

      const result = this.check(agentId);
      if (result.stagnant) {
        tracker.stagnant = true;
        this._stats.detected++;

        this._bus?.publish?.('stagnation.detected', {
          agentId,
          dagId: tracker.dagId,
          reason: result.reason,
          rounds: tracker.totalRounds,
          idleRounds: tracker.idleRounds,
          ts: Date.now(),
        }, 'stagnation-detector');
      }
    }
  }

  // ── 事件处理 ──────────────────────────────────────────────

  _onToolExecuted(data) {
    const agentId = data?.agentId || data?.sessionId;
    if (!agentId) return;

    this.track(agentId);
    const tracker = this._trackers.get(agentId);

    tracker.totalRounds++;
    tracker.idleRounds = 0; // tool 执行 = 有活动
    tracker.lastActivityTs = Date.now();
    this._stats.totalRoundsTracked++;

    // 记录 tool 名称用于重复检测
    const toolName = data?.tool || data?.name || 'unknown';
    tracker.lastToolCalls.push(toolName);
    if (tracker.lastToolCalls.length > this._repeatThreshold * 2) {
      tracker.lastToolCalls = tracker.lastToolCalls.slice(-this._repeatThreshold * 2);
    }

    // 每次 tool 执行后检查
    const result = this.check(agentId);
    if (result.stagnant && !tracker.stagnant) {
      tracker.stagnant = true;
      this._stats.detected++;
      this._bus?.publish?.('stagnation.detected', {
        agentId,
        dagId: tracker.dagId,
        reason: result.reason,
        rounds: tracker.totalRounds,
        ts: Date.now(),
      }, 'stagnation-detector');
    }
  }

  _onTranscript(data) {
    const agentId = data?.agentId || data?.sessionId;
    if (!agentId) return;

    this.track(agentId);
    const tracker = this._trackers.get(agentId);

    tracker.totalRounds++;
    this._stats.totalRoundsTracked++;

    // transcript 如果没有 tool_use 则算 idle
    const hasToolUse = data?.message?.role === 'assistant' &&
      (data?.message?.tool_use || data?.message?.content?.some?.(c => c?.type === 'tool_use'));

    if (hasToolUse) {
      tracker.idleRounds = 0;
    } else {
      tracker.idleRounds++;
    }
  }

  _cleanup(agentId) {
    if (agentId) {
      this._trackers.delete(agentId);
    }
  }

  // ── Stats ──────────────────────────────────────────────────

  getStats() {
    return {
      ...this._stats,
      trackedAgents: this._trackers.size,
      config: {
        maxIdleRounds: this._maxIdleRounds,
        repeatThreshold: this._repeatThreshold,
        maxTotalRounds: this._maxTotalRounds,
      },
    };
  }
}
