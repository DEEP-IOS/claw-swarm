/**
 * BaseStrategy — 基础策略 / Base Strategy — Abstract interface for execution backends.
 *
 * 所有具体策略必须继承此类并实现 execute() 方法。
 * 直接实例化会在运行时被阻止。
 *
 * All concrete strategies must extend this class and implement the
 * execute() method. Direct instantiation is prevented at runtime.
 *
 * [WHY] 从 v3.0 移植，更新类型导入路径以适应 v4.0 分层架构。
 * Ported from v3.0 with updated type import paths for the v4.0 layered architecture.
 *
 * @module orchestration/strategies/base-strategy
 * @author DEEP-IOS
 */

export class BaseStrategy {
  /**
   * @param {string} name - 人类可读的策略标识符 / Human-readable strategy identifier.
   */
  constructor(name) {
    this.name = name;
    if (new.target === BaseStrategy) {
      throw new Error('BaseStrategy is abstract and cannot be instantiated directly');
    }
  }

  /**
   * 执行角色的工作 / Execute a role's work.
   *
   * 具体策略覆盖此方法，在给定的执行上下文中为角色执行真实或模拟的工作。
   *
   * Concrete strategies override this method to perform real or simulated
   * work for the given role within the supplied execution context.
   *
   * @param {import('../../../layer1-core/types.js').Role} role - 要执行的角色 / The role to execute.
   * @param {string} prompt - 为角色构建的提示词 / Built prompt for the role.
   * @param {import('../../../layer1-core/types.js').ExecutionContext} context - 执行上下文 / Execution context.
   * @returns {Promise<import('../../../layer1-core/types.js').RoleResult>} 执行结果 / The result of execution.
   */
  async execute(role, prompt, context) {
    throw new Error(`Strategy "${this.name}" must implement execute()`);
  }

  /**
   * 策略显示名称 / Strategy display name.
   *
   * @returns {string}
   */
  toString() {
    return `Strategy<${this.name}>`;
  }
}
