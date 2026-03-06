/**
 * TaskDistributor — 任务分发器 / Task Distributor
 *
 * 基于策略的工作分发。构建丰富的、角色感知的提示词，
 * 并将执行委托给可插拔的策略实例。
 *
 * Strategy-based work distribution. Builds rich, role-aware prompts and
 * delegates execution to a pluggable strategy instance.
 *
 * [WHY] 从 v3.0 移植，更新导入路径以适应 v4.0 分层架构。
 * 业务逻辑保持不变。
 * Ported from v3.0 with updated import paths for the v4.0 layered
 * architecture. Business logic unchanged.
 *
 * @module orchestration/task-distributor
 * @author DEEP-IOS
 */

import { StrategyType } from '../../layer1-core/types.js';
import { SwarmValidationError } from '../../layer1-core/errors.js';

// ---------------------------------------------------------------------------
// 角色特定交付物 / Role-Specific Deliverables
// ---------------------------------------------------------------------------

/**
 * 将角色名称映射到其预期交付物列表。用于向每个角色的提示词
 * 追加具体的输出期望。
 *
 * Maps role names to their expected deliverable lists. Used to append
 * concrete output expectations to each role's prompt.
 *
 * @type {Record<string, string[]>}
 */
const ROLE_DELIVERABLES = {
  Architect: [
    'Architecture diagram',
    'Component structure',
    'API design',
    'Data model',
  ],
  FrontendDev: [
    'React components',
    'CSS / styling',
    'Unit tests',
    'Usage README',
  ],
  BackendDev: [
    'API routes',
    'Database schema',
    'Middleware',
    'API documentation',
  ],
  QATester: [
    'Test plan',
    'Unit tests',
    'Integration tests',
    'Bug report',
  ],
  DevOpsEngineer: [
    'Dockerfile',
    'CI/CD pipeline',
    'Deployment scripts',
  ],
  SecurityAnalyst: [
    'Security audit',
    'Vulnerability assessment',
    'Compliance report',
  ],
  DataAnalyst: [
    'Data analysis report',
    'Visualizations',
    'Recommendations',
  ],
  TechnicalWriter: [
    'Documentation',
    'User guide',
    'API reference',
  ],
};

/** 角色名称不匹配已知集合时的默认交付物
 *  Default deliverables when the role name does not match a known set. */
const DEFAULT_DELIVERABLES = [
  'Complete assigned work',
  'Documentation',
  'Test results',
];

// ---------------------------------------------------------------------------
// TaskDistributor 类 / TaskDistributor Class
// ---------------------------------------------------------------------------

/**
 * 通过可配置的执行策略分发工作给角色。
 *
 * Distributes work to roles via a configurable execution strategy.
 *
 * 分发器负责：/ The distributor is responsible for:
 *  - 为每个角色构建丰富的上下文感知提示词 / Building a rich, context-aware prompt
 *  - 将执行委托给活跃策略 / Delegating execution to the active strategy
 *  - 允许运行时策略切换 / Allowing runtime strategy swaps
 */
export class TaskDistributor {
  /**
   * 创建新的 TaskDistributor / Create a new TaskDistributor.
   *
   * @param {Object} strategy - 执行策略实例，必须公开 execute(role, prompt, context) 方法
   *   Execution strategy instance. Must expose an execute(role, prompt, context) method.
   * @throws {SwarmValidationError} 如果策略缺失或无效 / If the strategy is missing or invalid.
   */
  constructor(strategy) {
    this._validateStrategy(strategy);

    /** @type {Object} */
    this.strategy = strategy;
  }

  // -----------------------------------------------------------------------
  // 公共 API / Public API
  // -----------------------------------------------------------------------

  /**
   * 分发工作给单个角色 / Distribute work to a single role.
   *
   * 1. 构建角色特定提示词 / Build the role-specific prompt
   * 2. 委托给策略的 execute 方法 / Delegate to the strategy's execute method
   * 3. 返回角色结果 / Return the resulting RoleResult
   *
   * @param {import('../../layer1-core/types.js').Role} role    - 要执行的角色 / The role to execute.
   * @param {import('../../layer1-core/types.js').ExecutionContext} context - 执行上下文 / Execution context.
   * @returns {Promise<import('../../layer1-core/types.js').RoleResult>} 角色的结果 / The role's result.
   */
  async distribute(role, context) {
    const prompt = this.buildRolePrompt(role, context);
    const result = await this.strategy.execute(role, prompt, context);
    return result;
  }

  /**
   * 构建丰富的角色感知提示词，包含任务上下文、指令和角色特定交付物。
   *
   * Build a rich, role-aware prompt that includes task context, instructions,
   * and role-specific deliverables.
   *
   * @param {import('../../layer1-core/types.js').Role} role    - 目标角色 / The target role.
   * @param {import('../../layer1-core/types.js').ExecutionContext} context - 执行上下文 / Execution context.
   * @returns {string} 组装好的提示词字符串 / The assembled prompt string.
   */
  buildRolePrompt(role, context) {
    const description = context.taskConfig?.description || 'Complete assigned task';

    // --- 基础提示词 / Base prompt ---
    const sections = [
      `You are ${role.name}, ${role.description}.`,
      '',
      'Task Context:',
      `- Task ID: ${context.taskId}`,
      `- Your Role: ${role.name}`,
      `- Capabilities: ${role.capabilities.join(', ')}`,
      '',
      'Instructions:',
      '1. Focus on your specific responsibilities',
      '2. Coordinate with other roles through shared workspace',
      '3. Produce concrete, actionable outputs',
      '4. Save checkpoints regularly',
      '',
      'Work to complete:',
      description,
    ];

    // --- 角色特定交付物 / Role-specific deliverables ---
    const deliverables = ROLE_DELIVERABLES[role.name] || DEFAULT_DELIVERABLES;
    sections.push('');
    sections.push('Expected Deliverables:');
    for (const item of deliverables) {
      sections.push(`- ${item}`);
    }

    // --- 自定义提示词覆盖 / Custom prompt override ---
    if (role.customPrompt) {
      sections.push('');
      sections.push('Additional Instructions:');
      sections.push(role.customPrompt);
    }

    return sections.join('\n');
  }

  /**
   * 运行时替换活跃执行策略 / Replace the active execution strategy at runtime.
   *
   * @param {Object} strategy - 新策略实例 / New strategy instance.
   * @throws {SwarmValidationError} 如果策略缺失或无效 / If the strategy is missing or invalid.
   */
  setStrategy(strategy) {
    this._validateStrategy(strategy);
    this.strategy = strategy;
  }

  /**
   * 返回当前活跃策略的名称 / Return the name of the currently active strategy.
   *
   * @returns {string} 策略名称，未设置时返回 'unknown' / Strategy name, or 'unknown' if not set.
   */
  getStrategyName() {
    return this.strategy?.name || 'unknown';
  }

  // -----------------------------------------------------------------------
  // 内部辅助方法 / Internal Helpers
  // -----------------------------------------------------------------------

  /**
   * 验证策略对象是否具有必需的 execute 方法。
   * Validate that a strategy object has the required execute method.
   *
   * @param {any} strategy
   * @throws {SwarmValidationError}
   * @private
   */
  _validateStrategy(strategy) {
    if (!strategy || typeof strategy.execute !== 'function') {
      throw new SwarmValidationError(
        'Strategy must be an object with an "execute" method',
        { context: { strategy } },
      );
    }
  }
}
