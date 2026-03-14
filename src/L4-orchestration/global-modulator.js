/**
 * GlobalModulator — 运行时全局工作点调节器 / Runtime Global Work-Point Modulator
 *
 * V5.5 核心新增模块，类似生物神经调质系统，根据系统全局状态
 * 动态切换四种工作模式 (EXPLORE / EXPLOIT / RELIABLE / URGENT)。
 *
 * V5.5 core addition — bio-inspired neuromodulation system that dynamically
 * switches between four operating modes based on global system state.
 *
 * 设计原则 / Design principles:
 * - 滞后 (hysteresis) 防止频繁切换: 进入阈值 ≠ 退出阈值
 * - 最小停留时间: 切换后至少 MIN_DWELL_TURNS 个 turn 不再切换
 * - 系统影响通过 modulation factors 间接传导（不直接修改其他引擎）
 *
 * @module L4-orchestration/global-modulator
 * @version 5.5.0
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 四种工作点 / Four operating modes */
export const WorkMode = Object.freeze({
  EXPLORE: 'EXPLORE',     // 探索模式: 新颖度高，鼓励协作
  EXPLOIT: 'EXPLOIT',     // 利用模式: 复用已知策略
  RELIABLE: 'RELIABLE',   // 可靠模式: 平衡状态
  URGENT: 'URGENT',       // 紧急模式: 优先修复
});

/** 最小停留 turn 数 / Minimum dwell turns before mode switch */
const MIN_DWELL_TURNS = 3;

/** 各模式的调节系数 / Modulation factors per mode */
const MODE_FACTORS = {
  [WorkMode.EXPLORE]: {
    thresholdMult: 0.8,       // 降低阈值 → 更容易推荐蜂群协作
    costTolerance: 1.3,       // 容忍更高成本
    evidenceStrictness: 0.7,  // 放宽证据要求
  },
  [WorkMode.EXPLOIT]: {
    thresholdMult: 1.3,       // 提高阈值 → 减少协作开销
    costTolerance: 0.8,       // 严控成本
    evidenceStrictness: 1.2,  // 加严证据要求
  },
  [WorkMode.RELIABLE]: {
    thresholdMult: 1.0,       // 标准阈值
    costTolerance: 1.0,       // 标准成本
    evidenceStrictness: 1.0,  // 标准证据
  },
  [WorkMode.URGENT]: {
    thresholdMult: 0.6,       // 大幅降低阈值 → 强制协作
    costTolerance: 1.5,       // 高容忍成本
    evidenceStrictness: 0.5,  // 大幅放宽证据
  },
};

/**
 * 进入/退出阈值 (hysteresis)
 * Entry thresholds are stricter than exit thresholds to prevent oscillation
 */
const THRESHOLDS = {
  // URGENT: 高失败率 + 紧急度
  urgentEntry: { failureRate: 0.4, urgencyScore: 0.7 },
  urgentExit: { failureRate: 0.2, urgencyScore: 0.4 },
  // EXPLORE: 低失败率 + 高新颖度
  exploreEntry: { novelty: 0.7, failureRate: 0.15 },
  exploreExit: { novelty: 0.4, failureRate: 0.3 },
  // EXPLOIT: 高重复度 (低新颖度)
  exploitEntry: { novelty: 0.2 },
  exploitExit: { novelty: 0.4 },
};

// ============================================================================
// GlobalModulator 类 / GlobalModulator Class
// ============================================================================

export class GlobalModulator {
  /**
   * @param {Object} deps
   * @param {Object} [deps.swarmAdvisor] - SwarmAdvisor 实例
   * @param {Object} [deps.toolResilience] - ToolResilience 实例
   * @param {Object} [deps.healthChecker] - HealthChecker 实例
   * @param {Object} [deps.budgetTracker] - BudgetTracker 实例
   * @param {Object} [deps.evidenceGate] - EvidenceGate 实例
   * @param {Object} [deps.messageBus] - MessageBus 实例
   * @param {Object} [deps.logger] - Logger 实例
   */
  constructor({ swarmAdvisor, toolResilience, healthChecker, budgetTracker, evidenceGate, messageBus, logger, config = {} } = {}) {
    this._swarmAdvisor = swarmAdvisor;
    this._toolResilience = toolResilience;
    this._healthChecker = healthChecker;
    this._budgetTracker = budgetTracker;
    this._evidenceGate = evidenceGate;
    this._messageBus = messageBus;
    this._logger = logger || console;

    /**
     * V6.3: 冷启动 — 初始模式为 EXPLORE, 累计完成 N 次任务后切换到正常动态模式
     * V6.3: Cold start — initial mode is EXPLORE, switches to normal dynamic mode after N tasks
     */
    this._currentMode = WorkMode.EXPLORE;

    /** V6.3: 冷启动任务计数 / Cold start task counter */
    this._completedTaskCount = 0;

    /** V6.3: 冷启动阈值 / Cold start threshold */
    this._coldStartThreshold = config.coldStartThreshold ?? 20;

    /** V6.3: 冷启动是否完成 / Cold start completion flag */
    this._coldStartComplete = false;

    /** 最后切换的 turn 计数 / Turn count at last mode switch */
    this._lastSwitchTurn = 0;

    /** 当前 turn 计数 / Current turn counter */
    this._turnCount = 0;

    /**
     * 模式切换历史 / Mode switch history
     * @type {Array<{ from: string, to: string, turn: number, timestamp: number }>}
     */
    this._switchHistory = [];

    /**
     * 模式停留时间统计 / Mode dwell time statistics
     * @type {Object<string, number>}
     */
    this._modeDwellTurns = {
      [WorkMode.EXPLORE]: 0,
      [WorkMode.EXPLOIT]: 0,
      [WorkMode.RELIABLE]: 0,
      [WorkMode.URGENT]: 0,
    };
  }

  // ============================================================================
  // 核心评估方法 / Core Evaluation
  // ============================================================================

  /**
   * 评估当前应处于哪个工作点
   * Evaluate which operating mode the system should be in
   *
   * @param {Object} [turnContext] - 当前 turn 上下文
   * @param {number} [turnContext.failureRate] - 当前失败率
   * @param {number} [turnContext.novelty] - 任务新颖度 [0,1]
   * @param {number} [turnContext.urgencyScore] - 紧急度 [0,1]
   * @param {number} [turnContext.agentLoad] - Agent 负载 [0,1]
   * @returns {string} 决策后的工作模式
   */
  evaluate(turnContext = {}) {
    this._turnCount++;

    // V6.3: 记录任务完成数, 检测冷启动结束
    // V6.3: Track completed tasks, detect cold start completion
    if (turnContext.taskCompleted) {
      this._completedTaskCount++;
    }

    // 更新当前模式停留时间 / Update dwell time for current mode
    this._modeDwellTurns[this._currentMode]++;

    // V6.3: 冷启动期间保持 EXPLORE 模式 (除非 URGENT)
    // V6.3: During cold start, stay in EXPLORE mode (unless URGENT)
    if (!this._coldStartComplete) {
      if (this._completedTaskCount >= this._coldStartThreshold) {
        this._coldStartComplete = true;
        this._messageBus?.publish?.('coldstart.phase.completed', {
          tasksCompleted: this._completedTaskCount,
          threshold: this._coldStartThreshold,
          turn: this._turnCount,
          timestamp: Date.now(),
        });
        this._logger.info?.(
          `[GlobalModulator] Cold start complete: ${this._completedTaskCount} tasks, ` +
          `switching to dynamic mode selection`
        );
      } else {
        // 冷启动中: 仅允许 URGENT 覆盖 EXPLORE
        // During cold start: only URGENT can override EXPLORE
        const signals = this._aggregateSignals(turnContext);
        if (signals.failureRate >= THRESHOLDS.urgentEntry.failureRate ||
            signals.urgencyScore >= THRESHOLDS.urgentEntry.urgencyScore) {
          if (this._currentMode !== WorkMode.URGENT) {
            this._switchMode(WorkMode.URGENT, signals);
          }
        } else if (this._currentMode === WorkMode.URGENT) {
          // 从 URGENT 回到 EXPLORE (冷启动未完成)
          if (signals.failureRate <= THRESHOLDS.urgentExit.failureRate &&
              signals.urgencyScore <= THRESHOLDS.urgentExit.urgencyScore) {
            this._switchMode(WorkMode.EXPLORE, signals);
          }
        }
        return this._currentMode;
      }
    }

    // 聚合信号 / Aggregate signals
    const signals = this._aggregateSignals(turnContext);

    // 最小停留时间检查 / Minimum dwell time check
    const turnsSinceSwitch = this._turnCount - this._lastSwitchTurn;
    if (turnsSinceSwitch < MIN_DWELL_TURNS) {
      return this._currentMode;
    }

    // 优先级评估: URGENT > EXPLORE > EXPLOIT > RELIABLE
    // Priority evaluation: URGENT > EXPLORE > EXPLOIT > RELIABLE
    const newMode = this._determineMode(signals);

    if (newMode !== this._currentMode) {
      this._switchMode(newMode, signals);
    }

    return this._currentMode;
  }

  /**
   * 获取当前工作模式 / Get current work mode
   *
   * @returns {string}
   */
  getCurrentMode() {
    return this._currentMode;
  }

  /**
   * 获取当前调节系数 / Get current modulation factors
   *
   * @returns {{ thresholdMult: number, costTolerance: number, evidenceStrictness: number }}
   */
  getModulationFactors() {
    return { ...MODE_FACTORS[this._currentMode] };
  }

  // ============================================================================
  // 信号聚合 / Signal Aggregation
  // ============================================================================

  /**
   * 从各引擎聚合信号 / Aggregate signals from engines
   *
   * @param {Object} turnContext
   * @returns {{ failureRate: number, novelty: number, urgencyScore: number, agentLoad: number }}
   * @private
   */
  _aggregateSignals(turnContext) {
    const signals = {
      failureRate: turnContext.failureRate ?? this._inferFailureRate(),
      novelty: turnContext.novelty ?? this._inferNovelty(),
      urgencyScore: turnContext.urgencyScore ?? this._inferUrgency(),
      agentLoad: turnContext.agentLoad ?? this._inferAgentLoad(),
    };

    return signals;
  }

  /**
   * 从 ToolResilience 推断失败率 / Infer failure rate from ToolResilience
   * @returns {number}
   * @private
   */
  _inferFailureRate() {
    if (!this._toolResilience) return 0;

    try {
      const states = this._toolResilience.getCircuitBreakerStates();
      const tools = Object.values(states);
      if (tools.length === 0) return 0;

      const openCount = tools.filter(s => s === 'OPEN' || s === 'HALF_OPEN').length;
      return openCount / tools.length;
    } catch {
      return 0;
    }
  }

  /**
   * 从 repair_memory 推断任务新颖度 / Infer task novelty from repair_memory
   * 低匹配率 = 新颖 / Low match rate = novel
   * @returns {number}
   * @private
   */
  _inferNovelty() {
    // 如果没有 SwarmAdvisor 的 stimulus 数据，返回中等新颖度
    if (!this._swarmAdvisor) return 0.5;

    try {
      // 使用 SwarmAdvisor 的最后一次 stimulus 作为新颖度代理
      // Use SwarmAdvisor's last stimulus as novelty proxy
      const turns = this._swarmAdvisor._turns;
      if (!turns || turns.size === 0) return 0.5;

      // 取最近 turn 的 stimulus 值
      const entries = [...turns.values()];
      const latest = entries[entries.length - 1];
      return latest?.stimulus ?? 0.5;
    } catch {
      return 0.5;
    }
  }

  /**
   * 从 SwarmAdvisor 推断紧急度 / Infer urgency from SwarmAdvisor
   * @returns {number}
   * @private
   */
  _inferUrgency() {
    if (!this._swarmAdvisor) return 0;

    try {
      // 检查是否有 BRAKE 模式激活
      const mode = this._swarmAdvisor.getCurrentMode?.();
      if (mode === 'BRAKE') return 0.9;
      if (mode === 'PREPLAN') return 0.5;
      return 0.2;
    } catch {
      return 0;
    }
  }

  /**
   * 从 HealthChecker 推断 agent 负载 / Infer agent load from HealthChecker
   * @returns {number}
   * @private
   */
  _inferAgentLoad() {
    // 暂时返回中等负载，后续可从 HealthChecker 获取
    return 0.5;
  }

  // ============================================================================
  // 模式决策 / Mode Decision
  // ============================================================================

  /**
   * 确定应切换到的模式（含滞后逻辑）
   * Determine target mode with hysteresis
   *
   * @param {{ failureRate: number, novelty: number, urgencyScore: number }} signals
   * @returns {string}
   * @private
   */
  _determineMode(signals) {
    const { failureRate, novelty, urgencyScore } = signals;
    const currentMode = this._currentMode;

    // 1. URGENT 优先级最高 / URGENT has highest priority
    if (currentMode === WorkMode.URGENT) {
      // 需要低于退出阈值才能离开 URGENT
      if (failureRate <= THRESHOLDS.urgentExit.failureRate &&
          urgencyScore <= THRESHOLDS.urgentExit.urgencyScore) {
        // 退出 URGENT，根据信号决定下一个模式
        return this._decideNonUrgentMode(signals);
      }
      return WorkMode.URGENT;
    }

    // 进入 URGENT 检查
    if (failureRate >= THRESHOLDS.urgentEntry.failureRate ||
        urgencyScore >= THRESHOLDS.urgentEntry.urgencyScore) {
      return WorkMode.URGENT;
    }

    return this._decideNonUrgentMode(signals);
  }

  /**
   * 非紧急模式决策 / Non-urgent mode decision
   *
   * @param {{ failureRate: number, novelty: number }} signals
   * @returns {string}
   * @private
   */
  _decideNonUrgentMode(signals) {
    const { novelty, failureRate } = signals;
    const currentMode = this._currentMode;

    // EXPLORE: 高新颖度 + 低失败率
    if (currentMode === WorkMode.EXPLORE) {
      if (novelty <= THRESHOLDS.exploreExit.novelty ||
          failureRate >= THRESHOLDS.exploreExit.failureRate) {
        // 退出 EXPLORE
      } else {
        return WorkMode.EXPLORE;
      }
    } else if (novelty >= THRESHOLDS.exploreEntry.novelty &&
               failureRate <= THRESHOLDS.exploreEntry.failureRate) {
      return WorkMode.EXPLORE;
    }

    // EXPLOIT: 低新颖度 (高重复度)
    if (currentMode === WorkMode.EXPLOIT) {
      if (novelty >= THRESHOLDS.exploitExit.novelty) {
        // 退出 EXPLOIT
      } else {
        return WorkMode.EXPLOIT;
      }
    } else if (novelty <= THRESHOLDS.exploitEntry.novelty) {
      return WorkMode.EXPLOIT;
    }

    // 默认: RELIABLE
    return WorkMode.RELIABLE;
  }

  // ============================================================================
  // 模式切换 / Mode Switching
  // ============================================================================

  /**
   * 执行模式切换 / Execute mode switch
   *
   * @param {string} newMode
   * @param {Object} signals
   * @private
   */
  _switchMode(newMode, signals) {
    const oldMode = this._currentMode;
    this._currentMode = newMode;
    this._lastSwitchTurn = this._turnCount;

    // 记录切换历史 / Record switch history
    this._switchHistory.push({
      from: oldMode,
      to: newMode,
      turn: this._turnCount,
      timestamp: Date.now(),
      signals: { ...signals },
    });

    // 容量控制 / Capacity control
    if (this._switchHistory.length > 100) {
      this._switchHistory.shift();
    }

    // 发布 MODE_SWITCHED 事件
    this._messageBus?.publish?.('modulator.mode.switched', {
      from: oldMode,
      to: newMode,
      turn: this._turnCount,
      factors: this.getModulationFactors(),
      signals,
      timestamp: Date.now(),
    });

    this._logger.info?.(
      `[GlobalModulator] Mode switch: ${oldMode} → ${newMode} ` +
      `(turn=${this._turnCount}, failure=${signals.failureRate.toFixed(2)}, ` +
      `novelty=${signals.novelty.toFixed(2)}, urgency=${signals.urgencyScore.toFixed(2)})`
    );
  }

  // ============================================================================
  // 统计 / Statistics
  // ============================================================================

  /**
   * 获取模式切换统计 / Get mode switching statistics
   *
   * @returns {Object}
   */
  getStats() {
    const totalTurns = this._turnCount || 1;

    // 计算各模式占比 / Calculate mode distribution
    const modeDistribution = {};
    for (const [mode, turns] of Object.entries(this._modeDwellTurns)) {
      modeDistribution[mode] = parseFloat((turns / totalTurns).toFixed(3));
    }

    // 计算平均停留 turn 数 / Calculate average dwell turns
    const switchCount = this._switchHistory.length;
    let avgDwell = totalTurns;
    if (switchCount > 0) {
      avgDwell = totalTurns / switchCount;
    }

    return {
      currentMode: this._currentMode,
      turnCount: this._turnCount,
      switchCount,
      modeDistribution,
      switchStability: parseFloat(avgDwell.toFixed(1)),
      lastSwitch: this._switchHistory.length > 0
        ? this._switchHistory[this._switchHistory.length - 1]
        : null,
      factors: this.getModulationFactors(),
      // V6.3: 冷启动状态 / Cold start status
      coldStart: {
        complete: this._coldStartComplete,
        completedTasks: this._completedTaskCount,
        threshold: this._coldStartThreshold,
      },
    };
  }
}
