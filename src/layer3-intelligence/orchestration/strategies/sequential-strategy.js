/**
 * SequentialStrategy — 顺序策略 / Sequential Strategy — Single-threaded execution with timeout protection.
 *
 * 每个角色依次运行。Promise.race 守卫确保单个角色不会超过配置的超时时间。
 *
 * Each role runs one at a time. A Promise.race guard ensures that no
 * single role can exceed the configured timeout.
 *
 * [WHY] 从 v3.0 移植，更新导入路径以适应 v4.0 分层架构。
 * Ported from v3.0 with updated import paths for the v4.0 layered architecture.
 *
 * @module orchestration/strategies/sequential-strategy
 * @author DEEP-IOS
 */

import { BaseStrategy } from './base-strategy.js';
import { SwarmTimeoutError } from '../../../layer1-core/errors.js';

export class SequentialStrategy extends BaseStrategy {
  /**
   * @param {Object} [options={}] - 策略选项 / Strategy options.
   * @param {number} [options.defaultTimeout=300000] - 每角色默认超时（毫秒）/ Default per-role timeout in ms.
   */
  constructor(options = {}) {
    super('sequential');

    /** @type {Object} */
    this.options = options;
  }

  /**
   * 带超时保护的角色执行 / Execute a role with timeout protection.
   *
   * 使用 Promise.race，让工作 Promise 和超时 Promise 竞争 — 先解决的获胜。
   *
   * Uses Promise.race so that the work promise and a timeout promise
   * compete — whichever settles first wins.
   *
   * @param {import('../../../layer1-core/types.js').Role} role - 要执行的角色 / The role to execute.
   * @param {string} prompt - 为角色构建的提示词 / Built prompt for the role.
   * @param {import('../../../layer1-core/types.js').ExecutionContext} context - 执行上下文 / Execution context.
   * @returns {Promise<import('../../../layer1-core/types.js').RoleResult>}
   * @throws {SwarmTimeoutError} 如果执行超过超时时间 / If execution exceeds the timeout.
   */
  async execute(role, prompt, context) {
    const timeout = context.timeout || this.options.defaultTimeout || 300000;

    const result = await Promise.race([
      this._executeWork(role, prompt, context),
      this._createTimeout(timeout, role.name),
    ]);

    return result;
  }

  /**
   * 将角色工作格式化为结构化的任务对象。
   *
   * Format role work as a structured task object.
   *
   * 表示单个顺序代理将产生的输出：提示词、交付物和制品的 JSON 编码摘要。
   *
   * Represents the output a single sequential agent would produce: a
   * JSON-encoded summary of the prompt, deliverables, and artifacts.
   *
   * @param {import('../../../layer1-core/types.js').Role} role
   * @param {string} prompt
   * @param {import('../../../layer1-core/types.js').ExecutionContext} context
   * @returns {Promise<import('../../../layer1-core/types.js').RoleResult>}
   * @private
   */
  async _executeWork(role, prompt, context) {
    const start = Date.now();

    const taskObject = {
      prompt,
      deliverables: role.capabilities || [],
      artifacts: (role.capabilities || []).map((cap) => `${cap}-output.md`),
      context: {
        taskId: context.taskId,
        priority: role.priority,
        dependencies: role.dependencies || [],
      },
    };

    const duration = Date.now() - start;

    return {
      role: role.name,
      status: 'completed',
      output: JSON.stringify(taskObject, null, 2),
      artifacts: taskObject.artifacts,
      duration,
    };
  }

  /**
   * 创建在指定持续时间后拒绝的超时 Promise。
   *
   * Create a timeout promise that rejects after the given duration.
   *
   * 内部计时器在 Promise 解决时被清除，以便不阻止 Node.js 进程退出（无内存泄漏）。
   *
   * The internal timer is cleared when the promise settles so that it
   * does not prevent the Node.js process from exiting (no memory leak).
   *
   * @param {number} ms - 超时持续时间（毫秒）/ Timeout duration in milliseconds.
   * @param {string} roleName - 错误消息中的角色名称 / Role name for the error message.
   * @returns {Promise<never>} 始终拒绝的 Promise / A promise that always rejects.
   * @private
   */
  _createTimeout(ms, roleName) {
    return new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(
          new SwarmTimeoutError(
            `Role "${roleName}" exceeded timeout of ${ms}ms`,
            { timeoutMs: ms, context: { role: roleName } },
          ),
        );
      }, ms);

      // 允许 Node.js 进程退出，即使此计时器仍在等待
      // Allow the Node.js process to exit even if this timer is still pending.
      if (typeof timer === 'object' && typeof timer.unref === 'function') {
        timer.unref();
      }
    });
  }
}
