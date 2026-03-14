/**
 * 蜜蜂行为映射 / Bee Behavior Mapping
 *
 * 12 种蜜蜂行为与 Agent 状态的映射关系。
 *
 * @module constants/behaviors
 * @author DEEP-IOS
 */

/**
 * 行为定义
 * @typedef {Object} BehaviorDef
 * @property {string} id - 行为 ID
 * @property {string} en - 英文名
 * @property {string} zh - 中文名
 * @property {string} trigger - 触发条件描述
 * @property {number} priority - 优先级 (低数字=高优先)
 * @property {string} animation - 动画类型
 */

/** @type {BehaviorDef[]} */
export const BEHAVIORS = [
  { id: 'alarm',        en: 'Alarm',         zh: '警报',     trigger: 'alarm pheromone > 0.7',     priority: 0, animation: 'zigzag-fast' },
  { id: 'guarding',     en: 'Guarding',      zh: '守卫',     trigger: 'role=guard + active',        priority: 1, animation: 'patrol-arc' },
  { id: 'foraging',     en: 'Foraging',      zh: '觅食',     trigger: 'state=EXECUTING',            priority: 2, animation: 'fly-to-task' },
  { id: 'waggle_dance', en: 'Waggle Dance',  zh: '摇摆舞',   trigger: 'state=REPORTING + quality',  priority: 3, animation: 'figure-eight' },
  { id: 'round_dance',  en: 'Round Dance',   zh: '圆舞',     trigger: 'state=REPORTING + nearby',   priority: 4, animation: 'circle' },
  { id: 'fanning',      en: 'Fanning',       zh: '扇风',     trigger: 'recruit pheromone > 0.5',    priority: 5, animation: 'vibrate' },
  { id: 'nursing',      en: 'Nursing',       zh: '哺育',     trigger: 'has sub-agents',             priority: 6, animation: 'hover-near' },
  { id: 'orienting',    en: 'Orienting',     zh: '定向飞行', trigger: 'trail pheromone present',     priority: 7, animation: 'follow-trail' },
  { id: 'cleaning',     en: 'Cleaning',      zh: '清洁',     trigger: 'state=IDLE + low-priority',  priority: 8, animation: 'slow-circle' },
  { id: 'storing',      en: 'Storing',       zh: '储存',     trigger: 'state=DONE phase',           priority: 9, animation: 'return-to-hive' },
  { id: 'resting',      en: 'Resting',       zh: '休息',     trigger: 'state=IDLE',                 priority: 10, animation: 'breathe' },
  { id: 'pollinating',  en: 'Pollinating',   zh: '采花粉',   trigger: 'food pheromone > 0.5',       priority: 11, animation: 'zigzag-slow' },
];

/**
 * 根据 Agent 状态确定行为 / Determine behavior from agent state
 * @param {Object} agent
 * @param {Object} pheromones
 * @returns {BehaviorDef}
 */
export function determineBehavior(agent, pheromones = {}) {
  if (pheromones.alarm > 0.7) return BEHAVIORS[0]; // alarm
  if (agent.role === 'guard' && agent.state === 'ACTIVE') return BEHAVIORS[1]; // guarding
  if (agent.state === 'EXECUTING') return BEHAVIORS[2]; // foraging
  if (agent.state === 'REPORTING' && agent.taskDistance > 50) return BEHAVIORS[3]; // waggle_dance (distant)
  if (agent.state === 'REPORTING') return BEHAVIORS[4]; // round_dance (nearby)
  if (pheromones.recruit > 0.5) return BEHAVIORS[5]; // fanning
  if (agent.children?.length > 0) return BEHAVIORS[6]; // nursing
  if (pheromones.trail > 0.3) return BEHAVIORS[7]; // orienting
  if (agent.state === 'DONE') return BEHAVIORS[9]; // storing
  if (pheromones.food > 0.5) return BEHAVIORS[11]; // pollinating
  if (agent.state === 'IDLE' && agent.priority < 3) return BEHAVIORS[8]; // cleaning
  if (agent.state === 'IDLE') return BEHAVIORS[10]; // resting
  return BEHAVIORS[10]; // default: resting
}
