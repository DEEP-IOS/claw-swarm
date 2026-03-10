/**
 * CriticalPath -- 关键路径分析引擎
 * Critical path analysis engine for DAG scheduling
 *
 * 使用前向遍历(ES/EF)和后向遍历(LS/LF)计算关键路径、松弛时间和瓶颈节点。
 * 结合 DIM_LEARNING 信号的历史数据动态调整工期估算。
 * Uses forward pass (ES/EF) and backward pass (LS/LF) to compute the
 * critical path, slack times, and bottleneck nodes. Integrates DIM_LEARNING
 * signals for dynamic duration estimation based on historical data.
 *
 * @module orchestration/planning/critical-path
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js';
import { DIM_TASK, DIM_LEARNING } from '../../core/field/types.js';

// ============================================================================
// 角色基础工期 / Role Base Durations
// ============================================================================

/**
 * 各角色基础执行时间 (毫秒)
 * Base execution duration per role in milliseconds
 * @type {Record<string, number>}
 */
const BASE_DURATION = {
  researcher:  60000,
  analyst:     90000,
  planner:     60000,
  implementer: 180000,
  debugger:    120000,
  tester:      120000,
  reviewer:    60000,
  consultant:  90000,
  coordinator: 30000,
  librarian:   60000,
};

/**
 * 趋势系数 -- 基于学习信号的工期调整因子
 * Trend coefficients for duration adjustment based on learning signals
 * @type {Record<string, number>}
 */
const TREND_COEFFICIENTS = {
  improving:  0.85,
  stable:     1.0,
  declining:  1.2,
};

/** 未知角色的默认工期 (ms) / Default duration for unknown roles */
const DEFAULT_DURATION = 90000;

// ============================================================================
// CriticalPath 类 / CriticalPath Class
// ============================================================================

export class CriticalPath extends ModuleBase {
  /**
   * @param {Object} deps
   * @param {Object} deps.field - 信号场实例 / Signal field instance
   * @param {Object} deps.bus   - 事件总线实例 / Event bus instance
   */
  constructor({ field, bus } = {}) {
    super();
    /** @type {Object} */
    this._field = field;
    /** @type {Object} */
    this._bus = bus;
    /** @type {Map<string, Map<string, number>>} dagId -> (nodeId -> actualDuration) */
    this._actualDurations = new Map();
  }

  // --------------------------------------------------------------------------
  // 静态声明 / Static Declarations
  // --------------------------------------------------------------------------

  /** @returns {string[]} 产生的信号维度 / Signal dimensions produced */
  static produces() { return [DIM_TASK]; }

  /** @returns {string[]} 消费的信号维度 / Signal dimensions consumed */
  static consumes() { return [DIM_LEARNING]; }

  /** @returns {string[]} 发布的事件主题 / Event topics published */
  static publishes() { return ['critical-path.updated']; }

  /** @returns {string[]} 订阅的事件主题 / Event topics subscribed */
  static subscribes() { return ['dag.phase.completed', 'dag.phase.failed']; }

  // --------------------------------------------------------------------------
  // 核心方法 / Core Methods
  // --------------------------------------------------------------------------

  /**
   * 分析 DAG 关键路径
   * Analyze the critical path of a DAG
   *
   * 使用 CPM (Critical Path Method):
   * 1. 前向遍历: 计算 ES (Earliest Start) 和 EF (Earliest Finish)
   * 2. 后向遍历: 计算 LS (Latest Start) 和 LF (Latest Finish)
   * 3. 松弛时间: slack = LS - ES, 关键路径 = slack === 0 的序列
   *
   * @param {Array<{id: string, role: string, dependsOn: string[]}>} dagNodes - DAG 节点列表 / DAG node list
   * @param {Map<string, number>|Object} [estimatedDurations] - 每节点预估工期 / Estimated duration per node
   * @returns {{criticalPath: string[], slackTimes: Map<string, number>, totalDuration: number, bottleneck: string|null}}
   */
  analyze(dagNodes, estimatedDurations) {
    if (!dagNodes || dagNodes.length === 0) {
      return { criticalPath: [], slackTimes: new Map(), totalDuration: 0, bottleneck: null };
    }

    // 将 estimatedDurations 转为 Map / Normalize durations to Map
    const durations = estimatedDurations instanceof Map
      ? estimatedDurations
      : new Map(Object.entries(estimatedDurations ?? {}));

    // 补全缺失工期 / Fill missing durations with defaults
    for (const node of dagNodes) {
      if (!durations.has(node.id)) {
        durations.set(node.id, BASE_DURATION[node.role] ?? DEFAULT_DURATION);
      }
    }

    // 构建节点索引 / Build node index
    const nodeMap = new Map();
    for (const node of dagNodes) {
      nodeMap.set(node.id, node);
    }

    // --- 前向遍历 / Forward Pass ---
    // ES = max(EF of all predecessors), EF = ES + duration
    const es = new Map(); // Earliest Start
    const ef = new Map(); // Earliest Finish

    /**
     * 递归计算 ES / Recursively compute ES
     * @param {string} nodeId
     * @returns {number}
     */
    const computeES = (nodeId) => {
      if (es.has(nodeId)) return es.get(nodeId);
      const node = nodeMap.get(nodeId);
      if (!node.dependsOn || node.dependsOn.length === 0) {
        es.set(nodeId, 0);
      } else {
        let maxEF = 0;
        for (const depId of node.dependsOn) {
          const depEF = computeES(depId) + durations.get(depId);
          if (depEF > maxEF) maxEF = depEF;
        }
        es.set(nodeId, maxEF);
      }
      ef.set(nodeId, es.get(nodeId) + durations.get(nodeId));
      return es.get(nodeId);
    };

    for (const node of dagNodes) {
      computeES(node.id);
    }

    // 总工期 = 所有 EF 的最大值 / Total duration = max of all EF
    let totalDuration = 0;
    for (const [, val] of ef) {
      if (val > totalDuration) totalDuration = val;
    }

    // --- 后向遍历 / Backward Pass ---
    // LF = min(LS of all successors), LS = LF - duration
    const lf = new Map(); // Latest Finish
    const ls = new Map(); // Latest Start

    // 构建后继映射 / Build successor map
    const successors = new Map();
    for (const node of dagNodes) {
      successors.set(node.id, []);
    }
    for (const node of dagNodes) {
      for (const depId of (node.dependsOn ?? [])) {
        successors.get(depId)?.push(node.id);
      }
    }

    /**
     * 递归计算 LF / Recursively compute LF
     * @param {string} nodeId
     * @returns {number}
     */
    const computeLF = (nodeId) => {
      if (lf.has(nodeId)) return lf.get(nodeId);
      const succs = successors.get(nodeId) ?? [];
      if (succs.length === 0) {
        lf.set(nodeId, totalDuration);
      } else {
        let minLS = Infinity;
        for (const succId of succs) {
          const succLS = computeLF(succId) - durations.get(succId);
          if (succLS < minLS) minLS = succLS;
        }
        lf.set(nodeId, minLS);
      }
      ls.set(nodeId, lf.get(nodeId) - durations.get(nodeId));
      return lf.get(nodeId);
    };

    for (const node of dagNodes) {
      computeLF(node.id);
    }

    // --- 松弛时间和关键路径 / Slack Times and Critical Path ---
    const slackTimes = new Map();
    const criticalPath = [];

    for (const node of dagNodes) {
      const slack = ls.get(node.id) - es.get(node.id);
      slackTimes.set(node.id, slack);
      if (Math.abs(slack) < 0.001) { // 浮点误差容忍 / Float tolerance
        criticalPath.push(node.id);
      }
    }

    // 按 ES 排序关键路径 / Sort critical path by ES
    criticalPath.sort((a, b) => es.get(a) - es.get(b));

    // 瓶颈 = 关键路径上工期最长的节点 / Bottleneck = longest-duration node on critical path
    let bottleneck = null;
    let maxDuration = 0;
    for (const nodeId of criticalPath) {
      const d = durations.get(nodeId);
      if (d > maxDuration) {
        maxDuration = d;
        bottleneck = nodeId;
      }
    }

    return { criticalPath, slackTimes, totalDuration, bottleneck };
  }

  /**
   * 估算各节点工期 -- 结合基础时间和学习信号趋势
   * Estimate durations per node using base times and learning signal trends
   *
   * @param {Array<{id: string, role: string}>} dagNodes - DAG 节点列表 / DAG node list
   * @returns {Map<string, number>} nodeId -> 估算工期 (ms) / nodeId -> estimated duration
   */
  estimateDurations(dagNodes) {
    const durations = new Map();

    // 读取 DIM_LEARNING 信号 / Read DIM_LEARNING signals
    let trendMap = new Map();
    if (this._field?.read) {
      const learningSignals = this._field.read({
        dimension: DIM_LEARNING,
        limit: 50,
      });
      if (learningSignals && learningSignals.length > 0) {
        for (const sig of learningSignals) {
          const role = sig.metadata?.role;
          const trend = sig.metadata?.trend;
          if (role && trend) {
            trendMap.set(role, trend);
          }
        }
      }
    }

    for (const node of dagNodes) {
      const baseDuration = BASE_DURATION[node.role] ?? DEFAULT_DURATION;
      const trend = trendMap.get(node.role) ?? 'stable';
      const coefficient = TREND_COEFFICIENTS[trend] ?? 1.0;
      durations.set(node.id, Math.round(baseDuration * coefficient));
    }

    return durations;
  }

  /**
   * 获取 DAG 瓶颈节点 -- 关键路径上耗时最长的节点
   * Get the bottleneck node on the critical path
   *
   * @param {Array<{id: string, role: string, dependsOn: string[]}>} dagNodes - DAG 节点列表 / DAG node list
   * @returns {{nodeId: string|null, duration: number}} 瓶颈节点和工期 / Bottleneck node and duration
   */
  getBottleneck(dagNodes) {
    const durations = this.estimateDurations(dagNodes);
    const result = this.analyze(dagNodes, durations);
    return {
      nodeId:   result.bottleneck,
      duration: result.bottleneck ? durations.get(result.bottleneck) : 0,
    };
  }

  /**
   * 更新实际完成时间, 用于后续估算校准
   * Update with actual completion duration for future estimation calibration
   *
   * @param {string} dagId          - DAG 标识 / DAG identifier
   * @param {string} nodeId         - 节点标识 / Node identifier
   * @param {number} actualDuration - 实际工期 (ms) / Actual duration in ms
   */
  updateOnCompletion(dagId, nodeId, actualDuration) {
    if (!this._actualDurations.has(dagId)) {
      this._actualDurations.set(dagId, new Map());
    }
    this._actualDurations.get(dagId).set(nodeId, actualDuration);

    // 发布更新事件 / Publish update event
    this._bus?.emit?.('critical-path.updated', {
      dagId,
      nodeId,
      actualDuration,
    });

    // 发射 DIM_TASK 信号通知估算已更新
    // Emit DIM_TASK signal to notify estimation update
    this._field?.emit?.({
      dimension: DIM_TASK,
      scope:     dagId,
      strength:  0.4,
      metadata:  { type: 'duration.calibrated', nodeId, actualDuration },
    });
  }
}

export { BASE_DURATION, TREND_COEFFICIENTS, DEFAULT_DURATION };
export default CriticalPath;
