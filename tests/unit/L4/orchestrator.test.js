/**
 * Orchestrator 单元测试 / Orchestrator Unit Tests
 *
 * 使用真实 DatabaseManager + 内存 SQLite 测试编排器核心功能。
 * Uses real DatabaseManager + in-memory SQLite to test orchestrator core.
 *
 * 覆盖: decompose, topologicalSort, execute, getStatus, abort
 * Covers: decompose, topologicalSort, execute, getStatus, abort
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../src/L1-infrastructure/database/database-manager.js';
import { TaskRepository } from '../../../src/L1-infrastructure/database/repositories/task-repo.js';
import { AgentRepository } from '../../../src/L1-infrastructure/database/repositories/agent-repo.js';
import { TABLE_SCHEMAS } from '../../../src/L1-infrastructure/schemas/database-schemas.js';
import { Orchestrator } from '../../../src/L4-orchestration/orchestrator.js';
import { TaskStatus } from '../../../src/L1-infrastructure/types.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// 模拟 MessageBus / Mock MessageBus
function createMockMessageBus() {
  const published = [];
  return {
    publish(topic, data) { published.push({ topic, data }); },
    subscribe() {},
    published,
  };
}

describe('Orchestrator', () => {
  let dbManager, taskRepo, agentRepo, messageBus, orchestrator;

  beforeEach(() => {
    // 创建内存数据库并初始化所有表 / Create in-memory DB and bootstrap all tables
    dbManager = new DatabaseManager({ memory: true });
    dbManager.open(TABLE_SCHEMAS);
    taskRepo = new TaskRepository(dbManager);
    agentRepo = new AgentRepository(dbManager);
    messageBus = createMockMessageBus();
    orchestrator = new Orchestrator({
      taskRepo,
      agentRepo,
      messageBus,
      config: {},
      logger: silentLogger,
    });
  });

  afterEach(() => { dbManager.close(); });

  // ━━━ 1. 分解 / Decompose ━━━
  describe('decompose', () => {
    it('应将根任务分解为子任务 / should decompose root task into subtasks', async () => {
      // 创建根任务 / Create root task
      taskRepo.createTask('task-1', { name: 'build-app' });

      const roles = [
        { id: 'r1', name: 'architect', description: 'design', priority: 3 },
        { id: 'r2', name: 'developer', description: 'implement', dependsOn: ['r1'], priority: 2 },
        { id: 'r3', name: 'tester', description: 'test', dependsOn: ['r2'], priority: 1 },
      ];

      const { taskId, subtasks } = await orchestrator.decompose({
        id: 'task-1',
        roles,
      });

      expect(taskId).toBe('task-1');
      expect(subtasks.size).toBe(3);

      // 验证子任务属性 / Verify subtask properties
      const arch = subtasks.get('r1');
      expect(arch).toBeDefined();
      expect(arch.name).toBe('architect');
      expect(arch.status).toBe(TaskStatus.pending);

      // 验证依赖关系 / Verify dependencies
      const dev = subtasks.get('r2');
      expect(dev.dependencies).toContain('r1');

      // 验证事件发布 / Verify event published
      const decomposeEvents = messageBus.published.filter(
        (e) => e.topic === 'orchestrator.decomposed',
      );
      expect(decomposeEvents.length).toBe(1);
      expect(decomposeEvents[0].data.subtaskCount).toBe(3);
    });
  });

  // ━━━ 2. 拓扑排序 - 线性链 / Topological Sort - Linear Chain ━━━
  describe('topologicalSort - linear chain', () => {
    it('线性依赖链应产生正确的层序 / linear dependency chain should produce correct layer order', () => {
      const tasks = new Map([
        ['A', { id: 'A', name: 'A', dependencies: [], priority: 0 }],
        ['B', { id: 'B', name: 'B', dependencies: ['A'], priority: 0 }],
        ['C', { id: 'C', name: 'C', dependencies: ['B'], priority: 0 }],
      ]);

      const layers = orchestrator.topologicalSort(tasks);

      // 应产生 3 层, 每层 1 个 / Should produce 3 layers with 1 task each
      expect(layers).toHaveLength(3);
      expect(layers[0]).toEqual(['A']);
      expect(layers[1]).toEqual(['B']);
      expect(layers[2]).toEqual(['C']);
    });
  });

  // ━━━ 3. 拓扑排序 - 并行任务 / Topological Sort - Parallel Tasks ━━━
  describe('topologicalSort - parallel tasks', () => {
    it('独立任务应在同一层 / independent tasks should be in the same layer', () => {
      const tasks = new Map([
        ['A', { id: 'A', name: 'A', dependencies: [], priority: 0 }],
        ['B', { id: 'B', name: 'B', dependencies: [], priority: 0 }],
        ['C', { id: 'C', name: 'C', dependencies: [], priority: 0 }],
      ]);

      const layers = orchestrator.topologicalSort(tasks);

      // 所有任务应在第一层 / All tasks should be in first layer
      expect(layers).toHaveLength(1);
      expect(layers[0]).toHaveLength(3);
      expect(layers[0]).toContain('A');
      expect(layers[0]).toContain('B');
      expect(layers[0]).toContain('C');
    });
  });

  // ━━━ 4. 拓扑排序 - 环检测 / Topological Sort - Cycle Detection ━━━
  describe('topologicalSort - cycle detection', () => {
    it('循环依赖应抛出错误 / circular dependency should throw error', () => {
      const tasks = new Map([
        ['A', { id: 'A', name: 'A', dependencies: ['C'], priority: 0 }],
        ['B', { id: 'B', name: 'B', dependencies: ['A'], priority: 0 }],
        ['C', { id: 'C', name: 'C', dependencies: ['B'], priority: 0 }],
      ]);

      expect(() => orchestrator.topologicalSort(tasks)).toThrow(/[Cc]ycle/);
    });
  });

  // ━━━ 5. 执行 - 简单流水线 / Execute - Simple Pipeline ━━━
  describe('execute', () => {
    it('简单 2 任务流水线应完成 / simple 2-task pipeline should complete', async () => {
      // 创建根任务 / Create root task
      taskRepo.createTask('exec-1', { name: 'pipeline' });

      // 注入模拟执行器 / Inject mock executor
      orchestrator.setExecutor(async (task, context) => ({
        output: `done-${task.name}`,
        success: true,
      }));

      // 构建子任务 Map / Build subtask map
      const subtasks = new Map([
        ['s1', {
          id: 's1', name: 'step-1', description: 'first step',
          dependencies: [], assignedAgent: null, status: TaskStatus.pending,
          result: null, priority: 1, estimatedDuration: 1000,
          capabilities: [], retryCount: 0, startedAt: null, completedAt: null,
        }],
        ['s2', {
          id: 's2', name: 'step-2', description: 'second step',
          dependencies: ['s1'], assignedAgent: null, status: TaskStatus.pending,
          result: null, priority: 0, estimatedDuration: 1000,
          capabilities: [], retryCount: 0, startedAt: null, completedAt: null,
        }],
      ]);

      // 在 DB 中创建角色 / Create roles in DB for updateRoleStatus
      taskRepo.createRole('s1', 'exec-1', 'step-1', 'first', '[]', 1, '[]');
      taskRepo.createRole('s2', 'exec-1', 'step-2', 'second', '[]', 0, '["s1"]');

      const result = await orchestrator.execute('exec-1', { subtasks });

      expect(result).toBeDefined();
      expect(result.taskId).toBe('exec-1');
      expect(result.successCount).toBe(2);
      expect(result.failCount).toBe(0);
      expect(result.totalSubtasks).toBe(2);

      // 验证子任务结果 / Verify subtask results
      expect(result.subtaskResults.s1.result.output).toBe('done-step-1');
      expect(result.subtaskResults.s2.result.output).toBe('done-step-2');
    });
  });

  // ━━━ 6. 状态查询 / Status ━━━
  describe('getStatus', () => {
    it('应返回正在运行的执行的进度信息 / should return progress info for running execution', async () => {
      taskRepo.createTask('status-1', { name: 'status-check' });

      // 使用延迟执行器以捕获中间状态 / Use delayed executor to capture intermediate state
      let resolveFirst;
      const firstPromise = new Promise((resolve) => { resolveFirst = resolve; });
      let callCount = 0;
      orchestrator.setExecutor(async (task) => {
        callCount++;
        if (callCount === 1) {
          await firstPromise; // 阻塞第一个任务 / Block first task
        }
        return { output: `done-${task.name}`, success: true };
      });

      const subtasks = new Map([
        ['st1', {
          id: 'st1', name: 'task-a', description: '', dependencies: [],
          assignedAgent: null, status: TaskStatus.pending, result: null,
          priority: 0, estimatedDuration: 1000, capabilities: [],
          retryCount: 0, startedAt: null, completedAt: null,
        }],
      ]);

      taskRepo.createRole('st1', 'status-1', 'task-a', '', '[]', 0, '[]');

      // 启动执行但不等待完成 / Start execution without awaiting
      const execPromise = orchestrator.execute('status-1', { subtasks });

      // 等待一点时间让执行开始 / Wait a bit for execution to start
      await new Promise((r) => setTimeout(r, 20));

      const status = orchestrator.getStatus('status-1');
      expect(status).not.toBeNull();
      expect(status.taskId).toBe('status-1');
      expect(status.status).toBe(TaskStatus.running);
      expect(status.source).toBe('memory');
      expect(status.subtasks).toBeDefined();
      expect(status.subtasks.total).toBe(1);

      // 解除阻塞 / Unblock
      resolveFirst();
      await execPromise;
    });
  });

  // ━━━ 7. 取消 / Abort ━━━
  describe('abort', () => {
    it('未运行的任务取消应返回未中止 / should return not aborted for non-running task', () => {
      // abort() 对未在运行的任务应安全处理
      // abort() should handle gracefully for non-running tasks
      const result = orchestrator.abort('nonexistent-task');
      expect(result.aborted).toBe(false);
    });
  });
});
