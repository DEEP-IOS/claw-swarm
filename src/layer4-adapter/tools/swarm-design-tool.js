/**
 * SwarmDesignTool — 蜂群设计工具 / Swarm Design Tool
 *
 * 允许 Agent 查询/选择角色模板用于子代理创建。
 * Allows agents to query/select persona templates for subagent creation.
 *
 * [WHY] 让 Agent 能自助查看可用的角色模板，并获得任务适配推荐，
 * 减少用户手动查找和配置的负担。
 *
 * Lets agents self-serve to browse available persona templates and get
 * task-appropriate recommendations, reducing manual lookup and configuration.
 *
 * @module tools/swarm-design-tool
 * @author DEEP-IOS
 */

export const swarmDesignToolDefinition = {
  name: 'swarm_design',
  description: 'Query available agent persona templates and get recommendations for task-appropriate designs.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string', enum: ['list', 'recommend', 'detail'],
        description: 'list=show all, recommend=suggest for task, detail=show one template',
      },
      taskType: {
        type: 'string',
        description: 'Task type for recommendation (e.g. exploration, coding, review)',
      },
      personaId: { type: 'string', description: 'Persona ID for detail view' },
    },
    required: ['action'],
  },
};

/**
 * 创建蜂群设计工具处理函数 / Create the swarm design tool handler
 *
 * 委托给 engines.soulDesigner 完成角色模板查询、推荐和详情查看。
 * Delegates to engines.soulDesigner for persona template listing,
 * recommendation, and detail retrieval.
 *
 * @param {Object} engines - 引擎实例集合 / Engine instances
 * @param {Object} config  - 插件配置 / Plugin configuration
 * @param {Object} logger  - 日志器 / Logger instance
 * @returns {Function} 工具处理函数 / Tool handler function
 */
export function createSwarmDesignHandler(engines, config, logger) {
  return function handleSwarmDesign(params) {
    const { action, taskType, personaId } = params;
    const soulDesigner = engines?.soulDesigner;

    // 检查灵魂子系统是否可用 / Check if soul subsystem is available
    if (!soulDesigner) {
      return {
        success: false,
        error: 'Soul subsystem is disabled. SoulDesigner engine is not available.',
      };
    }

    switch (action) {
      // -----------------------------------------------------------------
      // list — 列出所有可用角色模板 / List all available persona templates
      // -----------------------------------------------------------------
      case 'list': {
        const personas = soulDesigner.listPersonas();
        return {
          success: true,
          action: 'list',
          personas,
          count: personas.length,
        };
      }

      // -----------------------------------------------------------------
      // recommend — 根据任务类型推荐角色 / Recommend persona for task type
      // -----------------------------------------------------------------
      case 'recommend': {
        if (!taskType) {
          return {
            success: false,
            error: 'taskType is required for the recommend action.',
          };
        }
        const recommendation = soulDesigner.getRecommendation(taskType);
        return {
          success: true,
          action: 'recommend',
          taskType,
          recommendation,
        };
      }

      // -----------------------------------------------------------------
      // detail — 查看单个角色模板详情 / View single persona template detail
      // -----------------------------------------------------------------
      case 'detail': {
        if (!personaId) {
          return {
            success: false,
            error: 'personaId is required for the detail action.',
          };
        }
        // 通过 selectPersona 方法查找，传入 personaId 作为描述以匹配
        // 或者直接从 listPersonas 中按 id 查找
        const allPersonas = soulDesigner.listPersonas();
        const persona = allPersonas.find(p => p.id === personaId);
        if (!persona) {
          return {
            success: false,
            error: `Persona '${personaId}' not found.`,
          };
        }
        // 也获取完整的 SOUL 片段 / Also get the full SOUL snippet
        const soulMatch = soulDesigner.selectPersona(personaId);
        return {
          success: true,
          action: 'detail',
          persona,
          soulSnippet: soulMatch?.soulSnippet || null,
        };
      }

      // -----------------------------------------------------------------
      // 未知动作 / Unknown action
      // -----------------------------------------------------------------
      default:
        return {
          success: false,
          error: `Unknown action '${action}'. Valid actions: list, recommend, detail.`,
        };
    }
  };
}
