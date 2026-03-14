/**
 * @deprecated V6.3 — 功能已吸收到 auto-hooks + swarm_query / Absorbed into auto-hooks + swarm_query
 * SwarmPheromoneTool -- 信息素管理工具 / Swarm Pheromone Tool
 *
 * V5.0 L5 应用层工具: 管理信息素信号, 支持基于 stigmergy 的间接协调。
 * V5.0 L5 Application Layer tool: Manage pheromone signals for
 * stigmergy-based coordination.
 *
 * 动作 / Actions:
 * - emit:   发射信息素 / Emit a pheromone
 * - read:   读取信息素 / Read pheromones
 * - decay:  触发衰减通道 / Trigger decay pass
 * - alarms: 获取告警密度 / Get alarm density
 *
 * 信息素类型 / Pheromone types:
 * - trail:   路径信息素 (标记成功路径)
 * - alarm:   警报信息素 (标记危险/问题)
 * - recruit: 招募信息素 (吸引代理到任务)
 * - queen:   蜂王信息素 (中央协调信号)
 * - dance:   舞蹈信息素 (传达资源位置)
 *
 * @module L5-application/tools/swarm-pheromone-tool
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

const TOOL_NAME = 'swarm_pheromone';
const TOOL_DESCRIPTION = 'Manage pheromone signals for stigmergy-based coordination';

/** 默认信息素读取上限 / Default pheromone read limit */
const DEFAULT_READ_LIMIT = 20;

/** 默认信息素强度 / Default pheromone intensity */
const DEFAULT_INTENSITY = 1.0;

// ============================================================================
// JSON Schema 定义 / JSON Schema Definition
// ============================================================================

const inputSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['emit', 'read', 'decay', 'alarms'],
      description: '操作类型 / Action type: emit, read, decay, or alarms',
    },
    // emit 参数 / emit params
    type: {
      type: 'string',
      description: '信息素类型 / Pheromone type (trail, alarm, recruit, queen, dance, or custom)',
    },
    scope: {
      type: 'string',
      description: '目标范围 / Target scope (e.g., "/task/123", "/zone/frontend")',
    },
    message: {
      type: 'string',
      description: '信息素消息内容 / Pheromone message content',
    },
    metadata: {
      type: 'object',
      additionalProperties: true,
      description: '附加元数据 / Additional metadata (optional)',
    },
    intensity: {
      type: 'number',
      description: '信号强度 0-1 / Signal intensity 0-1 (optional, default 1.0)',
    },
    // read 参数 / read params (scope, type reused)
    limit: {
      type: 'number',
      description: '读取数量上限 / Read limit (optional, default 20)',
    },
  },
  required: ['action'],
};

// ============================================================================
// 工厂函数 / Factory Function
// ============================================================================

/**
 * 创建信息素管理工具
 * Create the pheromone management tool
 *
 * @param {Object} deps
 * @param {Object} deps.engines - 引擎实例集合 / Engine instances
 * @param {Object} deps.logger - 日志器 / Logger
 * @returns {{ name: string, description: string, inputSchema: Object, handler: Function }}
 */
export function createPheromoneTool({ engines, logger }) {
  const {
    pheromoneEngine,
    messageBus,
  } = engines;

  /**
   * 发射信息素 / Emit a pheromone
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleEmit(input) {
    const { type, scope, message, metadata, intensity = DEFAULT_INTENSITY } = input;

    // 验证必需参数 / Validate required params
    if (!type) {
      return { success: false, error: '信息素类型不能为空 / type is required' };
    }
    if (!scope) {
      return { success: false, error: '目标范围不能为空 / scope is required' };
    }
    if (!message) {
      return { success: false, error: '消息内容不能为空 / message is required' };
    }

    if (!pheromoneEngine) {
      return { success: false, error: 'pheromoneEngine 不可用 / pheromoneEngine not available' };
    }

    try {
      // 构建 payload / Build payload
      const payload = {
        message,
        ...(metadata || {}),
        emittedAt: Date.now(),
      };

      // 发射信息素 / Emit pheromone
      const pheromoneId = pheromoneEngine.emitPheromone({
        type,
        sourceId: 'swarm-pheromone-tool',
        targetScope: scope,
        intensity: Math.max(0, Math.min(1, intensity)),
        payload,
      });

      logger.info?.(
        `[SwarmPheromoneTool] 信息素已发射 / Pheromone emitted: type=${type}, scope=${scope}, id=${pheromoneId}`
      );

      return {
        success: true,
        pheromoneId,
        message: `信息素已发射 / Pheromone emitted: ${type} at ${scope}`,
      };
    } catch (err) {
      return { success: false, error: `发射失败 / Emit failed: ${err.message}` };
    }
  }

  /**
   * 读取信息素 / Read pheromones
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleRead(input) {
    const { scope, type, limit = DEFAULT_READ_LIMIT } = input;

    if (!pheromoneEngine) {
      return { success: false, error: 'pheromoneEngine 不可用 / pheromoneEngine not available' };
    }

    try {
      let pheromones;

      if (scope) {
        // 按范围读取 (带可选类型过滤) / Read by scope (with optional type filter)
        pheromones = pheromoneEngine.read(scope, { type });
      } else {
        // 全量快照 (带可选过滤) / Full snapshot (with optional filters)
        const snapshot = pheromoneEngine.buildSnapshot({ type, scope });
        pheromones = snapshot.pheromones || [];
      }

      // 截断到 limit / Truncate to limit
      const truncated = pheromones.slice(0, limit);

      return {
        success: true,
        pheromones: truncated.map(ph => ({
          id: ph.id,
          type: ph.type,
          sourceId: ph.sourceId,
          targetScope: ph.targetScope,
          intensity: Math.round(ph.intensity * 10000) / 10000,
          payload: ph.payload,
          createdAt: ph.createdAt,
        })),
        count: truncated.length,
        totalAvailable: pheromones.length,
      };
    } catch (err) {
      return { success: false, error: `读取失败 / Read failed: ${err.message}` };
    }
  }

  /**
   * 触发衰减通道 / Trigger decay pass
   *
   * @returns {Object}
   */
  async function handleDecay() {
    if (!pheromoneEngine) {
      return { success: false, error: 'pheromoneEngine 不可用 / pheromoneEngine not available' };
    }

    try {
      const result = pheromoneEngine.decayPass();

      logger.info?.(
        `[SwarmPheromoneTool] 衰减完成 / Decay pass complete: updated=${result.updated}, evaporated=${result.evaporated}`
      );

      return {
        success: true,
        stats: {
          updated: result.updated,
          evaporated: result.evaporated,
        },
        message: `衰减通道完成 / Decay pass complete: ${result.updated} updated, ${result.evaporated} evaporated`,
      };
    } catch (err) {
      return { success: false, error: `衰减失败 / Decay failed: ${err.message}` };
    }
  }

  /**
   * 获取告警信息素密度 / Get alarm pheromone density
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleAlarms(input) {
    const { scope } = input;

    if (!pheromoneEngine) {
      return { success: false, error: 'pheromoneEngine 不可用 / pheromoneEngine not available' };
    }

    try {
      // 如果指定了范围, 查询该范围; 否则查询全局 / Query scope or global
      const targetScope = scope || '/';
      const density = pheromoneEngine.getAlarmDensity(targetScope);

      return {
        success: true,
        stats: {
          scope: targetScope,
          alarmCount: density.count,
          totalIntensity: Math.round(density.totalIntensity * 10000) / 10000,
          triggered: density.triggered,
        },
        message: density.triggered
          ? `告警阈值已触发 / Alarm threshold triggered: ${density.count} alarms`
          : `告警密度正常 / Alarm density normal: ${density.count} alarms`,
      };
    } catch (err) {
      return { success: false, error: `告警查询失败 / Alarm query failed: ${err.message}` };
    }
  }

  // ━━━ 主处理函数 / Main Handler ━━━

  async function handler(input) {
    try {
      const { action } = input;

      switch (action) {
        case 'emit':
          return await handleEmit(input);
        case 'read':
          return await handleRead(input);
        case 'decay':
          return await handleDecay();
        case 'alarms':
          return await handleAlarms(input);
        default:
          return {
            success: false,
            error: `未知操作 / Unknown action: ${action}. 支持 / Supported: emit, read, decay, alarms`,
          };
      }
    } catch (err) {
      logger.error?.(`[SwarmPheromoneTool] 未捕获错误 / Uncaught error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: inputSchema,
    handler,
    execute: async (toolCallId, params) => {
      const result = await handler(params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  };
}
