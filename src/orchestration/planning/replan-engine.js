/**
 * ReplanEngine -- 重规划引擎
 * Re-planning engine for failure recovery strategies
 *
 * 当 DAG 节点失败时，根据失败分类自动选择恢复策略：
 * 同角色重试、升级模型、换角色、拆分任务或中止并报告。
 * 结合 DIM_ALARM 和 DIM_LEARNING 信号做出决策。
 * When DAG nodes fail, automatically selects recovery strategies based
 * on failure classification: retry, escalate model, change role,
 * split task, or abort with report. Decisions are informed by
 * DIM_ALARM and DIM_LEARNING signals.
 *
 * @module orchestration/planning/replan-engine
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js';
import { DIM_COORDINATION, DIM_ALARM, DIM_LEARNING } from '../../core/field/types.js';

// ============================================================================
// 重规划策略 / Replan Strategies
// ============================================================================

/**
 * 可用恢复策略定义
 * Available recovery strategy definitions
 *
 * @type {Record<string, {name: string, cost: string, condition: string}>}
 */
const STRATEGIES = {
  RETRY_SAME_ROLE: {
    name: '同角色重试',
    cost: 'low',
    condition: 'transient_failure',
  },
  ESCALATE_MODEL: {
    name: '升级模型',
    cost: 'medium',
    condition: 'capability_insufficient',
  },
  CHANGE_ROLE: {
    name: '换角色',
    cost: 'medium',
    condition: 'wrong_approach',
  },
  SPLIT_TASK: {
    name: '拆分任务',
    cost: 'high',
    condition: 'task_too_complex',
  },
  ABORT_WITH_REPORT: {
    name: '中止并报告',
    cost: 'zero',
    condition: 'unrecoverable',
  },
};

/**
 * 失败类型到策略的映射
 * Failure type to strategy mapping
 * @type {Record<string, string>}
 */
const FAILURE_STRATEGY_MAP = {
  transient_failure:       'RETRY_SAME_ROLE',
  timeout:                 'RETRY_SAME_ROLE',
  rate_limit:              'RETRY_SAME_ROLE',
  capability_insufficient: 'ESCALATE_MODEL',
  model_limit:             'ESCALATE_MODEL',
  wrong_approach:          'CHANGE_ROLE',
  role_mismatch:           'CHANGE_ROLE',
  task_too_complex:        'SPLIT_TASK',
  scope_overflow:          'SPLIT_TASK',
  unrecoverable:           'ABORT_WITH_REPORT',
  permission_denied:       'ABORT_WITH_REPORT',
  resource_exhausted:      'ABORT_WITH_REPORT',
};

/**
 * 角色替换映射 -- CHANGE_ROLE 策略使用
 * Role substitution map for CHANGE_ROLE strategy
 * @type {Record<string, string>}
 */
const ROLE_ALTERNATIVES = {
  researcher:  'analyst',
  analyst:     'researcher',
  implementer: 'debugger',
  debugger:    'implementer',
  tester:      'reviewer',
  reviewer:    'tester',
  planner:     'coordinator',
  coordinator: 'planner',
  consultant:  'researcher',
  librarian:   'consultant',
};

// ============================================================================
// ReplanEngine 类 / ReplanEngine Class
// ============================================================================

export class ReplanEngine extends ModuleBase {
  /**
   * @param {Object} deps
   * @param {Object} deps.field     - 信号场实例 / Signal field instance
   * @param {Object} deps.bus       - 事件总线实例 / Event bus instance
   * @param {Object} deps.dagEngine - DAGEngine 实例 / DAGEngine instance
   */
  constructor({ field, bus, dagEngine } = {}) {
    super();
    /** @type {Object} */
    this._field = field;
    /** @type {Object} */
    this._bus = bus;
    /** @type {Object} */
    this._dagEngine = dagEngine;
  }

  // --------------------------------------------------------------------------
  // 静态声明 / Static Declarations
  // --------------------------------------------------------------------------

  /** @returns {string[]} 产生的信号维度 / Signal dimensions produced */
  static produces() { return [DIM_COORDINATION]; }

  /** @returns {string[]} 消费的信号维度 / Signal dimensions consumed */
  static consumes() { return [DIM_ALARM, DIM_LEARNING]; }

  /** @returns {string[]} 发布的事件主题 / Event topics published */
  static publishes() { return ['replan.triggered', 'replan.strategy.selected']; }

  /** @returns {string[]} 订阅的事件主题 / Event topics subscribed */
  static subscribes() { return ['dag.phase.failed', 'failure.classified']; }

  // --------------------------------------------------------------------------
  // 核心方法 / Core Methods
  // --------------------------------------------------------------------------

  /**
   * 根据失败分类选择恢复策略
   * Select a recovery strategy based on failure classification
   *
   * @param {Object} failureClassification - 失败分类结果 / Failure classification result
   * @param {string} failureClassification.type     - 失败类型 / Failure type
   * @param {string} [failureClassification.message] - 错误消息 / Error message
   * @param {number} [failureClassification.severity] - 严重程度 [0,1] / Severity [0,1]
   * @param {string} dagId  - DAG 标识 / DAG identifier
   * @param {string} nodeId - 节点标识 / Node identifier
   * @returns {{strategyKey: string, strategy: Object, reason: string}} 选中的策略 / Selected strategy
   */
  selectStrategy(failureClassification, dagId, nodeId) {
    const failType = failureClassification.type ?? 'unrecoverable';

    // 读取 DIM_ALARM 信号判断系统整体健康度
    // Read DIM_ALARM to assess overall system health
    let systemAlarmLevel = 0;
    if (this._field?.read) {
      const alarmSignals = this._field.read({
        dimension: DIM_ALARM,
        limit: 10,
      });
      if (alarmSignals && alarmSignals.length > 0) {
        systemAlarmLevel = alarmSignals.reduce(
          (sum, s) => sum + (s.strength ?? 0), 0
        ) / alarmSignals.length;
      }
    }

    // 读取 DIM_LEARNING 信号判断历史修复成功率
    // Read DIM_LEARNING to assess historical fix success rate
    let learningInsight = null;
    if (this._field?.read) {
      const learningSignals = this._field.read({
        dimension: DIM_LEARNING,
        scope: nodeId,
        limit: 5,
      });
      if (learningSignals && learningSignals.length > 0) {
        learningInsight = learningSignals[0]?.metadata;
      }
    }

    // 基于失败类型选策略 / Select strategy based on failure type
    let strategyKey = FAILURE_STRATEGY_MAP[failType] ?? 'ABORT_WITH_REPORT';

    // 如果系统告警过高, 降级为 ABORT / Downgrade to ABORT if system alarm too high
    if (systemAlarmLevel > 0.8 && strategyKey !== 'ABORT_WITH_REPORT') {
      strategyKey = 'ABORT_WITH_REPORT';
    }

    // 如果学习信号表明重试无效, 升级策略
    // Escalate strategy if learning signals indicate retries are futile
    if (learningInsight?.trend === 'declining' && strategyKey === 'RETRY_SAME_ROLE') {
      strategyKey = 'ESCALATE_MODEL';
    }

    const strategy = STRATEGIES[strategyKey];
    const reason = `failure type "${failType}" -> ${strategy.name}` +
      (systemAlarmLevel > 0 ? ` (alarm level: ${systemAlarmLevel.toFixed(2)})` : '');

    // 发布策略选择事件 / Publish strategy selection event
    this._bus?.emit?.('replan.strategy.selected', {
      dagId,
      nodeId,
      strategyKey,
      strategy,
      reason,
    });

    return { strategyKey, strategy, reason };
  }

  /**
   * 执行选定的恢复策略
   * Execute the selected recovery strategy
   *
   * @param {string} strategyKey - 策略键名 / Strategy key
   * @param {string} dagId       - DAG 标识 / DAG identifier
   * @param {string} nodeId      - 节点标识 / Node identifier
   * @returns {{success: boolean, action: string, details?: object}} 执行结果 / Execution result
   */
  execute(strategyKey, dagId, nodeId) {
    this._bus?.emit?.('replan.triggered', { dagId, nodeId, strategyKey });

    // 发射 DIM_COORDINATION 信号 / Emit coordination signal
    this._field?.emit?.({
      dimension: DIM_COORDINATION,
      scope:     dagId,
      strength:  0.7,
      metadata:  { type: 'replan', nodeId, strategyKey },
    });

    const node = this._dagEngine.getNodeStatus(dagId, nodeId);

    switch (strategyKey) {
      case 'RETRY_SAME_ROLE': {
        // 重置为 PENDING, 保留原角色 / Reset to PENDING, keep original role
        this._dagEngine.failNode(dagId, nodeId, 'replan: retry');
        return {
          success: true,
          action:  'reset_to_pending',
          details: { role: node.role, retries: node.retries },
        };
      }

      case 'ESCALATE_MODEL': {
        // 重置为 PENDING + 附加 modelOverride 元数据
        // Reset to PENDING with modelOverride metadata
        this._dagEngine.failNode(dagId, nodeId, 'replan: escalate model');
        return {
          success: true,
          action:  'escalate_model',
          details: { modelOverride: 'strong', previousRole: node.role },
        };
      }

      case 'CHANGE_ROLE': {
        // 选择替代角色 / Select alternative role
        const altRole = ROLE_ALTERNATIVES[node.role] ?? 'researcher';
        this._dagEngine.failNode(dagId, nodeId, `replan: change role to ${altRole}`);
        return {
          success: true,
          action:  'change_role',
          details: { previousRole: node.role, newRole: altRole },
        };
      }

      case 'SPLIT_TASK': {
        // 将任务拆分为 2 个子节点 / Split task into 2 sub-nodes
        const subNode1Id = `${nodeId}-sub-a`;
        const subNode2Id = `${nodeId}-sub-b`;
        const subNodes = [
          {
            id:        subNode1Id,
            taskId:    `${node.taskId} (part 1: analysis)`,
            role:      'analyst',
            dependsOn: node.dependsOn ?? [],
          },
          {
            id:        subNode2Id,
            taskId:    `${node.taskId} (part 2: execution)`,
            role:      node.role,
            dependsOn: [subNode1Id],
          },
        ];
        return {
          success: true,
          action:  'split_task',
          details: { originalNodeId: nodeId, subNodes },
        };
      }

      case 'ABORT_WITH_REPORT': {
        // 将节点标记为死信 / Mark node as dead letter
        // failNode will handle DLQ if retries exhausted, otherwise force it
        return {
          success: true,
          action:  'abort',
          details: {
            nodeId,
            role:   node.role,
            taskId: node.taskId,
            reason: 'unrecoverable failure, sent to dead-letter queue',
          },
        };
      }

      default:
        return {
          success: false,
          action:  'unknown_strategy',
          details: { strategyKey },
        };
    }
  }
}

export { STRATEGIES, FAILURE_STRATEGY_MAP, ROLE_ALTERNATIVES };
export default ReplanEngine;
