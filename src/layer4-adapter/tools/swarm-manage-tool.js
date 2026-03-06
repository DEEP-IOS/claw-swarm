/**
 * SwarmManageTool — 蜂群管理工具 / Swarm Management Tool
 *
 * 将 v3.0 的 /swarm status|list|cancel|report 命令合并为工具格式。
 * Consolidates v3.0's /swarm status|list|cancel|report commands into tool format.
 *
 * [WHY] v3.0 使用斜杠命令管理蜂群任务，不够 Agent 友好。
 * 工具格式让 Agent 可以程序化地管理任务，无需解析文本命令。
 *
 * v3.0 used slash commands for swarm management, which wasn't agent-friendly.
 * Tool format lets agents manage tasks programmatically without parsing text commands.
 *
 * @module tools/swarm-manage-tool
 * @author DEEP-IOS
 */

import { updateSwarmTaskStatus } from '../../layer1-core/db.js';

export const swarmManageToolDefinition = {
  name: 'swarm_manage',
  description: 'Manage swarm tasks: view status, list tasks, cancel tasks, get reports.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string', enum: ['status', 'list', 'cancel', 'report'],
        description: 'Management action to perform',
      },
      taskId: { type: 'string', description: 'Task ID (required for status, cancel, report)' },
      filter: { type: 'string', description: 'Status filter for list action' },
    },
    required: ['action'],
  },
};

/**
 * 创建蜂群管理工具处理函数 / Create the swarm manage tool handler
 *
 * @param {Object} engines - 引擎实例集合（需要 engines.monitor）/ Engine instances (requires engines.monitor)
 * @param {Object} config  - 插件配置 / Plugin configuration
 * @param {Object} logger  - 日志器 / Logger instance
 * @returns {Function} 工具处理函数 / Tool handler function
 */
export function createSwarmManageHandler(engines, config, logger) {
  return function handleSwarmManage(params) {
    const { action, taskId, filter } = params;

    // ── Action: status ─────────────────────────────────────────────
    if (action === 'status') {
      if (!taskId) return { error: 'taskId required for status' };
      return engines.monitor.getTaskStatus(taskId);
    }

    // ── Action: list ───────────────────────────────────────────────
    if (action === 'list') {
      return { tasks: engines.monitor.listTasks(filter || null) };
    }

    // ── Action: report ─────────────────────────────────────────────
    if (action === 'report') {
      if (!taskId) return { error: 'taskId required for report' };
      return engines.monitor.getReport(taskId);
    }

    // ── Action: cancel ─────────────────────────────────────────────
    if (action === 'cancel') {
      if (!taskId) return { error: 'taskId required for cancel' };
      try {
        updateSwarmTaskStatus(taskId, 'cancelled', 'Cancelled by user');
        return { success: true, taskId, status: 'cancelled' };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    return { error: `Unknown action: ${action}` };
  };
}
