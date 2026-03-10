/**
 * SwarmAdvisor -- 蜂群主路径路由引擎 / Swarm Main-Path Routing Engine
 *
 * V5.4 L4 编排层: 多信号聚合路由器 — 从 5 个引擎收集信号, 加权决策是否引导蜂群协作。
 *
 * V5.4 L4 Orchestration: Multi-signal aggregation router — collects signals from 5 engines,
 * makes weighted routing decisions for swarm collaboration.
 *
 * V5.3 → V5.4 变化 / V5.3 → V5.4 changes:
 * - 降格为宿主内轻再组织器 (不再是"建议", 而是"路由判断")
 * - Repositioned as lightweight in-host route gate (not "advisor", but "router")
 * - computeStimulus 从纯文本特征分析 → 多信号聚合 (text + env + failure + breaker + board)
 * - computeStimulus from text-only features → multi-signal aggregation
 * - 工具安全分级 T0/T1/T2: 不同级别差异化路由策略
 * - Tool safety classes T0/T1/T2: differentiated routing per safety level
 *
 * 信号源 / Signal sources:
 * - ResponseThreshold: PI 控制器阈值判断
 * - PheromoneResponseMatrix: pending 任务压力梯度 + recruit 信号
 * - FailureVaccination: 同类失败免疫命中
 * - ToolResilience: 断路器开路状态
 * - StigmergicBoard: 活跃协作公告数
 *
 * 两层架构 / Two-layer architecture:
 * - Layer 0: 每条用户消息 → 信号聚合 → 仲裁模式判定 → recruit 信息素 (Dashboard 可见)
 * - Layer 1: 按仲裁模式注入差异化路由上下文
 *
 * V5.4 adaptive-arbiter 四态仲裁 / 4-state arbitration:
 * - DIRECT:     简单任务, 无蜂群触发 / Simple task, no swarm trigger
 * - BIAS_SWARM: 中等复杂, 注入建议引导 / Medium, inject advisory bias
 * - PREPLAN:    高复杂度, 强制 swarm_run 优先 / High, force swarm_run first
 * - BRAKE:      紧急制动, 多环境信号临界 / Emergency, critical env signals
 *
 * @module L4-orchestration/swarm-advisor
 * @version 5.4.0
 * @author DEEP-IOS
 */

import { randomUUID } from 'node:crypto';
import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** Turn 状态 Map 最大容量 (防止内存泄漏) / Max turn states to prevent memory leak */
const MAX_TURNS = 50;

/** 无 ResponseThreshold 时的硬阈值 / Hard threshold when no ResponseThreshold available */
const DEFAULT_THRESHOLD = 0.5;

/** 虚拟 agent ID (用于 ResponseThreshold) / Virtual agent ID for threshold tracking */
const DEFAULT_AGENT_ID = 'swarm-advisor';

/** 任务类型标识 / Task type identifier for threshold tracking */
const TASK_TYPE = 'advisory';

// ============================================================================
// V5.4: 工具安全分级 / Tool Safety Classes
// ============================================================================

/**
 * 工具安全分级 (来源: V6 PolicyGate 核心概念)
 * Tool safety classification (from V6 PolicyGate core concept)
 *
 * T0_READONLY  — 只读查询, 永远放行, 不需要 advisory
 * T1_SCOPED    — 有限范围写操作, 根据 stimulus 决定是否引导
 * T2_PRIVILEGED — 高权限操作, 低 confidence 时强制引导到 swarm_run
 */
const TOOL_SAFETY_CLASS = {
  // T0: 只读, 始终放行 / Read-only, always allow
  swarm_status: 'T0_READONLY',
  swarm_query:  'T0_READONLY',
  swarm_memory: 'T0_READONLY',

  // T1: 有限范围, 根据信号强度路由 / Scoped, route by signal strength
  swarm_plan:      'T1_SCOPED',
  swarm_run:       'T1_SCOPED',
  swarm_pheromone: 'T1_SCOPED',
  swarm_gate:      'T1_SCOPED',
  swarm_zone:      'T1_SCOPED',

  // T2: 高权限, 低信号时强制引导 / Privileged, force guidance on low signal
  swarm_spawn:   'T2_PRIVILEGED',
  swarm_dispatch:'T2_PRIVILEGED',
};

/**
 * 获取工具安全级别 / Get tool safety class
 * @param {string} toolName
 * @returns {string} 'T0_READONLY' | 'T1_SCOPED' | 'T2_PRIVILEGED' | 'EXTERNAL'
 */
function getToolSafetyClass(toolName) {
  return TOOL_SAFETY_CLASS[toolName] || 'EXTERNAL';
}

// ============================================================================
// V5.4: 信号聚合权重 / Signal Aggregation Weights
// ============================================================================

/**
 * 多信号聚合权重 / Multi-signal aggregation weights
 * 总权重 = 1.0
 *
 * textStimulus:     文本特征分析 (V5.3 原有)
 * pressureSignal:   信息素压力梯度 (PheromoneResponseMatrix)
 * failureSignal:    失败免疫命中 (FailureVaccination)
 * breakerSignal:    断路器开路 (ToolResilience)
 * boardSignal:      活跃公告 (StigmergicBoard)
 */
const SIGNAL_WEIGHTS = {
  textStimulus:    0.30,
  pressureSignal:  0.18,
  failureSignal:   0.18,
  breakerSignal:   0.12,
  boardSignal:     0.10,
  symbiosisSignal: 0.12,  // V5.7: 共生互补度信号
};

// ============================================================================
// V5.4: 四态仲裁模式 / Adaptive Arbiter Modes
// ============================================================================

/**
 * 仲裁模式枚举 / Arbiter mode enum
 *
 * DIRECT     — 简单任务, 不触发蜂群, 所有工具放行
 * BIAS_SWARM — 中等复杂, 注入能力画像引导蜂群, 仅限制 T2 工具
 * PREPLAN    — 高复杂度, 强制 swarm_run 优先, T2+EXTERNAL 均受限
 * BRAKE      — 紧急制动, 多环境信号临界, 最强约束 + 环境告警
 */
export const ARBITER_MODES = {
  DIRECT:     'DIRECT',
  BIAS_SWARM: 'BIAS_SWARM',
  PREPLAN:    'PREPLAN',
  BRAKE:      'BRAKE',
};

// ============================================================================
// SwarmAdvisor 类 / SwarmAdvisor Class
// ============================================================================

export class SwarmAdvisor {
  /**
   * @param {Object} deps
   * @param {import('../L3-agent/response-threshold.js').ResponseThreshold} [deps.responseThreshold]
   * @param {import('../L2-communication/pheromone-engine.js').PheromoneEngine} [deps.pheromoneEngine]
   * @param {import('../L4-orchestration/task-dag-engine.js').TaskDAGEngine} [deps.dagEngine]
   * @param {import('../L3-agent/capability-engine.js').CapabilityEngine} [deps.capabilityEngine]
   * @param {import('../L2-communication/stigmergic-board.js').StigmergicBoard} [deps.stigmergicBoard]
   * @param {import('../L2-communication/pheromone-response-matrix.js').PheromoneResponseMatrix} [deps.pheromoneResponseMatrix]
   * @param {import('../L3-agent/failure-vaccination.js').FailureVaccination} [deps.failureVaccination]
   * @param {import('../L5-application/tool-resilience.js').ToolResilience} [deps.toolResilience]
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.logger]
   */
  constructor({
    responseThreshold, pheromoneEngine, dagEngine, capabilityEngine,
    stigmergicBoard, messageBus, logger,
    // V5.4: 新增信号源 / New signal sources
    pheromoneResponseMatrix, failureVaccination, toolResilience,
    // V5.7: 共生技能信号源 / Skill symbiosis signal source
    skillSymbiosis,
  } = {}) {
    this._responseThreshold = responseThreshold || null;
    this._pheromoneEngine = pheromoneEngine || null;
    this._dagEngine = dagEngine || null;
    this._capabilityEngine = capabilityEngine || null;
    this._stigmergicBoard = stigmergicBoard || null;
    this._messageBus = messageBus || null;
    this._logger = logger || console;

    // V5.4: 新增信号源引擎 / New signal source engines
    this._pheromoneResponseMatrix = pheromoneResponseMatrix || null;
    this._failureVaccination = failureVaccination || null;
    this._toolResilience = toolResilience || null;

    // V5.7: 共生技能引擎 / Skill symbiosis engine
    this._skillSymbiosis = skillSymbiosis || null;

    /** @type {Object|null} V5.5: GlobalModulator for threshold adjustment */
    this._globalModulator = null;

    this._agentId = DEFAULT_AGENT_ID;

    // Turn 级状态: Map<turnId, TurnState> (D1 并发安全修正)
    // Turn-level state: Map for concurrent safety
    this._turns = new Map();

    // 统计 / Statistics
    this._stats = {
      layer0Fires: 0,
      layer1Injections: 0,
      swarmToolUsages: 0,
      totalStimulus: 0,
      // V5.4: 信号聚合统计 / Signal aggregation stats
      signalAggregations: 0,
      pressureBoosts: 0,
      failureBoosts: 0,
      breakerBoosts: 0,
      boardBoosts: 0,
      // V5.4: 四态仲裁统计 / Arbiter mode stats
      arbiterModes: {
        [ARBITER_MODES.DIRECT]: 0,
        [ARBITER_MODES.BIAS_SWARM]: 0,
        [ARBITER_MODES.PREPLAN]: 0,
        [ARBITER_MODES.BRAKE]: 0,
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Turn 状态管理 / Turn State Management
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 创建新 turn 条目 (Map 隔离, 每个 turn 独立状态)
   * Create new turn entry (Map isolation, independent state per turn)
   *
   * @param {string} [turnId]
   */
  resetTurn(turnId) {
    const id = turnId || randomUUID();
    this._turns.set(id, {
      turnId: id,
      stimulus: 0,
      advisoryInjected: false,
      swarmToolCalled: false,
      // V5.4: 四态仲裁 (取代二元 swarmPlanRequired)
      // V5.4: 4-state arbiter (replaces binary swarmPlanRequired)
      arbiterMode: ARBITER_MODES.DIRECT,
      swarmPlanRequired: false,  // 向后兼容: 从 arbiterMode 派生 / backward compat: derived from arbiterMode
      swarmPlanCompleted: false, // swarm tool 是否已完成
      toolCallCount: 0,         // 当前 turn 的工具调用次数
      userInput: '',
      // V5.4: 信号分解 / Signal breakdown
      signals: null,
      createdAt: Date.now(),
    });
    this._cleanupOldTurns();
    return id;
  }

  /**
   * 标记指定 turn 中 LLM 使用了 swarm tool
   * Mark that LLM called a swarm tool in the specified turn
   *
   * @param {string} turnId
   */
  markSwarmToolUsed(turnId) {
    const state = this._turns.get(turnId);
    if (state) {
      state.swarmToolCalled = true;
      state.swarmPlanCompleted = true;
      this._stats.swarmToolUsages++;
    }
  }

  /**
   * 检查工具调用是否应该被拦截 (before_tool_call 路由状态机)
   * Check if a tool call should be blocked (before_tool_call routing state machine)
   *
   * V5.4: 加入 T0/T1/T2 安全分级差异化路由
   * V5.4: Added T0/T1/T2 safety-class-based differentiated routing
   *
   * @param {string} turnId
   * @param {string} toolName
   * @returns {{ block: boolean, blockReason: string } | undefined}
   */
  checkToolRouting(turnId, toolName) {
    const state = this._turns.get(turnId);
    if (!state) return undefined;

    const safetyClass = getToolSafetyClass(toolName);
    const mode = state.arbiterMode;
    const inputHint = (state.userInput || '').substring(0, 80);

    // T0: 只读工具始终放行 / T0: read-only tools always pass
    if (safetyClass === 'T0_READONLY') return undefined;

    // DIRECT 模式: 无约束, 所有工具放行 / DIRECT: no constraints
    if (mode === ARBITER_MODES.DIRECT) return undefined;

    // T1: swarm 工具在任何非 DIRECT 模式下放行 (swarm_plan, swarm_run 等)
    // T1: swarm tools pass in all non-DIRECT modes
    if (safetyClass === 'T1_SCOPED') return undefined;

    // ── BIAS_SWARM 模式: 仅引导 T2, EXTERNAL 放行 ──
    if (mode === ARBITER_MODES.BIAS_SWARM) {
      if (safetyClass === 'T2_PRIVILEGED' && !state.swarmPlanCompleted) {
        state.toolCallCount++;
        this._stats.toolBlockCount = (this._stats.toolBlockCount || 0) + 1;
        return {
          block: true,
          blockReason: `建议先调用 swarm_run({ goal: "${inputHint}" }) 进行任务规划，再使用 ${toolName}。`,
        };
      }
      return undefined; // EXTERNAL 在 BIAS_SWARM 下放行
    }

    // ── PREPLAN / BRAKE 模式: T2 + EXTERNAL 均受限 ──

    // T2: 高权限 swarm 工具 — 引导到 swarm_run 先规划
    if (safetyClass === 'T2_PRIVILEGED' && !state.swarmPlanCompleted) {
      state.toolCallCount++;
      this._stats.toolBlockCount = (this._stats.toolBlockCount || 0) + 1;
      const prefix = mode === ARBITER_MODES.BRAKE ? '[环境异常] ' : '';
      return {
        block: true,
        blockReason: `${prefix}请先调用 swarm_run({ goal: "${inputHint}" }) 进行任务规划，再使用 ${toolName}。`,
      };
    }

    // swarm 完成后放行 / After swarm completion, allow all
    if (state.swarmPlanCompleted) return undefined;

    // 核心拦截: swarm 尚未调用, block 非 swarm 工具
    // Core blocking: swarm not yet called, block non-swarm tools
    state.toolCallCount++;
    this._stats.toolBlockCount = (this._stats.toolBlockCount || 0) + 1;

    const prefix = mode === ARBITER_MODES.BRAKE
      ? '[环境信号异常] 蜂群协作为必要路径 — '
      : '';
    return {
      block: true,
      blockReason: `${prefix}此任务需要先启动蜂群协作。请调用: swarm_run({ goal: "${inputHint}" })`,
    };
  }

  /**
   * 获取指定 turn 状态 / Get state of a specific turn
   * @param {string} turnId
   * @returns {Object|undefined}
   */
  getTurnState(turnId) {
    const state = this._turns.get(turnId);
    return state ? { ...state } : undefined;
  }

  /**
   * 清理超出 MAX_TURNS 的旧条目 / Cleanup old turns exceeding MAX_TURNS
   * @private
   */
  _cleanupOldTurns() {
    if (this._turns.size <= MAX_TURNS) return;

    // 按 createdAt 排序, 删除最旧的
    const entries = [...this._turns.entries()]
      .sort((a, b) => a[1].createdAt - b[1].createdAt);

    const toRemove = entries.length - MAX_TURNS;
    for (let i = 0; i < toRemove; i++) {
      this._turns.delete(entries[i][0]);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // V5.4: 多信号聚合 / Multi-Signal Aggregation
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 从 5 个引擎收集信号并加权聚合
   * Collect signals from 5 engines and compute weighted aggregate
   *
   * 信号源:
   * 1. textStimulus     — 文本特征分析 (V5.3 原有, 保留为基础信号)
   * 2. pressureSignal   — PheromoneResponseMatrix 的升压计数和追踪任务数
   * 3. failureSignal    — FailureVaccination 缓存中的活跃疫苗密度
   * 4. breakerSignal    — ToolResilience 中 OPEN 状态的断路器比例
   * 5. boardSignal      — StigmergicBoard 活跃公告数
   *
   * @param {string} userInput
   * @returns {{ composite: number, signals: Object }}
   */
  aggregateSignals(userInput) {
    this._stats.signalAggregations++;

    // ── 信号 1: 文本特征 (V5.3 原有) ────────────────────────────
    const textStimulus = this._computeTextStimulus(userInput);

    // ── 信号 2: 信息素压力梯度 ────────────────────────────────────
    let pressureSignal = 0;
    if (this._pheromoneResponseMatrix) {
      try {
        const prmStats = this._pheromoneResponseMatrix.getStats();
        // 有追踪中的 pending 任务 → 环境中有未完成工作 → 升压信号
        // Tracked pending tasks → unfinished work in environment → pressure signal
        const taskPressure = Math.min(prmStats.trackedTasks / 3, 1);
        // 历史升压次数越多 → 系统越需要蜂群协助
        // More historical escalations → system needs more swarm help
        const escalationPressure = Math.min(prmStats.escalations / 5, 1);
        pressureSignal = Math.max(taskPressure, escalationPressure);
        if (pressureSignal > 0) this._stats.pressureBoosts++;
      } catch { /* non-fatal */ }
    }

    // ── 信号 3: 失败免疫命中 ──────────────────────────────────────
    let failureSignal = 0;
    if (this._failureVaccination) {
      try {
        const fvStats = this._failureVaccination.getStats();
        // 活跃疫苗越多 → 系统遇到过更多失败模式 → 蜂群修复价值越高
        // More active vaccines → more failure patterns encountered → higher swarm repair value
        const vaccineDensity = Math.min(fvStats.cachedVaccines / 5, 1);
        // 疫苗应用成功率 → 如果免疫修复有效, 蜂群协作更有价值
        const successRate = fvStats.applied > 0
          ? fvStats.successes / fvStats.applied
          : 0;
        failureSignal = vaccineDensity * 0.6 + successRate * 0.4;
        if (failureSignal > 0) this._stats.failureBoosts++;
      } catch { /* non-fatal */ }
    }

    // ── 信号 4: 断路器开路 ────────────────────────────────────────
    let breakerSignal = 0;
    if (this._toolResilience) {
      try {
        const states = this._toolResilience.getCircuitBreakerStates();
        const entries = Object.entries(states);
        if (entries.length > 0) {
          const openCount = entries.filter(([, s]) => s === 'OPEN').length;
          const halfOpenCount = entries.filter(([, s]) => s === 'HALF_OPEN').length;
          // OPEN 断路器 → 工具不可用 → 蜂群可提供替代路径
          // OPEN breakers → tools unavailable → swarm can provide alternative paths
          breakerSignal = Math.min((openCount + halfOpenCount * 0.5) / entries.length, 1);
          if (breakerSignal > 0) this._stats.breakerBoosts++;
        }
      } catch { /* non-fatal */ }
    }

    // ── 信号 5: 活跃公告 ──────────────────────────────────────────
    let boardSignal = 0;
    if (this._stigmergicBoard) {
      try {
        const boardStats = this._stigmergicBoard.getStats();
        // 活跃公告越多 → 蜂群环境越活跃 → 更适合协作
        // More active posts → more active swarm environment → better for collaboration
        boardSignal = Math.min(boardStats.activePosts / 5, 1);
        if (boardSignal > 0) this._stats.boardBoosts++;
      } catch { /* non-fatal */ }
    }

    // ── 信号 6: V5.7 共生团队互补度 / Symbiosis team complementarity ──
    let symbiosisSignal = 0;
    if (this._skillSymbiosis) {
      try {
        const symStats = this._skillSymbiosis.getStats();
        const pairDensity = Math.min(symStats.trackedPairs / 10, 1);
        const usageRate = Math.min(symStats.recommendations / 5, 1);
        symbiosisSignal = pairDensity * 0.5 + usageRate * 0.5;
        if (symbiosisSignal > 0) this._stats.symbiosisBoosts = (this._stats.symbiosisBoosts || 0) + 1;
      } catch { /* non-fatal */ }
    }

    // ── 加权聚合 (缺失引擎权重重分配) / Weighted aggregation (redistribute missing engine weights) ──
    // 当信号源引擎未连接时, 其权重按比例重分配给已连接的信号源
    // When signal source engines are not connected, their weights are proportionally
    // redistributed to connected signal sources
    const activeWeights = { textStimulus: SIGNAL_WEIGHTS.textStimulus };
    let totalActive = SIGNAL_WEIGHTS.textStimulus; // text 始终可用

    if (this._pheromoneResponseMatrix) { activeWeights.pressureSignal = SIGNAL_WEIGHTS.pressureSignal; totalActive += SIGNAL_WEIGHTS.pressureSignal; }
    if (this._failureVaccination)      { activeWeights.failureSignal  = SIGNAL_WEIGHTS.failureSignal;  totalActive += SIGNAL_WEIGHTS.failureSignal; }
    if (this._toolResilience)          { activeWeights.breakerSignal  = SIGNAL_WEIGHTS.breakerSignal;  totalActive += SIGNAL_WEIGHTS.breakerSignal; }
    if (this._stigmergicBoard)         { activeWeights.boardSignal    = SIGNAL_WEIGHTS.boardSignal;    totalActive += SIGNAL_WEIGHTS.boardSignal; }
    if (this._skillSymbiosis)          { activeWeights.symbiosisSignal = SIGNAL_WEIGHTS.symbiosisSignal; totalActive += SIGNAL_WEIGHTS.symbiosisSignal; }

    // 归一化权重 / Normalize weights so they sum to 1.0
    const scale = totalActive > 0 ? 1 / totalActive : 1;

    const composite = (
      (activeWeights.textStimulus    || 0) * scale * textStimulus +
      (activeWeights.pressureSignal  || 0) * scale * pressureSignal +
      (activeWeights.failureSignal   || 0) * scale * failureSignal +
      (activeWeights.breakerSignal   || 0) * scale * breakerSignal +
      (activeWeights.boardSignal     || 0) * scale * boardSignal +
      (activeWeights.symbiosisSignal || 0) * scale * symbiosisSignal
    );

    const signals = {
      textStimulus:    Math.round(textStimulus * 10000) / 10000,
      pressureSignal:  Math.round(pressureSignal * 10000) / 10000,
      failureSignal:   Math.round(failureSignal * 10000) / 10000,
      breakerSignal:   Math.round(breakerSignal * 10000) / 10000,
      boardSignal:     Math.round(boardSignal * 10000) / 10000,
      symbiosisSignal: Math.round(symbiosisSignal * 10000) / 10000,
      composite:       Math.round(Math.max(0, Math.min(1, composite)) * 10000) / 10000,
    };

    return { composite: signals.composite, signals };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // V5.4: 四态仲裁判定 / Adaptive Arbiter Mode Computation
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 根据聚合信号计算仲裁模式
   * Compute arbiter mode from aggregated signals
   *
   * 模式阶梯 / Mode ladder:
   *   DIRECT     — composite <= threshold * 0.7  (远低于阈值)
   *   BIAS_SWARM — threshold * 0.7 < composite <= threshold  (接近阈值)
   *   PREPLAN    — composite > threshold AND 无临界环境信号  (超过阈值)
   *   BRAKE      — composite > threshold AND ≥2 个环境信号超过警戒线  (紧急)
   *
   * @param {number} composite - 聚合信号值 [0, 1]
   * @param {Object} [signals] - 信号分解 (含 breakerSignal, pressureSignal, etc.)
   * @returns {string} ARBITER_MODES.*
   */
  _computeArbiterMode(composite, signals) {
    const threshold = this._responseThreshold?.getThreshold?.(this._agentId, TASK_TYPE) ?? DEFAULT_THRESHOLD;

    // 低于阈值下界 → DIRECT (简单任务)
    if (composite <= threshold * 0.7) {
      return ARBITER_MODES.DIRECT;
    }

    // 超过阈值 → 判断 PREPLAN 还是 BRAKE
    if (composite > threshold) {
      // BRAKE: 需要同时满足 composite > threshold 且 ≥2 个环境信号超过警戒线
      if (signals) {
        const envAlerts = [
          signals.breakerSignal > 0.3,    // 有工具断路
          signals.pressureSignal > 0.5,   // 有任务滞留压力
          signals.failureSignal > 0.4,    // 有失败模式积累
          signals.boardSignal > 0.5,      // 公告板活跃度高
        ].filter(Boolean).length;

        if (envAlerts >= 2) {
          return ARBITER_MODES.BRAKE;
        }
      }
      return ARBITER_MODES.PREPLAN;
    }

    // 接近阈值 → BIAS_SWARM (中等复杂, 注入引导但不强制)
    return ARBITER_MODES.BIAS_SWARM;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Layer 0: 信号聚合 + 轻量信号 / Signal Aggregation + Lightweight Signal
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 从用户输入计算环境刺激值 (V5.4: 多信号聚合)
   * Compute environmental stimulus from user input (V5.4: multi-signal aggregation)
   *
   * V5.3: 纯文本特征 → V5.4: 文本 + 环境 + 失败 + 断路器 + 公告板
   *
   * @param {string} userInput
   * @returns {number} stimulus [0, 1]
   */
  computeStimulus(userInput) {
    const { composite } = this.aggregateSignals(userInput);
    return composite;
  }

  /**
   * 判断刺激值是否超过阈值 (使用 ResponseThreshold PI 控制器)
   * Check if stimulus exceeds threshold (using ResponseThreshold PI controller)
   *
   * @param {number} stimulus
   * @returns {boolean}
   */
  isHighStimulus(stimulus) {
    // V5.5: GlobalModulator 调节阈值 / GlobalModulator threshold adjustment
    let threshold = DEFAULT_THRESHOLD;
    if (this._globalModulator) {
      const factors = this._globalModulator.getModulationFactors();
      threshold = DEFAULT_THRESHOLD * (factors.thresholdMult || 1.0);
    }

    if (!this._responseThreshold) {
      return stimulus > threshold;
    }
    return this._responseThreshold.shouldRespond(this._agentId, TASK_TYPE, stimulus);
  }

  /**
   * V5.5: 设置 GlobalModulator 引用（初始化后注入）
   * V5.5: Set GlobalModulator reference (injected post-init)
   *
   * @param {Object} globalModulator
   */
  setGlobalModulator(globalModulator) {
    this._globalModulator = globalModulator;
  }

  /**
   * Layer 0 入口: 每条用户消息触发
   * Layer 0 entry: fires on every user message
   *
   * V5.4: 使用 aggregateSignals 替代原有 computeStimulus
   *
   * @param {string} userInput
   * @param {string} [turnId]
   * @returns {{ stimulus: number, turnId: string }}
   */
  handleLayer0(userInput, turnId) {
    const id = this.resetTurn(turnId);
    const state = this._turns.get(id);
    state.userInput = userInput || '';

    // V5.4: 多信号聚合 / Multi-signal aggregation
    const { composite, signals } = this.aggregateSignals(userInput);
    state.stimulus = composite;
    state.signals = signals;
    this._stats.layer0Fires++;
    this._stats.totalStimulus += composite;

    // V5.4: 四态仲裁 — 替代二元 swarmPlanRequired
    // V5.4: 4-state arbiter — replaces binary swarmPlanRequired
    const arbiterMode = this._computeArbiterMode(composite, signals);
    state.arbiterMode = arbiterMode;
    // 向后兼容: swarmPlanRequired 从 arbiterMode 派生
    // Backward compat: swarmPlanRequired derived from arbiterMode
    state.swarmPlanRequired = (arbiterMode === ARBITER_MODES.PREPLAN || arbiterMode === ARBITER_MODES.BRAKE);
    this._stats.arbiterModes[arbiterMode]++;

    // 轻量信号: composite > 0.1 时 emit recruit 信息素 (Dashboard 可见)
    if (composite > 0.1 && this._pheromoneEngine) {
      try {
        this._pheromoneEngine.emitPheromone({
          type: 'recruit',
          sourceId: 'swarm-advisor',
          targetScope: '/swarm-advisor/signal',
          intensity: Math.min(composite * 0.5, 0.8),
          payload: { turnId: id, stimulus: composite, signals, arbiterMode, layer: 0 },
        });
      } catch { /* non-fatal */ }
    }

    // 发布事件 / Publish event
    this._publish(EventTopics.SWARM_ADVISORY_INJECTED, {
      layer: 0,
      turnId: id,
      stimulus: Math.round(composite * 10000) / 10000,
      signals,
      arbiterMode,
    });

    return { stimulus: composite, turnId: id };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Layer 1: 路由决策上下文 / Routing Decision Context
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Layer 1 入口: 构建路由上下文 (仅当 stimulus 超过阈值时生效)
   * Layer 1 entry: build routing context (only when stimulus exceeds threshold)
   *
   * @param {string} userInput
   * @param {string} turnId
   * @returns {{ context: string, turnId: string } | null}
   */
  handleLayer1(userInput, turnId) {
    const state = this._turns.get(turnId);
    if (!state) return null;

    const stimulus = state.stimulus;
    const context = this.buildAdvisoryContext(userInput, stimulus, state.signals);

    if (context) {
      state.advisoryInjected = true;
      if (this.isHighStimulus(stimulus)) {
        this._stats.layer1Injections++;
      }

      this._publish(EventTopics.SWARM_ADVISORY_INJECTED, {
        layer: 1,
        turnId,
        stimulus: Math.round(stimulus * 10000) / 10000,
        arbiterMode: state.arbiterMode,
        highStimulus: this.isHighStimulus(stimulus),
      });
    }

    return context ? { context, turnId } : null;
  }

  /**
   * 构建路由决策上下文 (V5.4: 精简版, 路由决策 + 一行理由)
   * Build routing decision context (V5.4: concise — decision + one-line rationale)
   *
   * @param {string} userInput
   * @param {number} stimulus
   * @param {Object} [signals]
   * @returns {string}
   */
  buildAdvisoryContext(userInput, stimulus, signals) {
    const mode = this._computeArbiterMode(stimulus, signals);

    switch (mode) {
      case ARBITER_MODES.BRAKE: {
        // 紧急制动: 环境告警 + 最强建议 / Emergency brake: env alerts + strongest recommendation
        const rationale = this._buildRoutingRationale(signals);
        return [
          this.buildCapabilityProfile(),
          '',
          this.buildTaskAnalysis(userInput, stimulus),
          this._buildBrakeAlert(signals),
          rationale ? `[路由依据] ${rationale}` : '',
          '',
          '[紧急行动] 环境信号异常，请立即使用 swarm_run 启动蜂群协作:',
          'swarm_run({ goal: "<用户任务描述>" })',
          '蜂群协作将提供冗余路径和失败修复能力。',
        ].filter(Boolean).join('\n');
      }

      case ARBITER_MODES.PREPLAN: {
        // 强制规划: 完整画像 + 强建议 (保持 V5.3 高信号行为)
        // Force planning: full profile + strong recommendation (preserves V5.3 high-signal behavior)
        const rationale = this._buildRoutingRationale(signals);
        return [
          this.buildCapabilityProfile(),
          '',
          this.buildTaskAnalysis(userInput, stimulus),
          rationale ? `[路由依据] ${rationale}` : '',
          '',
          this.buildRecommendation(stimulus),
        ].filter(Boolean).join('\n');
      }

      case ARBITER_MODES.BIAS_SWARM:
        // 引导偏向: 能力画像 + 温和建议 + 明确可跳过
        // Bias toward swarm: profile + mild suggestion + explicit opt-out
        return [
          this.buildCapabilityProfile(),
          '',
          this.buildTaskAnalysis(userInput, stimulus),
          '',
          '[建议] 此任务可能受益于蜂群协作。调用 swarm_run({ goal: "..." }) 可自动分解任务并派遣专业角色。',
          '如果你认为此任务不需要协作，可以直接回答。',
        ].filter(Boolean).join('\n');

      default:
        // DIRECT: 简短待命提示 / Brief standby hint
        return '[蜂群] D1/D3/D2 待命。如需协作可使用 swarm_run({ goal: "你的任务" }) 一键启动蜂群。';
    }
  }

  /**
   * 构建 D1/D2/D3 能力画像 / Build capability profile for D1/D2/D3
   * @returns {string}
   */
  buildCapabilityProfile() {
    return [
      '[蜂群协作能力]',
      '你拥有以下协作资源:',
      '• D1(侦察蜂) — 擅长信息搜集、API调研、文档分析、数据源探索',
      '• D3(工蜂)   — 擅长代码实现、文档编写、数据处理、技术方案',
      '• D2(审查蜂) — 擅长代码审查、质量评估、安全检查、验证测试',
    ].join('\n');
  }

  /**
   * 构建任务复杂度分析文本 / Build task complexity analysis text
   *
   * @param {string} userInput
   * @param {number} stimulus
   * @returns {string}
   */
  buildTaskAnalysis(userInput, stimulus) {
    const level = stimulus > 0.7 ? '高' : stimulus > 0.4 ? '中' : '低';
    const features = [];

    // 检测特征 / Detect features
    if ((userInput.match(/分析|比较|评估|对比|权衡/g) || []).length >= 2) {
      features.push('多分析维度');
    }
    if (/API|api|数据库|接口|数据源|文档|http/i.test(userInput)) {
      features.push('需外部数据源');
    }
    if (/首先|然后|最后|接着|第[一二三四五]步/g.test(userInput)) {
      features.push('涉及多步骤处理');
    }
    if (/代码|实现|编写|开发|构建|重构|build|implement/i.test(userInput)) {
      features.push('涉及代码开发');
    }

    const featureText = features.length > 0
      ? `检测到: ${features.join(' + ')}`
      : '未检测到特定复杂度特征';

    return [
      `[任务分析] 复杂度: ${stimulus.toFixed(2)} (${level})`,
      featureText,
    ].join('\n');
  }

  /**
   * 构建行动建议文本 (强度随 PI 控制器调节)
   * Build recommendation text (strength adapts via PI controller)
   *
   * @param {number} stimulus
   * @returns {string}
   */
  buildRecommendation(stimulus) {
    // 获取当前阈值来判断建议强度 / Get current threshold for recommendation strength
    const threshold = this._responseThreshold?.getThreshold?.(this._agentId, TASK_TYPE) ?? DEFAULT_THRESHOLD;

    // 超过阈值越多, 建议越强 / Higher surplus = stronger recommendation
    const surplus = stimulus - threshold;

    if (surplus > 0.3) {
      // 强建议 / Strong recommendation
      return [
        '[行动] 请使用 swarm_run 一键启动蜂群协作:',
        'swarm_run({ goal: "<用户任务描述>" })',
        '此工具自动完成: 任务分解 → 角色推荐 → 子代理派遣。',
      ].join('\n');
    } else if (surplus > 0.1) {
      // 中等建议 / Medium recommendation
      return [
        '[建议] 此任务适合使用蜂群协作, 效果优于单独处理。',
        '调用: swarm_run({ goal: "<任务描述>" })',
      ].join('\n');
    } else {
      // 弱建议 / Mild recommendation
      return '[提示] 如需多角色协作，可调用 swarm_run({ goal: "..." }) 一键启动蜂群。';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PI 控制器反馈 / PI Controller Feedback
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * PI 控制器反馈: 评估建议效果, 调节未来建议强度
   * PI controller feedback: evaluate advisory effectiveness, adjust future strength
   *
   * @param {string} turnId
   * @param {boolean} wasHelpful - 蜂群协助是否有帮助
   */
  recordOutcome(turnId, wasHelpful) {
    if (!this._responseThreshold) return;

    // 有帮助 → 高活跃率 → 降低阈值 → 未来推荐更积极
    // 没帮助 → 低活跃率 → 升高阈值 → 未来推荐更谨慎
    const rate = wasHelpful ? 0.8 : 0.2;

    const result = this._responseThreshold.adjust(this._agentId, TASK_TYPE, rate);

    this._logger.info?.(
      `[SwarmAdvisor] Feedback: turnId=${turnId}, helpful=${wasHelpful}, ` +
      `threshold: ${result.oldThreshold?.toFixed(3)} → ${result.newThreshold?.toFixed(3)}`
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 统计 + 生命周期 / Stats + Lifecycle
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 获取统计数据 / Get statistics
   * @returns {Object}
   */
  getStats() {
    return {
      ...this._stats,
      avgStimulus: this._stats.layer0Fires > 0
        ? Math.round((this._stats.totalStimulus / this._stats.layer0Fires) * 10000) / 10000
        : 0,
      currentThreshold: this._responseThreshold?.getThreshold?.(this._agentId, TASK_TYPE) ?? DEFAULT_THRESHOLD,
      activeTurns: this._turns.size,
      // V5.4: 仲裁模式分布 / Arbiter mode distribution
      arbiterModes: { ...this._stats.arbiterModes },
    };
  }

  /**
   * 销毁实例 / Destroy instance
   */
  destroy() {
    this._turns.clear();
    this._logger.info?.('[SwarmAdvisor] Destroyed');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // V5.4: 工具安全分级查询 / Tool Safety Class Query
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 获取工具安全分级 / Get tool safety class
   * @param {string} toolName
   * @returns {string}
   */
  static getToolSafetyClass(toolName) {
    return getToolSafetyClass(toolName);
  }

  /**
   * 获取仲裁模式枚举 / Get arbiter modes enum
   * @returns {Object}
   */
  static get ARBITER_MODES() {
    return ARBITER_MODES;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 内部辅助 / Internal Helpers
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * V5.4: 纯文本特征刺激计算 (从 V5.3 computeStimulus 提取)
   * V5.4: Pure text feature stimulus computation (extracted from V5.3 computeStimulus)
   *
   * @param {string} userInput
   * @returns {number} [0, 1]
   * @private
   */
  _computeTextStimulus(userInput) {
    if (!userInput || typeof userInput !== 'string') return 0;

    const text = userInput.trim();
    if (text.length === 0) return 0;

    // Feature 1: 文本长度归一化 (sigmoid at 200 effective chars)
    const effectiveLength = this._computeEffectiveLength(text);
    const lengthScore = 1 / (1 + Math.exp(-0.02 * (effectiveLength - 200)));

    // Feature 2: 动作动词密度
    const actionVerbs = text.match(
      /分析|调研|比较|实现|搜索|评估|验证|设计|优化|重构|部署|测试|审查|研究|整理|汇总|统计|监控|编写|开发|构建|review|analyze|implement|design|build|test/gi
    ) || [];
    const actionScore = Math.min(actionVerbs.length / 3, 1);

    // Feature 3: 多步骤指示符
    const multiStep = text.match(
      /首先|然后|最后|接着|第[一二三四五]步|同时|另外|此外|再|之后|并且|以及|step\s?\d|first|then|finally/gi
    ) || [];
    const multiStepScore = Math.min(multiStep.length / 2, 1);

    // Feature 4: 数据源引用
    const dataSources = text.match(
      /API|api|数据库|文档|GitHub|repo|仓库|Tushare|接口|SDK|网站|http|文件|服务|数据源|database|endpoint/gi
    ) || [];
    const dataSourceScore = Math.min(dataSources.length / 2, 1);

    // Feature 5: 问号密度
    const questionMarks = (text.match(/[？?]/g) || []).length;
    const questionScore = Math.min(questionMarks / 3, 1);

    // 加权组合 / Weighted combination
    const stimulus = (
      0.20 * lengthScore +
      0.25 * actionScore +
      0.25 * multiStepScore +
      0.15 * dataSourceScore +
      0.15 * questionScore
    );

    return Math.max(0, Math.min(1, stimulus));
  }

  /**
   * V5.4: 构建路由决策理由 (基于信号分解)
   * V5.4: Build routing rationale (based on signal breakdown)
   *
   * @param {Object} [signals]
   * @returns {string}
   * @private
   */
  _buildRoutingRationale(signals) {
    if (!signals) return '';

    const reasons = [];
    if (signals.pressureSignal > 0.3) reasons.push('环境中有滞留任务需要协助');
    if (signals.failureSignal > 0.3) reasons.push('已知失败模式可通过蜂群修复');
    if (signals.breakerSignal > 0) reasons.push('部分工具断路器已开启');
    if (signals.boardSignal > 0.3) reasons.push('公告板有活跃协作信号');
    if (signals.textStimulus > 0.5) reasons.push('任务文本复杂度较高');

    return reasons.length > 0 ? reasons.join('; ') : '';
  }

  /**
   * V5.4: 构建 BRAKE 模式环境告警文本
   * V5.4: Build BRAKE mode environment alert text
   *
   * @param {Object} [signals]
   * @returns {string}
   * @private
   */
  _buildBrakeAlert(signals) {
    if (!signals) return '';

    const alerts = [];
    if (signals.breakerSignal > 0.3) alerts.push(`断路器告警: ${Math.round(signals.breakerSignal * 100)}% 工具处于异常状态`);
    if (signals.pressureSignal > 0.5) alerts.push(`任务压力: ${Math.round(signals.pressureSignal * 100)}% 滞留压力`);
    if (signals.failureSignal > 0.4) alerts.push(`失败免疫: ${Math.round(signals.failureSignal * 100)}% 已知故障模式`);
    if (signals.boardSignal > 0.5) alerts.push(`公告板: ${Math.round(signals.boardSignal * 100)}% 活跃度`);

    if (alerts.length === 0) return '';
    return `[环境告警] ${alerts.join(' | ')}`;
  }

  /**
   * 计算文本的有效长度 (CJK 字符按 3 倍计算)
   * Compute effective length (CJK characters counted as 3x)
   *
   * @param {string} text
   * @returns {number} effective character count
   * @private
   */
  _computeEffectiveLength(text) {
    // eslint-disable-next-line no-control-regex
    const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;
    const cjkMatches = text.match(cjkRegex);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;
    const nonCjkCount = text.length - cjkCount;
    // CJK 字符 × 3 + 非 CJK 字符 × 1
    return cjkCount * 3 + nonCjkCount;
  }

  /**
   * 发布事件 / Publish event
   * @param {string} topic
   * @param {Object} payload
   * @private
   */
  _publish(topic, payload) {
    if (!this._messageBus) return;
    try {
      this._messageBus.publish(topic, wrapEvent(topic, payload, 'swarm-advisor'));
    } catch { /* non-fatal */ }
  }
}
