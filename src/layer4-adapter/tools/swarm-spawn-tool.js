/**
 * SwarmSpawnTool — 蜂群生成工具 / Swarm Spawn Tool
 *
 * 一键蜂群创建：分析任务 -> 选择角色 -> 生成 SOUL 个性 -> 派生协调子代理。
 * One-click swarm creation via sessions_spawn wrapper.
 * Analyzes task -> selects personas -> spawns coordinated subagents.
 *
 * [WHY] v3.0 的蜂群生成需要手动指定每个角色和配置，
 * 这个工具将分析和选择自动化，用户只需描述任务。
 *
 * v3.0 swarm creation required manual role/config specification.
 * This tool automates analysis and selection; users just describe the task.
 *
 * @module tools/swarm-spawn-tool
 * @author DEEP-IOS
 */

import { STRATEGIES } from '../../layer3-intelligence/collaboration/strategies.js';

export const swarmSpawnToolDefinition = {
  name: 'swarm_spawn',
  description: 'Analyze a task, select appropriate agent roles, generate SOUL personalities, and spawn a coordinated swarm of subagents.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task description for the swarm to accomplish' },
      strategy: {
        type: 'string', enum: ['parallel', 'pipeline', 'debate', 'stigmergy'],
        default: 'parallel', description: 'Collaboration strategy',
      },
      maxAgents: { type: 'number', default: 4, description: 'Maximum number of subagents to spawn' },
    },
    required: ['task'],
  },
};

/**
 * 创建蜂群生成工具处理函数 / Create the swarm spawn tool handler
 *
 * 分析任务描述，结合协作策略和 SoulDesigner 推荐，
 * 生成结构化的生成计划供调用方使用 sessions_spawn 执行。
 *
 * Analyzes the task description, combines collaboration strategy config
 * with SoulDesigner recommendations, and generates a structured spawn
 * plan for the calling agent to execute via sessions_spawn.
 *
 * @param {Object} engines - 引擎实例集合 / Engine instances
 * @param {Object} config  - 插件配置 / Plugin configuration
 * @param {Object} logger  - 日志器 / Logger instance
 * @returns {Function} 工具处理函数 / Tool handler function
 */
export function createSwarmSpawnHandler(engines, config, logger) {
  return function handleSwarmSpawn(params, ctx) {
    const { task, strategy = 'parallel', maxAgents = 4 } = params;

    // 验证必需参数 / Validate required parameter
    if (!task) {
      return { success: false, error: 'Task description is required' };
    }

    logger.info(`Swarm spawn requested: strategy=${strategy}, maxAgents=${maxAgents}`);

    // 1. 获取策略配置 / Get strategy configuration
    const strategyConfig = STRATEGIES[strategy] || STRATEGIES.parallel;

    // 2. 计算实际代理数量上限 / Determine effective agent cap
    const effectiveMax = Math.min(maxAgents, strategyConfig.maxAgents || maxAgents);

    // 3. 获取策略所需的角色列表 / Get required persona IDs from strategy
    const requiredPersonas = strategyConfig.requires || [];

    // 4. 去重并截取到上限 / Deduplicate and cap to effectiveMax
    const uniquePersonas = [...new Set(requiredPersonas)];
    const personaIds = uniquePersonas.slice(0, effectiveMax);

    const soulDesigner = engines?.soulDesigner;

    // 5. 为每个角色生成 SOUL 片段和描述 / Build role entries with SOUL snippets
    const roles = personaIds.map((personaId, index) => {
      if (soulDesigner) {
        // 使用 SoulDesigner 生成完整的 SOUL 片段
        // Use SoulDesigner to generate full SOUL snippet
        const soulSnippet = soulDesigner.generateSoul({
          personaId,
          taskDescription: task,
          swarmRole: `Role ${index + 1} of ${personaIds.length} in ${strategy} strategy`,
        });
        // 从 listPersonas 获取描述信息 / Get description from persona listing
        const allPersonas = soulDesigner.listPersonas();
        const personaInfo = allPersonas.find(p => p.id === personaId);
        return {
          name: personaInfo?.name || personaId,
          persona: personaId,
          soulSnippet,
          description: personaInfo?.description || `Agent with persona ${personaId}`,
        };
      }

      // 无 SoulDesigner 时的基本计划 / Fallback without SoulDesigner
      return {
        name: personaId,
        persona: personaId,
        soulSnippet: `You are a ${personaId} agent working on: ${task}`,
        description: `Agent with persona ${personaId}`,
      };
    });

    // 6. 如果策略要求重复角色（如 debate 需要多个 worker-bee），补充到上限
    // Handle duplicate personas in strategy (e.g. debate requires two worker-bees)
    if (roles.length < effectiveMax && requiredPersonas.length > uniquePersonas.length) {
      const duplicates = requiredPersonas.filter(
        (id, idx) => requiredPersonas.indexOf(id) !== idx,
      );
      for (const personaId of duplicates) {
        if (roles.length >= effectiveMax) break;
        const existingRole = roles.find(r => r.persona === personaId);
        if (existingRole) {
          const cloneIndex = roles.length + 1;
          const soulSnippet = soulDesigner
            ? soulDesigner.generateSoul({
                personaId,
                taskDescription: task,
                swarmRole: `Role ${cloneIndex} of ${effectiveMax} in ${strategy} strategy (parallel instance)`,
              })
            : `You are a ${personaId} agent (instance ${cloneIndex}) working on: ${task}`;
          roles.push({
            name: `${existingRole.name} #${cloneIndex}`,
            persona: personaId,
            soulSnippet,
            description: existingRole.description,
          });
        }
      }
    }

    // 7. 如果 SoulDesigner 可用且角色不足上限，自动推荐补充
    // Auto-fill remaining slots with SoulDesigner recommendations if available
    if (soulDesigner && roles.length < effectiveMax) {
      const recommendation = soulDesigner.getRecommendation(task);
      if (recommendation && !roles.some(r => r.persona === recommendation.personaId)) {
        const allPersonas = soulDesigner.listPersonas();
        const personaInfo = allPersonas.find(p => p.id === recommendation.personaId);
        const soulSnippet = soulDesigner.generateSoul({
          personaId: recommendation.personaId,
          taskDescription: task,
          swarmRole: `Auto-recommended role in ${strategy} strategy`,
        });
        roles.push({
          name: personaInfo?.name || recommendation.personaId,
          persona: recommendation.personaId,
          soulSnippet,
          description: personaInfo?.description || `Auto-recommended agent for this task`,
        });
      }
    }

    return {
      success: true,
      strategy,
      strategyDescription: strategyConfig.description,
      spawnMode: strategyConfig.spawnMode,
      communication: strategyConfig.communication,
      roles,
      instructions: 'Use sessions_spawn with the roles above to create the swarm.',
    };
  };
}
