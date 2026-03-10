/**
 * L5 Tool 工厂函数单元测试 / L5 Tool Factory Unit Tests
 *
 * 使用 mock 引擎依赖测试 8 个工具工厂函数的核心行为。
 * Tests core behavior of 8 tool factory functions using mock engine dependencies.
 *
 * 工具列表 / Tool list:
 * - swarm_spawn:     蜂群生成 / Swarm spawning
 * - swarm_query:     蜂群查询 / Swarm query
 * - swarm_pheromone: 信息素管理 / Pheromone management
 * - swarm_gate:      质量门控 / Quality gate
 * - swarm_memory:    记忆操作 / Memory operations
 * - swarm_plan:      执行计划 / Execution plan
 * - swarm_zone:      Zone 治理 / Zone governance
 *
 * @module tests/unit/L5/tools.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createSpawnTool } from '../../../src/L5-application/tools/swarm-spawn-tool.js';
import { createQueryTool } from '../../../src/L5-application/tools/swarm-query-tool.js';
import { createPheromoneTool } from '../../../src/L5-application/tools/swarm-pheromone-tool.js';
import { createGateTool } from '../../../src/L5-application/tools/swarm-gate-tool.js';
import { createMemoryTool } from '../../../src/L5-application/tools/swarm-memory-tool.js';
import { createPlanTool } from '../../../src/L5-application/tools/swarm-plan-tool.js';
import { createZoneTool } from '../../../src/L5-application/tools/swarm-zone-tool.js';
import { createRunTool } from '../../../src/L5-application/tools/swarm-run-tool.js';

// ============================================================================
// 静默日志器 / Silent Logger
// ============================================================================

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// ============================================================================
// Mock 引擎工厂 / Mock Engines Factory
// ============================================================================

/**
 * 创建完整的 mock 引擎集合
 * Create a complete set of mock engines for tool testing
 *
 * 每个 mock 方法返回可预测的结果, 便于断言。
 * Each mock method returns predictable results for assertions.
 */
function createMockEngines() {
  return {
    executionPlanner: {
      planExecution: (desc, opts) => ({
        roles: [
          { id: 'r1', name: 'developer', description: 'Developer role', score: 0.9 },
        ],
        scores: [{ name: 'developer', score: 0.9 }],
        fallback: false,
      }),
      generatePlan: (taskDesc, roles) => ({
        id: 'plan-gen-1',
        taskDescription: taskDesc,
        status: 'draft',
        roles: roles.map(r => r.name),
        phases: [{ id: 'ph-1', order: 1, roleName: 'developer', description: 'Phase 1', status: 'pending' }],
        constraints: {},
        maturityScore: 0.85,
        metadata: {},
      }),
      validatePlan: (plan) => ({ valid: true, issues: [], score: 0.9 }),
    },
    taskRepo: {
      createTask: (id, data, status) => id,
      getTask: (id) => ({ id, name: 'test-task', status: 'pending', config: {} }),
      listTasks: (status) => [{ id: 't1', status: status || 'running', config: {} }],
      updateTaskStatus: () => {},
    },
    agentRepo: {
      createAgent: (data) => `agent-${Date.now().toString(36)}`,
      getAgent: (id) => ({ id, name: 'test-agent', tier: 'mid', status: 'active', role: 'developer' }),
      listAgents: (status) => [
        { id: 'a1', name: 'agent-a', status: 'active', tier: 'mid', role: 'dev', total_score: 80, success_count: 8, failure_count: 2 },
        { id: 'a2', name: 'agent-b', status: 'active', tier: 'senior', role: 'qa', total_score: 90, success_count: 9, failure_count: 1 },
      ],
      upsertAgent: () => {},
      updateAgent: () => {},
      getCapabilities: () => [],
      getSkills: () => [],
    },
    pheromoneEngine: {
      emitPheromone: (opts) => 'ph-123',
      read: (scope, opts) => [
        { id: 'ph-1', type: 'trail', intensity: 0.7, sourceId: 's1', targetScope: '/', payload: {}, createdAt: Date.now() },
      ],
      buildSnapshot: (opts) => ({ pheromones: [] }),
      decayPass: () => ({ updated: 3, evaporated: 1 }),
      getAlarmDensity: (scope) => ({ count: 2, totalIntensity: 1.5, triggered: false }),
      getStats: () => ({ totalCount: 5, emitted: 10 }),
    },
    qualityController: {
      evaluate: async (taskId, output, opts) => ({
        evaluationId: 'eval-1',
        score: 0.85,
        verdict: 'pass',
        tier: 'self-review',
        passed: true,
        feedback: 'Good quality',
        dimensions: { correctness: 0.9, completeness: 0.8 },
      }),
      getStats: () => ({ totalEvaluations: 10, passRate: 0.8 }),
      getQualityReport: (taskId) => ({ taskId, score: 0.85 }),
    },
    reputationLedger: {
      recordOutcome: () => {},
      recordSuccess: () => {},
      recordFailure: () => {},
    },
    episodicMemory: {
      record: (opts) => 'ev-1',
      recall: (agentId, opts) => [
        { id: 'e1', subject: 'a', predicate: 'did', object: 'b', event_type: 'action', importance: 0.8, timestamp: Date.now(), _score: 0.8 },
      ],
      getStats: (id) => ({ totalEvents: 5, recentEvents: 3 }),
    },
    semanticMemory: {
      getRelated: (nodeId, opts) => [
        { node: { id: 'n2', label: 'React', nodeType: 'concept' }, depth: 1, path: ['n1', 'n2'] },
      ],
      addConcept: (opts) => 'node-new',
      addRelation: (opts) => 'edge-new',
      query: (keyword) => [{ id: 'n1', label: keyword }],
      buildContextSnippet: () => 'snippet',
      getStats: () => ({ totalNodes: 5, totalEdges: 8 }),
    },
    workingMemory: {
      get: (key) => ({ key, value: 'test-value', priority: 5 }),
      put: (key, value, opts) => ({ key, value, layer: 'context', priority: opts?.priority || 5 }),
      snapshot: () => ({
        focus: [{ key: 'k1', value: 'v1', priority: 9, layer: 'focus' }],
        context: [],
        scratchpad: [],
        totalItems: 1,
      }),
      getStats: () => ({ totalItems: 1 }),
    },
    messageBus: {
      publish: () => 'msg-1',
      subscribe: () => (() => {}),
    },
    soulDesigner: {
      design: (profile) => 'You are a worker bee...',
      generateSoul: (profile) => 'SOUL snippet',
    },
    planRepo: {
      create: (data) => data.id || 'plan-1',
      get: (id) => ({
        id,
        taskId: null,
        planData: {
          id,
          taskDescription: 'test task',
          status: 'draft',
          roles: ['developer'],
          phases: [{ id: 'ph-1', order: 1, roleName: 'developer', description: 'Phase 1', status: 'pending' }],
          constraints: {},
          maturityScore: 0.85,
          metadata: {},
        },
        status: 'draft',
        createdBy: 'test',
        maturityScore: 0.85,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      list: (status, limit) => [
        {
          id: 'p1', taskId: null, status: 'draft', createdBy: 'test',
          maturityScore: 0.85, createdAt: Date.now(), updatedAt: Date.now(),
          planData: { taskDescription: 'test task', roles: ['dev'] },
        },
      ],
      updateStatus: () => {},
    },
    zoneManager: {
      createZone: (data) => `zone-${Date.now().toString(36)}`,
      assignAgent: (agentId, zoneId) => {},
      autoAssignAgent: (agentId) => ({ zoneId: 'z1', score: 0.75 }),
      listZones: () => [
        { id: 'z1', name: 'frontend', description: 'Frontend zone', techStack: ['react'], leaderId: null, createdAt: Date.now() },
      ],
      getMembers: (zoneId) => [
        { agent_id: 'a1', role: 'member', joined_at: Date.now() },
      ],
      healthCheck: (zoneId) => ({ healthy: true, issues: [], memberCount: 3 }),
      getZone: (zoneId) => ({ id: zoneId, name: 'frontend' }),
    },
    orchestrator: {
      getStats: () => ({ running: 1, completed: 5 }),
    },
    gossipProtocol: {
      updateState: () => {},
    },
    roleManager: {},
    pipelineBreaker: { transition: () => {} },
    circuitBreaker: {},
    contextService: {},
    // 也提供 repos 用于 spawn tool 中 taskRepo/agentRepo 引用
    // Also provide repos for spawn tool taskRepo/agentRepo references
    repos: {},
  };
}

// ============================================================================
// 测试套件 / Test Suites
// ============================================================================

describe('L5 Tool Factories / L5 工具工厂', () => {
  let engines;

  beforeEach(() => {
    engines = createMockEngines();
  });

  // --------------------------------------------------------------------------
  // 11. 工具元数据通用测试 / Tool Metadata Tests
  // --------------------------------------------------------------------------
  describe('Tool metadata / 工具元数据', () => {
    it('all 8 tools should have name, description, parameters, execute / 所有 8 个工具应具有完整元数据', () => {
      const deps = { engines, logger: silentLogger };

      const tools = [
        createSpawnTool(deps),
        createQueryTool(deps),
        createPheromoneTool(deps),
        createGateTool(deps),
        createMemoryTool(deps),
        createPlanTool(deps),
        createZoneTool(deps),
        createRunTool(deps),
      ];

      const expectedNames = [
        'swarm_spawn', 'swarm_query', 'swarm_pheromone',
        'swarm_gate', 'swarm_memory', 'swarm_plan', 'swarm_zone',
        'swarm_run',
      ];

      expect(tools).toHaveLength(8);

      tools.forEach((tool, i) => {
        // 名称 / Name
        expect(tool.name).toBe(expectedNames[i]);

        // 描述 / Description
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);

        // 输入 Schema / Input schema (OpenClaw uses 'parameters')
        expect(tool.parameters).toBeDefined();
        expect(tool.parameters.type).toBe('object');
        expect(tool.parameters.properties).toBeDefined();

        // OpenClaw execute 接口 / OpenClaw execute interface
        expect(typeof tool.execute).toBe('function');
        // 内部 handler (供测试直接调用) / Internal handler (for direct test calls)
        expect(typeof tool.handler).toBe('function');
      });
    });
  });

  // --------------------------------------------------------------------------
  // 1. swarm_spawn 工具测试 / swarm_spawn Tool Tests
  // --------------------------------------------------------------------------
  describe('swarm_spawn / 蜂群生成工具', () => {
    it('spawn action should return success with agentId and role / spawn 动作应返回 success 以及 agentId 和角色', async () => {
      const tool = createSpawnTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'spawn',
        taskDescription: 'Build a REST API for user management',
      });

      expect(result.success).toBe(true);
      expect(result.agentId).toBeDefined();
      expect(result.role).toBe('developer');
      expect(result.taskId).toBeDefined();
      expect(result.message).toBeDefined();
    });

    it('spawn without taskDescription should fail / 无 taskDescription 时 spawn 应失败', async () => {
      const tool = createSpawnTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'spawn',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('list action should return agents / list 动作应返回代理列表', async () => {
      const tool = createSpawnTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'list' });

      expect(result.success).toBe(true);
      expect(result.agents).toBeDefined();
      expect(Array.isArray(result.agents)).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(0);
    });

    it('unknown action should fail / 未知动作应失败', async () => {
      const tool = createSpawnTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'unknown' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action');
    });
  });

  // --------------------------------------------------------------------------
  // 2. swarm_query 工具测试 / swarm_query Tool Tests
  // --------------------------------------------------------------------------
  describe('swarm_query / 蜂群查询工具', () => {
    it('status action should return swarm status / status 动作应返回蜂群状态', async () => {
      const tool = createQueryTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'status' });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.agents).toBeDefined();
      expect(result.data.pheromones).toBeDefined();
      expect(result.data.orchestrator).toBeDefined();
      expect(result.data.timestamp).toBeDefined();
    });

    it('agent action should return agent info / agent 动作应返回代理信息', async () => {
      const tool = createQueryTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'agent', agentId: 'a1' });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.id).toBe('a1');
    });

    it('agent action without agentId should fail / 无 agentId 的 agent 动作应失败', async () => {
      const tool = createQueryTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'agent' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('agents action should return agent list / agents 动作应返回代理列表', async () => {
      const tool = createQueryTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'agents' });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.count).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // 3-4. swarm_pheromone 工具测试 / swarm_pheromone Tool Tests
  // --------------------------------------------------------------------------
  describe('swarm_pheromone / 信息素管理工具', () => {
    it('emit action should return success with pheromoneId / emit 动作应返回 success 和 pheromoneId', async () => {
      const tool = createPheromoneTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'emit',
        type: 'trail',
        scope: '/task/123',
        message: 'Task completed successfully',
      });

      expect(result.success).toBe(true);
      expect(result.pheromoneId).toBe('ph-123');
    });

    it('emit without type should fail / 无 type 的 emit 应失败', async () => {
      const tool = createPheromoneTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'emit',
        scope: '/task/123',
        message: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('read action should return pheromones / read 动作应返回信息素列表', async () => {
      const tool = createPheromoneTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'read',
        scope: '/',
      });

      expect(result.success).toBe(true);
      expect(result.pheromones).toBeDefined();
      expect(Array.isArray(result.pheromones)).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(0);
    });

    it('decay action should return decay stats / decay 动作应返回衰减统计', async () => {
      const tool = createPheromoneTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'decay' });

      expect(result.success).toBe(true);
      expect(result.stats).toBeDefined();
      expect(result.stats.updated).toBe(3);
      expect(result.stats.evaporated).toBe(1);
    });

    it('alarms action should return alarm density / alarms 动作应返回告警密度', async () => {
      const tool = createPheromoneTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'alarms', scope: '/' });

      expect(result.success).toBe(true);
      expect(result.stats).toBeDefined();
      expect(result.stats.alarmCount).toBe(2);
      expect(result.stats.triggered).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 5. swarm_gate 工具测试 / swarm_gate Tool Tests
  // --------------------------------------------------------------------------
  describe('swarm_gate / 质量门控工具', () => {
    it('evaluate action should return evaluation result / evaluate 动作应返回评估结果', async () => {
      const tool = createGateTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'evaluate',
        taskId: 'task-1',
        output: { code: 'console.log("hello")' },
        agentId: 'agent-1',
      });

      expect(result.success).toBe(true);
      expect(result.evaluation).toBeDefined();
      expect(result.evaluation.score).toBe(0.85);
      expect(result.evaluation.verdict).toBe('pass');
      expect(result.evaluation.passed).toBe(true);
    });

    it('evaluate without taskId should fail / 无 taskId 时 evaluate 应失败', async () => {
      const tool = createGateTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'evaluate',
        output: {},
        agentId: 'a1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('stats action should return quality statistics / stats 动作应返回质量统计', async () => {
      const tool = createGateTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'stats' });

      expect(result.success).toBe(true);
      expect(result.stats).toBeDefined();
      expect(result.stats.global).toBeDefined();
    });

    it('appeal action should return appeal status / appeal 动作应返回申诉状态', async () => {
      const tool = createGateTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'appeal',
        evaluationId: 'eval-1',
        reason: 'The evaluation did not consider edge cases',
      });

      expect(result.success).toBe(true);
      expect(result.evaluation).toBeDefined();
      expect(result.evaluation.status).toBe('appeal_submitted');
    });
  });

  // --------------------------------------------------------------------------
  // 6-7. swarm_memory 工具测试 / swarm_memory Tool Tests
  // --------------------------------------------------------------------------
  describe('swarm_memory / 记忆操作工具', () => {
    it('record action should return success with eventId / record 动作应返回 success 和 eventId', async () => {
      const tool = createMemoryTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'record',
        agentId: 'agent-1',
        eventType: 'action',
        subject: 'agent-1',
        predicate: 'completed',
        object: 'task-1',
        importance: 0.8,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.eventId).toBe('ev-1');
    });

    it('record without required fields should fail / 缺少必需字段时 record 应失败', async () => {
      const tool = createMemoryTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'record',
        agentId: 'agent-1',
        // 缺少 eventType, subject, predicate / Missing eventType, subject, predicate
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('recall action should return episodic events / recall 动作应返回情景事件', async () => {
      const tool = createMemoryTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'recall',
        agentId: 'agent-1',
        keyword: 'task',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(0);
    });

    it('knowledge add action should return nodeId / knowledge add 动作应返回 nodeId', async () => {
      const tool = createMemoryTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'knowledge',
        subaction: 'add',
        label: 'TypeScript',
        nodeType: 'concept',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.nodeId).toBe('node-new');
    });

    it('knowledge connect action should return edgeId / knowledge connect 动作应返回 edgeId', async () => {
      const tool = createMemoryTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'knowledge',
        subaction: 'connect',
        sourceId: 'n1',
        targetId: 'n2',
        edgeType: 'uses',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.edgeId).toBe('edge-new');
    });

    it('working snapshot action should return memory snapshot / working snapshot 动作应返回记忆快照', async () => {
      const tool = createMemoryTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'working',
        subaction: 'snapshot',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.totalItems).toBe(1);
    });

    it('stats action should return memory statistics / stats 动作应返回记忆统计', async () => {
      const tool = createMemoryTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'stats', agentId: 'agent-1' });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.workingMemory).toBeDefined();
      expect(result.data.episodicMemory).toBeDefined();
      expect(result.data.semanticMemory).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 8. swarm_plan 工具测试 / swarm_plan Tool Tests
  // --------------------------------------------------------------------------
  describe('swarm_plan / 执行计划工具', () => {
    it('design action should return execution plan / design 动作应返回执行计划', async () => {
      const tool = createPlanTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'design',
        taskDescription: 'Build a microservice architecture for e-commerce platform',
      });

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan.status).toBe('draft');
      expect(result.plan.roles).toBeDefined();
      expect(result.plan.phases).toBeDefined();
      expect(Array.isArray(result.plan.phases)).toBe(true);
      expect(result.plan.maturityScore).toBe(0.85);
    });

    it('design without taskDescription should fail / 无 taskDescription 时 design 应失败', async () => {
      const tool = createPlanTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'design' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('list action should return plans / list 动作应返回计划列表', async () => {
      const tool = createPlanTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'list' });

      expect(result.success).toBe(true);
      expect(result.plans).toBeDefined();
      expect(Array.isArray(result.plans)).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(0);
    });

    it('detail action should return plan details / detail 动作应返回计划详情', async () => {
      const tool = createPlanTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'detail', planId: 'plan-1' });

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan.id).toBe('plan-1');
    });

    it('validate action should return validation result / validate 动作应返回验证结果', async () => {
      const tool = createPlanTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'validate', planId: 'plan-1' });

      expect(result.success).toBe(true);
      expect(result.validation).toBeDefined();
      expect(result.validation.valid).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 9-10. swarm_zone 工具测试 / swarm_zone Tool Tests
  // --------------------------------------------------------------------------
  describe('swarm_zone / Zone 治理工具', () => {
    it('create action should return zone / create 动作应返回 zone', async () => {
      const tool = createZoneTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'create',
        name: 'backend',
        description: 'Backend services zone',
        techStack: ['node', 'postgres'],
      });

      expect(result.success).toBe(true);
      expect(result.zone).toBeDefined();
      expect(result.zone.name).toBe('backend');
      expect(result.zone.techStack).toEqual(['node', 'postgres']);
    });

    it('create without name should fail / 无 name 时 create 应失败', async () => {
      const tool = createZoneTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'create' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('list action should return zones / list 动作应返回 zone 列表', async () => {
      const tool = createZoneTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'list' });

      expect(result.success).toBe(true);
      expect(result.zones).toBeDefined();
      expect(Array.isArray(result.zones)).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(0);
    });

    it('assign action with zoneId should directly assign / 带 zoneId 的 assign 应直接分配', async () => {
      const tool = createZoneTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'assign',
        agentId: 'a1',
        zoneId: 'z1',
      });

      expect(result.success).toBe(true);
      expect(result.zone).toBeDefined();
      expect(result.zone.mode).toBe('direct');
    });

    it('assign action without zoneId should auto-assign / 无 zoneId 的 assign 应自动分配', async () => {
      const tool = createZoneTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        action: 'assign',
        agentId: 'a1',
      });

      expect(result.success).toBe(true);
      expect(result.zone).toBeDefined();
      expect(result.zone.mode).toBe('auto');
      expect(result.zone.jaccardScore).toBeDefined();
    });

    it('members action should return zone members / members 动作应返回 zone 成员', async () => {
      const tool = createZoneTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'members', zoneId: 'z1' });

      expect(result.success).toBe(true);
      expect(result.members).toBeDefined();
      expect(Array.isArray(result.members)).toBe(true);
      expect(result.count).toBeGreaterThan(0);
    });

    it('health action should return health status / health 动作应返回健康状态', async () => {
      const tool = createZoneTool({ engines, logger: silentLogger });
      const result = await tool.handler({ action: 'health', zoneId: 'z1' });

      expect(result.success).toBe(true);
      expect(result.health).toBeDefined();
      expect(result.health.healthy).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 12. 错误处理测试 / Error Handling Tests
  // --------------------------------------------------------------------------
  describe('Error handling / 错误处理', () => {
    it('swarm_spawn should return success:false on engine exception / 引擎异常时 swarm_spawn 应返回 success:false', async () => {
      // 让 agentRepo.createAgent 抛出异常 / Make agentRepo.createAgent throw
      const brokenEngines = createMockEngines();
      brokenEngines.agentRepo.createAgent = () => { throw new Error('DB connection lost'); };

      const tool = createSpawnTool({ engines: brokenEngines, logger: silentLogger });
      const result = await tool.handler({
        action: 'spawn',
        taskDescription: 'Build something',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('DB connection lost');
    });

    it('swarm_query should return success:false on engine exception / 引擎异常时 swarm_query 应返回 success:false', async () => {
      const brokenEngines = createMockEngines();
      brokenEngines.agentRepo.listAgents = () => { throw new Error('Agent DB failure'); };

      const tool = createQueryTool({ engines: brokenEngines, logger: silentLogger });
      const result = await tool.handler({ action: 'agents' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('swarm_pheromone should return success:false on engine exception / 引擎异常时 swarm_pheromone 应返回 success:false', async () => {
      const brokenEngines = createMockEngines();
      brokenEngines.pheromoneEngine.emitPheromone = () => { throw new Error('Pheromone write failure'); };

      const tool = createPheromoneTool({ engines: brokenEngines, logger: silentLogger });
      const result = await tool.handler({
        action: 'emit',
        type: 'trail',
        scope: '/',
        message: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('swarm_memory should return success:false on engine exception / 引擎异常时 swarm_memory 应返回 success:false', async () => {
      const brokenEngines = createMockEngines();
      brokenEngines.episodicMemory.record = () => { throw new Error('Memory write failure'); };

      const tool = createMemoryTool({ engines: brokenEngines, logger: silentLogger });
      const result = await tool.handler({
        action: 'record',
        agentId: 'a1',
        eventType: 'action',
        subject: 'a1',
        predicate: 'did',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('swarm_zone should return success:false on engine exception / 引擎异常时 swarm_zone 应返回 success:false', async () => {
      const brokenEngines = createMockEngines();
      brokenEngines.zoneManager.createZone = () => { throw new Error('Zone DB failure'); };

      const tool = createZoneTool({ engines: brokenEngines, logger: silentLogger });
      const result = await tool.handler({
        action: 'create',
        name: 'broken-zone',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('swarm_plan should return success:false on engine exception / 引擎异常时 swarm_plan 应返回 success:false', async () => {
      const brokenEngines = createMockEngines();
      brokenEngines.executionPlanner.planExecution = () => { throw new Error('Planner failure'); };

      const tool = createPlanTool({ engines: brokenEngines, logger: silentLogger });
      const result = await tool.handler({
        action: 'design',
        taskDescription: 'Build something',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
