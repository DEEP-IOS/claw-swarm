/**
 * SwarmZoneTool -- Zone 治理工具 / Swarm Zone Tool
 *
 * V5.0 L5 应用层工具: Zone 分区治理和管理。
 * V5.0 L5 Application Layer tool: Zone governance and management.
 *
 * Zone 治理机制 / Zone governance mechanisms:
 * - 自动分配: Jaccard(agent_skills, zone_tech_stack) > 0.3
 *   Auto-assignment: Jaccard similarity matching
 * - Leader 选举: success_rate > 90% + reputation > 800
 *   Leader election with success rate and reputation thresholds
 * - Zone 级信息素隔离: 范围 /zone/{zoneId}
 *   Zone-level pheromone isolation with scoped pheromones
 *
 * 动作 / Actions:
 * - create:  创建 Zone / Create a zone
 * - assign:  自动分配 Agent 到 Zone / Auto-assign agent to zone
 * - list:    列出 Zone / List zones
 * - members: 获取 Zone 成员 / Get zone members
 * - health:  Zone 健康检查 / Zone health check
 *
 * @module L5-application/tools/swarm-zone-tool
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

const TOOL_NAME = 'swarm_zone';
const TOOL_DESCRIPTION = 'Zone governance and management';

// ============================================================================
// JSON Schema 定义 / JSON Schema Definition
// ============================================================================

const inputSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'assign', 'list', 'members', 'health'],
      description: '操作类型 / Action type: create, assign, list, members, or health',
    },
    // create 参数 / create params
    name: {
      type: 'string',
      description: 'Zone 名称 (create 必需) / Zone name (required for create)',
    },
    description: {
      type: 'string',
      description: 'Zone 描述 / Zone description (optional)',
    },
    techStack: {
      type: 'array',
      items: { type: 'string' },
      description: '技术栈标签列表 / Tech stack labels (optional)',
    },
    // assign 参数 / assign params
    agentId: {
      type: 'string',
      description: 'Agent ID (assign 必需) / Agent ID (required for assign)',
    },
    zoneId: {
      type: 'string',
      description: 'Zone ID (assign 可选, 不提供则自动匹配) / Zone ID (optional for assign, auto-match if omitted)',
    },
  },
  required: ['action'],
};

// ============================================================================
// 工厂函数 / Factory Function
// ============================================================================

/**
 * 创建 Zone 治理工具
 * Create the zone governance tool
 *
 * @param {Object} deps
 * @param {Object} deps.engines - 引擎实例集合 / Engine instances
 * @param {Object} deps.logger - 日志器 / Logger
 * @returns {{ name: string, description: string, inputSchema: Object, handler: Function }}
 */
export function createZoneTool({ engines, logger }) {
  const {
    zoneManager,
    zoneRepo,
    messageBus,
  } = engines;

  /**
   * 创建 Zone / Create a zone
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleCreate(input) {
    const { name, description: desc, techStack } = input;

    if (!name || typeof name !== 'string') {
      return { success: false, error: 'Zone 名称不能为空 / name is required' };
    }

    if (!zoneManager) {
      return { success: false, error: 'zoneManager 不可用 / zoneManager not available' };
    }

    try {
      const zoneId = zoneManager.createZone({
        name,
        description: desc || null,
        techStack: techStack || [],
      });

      logger.info?.(`[SwarmZoneTool] Zone 已创建 / Zone created: ${zoneId} (${name})`);

      return {
        success: true,
        zone: {
          id: zoneId,
          name,
          description: desc || null,
          techStack: techStack || [],
        },
        message: `Zone 已创建 / Zone created: ${name}`,
      };
    } catch (err) {
      return { success: false, error: `Zone 创建失败 / Zone creation failed: ${err.message}` };
    }
  }

  /**
   * 分配 Agent 到 Zone / Assign agent to zone
   *
   * 两种模式 / Two modes:
   * - 指定 zoneId: 直接分配 / Direct assignment
   * - 不指定 zoneId: Jaccard 自动匹配 / Jaccard auto-matching
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleAssign(input) {
    const { agentId, zoneId } = input;

    if (!agentId) {
      return { success: false, error: 'agentId 不能为空 / agentId is required' };
    }

    if (!zoneManager) {
      return { success: false, error: 'zoneManager 不可用 / zoneManager not available' };
    }

    try {
      if (zoneId) {
        // 直接分配模式 / Direct assignment mode
        zoneManager.assignAgent(agentId, zoneId);

        logger.info?.(`[SwarmZoneTool] Agent 已直接分配 / Agent directly assigned: ${agentId} → ${zoneId}`);

        return {
          success: true,
          zone: { agentId, zoneId, mode: 'direct' },
          message: `Agent 已分配到 Zone / Agent assigned to zone: ${zoneId}`,
        };
      } else {
        // Jaccard 自动匹配模式 / Jaccard auto-matching mode
        const result = zoneManager.autoAssignAgent(agentId);

        if (!result) {
          return {
            success: false,
            error: `无匹配 Zone (Jaccard 阈值未达到) / No matching zone (Jaccard threshold not met)`,
          };
        }

        logger.info?.(
          `[SwarmZoneTool] Agent 已自动分配 / Agent auto-assigned: ${agentId} → ${result.zoneId} (score=${result.score.toFixed(3)})`
        );

        return {
          success: true,
          zone: {
            agentId,
            zoneId: result.zoneId,
            jaccardScore: Math.round(result.score * 10000) / 10000,
            mode: 'auto',
          },
          message: `Agent 已自动匹配到 Zone / Agent auto-assigned to zone: ${result.zoneId}`,
        };
      }
    } catch (err) {
      return { success: false, error: `分配失败 / Assignment failed: ${err.message}` };
    }
  }

  /**
   * 列出所有 Zone / List all zones
   *
   * @returns {Object}
   */
  async function handleList() {
    if (!zoneManager) {
      return { success: false, error: 'zoneManager 不可用 / zoneManager not available' };
    }

    try {
      const zones = zoneManager.listZones();

      return {
        success: true,
        zones: zones.map(z => ({
          id: z.id,
          name: z.name,
          description: z.description,
          techStack: z.techStack || z.tech_stack,
          leaderId: z.leaderId || z.leader_id,
          createdAt: z.createdAt || z.created_at,
        })),
        count: zones.length,
      };
    } catch (err) {
      return { success: false, error: `列出 Zone 失败 / List failed: ${err.message}` };
    }
  }

  /**
   * 获取 Zone 成员 / Get zone members
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleMembers(input) {
    const { zoneId } = input;

    if (!zoneId) {
      return { success: false, error: 'zoneId 不能为空 / zoneId is required' };
    }

    if (!zoneManager) {
      return { success: false, error: 'zoneManager 不可用 / zoneManager not available' };
    }

    try {
      const members = zoneManager.getMembers(zoneId);

      return {
        success: true,
        members: members.map(m => ({
          agentId: m.agent_id,
          role: m.role,
          joinedAt: m.joined_at,
        })),
        count: members.length,
      };
    } catch (err) {
      return { success: false, error: `成员查询失败 / Members query failed: ${err.message}` };
    }
  }

  /**
   * Zone 健康检查 / Zone health check
   *
   * 检测项 / Checks:
   * - 成员数 / Member count
   * - Leader 状态 / Leader status
   * - 技术栈完整性 / Tech stack completeness
   * - 容量限制 / Capacity limits
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleHealth(input) {
    const { zoneId } = input;

    if (!zoneId) {
      return { success: false, error: 'zoneId 不能为空 / zoneId is required' };
    }

    if (!zoneManager) {
      return { success: false, error: 'zoneManager 不可用 / zoneManager not available' };
    }

    try {
      const healthResult = zoneManager.healthCheck(zoneId);

      // 获取 Zone 详情补充信息 / Get zone details for supplementary info
      let zoneInfo = null;
      try {
        zoneInfo = zoneManager.getZone(zoneId);
      } catch {
        // 忽略 / Ignore
      }

      logger.info?.(
        `[SwarmZoneTool] Zone 健康检查 / Zone health check: zoneId=${zoneId}, ` +
        `healthy=${healthResult.healthy}, issues=${healthResult.issues.length}`
      );

      return {
        success: true,
        health: {
          zoneId,
          zoneName: zoneInfo?.name || null,
          healthy: healthResult.healthy,
          issues: healthResult.issues,
          issueCount: healthResult.issues.length,
        },
      };
    } catch (err) {
      return { success: false, error: `健康检查失败 / Health check failed: ${err.message}` };
    }
  }

  // ━━━ 主处理函数 / Main Handler ━━━

  async function handler(input) {
    try {
      const { action } = input;

      switch (action) {
        case 'create':
          return await handleCreate(input);
        case 'assign':
          return await handleAssign(input);
        case 'list':
          return await handleList();
        case 'members':
          return await handleMembers(input);
        case 'health':
          return await handleHealth(input);
        default:
          return {
            success: false,
            error: `未知操作 / Unknown action: ${action}. 支持 / Supported: create, assign, list, members, health`,
          };
      }
    } catch (err) {
      logger.error?.(`[SwarmZoneTool] 未捕获错误 / Uncaught error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    inputSchema,
    handler,
  };
}
