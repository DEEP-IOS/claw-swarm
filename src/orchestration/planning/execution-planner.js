/**
 * ExecutionPlanner -- 执行计划生成器
 * Execution plan generator using Mixture-of-Experts scoring
 *
 * 根据用户意图将任务分解为 DAGNode 序列，使用 MoE 评分模型
 * 选择最佳执行角色，并结合信号场中的 SNA 和 Knowledge 信号
 * 进行智能规划。
 * Decomposes user intents into DAGNode sequences using a Mixture-of-Experts
 * scoring model to select optimal execution roles, augmented by SNA and
 * Knowledge signals from the signal field.
 *
 * @module orchestration/planning/execution-planner
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js';
import { DIM_TASK, DIM_SNA, DIM_KNOWLEDGE } from '../../core/field/types.js';

// ============================================================================
// MoE 专家权重 / MoE Expert Weights
// ============================================================================

/**
 * 混合专家评分权重
 * Mixture-of-Experts scoring weights
 */
const EXPERTS = {
  /** 关键词匹配专家 / Keyword matching expert */
  keyword:    { weight: 0.4 },
  /** 能力匹配专家 / Capability matching expert */
  capability: { weight: 0.3 },
  /** 历史表现专家 / Historical performance expert */
  history:    { weight: 0.3 },
};

// ============================================================================
// 阶段模板 / Phase Templates
// ============================================================================

/**
 * 按意图类型的执行阶段模板
 * Phase templates organized by intent type
 * @type {Record<string, Array<{phase: string, role: string, order: number, dependsOn?: string[]}>>}
 */
const PHASE_TEMPLATES = {
  bug_fix: [
    { phase: 'diagnose', role: 'researcher', order: 1 },
    { phase: 'fix',      role: 'debugger',   order: 2, dependsOn: ['diagnose'] },
    { phase: 'test',     role: 'tester',     order: 3, dependsOn: ['fix'] },
  ],
  new_feature: [
    { phase: 'research',  role: 'researcher',  order: 1 },
    { phase: 'plan',      role: 'planner',     order: 2, dependsOn: ['research'] },
    { phase: 'implement', role: 'implementer', order: 3, dependsOn: ['plan'] },
    { phase: 'review',    role: 'reviewer',    order: 4, dependsOn: ['implement'] },
  ],
  refactor: [
    { phase: 'analyze', role: 'analyst',     order: 1 },
    { phase: 'plan',    role: 'planner',     order: 2, dependsOn: ['analyze'] },
    { phase: 'execute', role: 'implementer', order: 3, dependsOn: ['plan'] },
    { phase: 'verify',  role: 'reviewer',    order: 4, dependsOn: ['execute'] },
  ],
  optimize: [
    { phase: 'profile',   role: 'analyst',     order: 1 },
    { phase: 'implement', role: 'implementer', order: 2, dependsOn: ['profile'] },
    { phase: 'benchmark', role: 'tester',      order: 3, dependsOn: ['implement'] },
  ],
  explore: [
    { phase: 'explore', role: 'researcher', order: 1 },
  ],
  question: [
    { phase: 'answer', role: 'consultant', order: 1 },
  ],
};

// ============================================================================
// 角色关键词映射 / Role Keyword Mappings
// ============================================================================

/**
 * 每个角色关联的关键词（用于 keyword expert 评分）
 * Keywords associated with each role (for keyword expert scoring)
 * @type {Record<string, string[]>}
 */
const ROLE_KEYWORDS = {
  researcher:  ['research', 'investigate', 'find', 'search', 'analyze', 'explore', 'discover', 'understand', 'study'],
  analyst:     ['analyze', 'profile', 'measure', 'evaluate', 'assess', 'diagnose', 'inspect', 'audit', 'metrics'],
  planner:     ['plan', 'design', 'architect', 'structure', 'organize', 'strategy', 'outline', 'roadmap'],
  implementer: ['implement', 'build', 'create', 'develop', 'code', 'write', 'construct', 'make', 'add'],
  debugger:    ['debug', 'fix', 'repair', 'resolve', 'patch', 'troubleshoot', 'diagnose', 'error', 'bug'],
  tester:      ['test', 'verify', 'validate', 'check', 'benchmark', 'assert', 'coverage', 'qa'],
  reviewer:    ['review', 'inspect', 'approve', 'feedback', 'critique', 'verify', 'quality'],
  consultant:  ['answer', 'explain', 'advise', 'recommend', 'guide', 'help', 'clarify', 'question'],
  coordinator: ['coordinate', 'manage', 'orchestrate', 'sync', 'delegate', 'schedule', 'assign'],
  librarian:   ['document', 'catalog', 'index', 'archive', 'store', 'retrieve', 'organize', 'knowledge'],
};

// ============================================================================
// ExecutionPlanner 类 / ExecutionPlanner Class
// ============================================================================

export class ExecutionPlanner extends ModuleBase {
  /**
   * @param {Object} deps
   * @param {Object} deps.field            - 信号场实例 / Signal field instance
   * @param {Object} deps.bus              - 事件总线实例 / Event bus instance
   * @param {Object} [deps.capabilityEngine] - 能力引擎 / Capability engine for scoring
   * @param {Object} [deps.hybridRetrieval]  - 混合检索引擎 / Hybrid retrieval engine
   */
  constructor({ field, bus, capabilityEngine, hybridRetrieval } = {}) {
    super();
    /** @type {Object} */
    this._field = field;
    /** @type {Object} */
    this._bus = bus;
    /** @type {Object|null} */
    this._capabilityEngine = capabilityEngine ?? null;
    /** @type {Object|null} */
    this._hybridRetrieval = hybridRetrieval ?? null;
  }

  // --------------------------------------------------------------------------
  // 静态声明 / Static Declarations
  // --------------------------------------------------------------------------

  /** @returns {string[]} 产生的信号维度 / Signal dimensions produced */
  static produces() { return [DIM_TASK]; }

  /** @returns {string[]} 消费的信号维度 / Signal dimensions consumed */
  static consumes() { return [DIM_SNA, DIM_KNOWLEDGE, DIM_TASK]; }

  /** @returns {string[]} 发布的事件主题 / Event topics published */
  static publishes() { return ['plan.created']; }

  /** @returns {string[]} 订阅的事件主题 / Event topics subscribed */
  static subscribes() { return ['intent.classified']; }

  // --------------------------------------------------------------------------
  // 核心方法 / Core Methods
  // --------------------------------------------------------------------------

  /**
   * 将用户意图分解为 DAGNode 序列
   * Decompose a user intent into a sequence of DAGNode definitions
   *
   * @param {Object} userIntent - 用户意图分类结果 / Classified user intent
   * @param {string} userIntent.primary      - 主意图类型 / Primary intent type (e.g. 'bug_fix')
   * @param {string} userIntent.description  - 意图描述 / Intent description
   * @param {string} [userIntent.secondary]  - 次要意图 / Secondary intent
   * @param {Object} scopeEstimate - 范围评估 / Scope estimation
   * @param {string} [scopeEstimate.complexity] - 复杂度 ('low'|'medium'|'high')
   * @param {Object} [context] - 附加上下文 / Additional context
   * @returns {Array<{id: string, taskId: string, role: string, dependsOn: string[]}>} DAGNode 定义 / DAGNode definitions
   */
  decompose(userIntent, scopeEstimate, context = {}) {
    const intentType = userIntent.primary;
    const template = PHASE_TEMPLATES[intentType] ?? PHASE_TEMPLATES.explore;
    const description = userIntent.description ?? '';

    // 读取 DIM_KNOWLEDGE 信号判断是否跳过 research 阶段
    // Read DIM_KNOWLEDGE to determine if research phase can be skipped
    let skipResearch = false;
    if (this._field?.read) {
      const knowledgeSignals = this._field.read({
        dimension: DIM_KNOWLEDGE,
        minStrength: 0.7,
        limit: 5,
      });
      if (knowledgeSignals && knowledgeSignals.length > 0) {
        skipResearch = true;
      }
    }

    // 读取 DIM_SNA 信号为搭档推荐做准备
    // Read DIM_SNA for partner recommendation
    let snaContext = null;
    if (this._field?.read) {
      const snaSignals = this._field.read({
        dimension: DIM_SNA,
        limit: 10,
      });
      if (snaSignals && snaSignals.length > 0) {
        snaContext = snaSignals;
      }
    }

    // 构建 DAGNode 列表 / Build DAGNode list
    const nodes = [];
    let nodeIndex = 0;

    for (const step of template) {
      // 如果知识充足, 跳过 research/explore 阶段
      // Skip research/explore phase if knowledge is sufficient
      if (skipResearch && (step.phase === 'research' || step.phase === 'explore')) {
        continue;
      }

      const nodeId = `${intentType}-${step.phase}-${nodeIndex}`;
      nodeIndex += 1;

      // MoE 评分选最佳角色 / MoE scoring for best role
      const taskDesc = `${step.phase}: ${description}`;
      const candidateRoles = this._getCandidateRoles(step.role);
      const bestRole = this.selectBestRole(
        { description: taskDesc, phase: step.phase },
        candidateRoles,
      );

      // 解析依赖: 将模板阶段名映射到实际 nodeId
      // Resolve dependencies: map template phase names to actual nodeIds
      const dependsOn = (step.dependsOn ?? [])
        .map(depPhase => {
          const depNode = nodes.find(n => n._phase === depPhase);
          return depNode?.id;
        })
        .filter(Boolean);

      nodes.push({
        id:        nodeId,
        taskId:    taskDesc,
        role:      bestRole.roleId,
        dependsOn,
        _phase:    step.phase, // 内部用, 创建 DAG 前删除 / Internal use, removed before DAG creation
      });
    }

    // 移除内部 _phase 字段 / Remove internal _phase field
    const result = nodes.map(({ _phase, ...rest }) => rest);

    // 发射 DIM_TASK 信号 / Emit plan signal
    this._field?.emit?.({
      dimension: DIM_TASK,
      scope:     intentType,
      strength:  0.7,
      metadata:  { type: 'plan.created', nodeCount: result.length },
    });

    // 发布事件 / Publish event
    this._bus?.emit?.('plan.created', {
      intentType,
      nodeCount: result.length,
      nodes: result,
    });

    return result;
  }

  /**
   * MoE 评分 -- 对单个任务-角色组合打分
   * MoE scoring for a single task-role combination
   *
   * @param {Object} task           - 任务对象 / Task object
   * @param {string} task.description - 任务描述 / Task description
   * @param {string} roleId         - 角色标识 / Role identifier
   * @returns {number} 综合评分 [0, 1] / Combined score [0, 1]
   */
  _scoreRole(task, roleId) {
    const description = (task.description ?? '').toLowerCase();

    // Expert 1: 关键词匹配 / Keyword matching
    const keywords = ROLE_KEYWORDS[roleId] ?? [];
    const keywordHits = keywords.filter(kw => description.includes(kw)).length;
    const keywordScore = keywords.length > 0
      ? Math.min(keywordHits / Math.max(keywords.length * 0.3, 1), 1.0)
      : 0;

    // Expert 2: 能力匹配 / Capability matching
    let capabilityScore = 0.5; // 默认中等 / Default medium
    if (this._capabilityEngine?.scoreRole) {
      try {
        capabilityScore = this._capabilityEngine.scoreRole(roleId, task);
      } catch {
        capabilityScore = 0.5;
      }
    }

    // Expert 3: 历史表现 / Historical performance
    let historyScore = 0.5; // 默认中等 / Default medium
    if (this._hybridRetrieval?.getRolePerformance) {
      try {
        historyScore = this._hybridRetrieval.getRolePerformance(roleId, task);
      } catch {
        historyScore = 0.5;
      }
    }

    // 加权求和 / Weighted sum
    const score =
      EXPERTS.keyword.weight    * keywordScore +
      EXPERTS.capability.weight * capabilityScore +
      EXPERTS.history.weight    * historyScore;

    return Math.min(Math.max(score, 0), 1);
  }

  /**
   * 选择最佳角色 -- 在候选角色中选评分最高者
   * Select the best role from candidates via MoE scoring
   *
   * @param {Object}   task            - 任务对象 / Task object
   * @param {string}   task.description - 任务描述 / Task description
   * @param {string[]} candidateRoles  - 候选角色 ID 列表 / Candidate role IDs
   * @returns {{roleId: string, score: number, reasons: string[]}} 最佳角色和原因 / Best role with reasons
   */
  selectBestRole(task, candidateRoles) {
    if (!candidateRoles || candidateRoles.length === 0) {
      return { roleId: 'researcher', score: 0, reasons: ['no candidates, fallback'] };
    }

    let bestRole = candidateRoles[0];
    let bestScore = -1;
    const scoreMap = new Map();

    for (const roleId of candidateRoles) {
      const score = this._scoreRole(task, roleId);
      scoreMap.set(roleId, score);
      if (score > bestScore) {
        bestScore = score;
        bestRole = roleId;
      }
    }

    // 构建选择理由 / Build selection reasons
    const reasons = [];
    const description = (task.description ?? '').toLowerCase();
    const keywords = ROLE_KEYWORDS[bestRole] ?? [];
    const matchedKW = keywords.filter(kw => description.includes(kw));
    if (matchedKW.length > 0) {
      reasons.push(`keyword matches: ${matchedKW.join(', ')}`);
    }
    if (bestScore >= 0.7) {
      reasons.push('high confidence score');
    }
    if (reasons.length === 0) {
      reasons.push('best available candidate');
    }

    return { roleId: bestRole, score: bestScore, reasons };
  }

  /**
   * 自适应调整已有计划
   * Adapt an existing plan based on new context
   *
   * @param {Array<{id: string, taskId: string, role: string, dependsOn: string[]}>} existingNodes - 现有节点 / Existing nodes
   * @param {Object} newContext - 新上下文信息 / New context information
   * @param {string} [newContext.reason]       - 调整原因 / Reason for adaptation
   * @param {string} [newContext.failedNodeId] - 失败的节点 ID / Failed node ID
   * @param {Object} [newContext.additionalInfo] - 额外信息 / Additional info
   * @returns {Array<{id: string, taskId: string, role: string, dependsOn: string[]}>} 调整后的节点 / Adapted nodes
   */
  adaptPlan(existingNodes, newContext) {
    if (!existingNodes || existingNodes.length === 0) return [];

    const adapted = existingNodes.map(node => ({ ...node }));

    // 如果有失败节点, 在其后插入诊断步骤
    // If a node failed, insert a diagnostic step after it
    if (newContext.failedNodeId) {
      const failedIdx = adapted.findIndex(n => n.id === newContext.failedNodeId);
      if (failedIdx !== -1) {
        const failedNode = adapted[failedIdx];
        const diagNode = {
          id:        `adapt-diagnose-${Date.now()}`,
          taskId:    `diagnose failure in: ${failedNode.taskId}`,
          role:      'debugger',
          dependsOn: [failedNode.id],
        };

        // 将诊断节点插入到失败节点之后
        // Insert diagnostic node after the failed node
        adapted.splice(failedIdx + 1, 0, diagNode);

        // 更新后续节点的依赖, 使其也依赖诊断节点
        // Update downstream dependencies to also depend on diagnostic node
        for (let i = failedIdx + 2; i < adapted.length; i++) {
          if (adapted[i].dependsOn.includes(failedNode.id)) {
            adapted[i].dependsOn.push(diagNode.id);
          }
        }
      }
    }

    return adapted;
  }

  // --------------------------------------------------------------------------
  // 内部方法 / Internal Methods
  // --------------------------------------------------------------------------

  /**
   * 获取候选角色列表 -- 包含默认角色和相关角色
   * Get candidate role list including default and related roles
   *
   * @param {string} defaultRole - 模板默认角色 / Template default role
   * @returns {string[]} 候选角色列表 / Candidate role list
   * @private
   */
  _getCandidateRoles(defaultRole) {
    // 默认角色始终排第一 / Default role always first
    const candidates = [defaultRole];

    // 根据角色类型添加相关候选 / Add related candidates by role type
    const relatedMap = {
      researcher:  ['analyst'],
      analyst:     ['researcher'],
      planner:     ['coordinator'],
      implementer: ['debugger'],
      debugger:    ['implementer'],
      tester:      ['reviewer'],
      reviewer:    ['tester'],
      consultant:  ['researcher'],
      coordinator: ['planner'],
      librarian:   ['researcher'],
    };

    const related = relatedMap[defaultRole] ?? [];
    for (const r of related) {
      if (!candidates.includes(r)) candidates.push(r);
    }

    return candidates;
  }
}

export { EXPERTS, PHASE_TEMPLATES, ROLE_KEYWORDS };
export default ExecutionPlanner;
