/**
 * CollaborationStrategies — 协作策略 / Collaboration Strategies
 *
 * 定义 4 种蜂群协作模式（parallel / pipeline / debate / stigmergy），
 * 作为 swarm_spawn 的策略配置，包含角色需求、通信方式和代理上限。
 *
 * Defines 4 swarm collaboration patterns (parallel / pipeline / debate / stigmergy)
 * as strategy configurations for swarm_spawn, including required roles,
 * communication channels, and agent caps.
 *
 * [WHY] 不同任务需要不同的协作模式——有些适合并行分工，有些需要流水线串行。
 * 将策略声明为静态配置对象，使 swarm_spawn 可以按名称查表，
 * 而无需硬编码每种模式的组队逻辑。
 * Different tasks need different collaboration patterns — some suit parallel division,
 * others require sequential pipelines. Declaring strategies as static config objects
 * lets swarm_spawn look them up by name without hard-coding team-assembly logic
 * for each pattern.
 *
 * @module collaboration/strategies
 * @author DEEP-IOS
 */

export const STRATEGIES = Object.freeze({
  parallel: Object.freeze({
    id: 'parallel',
    name: '并行执行 (Parallel)',
    description: 'All agents work simultaneously on different aspects of the task',
    spawnMode: 'run',
    communication: 'pheromone',  // indirect via pheromones
    requires: ['scout-bee', 'worker-bee'],
    maxAgents: 4,
  }),

  pipeline: Object.freeze({
    id: 'pipeline',
    name: '流水线 (Pipeline)',
    description: 'Agents work in sequence, each building on the previous result',
    spawnMode: 'session',
    communication: 'memory',  // shared memory scope
    requires: ['scout-bee', 'worker-bee', 'guard-bee'],
    maxAgents: 3,
  }),

  debate: Object.freeze({
    id: 'debate',
    name: '辩论 (Debate)',
    description: 'Multiple agents propose solutions, then vote on the best approach',
    spawnMode: 'run',
    communication: 'pheromone',
    requires: ['worker-bee', 'worker-bee', 'guard-bee'],
    maxAgents: 3,
  }),

  stigmergy: Object.freeze({
    id: 'stigmergy',
    name: '群体智慧 (Stigmergy)',
    description: 'Agents coordinate purely through environmental signals (pheromones)',
    spawnMode: 'run',
    communication: 'pheromone',
    requires: ['scout-bee', 'worker-bee', 'worker-bee'],
    maxAgents: 6,
  }),
});

export function getStrategy(name) {
  return STRATEGIES[name] || STRATEGIES.parallel;
}

export function listStrategies() {
  return Object.values(STRATEGIES);
}
