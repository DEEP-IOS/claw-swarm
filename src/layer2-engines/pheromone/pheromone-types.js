/**
 * PheromoneTypes — 信息素类型定义 / Pheromone Type Definitions
 *
 * 定义蜂群通信的 5 种信息素类型及其默认参数。
 * 灵感来自蜜蜂社会的化学通信系统：
 * - Trail (路径信息素): 标记已探索的路径，引导后续工蜂
 * - Alarm (警报信息素): 警告危险或问题，快速衰减
 * - Recruit (招募信息素): 请求协助，中等持续时间
 * - Queen (蜂王信息素): 高优先级指令，缓慢衰减
 * - Dance (舞蹈信息素): 分享发现的资源/知识
 *
 * Defines 5 pheromone types for swarm communication, inspired by
 * honeybee chemical signaling systems.
 *
 * @module pheromone-types
 * @author DEEP-IOS
 */

// Re-export from types.js for convenience
// 从 types.js 重新导出以方便使用
export { PheromoneType } from '../../layer1-core/types.js';

/**
 * 每种信息素类型的默认衰减参数
 * Default decay parameters for each pheromone type
 *
 * [WHY] 不同信息素有不同的"紧迫性"——
 * 警报需要快速衰减（30分钟），蜂王指令需要持久（8小时）
 * Different pheromones have different "urgency" —
 * alarms decay quickly (30min), queen orders persist (8 hours)
 */
export const PHEROMONE_DEFAULTS = Object.freeze({
  trail:   Object.freeze({ decayRate: 0.05, maxTTLMinutes: 120 }),
  alarm:   Object.freeze({ decayRate: 0.15, maxTTLMinutes: 30 }),
  recruit: Object.freeze({ decayRate: 0.10, maxTTLMinutes: 60 }),
  queen:   Object.freeze({ decayRate: 0.02, maxTTLMinutes: 480 }),
  dance:   Object.freeze({ decayRate: 0.08, maxTTLMinutes: 90 }),
});

/**
 * 最小可感知强度阈值
 * Minimum perceptible intensity threshold
 *
 * [WHY] 当强度低于此值时，信息素被视为"已蒸发"，
 * 不再注入 Agent 上下文，等待下次 decayPass 清理
 * Below this intensity, pheromone is considered "evaporated",
 * no longer injected into agent context, awaits cleanup
 */
export const MIN_INTENSITY = 0.01;
