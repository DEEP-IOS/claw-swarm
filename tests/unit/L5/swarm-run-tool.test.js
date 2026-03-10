/**
 * SwarmRunTool 单元测试 / SwarmRunTool Unit Tests
 *
 * 测试 swarm_run 高层一键执行工具的三种模式:
 * Tests the swarm_run high-level one-click execution tool's three modes:
 * - auto:      设计计划 + 立即派遣 / Design plan + immediately dispatch
 * - plan_only: 仅设计计划 / Design plan only
 * - execute:   对已有计划执行派遣 / Execute existing plan
 *
 * @module tests/unit/L5/swarm-run-tool.test
 * @version 5.3.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRunTool } from '../../../src/L5-application/tools/swarm-run-tool.js';

// ============================================================================
// 静默日志器 / Silent Logger
// ============================================================================

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// ============================================================================
// Mock 引擎工厂 / Mock Engines Factory
// ============================================================================

function createMockEngines() {
  return {
    executionPlanner: {
      planExecution: (desc, opts) => ({
        roles: [
          { id: 'r1', name: 'scout', description: 'Scout role', score: 0.9 },
          { id: 'r2', name: 'developer', description: 'Developer role', score: 0.8 },
        ],
        scores: [
          { name: 'scout', score: 0.9 },
          { name: 'developer', score: 0.8 },
        ],
        fallback: false,
      }),
      generatePlan: (taskDesc, roles) => ({
        id: `plan-${Date.now().toString(36)}`,
        taskDescription: taskDesc,
        status: 'draft',
        roles: roles.map(r => r.name),
        phases: [
          { id: 'ph-1', order: 1, roleName: 'scout', description: 'Phase 1: Research', status: 'pending' },
          { id: 'ph-2', order: 2, roleName: 'developer', description: 'Phase 2: Implement', status: 'pending' },
        ],
        constraints: {},
        maturityScore: 0.85,
        metadata: {},
      }),
    },
    taskRepo: {
      createTask: vi.fn((id, data, status) => id),
      updateTaskStatus: vi.fn(),
    },
    agentRepo: {
      createAgent: vi.fn((data) => `agent-${Date.now().toString(36)}`),
    },
    pheromoneEngine: {
      emitPheromone: vi.fn(() => 'ph-123'),
    },
    planRepo: {
      create: vi.fn((data) => data.id || 'plan-1'),
      get: vi.fn((id) => ({
        id,
        taskId: null,
        planData: {
          id,
          taskDescription: 'existing task',
          status: 'draft',
          roles: ['developer'],
          phases: [
            { id: 'ph-1', order: 1, roleName: 'developer', description: 'Phase 1: Build', status: 'pending' },
          ],
          constraints: {},
          maturityScore: 0.80,
          metadata: {},
        },
        status: 'draft',
        createdBy: 'test',
        maturityScore: 0.80,
      })),
      updateStatus: vi.fn(),
    },
    messageBus: {
      publish: vi.fn(() => 'msg-1'),
    },
    soulDesigner: {
      generateSoul: () => 'SOUL snippet',
    },
    hierarchicalCoordinator: null, // 默认无并发限制 / No concurrency limit by default
  };
}

// ============================================================================
// 测试套件 / Test Suites
// ============================================================================

describe('SwarmRunTool / 蜂群一键执行工具', () => {
  let engines;

  beforeEach(() => {
    engines = createMockEngines();
  });

  // --------------------------------------------------------------------------
  // 元数据 / Metadata
  // --------------------------------------------------------------------------
  describe('Tool metadata / 工具元数据', () => {
    it('should have correct name, description, parameters, execute', () => {
      const tool = createRunTool({ engines, logger: silentLogger });

      expect(tool.name).toBe('swarm_run');
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties.goal).toBeDefined();
      expect(tool.parameters.properties.mode).toBeDefined();
      expect(tool.parameters.required).toContain('goal');
      expect(typeof tool.execute).toBe('function');
      expect(typeof tool.handler).toBe('function');
    });
  });

  // --------------------------------------------------------------------------
  // auto 模式 / auto mode
  // --------------------------------------------------------------------------
  describe('auto mode / 自动模式', () => {
    it('should design plan and dispatch sub-agents / 应设计计划并派遣子代理', async () => {
      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        goal: '分析A股大盘走势, 调研Tushare daily接口获取数据',
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('auto');
      expect(result.plan).toBeDefined();
      expect(result.plan.id).toBeDefined();
      expect(result.plan.status).toBe('executing');
      expect(result.plan.phases).toBeDefined();
      expect(result.plan.phases.length).toBe(2);
      expect(result.dispatched).toBeDefined();
      expect(result.dispatched.length).toBe(2);
      expect(result.summary).toBeDefined();

      // 验证调用了 agentRepo.createAgent / Verify agentRepo.createAgent was called
      expect(engines.agentRepo.createAgent).toHaveBeenCalledTimes(2);

      // 验证调用了 taskRepo.createTask / Verify taskRepo.createTask was called
      expect(engines.taskRepo.createTask).toHaveBeenCalledTimes(2);

      // 验证调用了 pheromoneEngine.emitPheromone / Verify pheromone was emitted
      expect(engines.pheromoneEngine.emitPheromone).toHaveBeenCalledTimes(2);

      // 验证调用了 planRepo.updateStatus / Verify plan status was updated
      expect(engines.planRepo.updateStatus).toHaveBeenCalled();
    });

    it('should default to auto mode when mode not specified / 未指定 mode 时应默认 auto', async () => {
      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        goal: 'Build a REST API',
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('auto');
    });

    it('should fail with empty goal / 空 goal 应失败', async () => {
      const tool = createRunTool({ engines, logger: silentLogger });

      const result1 = await tool.handler({ goal: '' });
      expect(result1.success).toBe(false);
      expect(result1.error).toBeDefined();

      const result2 = await tool.handler({ goal: '   ' });
      expect(result2.success).toBe(false);

      const result3 = await tool.handler({});
      expect(result3.success).toBe(false);
    });

    it('should fail when executionPlanner not available / executionPlanner 不可用时应失败', async () => {
      engines.executionPlanner = null;
      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        goal: 'Some complex task',
        mode: 'auto',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('executionPlanner');
    });

    it('should include roleScores in result / 结果应包含 roleScores', async () => {
      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        goal: 'Complex analysis task',
      });

      expect(result.roleScores).toBeDefined();
      expect(result.roleScores.length).toBeGreaterThan(0);
    });

    it('dispatched entries should have agentId and taskId / 派遣条目应包含 agentId 和 taskId', async () => {
      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        goal: 'Build something',
      });

      for (const d of result.dispatched) {
        expect(d.agentId).toBeDefined();
        expect(d.taskId).toBeDefined();
        expect(d.roleName).toBeDefined();
        expect(d.description).toBeDefined();
        expect(d.phaseOrder).toBeDefined();
      }
    });
  });

  // --------------------------------------------------------------------------
  // plan_only 模式 / plan_only mode
  // --------------------------------------------------------------------------
  describe('plan_only mode / 仅规划模式', () => {
    it('should design plan without dispatching / 应设计计划但不派遣', async () => {
      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        goal: 'Design a microservice architecture',
        mode: 'plan_only',
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('plan_only');
      expect(result.plan).toBeDefined();
      expect(result.plan.status).toBe('draft');
      expect(result.dispatched).toBeUndefined();
      expect(result.summary).toContain('计划已就绪');

      // 不应调用 agentRepo.createAgent / Should NOT call agentRepo.createAgent
      expect(engines.agentRepo.createAgent).not.toHaveBeenCalled();

      // 不应发射信息素 / Should NOT emit pheromone
      expect(engines.pheromoneEngine.emitPheromone).not.toHaveBeenCalled();
    });

    it('should fail with empty goal / 空 goal 应失败', async () => {
      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        goal: '',
        mode: 'plan_only',
      });

      expect(result.success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // execute 模式 / execute mode
  // --------------------------------------------------------------------------
  describe('execute mode / 执行模式', () => {
    it('should dispatch sub-agents for existing plan / 应为已有计划派遣子代理', async () => {
      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        goal: 'Execute the plan',
        mode: 'execute',
        planId: 'plan-existing',
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('execute');
      expect(result.planId).toBe('plan-existing');
      expect(result.dispatched).toBeDefined();
      expect(result.dispatched.length).toBe(1); // Mock plan has 1 phase

      // 验证加载了计划 / Verify plan was loaded
      expect(engines.planRepo.get).toHaveBeenCalledWith('plan-existing');
    });

    it('should fail without planId / 无 planId 应失败', async () => {
      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        goal: 'Execute something',
        mode: 'execute',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('planId');
    });

    it('should fail when plan not found / 计划不存在时应失败', async () => {
      engines.planRepo.get = vi.fn(() => null);

      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        goal: 'Execute the plan',
        mode: 'execute',
        planId: 'non-existent',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // --------------------------------------------------------------------------
  // 并发限制 / Concurrency Limits
  // --------------------------------------------------------------------------
  describe('Concurrency limits / 并发限制', () => {
    it('should reject when swarm capacity insufficient / 蜂群容量不足时应拒绝', async () => {
      engines.hierarchicalCoordinator = {
        getStats: () => ({
          currentActiveAgents: 9,
          swarmMaxAgents: 10,
        }),
      };

      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        goal: 'Complex task needing many agents',
      });

      // 计划有 2 个 phase, 但只剩 1 个空位
      // Plan has 2 phases but only 1 slot left
      expect(result.success).toBe(false);
      expect(result.dispatched).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // execute 接口 / execute interface (OpenClaw 格式)
  // --------------------------------------------------------------------------
  describe('execute interface / OpenClaw execute 接口', () => {
    it('should return content array with JSON text / 应返回包含 JSON 文本的 content 数组', async () => {
      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.execute('call-1', {
        goal: 'Build a feature',
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.mode).toBe('auto');
    });
  });

  // --------------------------------------------------------------------------
  // 边界情况 / Edge Cases
  // --------------------------------------------------------------------------
  describe('Edge cases / 边界情况', () => {
    it('should handle unknown mode / 应处理未知模式', async () => {
      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        goal: 'Some task',
        mode: 'invalid_mode',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown mode');
    });

    it('should handle no roles found / 应处理未找到角色', async () => {
      engines.executionPlanner.planExecution = () => ({
        roles: [],
        scores: [],
        fallback: false,
      });

      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        goal: 'Some task',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('角色');
    });

    it('should gracefully handle agentRepo failure / 应优雅处理 agentRepo 失败', async () => {
      engines.agentRepo.createAgent = vi.fn(() => { throw new Error('DB error'); });

      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        goal: 'Some task',
      });

      // 应记录错误但不完全崩溃 / Should record errors but not crash
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should work without optional engines / 可选引擎不存在时应正常工作', async () => {
      engines.pheromoneEngine = null;
      engines.soulDesigner = null;
      engines.messageBus = null;
      engines.hierarchicalCoordinator = null;

      const tool = createRunTool({ engines, logger: silentLogger });
      const result = await tool.handler({
        goal: 'Simple task',
      });

      // 仍然应该成功 (只有核心引擎是必须的)
      // Should still succeed (only core engines are required)
      expect(result.success).toBe(true);
      expect(result.dispatched.length).toBeGreaterThan(0);
    });

    it('should respect maxRoles parameter / 应尊重 maxRoles 参数', async () => {
      const planExecutionSpy = vi.fn(engines.executionPlanner.planExecution);
      engines.executionPlanner.planExecution = planExecutionSpy;

      const tool = createRunTool({ engines, logger: silentLogger });
      await tool.handler({
        goal: 'Complex task',
        maxRoles: 3,
      });

      expect(planExecutionSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ topK: 3 })
      );
    });
  });
});
