/**
 * SimulatedStrategy — 模拟策略 / Simulated Strategy — Mock execution backend for testing.
 *
 * 生成确定性的、逼真的输出，无需调用任何外部服务。
 * 延迟按角色优先级缩放，以便高优先级角色稍快完成。
 *
 * Produces deterministic, realistic output without calling any external
 * service. Delay is scaled by role priority so higher-priority roles
 * complete slightly faster.
 *
 * [WHY] 从 v3.0 移植，更新导入路径以适应 v4.0 分层架构。
 * Ported from v3.0 with updated import paths for the v4.0 layered architecture.
 *
 * @module orchestration/strategies/simulated-strategy
 * @author DEEP-IOS
 */

import { BaseStrategy } from './base-strategy.js';

export class SimulatedStrategy extends BaseStrategy {
  constructor() {
    super('simulated');
  }

  /**
   * 模拟角色执行 / Simulate role execution.
   *
   * 等待短暂延迟（50-200 毫秒，按角色优先级缩放），然后返回合成的 RoleResult。
   *
   * Waits a short delay (50-200 ms scaled by role priority), then returns
   * a synthetic RoleResult.
   *
   * @param {import('../../../layer1-core/types.js').Role} role - 要执行的角色 / The role to execute.
   * @param {string} prompt - 为角色构建的提示词 / Built prompt for the role.
   * @param {import('../../../layer1-core/types.js').ExecutionContext} context - 执行上下文 / Execution context.
   * @returns {Promise<import('../../../layer1-core/types.js').RoleResult>}
   */
  async execute(role, prompt, context) {
    const start = Date.now();

    // 优先级越高（数值越小）= 延迟越短
    // Higher priority (lower number) = shorter delay.
    // priority 1 -> ~50 ms, priority 5 -> ~200 ms
    const delay = Math.min(200, 50 + (role.priority || 1) * 30);
    await new Promise((resolve) => setTimeout(resolve, delay));

    const duration = Date.now() - start;

    return {
      role: role.name,
      status: 'completed',
      output: `Simulated output for ${role.name}: ${role.description}`,
      artifacts: this._generateArtifacts(role.name),
      duration,
    };
  }

  /**
   * 根据角色名称生成逼真的制品列表 / Generate a realistic artifact list based on the role name.
   *
   * @param {string} roleName - 用于选择制品集的角色名称 / Role name used to pick the artifact set.
   * @returns {string[]} 制品文件路径/名称数组 / Array of artifact file paths / names.
   * @private
   */
  _generateArtifacts(roleName) {
    /** @type {Record<string, string[]>} */
    const artifactMap = {
      Architect: ['architecture.md', 'api-spec.yaml', 'data-model.md'],
      FrontendDev: ['App.jsx', 'App.css', 'components/index.js'],
      BackendDev: ['server.js', 'routes/api.js', 'models/schema.js'],
      QATester: ['test-plan.md', 'test-results.json'],
      DevOpsEngineer: ['Dockerfile', 'docker-compose.yml', 'deploy.sh'],
      SecurityAnalyst: ['security-audit.md', 'vulnerability-report.md'],
      DataAnalyst: ['analysis-report.md', 'visualizations/'],
      TechnicalWriter: ['README.md', 'API-docs.md', 'user-guide.md'],
    };

    return artifactMap[roleName] || ['output.md'];
  }
}
