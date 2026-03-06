/**
 * PheromoneTool — 信息素工具 / Pheromone Tool
 *
 * 允许 Agent 直接发射或读取信息素信号。
 * Allows agents to directly emit or read pheromone signals.
 *
 * [WHY] 虽然 before_agent_start 注入被动快照，有时 Agent 需要
 * 主动查询特定 scope 或发射自定义信号（例如标记发现的好资源）。
 *
 * While before_agent_start injects passive snapshots, sometimes agents
 * need to actively query specific scopes or emit custom signals
 * (e.g. marking a discovered valuable resource).
 *
 * @module tools/pheromone-tool
 * @author DEEP-IOS
 */

export const pheromoneToolDefinition = {
  name: 'pheromone',
  description: 'Emit or read pheromone signals for indirect swarm communication.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['emit', 'read'], description: 'Action to perform' },
      type: {
        type: 'string', enum: ['trail', 'alarm', 'recruit', 'queen', 'dance'],
        description: 'Pheromone type (required for emit)',
      },
      scope: { type: 'string', default: '/global', description: 'Target scope (e.g. /global, /agent/id)' },
      message: { type: 'string', description: 'Payload message (for emit)' },
      intensity: { type: 'number', default: 1.0, description: 'Signal intensity 0-1 (for emit)' },
    },
    required: ['action'],
  },
};

/**
 * 创建信息素工具处理函数 / Create the pheromone tool handler
 *
 * @param {Object} engines - 引擎实例集合 / Engine instances
 * @param {Object} config  - 插件配置 / Plugin configuration
 * @param {Object} logger  - 日志器 / Logger instance
 * @returns {Function} 工具处理函数 / Tool handler function
 */
export function createPheromoneHandler(engines, config, logger) {
  return function handlePheromone(params, ctx) {
    if (!engines.pheromone) {
      return { success: false, error: 'Pheromone engine not enabled' };
    }

    const { action, type, scope = '/global', message, intensity = 1.0 } = params;
    const agentId = ctx?.agentId || 'unknown';

    // ── Action: emit ───────────────────────────────────────────────
    if (action === 'emit') {
      if (!type) return { success: false, error: 'type is required for emit action' };
      engines.pheromone.emitPheromone({
        type,
        sourceId: agentId,
        targetScope: scope,
        intensity,
        payload: { message },
      });
      return { success: true, action: 'emit', type, scope };
    }

    // ── Action: read ───────────────────────────────────────────────
    if (action === 'read') {
      const signals = engines.pheromone.read(scope, { type });
      return {
        success: true,
        action: 'read',
        scope,
        signals: signals.map(s => ({
          type: s.type,
          intensity: s.currentIntensity?.toFixed(2),
          from: s.source_id,
          payload: s.payload,
        })),
      };
    }

    return { success: false, error: `Unknown action: ${action}` };
  };
}
