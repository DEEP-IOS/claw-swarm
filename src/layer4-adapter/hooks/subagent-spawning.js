/**
 * subagent_spawning Hook — 子代理生成前钩子 / Subagent Spawning Hook
 *
 * 治理门控：检查 Agent 是否有权限生成子代理。
 * Governance gate: checks if the agent has permission to spawn subagents.
 *
 * [WHY] 未经检查的子代理生成可能导致资源耗尽（fork bomb 式的级联生成）。
 * 通过 tier-based 限制和 governance 检查来防止这种情况。
 *
 * Unchecked subagent spawning could lead to resource exhaustion
 * (fork-bomb style cascading spawns). Prevented via tier-based limits
 * and governance checks.
 *
 * @module hooks/subagent-spawning
 * @author DEEP-IOS
 */

import * as db from '../../layer1-core/db.js';

/**
 * 处理 subagent_spawning 事件 / Handle the subagent_spawning event
 *
 * 如果 governance 已启用，检查 Agent 的 tier 的 taskLimit。
 * 如果活跃任务数已达上限，返回阻止对象。
 *
 * If governance is enabled, checks the agent's tier taskLimit.
 * If active task count reaches the limit, returns a blocking response.
 *
 * @param {Object} event   - 事件对象 / Event object
 * @param {Object} ctx     - 上下文对象 / Context object
 * @param {Object} engines - 引擎实例集合 / Engine instances
 * @param {Object} config  - 插件配置 / Plugin configuration
 * @param {Object} logger  - 日志器 / Logger instance
 * @returns {Object|undefined} 阻止对象或 undefined（允许生成）/ Block object or undefined (allow)
 */
export function handleSubagentSpawning(event, ctx, engines, config, logger) {
  const parentId = ctx?.agentId || event?.parentAgentId || 'main';

  // ── Governance tier-based 生成限制 / Tier-based spawn limit check ──
  // [WHY] 低等级 Agent（如 trainee）的 taskLimit 较小（默认 3），
  //       防止不受控的级联生成（fork bomb）耗尽系统资源。
  // Lower-tier agents (e.g. trainee) have small taskLimits (default 3),
  // preventing uncontrolled cascading spawns from exhausting resources.
  if (config.governance?.enabled && engines.capabilityEngine) {
    try {
      const agent = db.getAgent(parentId);
      const tier = agent?.tier || 'trainee';

      // 从 tier 配置获取任务上限 / Get task limit from tier config
      const tierConfig = config.governance.tiers || {};
      const tierDef = tierConfig[tier] || { taskLimit: 3 };
      const taskLimit = tierDef.taskLimit || 3;

      // 查询当前活跃任务数 / Query current active task count
      const activeTasks = db.listSwarmTasks('in_progress');
      const agentActiveTasks = activeTasks.filter(
        t => t.created_by === parentId || t.assigned_to === parentId
      );

      if (agentActiveTasks.length >= taskLimit) {
        logger.warn(
          `Subagent spawn BLOCKED: agent ${parentId} (tier: ${tier}) ` +
          `has ${agentActiveTasks.length}/${taskLimit} active tasks`
        );
        return { blocked: true, reason: `Tier ${tier} task limit reached (${taskLimit})` };
      }

      logger.debug(
        `Subagent spawn allowed: agent ${parentId} (tier: ${tier}), ` +
        `${agentActiveTasks.length}/${taskLimit} active tasks`
      );
    } catch (err) {
      // 治理检查失败不应阻止生成（安全降级）
      // Governance check failure should not block spawn (graceful degradation)
      logger.warn('Governance spawn check failed (allowing spawn):', err.message);
    }
  }

  // 返回 undefined 允许生成（不阻止）
  // Return undefined to allow spawning (no blocking)
}
