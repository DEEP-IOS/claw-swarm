/**
 * ExecutionPlanner 单元测试 / ExecutionPlanner Unit Tests
 *
 * 使用真实 DatabaseManager + RoleManager + TaskRepo + AgentRepo 测试 MoE 执行计划器。
 * Uses real DatabaseManager + RoleManager + TaskRepo + AgentRepo to test MoE execution planner.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../src/L1-infrastructure/database/database-manager.js';
import { TaskRepository } from '../../../src/L1-infrastructure/database/repositories/task-repo.js';
import { AgentRepository } from '../../../src/L1-infrastructure/database/repositories/agent-repo.js';
import { TABLE_SCHEMAS } from '../../../src/L1-infrastructure/schemas/database-schemas.js';
import { RoleManager } from '../../../src/L4-orchestration/role-manager.js';
import { ExecutionPlanner } from '../../../src/L4-orchestration/execution-planner.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// Mock MessageBus / 模拟消息总线
const mockBus = { publish() {}, subscribe() {} };

describe('ExecutionPlanner', () => {
  let dbManager, taskRepo, agentRepo, roleManager, planner;

  beforeEach(() => {
    // 创建内存数据库并初始化所有表 / Create in-memory DB and bootstrap all tables
    dbManager = new DatabaseManager({ memory: true });
    dbManager.open(TABLE_SCHEMAS);

    taskRepo = new TaskRepository(dbManager);
    agentRepo = new AgentRepository(dbManager);
    roleManager = new RoleManager({ taskRepo, messageBus: mockBus, logger: silentLogger });

    planner = new ExecutionPlanner({
      taskRepo,
      agentRepo,
      roleManager,
      messageBus: mockBus,
      logger: silentLogger,
    });
  });

  afterEach(() => {
    dbManager.close();
  });

  // ━━━ 1. planExecution 关键词匹配 / keyword-matching task ━━━
  describe('planExecution with keyword-matching task', () => {
    it('应返回包含 developer 角色的推荐列表 / should return roles containing developer for coding tasks', () => {
      const result = planner.planExecution('implement user authentication feature with OAuth2');

      expect(result.roles.length).toBeGreaterThan(0);
      expect(result.scores.length).toBeGreaterThan(0);

      // developer 模板的关键词包含 implement/feature, 应排在前列
      // developer template keywords include implement/feature, should rank high
      const roleNames = result.roles.map(r => r.name);
      expect(roleNames).toContain('developer');
    });

    it('应为测试任务推荐 tester 角色 / should recommend tester role for testing task', () => {
      const result = planner.planExecution('write unit tests and integration tests for auth module');

      const roleNames = result.roles.map(r => r.name);
      expect(roleNames).toContain('tester');
    });
  });

  // ━━━ 2. planExecution 低信心度降级 / low-confidence fallback ━━━
  describe('planExecution with low-confidence fallback', () => {
    it('当描述无法匹配时应降级到 regex / should fallback to regex when description has no keyword match', () => {
      // 使用极高 minConfidence 强制降级 / Use very high minConfidence to force fallback
      const result = planner.planExecution('deploy the docker container to kubernetes cluster', {
        minConfidence: 0.99,
      });

      expect(result.fallback).toBe(true);
      expect(result.roles.length).toBeGreaterThan(0);

      // regex 应匹配 devops (deploy/docker/kubernetes)
      // regex should match devops (deploy/docker/kubernetes)
      const roleNames = result.roles.map(r => r.name);
      expect(roleNames).toContain('devops');
    });

    it('统计中 fallback 计数应递增 / fallback count should increment in stats', () => {
      planner.planExecution('random xyz abc 123', { minConfidence: 0.99 });
      const stats = planner.getStats();
      expect(stats.fallbacks).toBeGreaterThanOrEqual(1);
      expect(stats.selections).toBeGreaterThanOrEqual(1);
    });
  });

  // ━━━ 3. _keywordExpert 评分 (通过结果间接测试) / keyword expert scoring ━━━
  describe('keyword expert scoring via planExecution results', () => {
    it('任务含多个 developer 关键词时 developer 得分应更高 / developer should score higher with many matching keywords', () => {
      const result = planner.planExecution('implement and develop a new feature to build a class module');

      // 找到 developer 的分数 / Find developer score
      const devScore = result.scores.find(s => s.role === 'developer');
      expect(devScore).toBeDefined();
      expect(devScore.details.keyword).toBeGreaterThan(0);
      // developer 的关键词匹配分应该不为零 / keyword score should be non-zero
      expect(devScore.score).toBeGreaterThan(0);
    });
  });

  // ━━━ 4. validatePlan / Plan validation ━━━
  describe('validatePlan', () => {
    it('合法计划应通过验证 / valid plan should pass validation', () => {
      const roles = roleManager.listTemplates().slice(0, 2);
      const plan = planner.generatePlan('build auth module', roles);
      const validation = planner.validatePlan(plan);

      expect(validation.valid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });

    it('无 phases 的计划应失败 / plan without phases should fail', () => {
      const invalidPlan = { id: 'plan-1', taskDescription: 'test', phases: [] };
      const validation = planner.validatePlan(invalidPlan);

      expect(validation.valid).toBe(false);
      expect(validation.issues.length).toBeGreaterThan(0);
    });

    it('null 计划应失败 / null plan should fail', () => {
      const validation = planner.validatePlan(null);
      expect(validation.valid).toBe(false);
    });

    it('缺少 roleName 的阶段应报错 / phase without roleName should report issue', () => {
      const plan = {
        id: 'plan-bad',
        taskDescription: 'test task',
        phases: [{ id: 'p1', order: 1 }], // 无 roleName / no roleName
      };
      const validation = planner.validatePlan(plan);
      expect(validation.valid).toBe(false);
      expect(validation.issues.some(i => i.includes('roleName'))).toBe(true);
    });
  });

  // ━━━ 5. generatePlan / Plan generation ━━━
  describe('generatePlan', () => {
    it('应生成包含 phases 和 metadata 的计划 / should produce plan with phases and metadata', () => {
      const roles = roleManager.listTemplates().slice(0, 3);
      const plan = planner.generatePlan('implement payment system', roles);

      expect(plan.id).toBeTruthy();
      expect(plan.taskDescription).toBe('implement payment system');
      expect(plan.status).toBe('draft');
      expect(plan.phases).toHaveLength(3);
      expect(plan.metadata.generatedBy).toBe('ExecutionPlanner/MoE');
      expect(plan.metadata.version).toBe('5.0');
      expect(plan.metadata.roleCount).toBe(3);
      expect(plan.metadata.phaseCount).toBe(3);

      // 每个阶段应有正确顺序 / Each phase should have correct order
      plan.phases.forEach((phase, i) => {
        expect(phase.order).toBe(i + 1);
        expect(phase.roleName).toBeTruthy();
        expect(phase.status).toBe('pending');
      });

      // maturityScore 应在 [0, 1] / maturityScore should be in [0, 1]
      expect(plan.maturityScore).toBeGreaterThanOrEqual(0);
      expect(plan.maturityScore).toBeLessThanOrEqual(1);

      // constraints 应存在 / constraints should exist
      expect(plan.constraints).toBeDefined();
      expect(plan.constraints.maxFiles).toBeGreaterThan(0);
    });

    it('统计中 plans 计数应递增 / plans count should increment in stats', () => {
      const roles = roleManager.listTemplates().slice(0, 1);
      planner.generatePlan('task A', roles);
      planner.generatePlan('task B', roles);

      const stats = planner.getStats();
      expect(stats.plans).toBe(2);
    });
  });
});
