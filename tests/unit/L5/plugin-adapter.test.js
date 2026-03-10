/**
 * PluginAdapter 单元测试 / PluginAdapter Unit Tests
 *
 * L5 应用层核心: 插件适配器的生命周期、钩子、工具注册测试。
 * L5 application layer core: lifecycle, hooks, and tool registration tests.
 *
 * 由于 PluginAdapter 导入了所有 L1-L4 模块, 采用真实内存数据库的集成测试策略。
 * Since PluginAdapter imports all L1-L4 modules, we use real in-memory DB integration test strategy.
 *
 * @module tests/unit/L5/plugin-adapter.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginAdapter } from '../../../src/L5-application/plugin-adapter.js';

// ============================================================================
// 静默日志器 / Silent Logger
// ============================================================================

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// ============================================================================
// 测试用配置 / Test Configuration
// ============================================================================

/**
 * 创建内存数据库测试配置
 * Create in-memory database test configuration
 */
function createTestConfig() {
  return {
    memory: { inMemory: true },
    // 关闭定时器干扰测试 / Disable timers that may interfere with tests
    pheromone: { decayIntervalMs: 999_999_999 },
    gossip: { heartbeatMs: 999_999_999 },
  };
}

// ============================================================================
// 测试套件 / Test Suites
// ============================================================================

describe('PluginAdapter', () => {

  // --------------------------------------------------------------------------
  // 1. 构造函数测试 / Constructor Tests
  // --------------------------------------------------------------------------
  describe('constructor / 构造函数', () => {
    it('should create PluginAdapter with config and logger / 使用 config 和 logger 创建实例', () => {
      const config = createTestConfig();
      const adapter = new PluginAdapter({ config, logger: silentLogger });

      // 验证初始状态 / Verify initial state
      expect(adapter).toBeDefined();
      expect(adapter._initialized).toBe(false);
      expect(adapter._engines).toEqual({});
      expect(adapter._config).toBe(config);
      expect(adapter._logger).toBe(silentLogger);
      expect(adapter._decayInterval).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // 2. init 生命周期测试 / Init Lifecycle Tests
  // --------------------------------------------------------------------------
  describe('init / 初始化', () => {
    let adapter;

    afterEach(() => {
      // 确保每次测试后正确关闭 / Ensure proper close after each test
      try { adapter?.close(); } catch { /* ignore */ }
    });

    it('should initialize all engines with in-memory database / 使用内存数据库初始化所有引擎', () => {
      adapter = new PluginAdapter({ config: createTestConfig(), logger: silentLogger });
      adapter.init({});

      // 验证初始化标志 / Verify initialization flag
      expect(adapter._initialized).toBe(true);

      // 验证关键引擎实例已创建 / Verify key engine instances are created
      const engines = adapter._engines;
      expect(engines.dbManager).toBeDefined();
      expect(engines.repos).toBeDefined();
      expect(engines.messageBus).toBeDefined();
      expect(engines.pheromoneEngine).toBeDefined();
      expect(engines.gossipProtocol).toBeDefined();
      expect(engines.workingMemory).toBeDefined();
      expect(engines.episodicMemory).toBeDefined();
      expect(engines.semanticMemory).toBeDefined();
      expect(engines.contextCompressor).toBeDefined();
      expect(engines.capabilityEngine).toBeDefined();
      expect(engines.personaEvolution).toBeDefined();
      expect(engines.reputationLedger).toBeDefined();
      expect(engines.soulDesigner).toBeDefined();
      expect(engines.orchestrator).toBeDefined();
      expect(engines.criticalPathAnalyzer).toBeDefined();
      expect(engines.qualityController).toBeDefined();
      expect(engines.pipelineBreaker).toBeDefined();
      expect(engines.resultSynthesizer).toBeDefined();
      expect(engines.roleManager).toBeDefined();
      expect(engines.executionPlanner).toBeDefined();
      expect(engines.contractNet).toBeDefined();
      expect(engines.replanEngine).toBeDefined();
      expect(engines.abcScheduler).toBeDefined();
      expect(engines.roleDiscovery).toBeDefined();
      expect(engines.zoneManager).toBeDefined();
      expect(engines.contextService).toBeDefined();
      expect(engines.circuitBreaker).toBeDefined();
    });

    it('should have all repositories in repos / repos 应包含所有仓库', () => {
      adapter = new PluginAdapter({ config: createTestConfig(), logger: silentLogger });
      adapter.init({});

      const repos = adapter._engines.repos;
      expect(repos.pheromoneRepo).toBeDefined();
      expect(repos.taskRepo).toBeDefined();
      expect(repos.agentRepo).toBeDefined();
      expect(repos.knowledgeRepo).toBeDefined();
      expect(repos.episodicRepo).toBeDefined();
      expect(repos.zoneRepo).toBeDefined();
      expect(repos.planRepo).toBeDefined();
      expect(repos.pheromoneTypeRepo).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 3. getHooks 钩子注册测试 / Hook Registration Tests
  // --------------------------------------------------------------------------
  describe('getHooks / 钩子注册', () => {
    let adapter;

    beforeEach(() => {
      adapter = new PluginAdapter({ config: createTestConfig(), logger: silentLogger });
      adapter.init({});
    });

    afterEach(() => {
      try { adapter?.close(); } catch { /* ignore */ }
    });

    it('should return an object with all 14 hook functions / 返回包含 14 个钩子函数的对象', () => {
      const hooks = adapter.getHooks();

      // 14 个钩子名称 / 14 hook names
      const expectedHooks = [
        'onAgentStart',
        'onAgentEnd',
        'onSubAgentSpawn',
        'onSubAgentComplete',
        'onSubAgentAbort',
        'onToolCall',
        'onToolResult',
        'onPrependContext',
        'onSubAgentMessage',
        'onTaskDecompose',
        'onReplanTrigger',
        'onZoneEvent',
        'onMemoryConsolidate',
        'onPheromoneThreshold',
      ];

      // 验证钩子数量 / Verify hook count
      expect(Object.keys(hooks)).toHaveLength(14);

      // 验证每个钩子都存在且为函数 / Verify each hook exists and is a function
      for (const hookName of expectedHooks) {
        expect(hooks[hookName], `Hook "${hookName}" should exist`).toBeDefined();
        expect(typeof hooks[hookName], `Hook "${hookName}" should be a function`).toBe('function');
      }
    });
  });

  // --------------------------------------------------------------------------
  // 4. getTools 工具注册测试 / Tool Registration Tests
  // --------------------------------------------------------------------------
  describe('getTools / 工具注册', () => {
    let adapter;

    beforeEach(() => {
      adapter = new PluginAdapter({ config: createTestConfig(), logger: silentLogger });
      adapter.init({});
    });

    afterEach(() => {
      try { adapter?.close(); } catch { /* ignore */ }
    });

    it('should return an array of 8 tool definitions / 返回包含 8 个工具定义的数组', () => {
      const tools = adapter.getTools();

      // 验证工具数量 / Verify tool count
      expect(tools).toHaveLength(8);

      // 期望的工具名称 / Expected tool names
      const expectedToolNames = [
        'swarm_spawn',
        'swarm_query',
        'swarm_pheromone',
        'swarm_gate',
        'swarm_memory',
        'swarm_plan',
        'swarm_zone',
        'swarm_run',
      ];

      // 验证每个工具的结构 / Verify each tool's structure
      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.execute).toBe('function');
      }

      // 验证工具名称完整性 / Verify tool name completeness
      const actualNames = tools.map(t => t.name);
      for (const name of expectedToolNames) {
        expect(actualNames, `Tool "${name}" should be present`).toContain(name);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 5. close 关闭测试 / Close Tests
  // --------------------------------------------------------------------------
  describe('close / 关闭', () => {
    it('should set _initialized to false and clear _engines / 关闭后 _initialized 为 false 且 _engines 为空', () => {
      const adapter = new PluginAdapter({ config: createTestConfig(), logger: silentLogger });
      adapter.init({});

      // 确认已初始化 / Confirm initialized
      expect(adapter._initialized).toBe(true);
      expect(Object.keys(adapter._engines).length).toBeGreaterThan(0);

      // 执行关闭 / Perform close
      adapter.close();

      // 验证关闭后状态 / Verify post-close state
      expect(adapter._initialized).toBe(false);
      expect(adapter._engines).toEqual({});
      expect(adapter._decayInterval).toBeNull();
    });

    it('should be safe to call close multiple times / 多次调用 close 应安全', () => {
      const adapter = new PluginAdapter({ config: createTestConfig(), logger: silentLogger });
      adapter.init({});
      adapter.close();

      // 第二次 close 不应抛出 / Second close should not throw
      expect(() => adapter.close()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // 6. init double-call guard / 重复初始化保护
  // --------------------------------------------------------------------------
  describe('init double-call guard / 重复初始化保护', () => {
    it('should be a no-op on second init call / 第二次 init 调用应为空操作', () => {
      const adapter = new PluginAdapter({ config: createTestConfig(), logger: silentLogger });
      adapter.init({});

      // 记录第一次初始化后的引擎引用 / Record engine reference after first init
      const firstEngines = adapter._engines;
      const firstDbManager = firstEngines.dbManager;

      // 第二次调用 init / Second init call
      adapter.init({});

      // 引擎引用应相同 (未被重建) / Engine references should be the same (not rebuilt)
      expect(adapter._engines.dbManager).toBe(firstDbManager);

      adapter.close();
    });
  });

  // --------------------------------------------------------------------------
  // 7-10. 钩子行为测试 / Hook Behavior Tests
  // --------------------------------------------------------------------------
  describe('hook behaviors / 钩子行为', () => {
    let adapter;
    let hooks;

    beforeEach(() => {
      adapter = new PluginAdapter({ config: createTestConfig(), logger: silentLogger });
      adapter.init({});
      hooks = adapter.getHooks();
    });

    afterEach(() => {
      try { adapter?.close(); } catch { /* ignore */ }
    });

    // -- 7. onAgentStart --
    it('onAgentStart should update gossip state to active / onAgentStart 应更新 gossip 状态为 active', async () => {
      const agentId = 'agent-test-1';

      // 调用钩子 / Call hook
      await hooks.onAgentStart({ agentId });

      // 验证 Gossip 状态已更新 / Verify gossip state is updated
      const gossip = adapter._engines.gossipProtocol;
      const allStates = gossip.getAllStates();

      expect(allStates.has(agentId)).toBe(true);

      const agentState = allStates.get(agentId);
      expect(agentState.status).toBe('active');
      expect(agentState.startedAt).toBeDefined();
    });

    // -- 8. onAgentEnd --
    it('onAgentEnd should update gossip state to completed / onAgentEnd 应更新 gossip 状态为 completed', async () => {
      const agentId = 'agent-test-2';

      // 先启动 agent / Start agent first
      await hooks.onAgentStart({ agentId });

      // 然后结束 agent / Then end agent
      await hooks.onAgentEnd({ agentId });

      // 验证 Gossip 状态已更新为 completed / Verify gossip state is 'completed'
      const gossip = adapter._engines.gossipProtocol;
      const allStates = gossip.getAllStates();

      expect(allStates.has(agentId)).toBe(true);

      const agentState = allStates.get(agentId);
      expect(agentState.status).toBe('completed');
      expect(agentState.completedAt).toBeDefined();
    });

    // -- 9. onPrependContext --
    it('onPrependContext should return object with prependText / onPrependContext 应返回包含 prependText 的对象', async () => {
      const agentId = 'agent-test-3';

      // 调用上下文注入钩子 / Call context injection hook
      const result = await hooks.onPrependContext({ agentId });

      // 验证返回值结构 / Verify return value structure
      expect(result).toBeDefined();
      expect(result).toHaveProperty('prependText');
      expect(typeof result.prependText).toBe('string');

      // 上下文文本应包含 Swarm 标记 / Context text should contain Swarm markers
      expect(result.prependText).toContain('Swarm Context');
    });

    // -- 10. onMemoryConsolidate --
    it('onMemoryConsolidate should return consolidatedCount / onMemoryConsolidate 应返回 consolidatedCount', async () => {
      const agentId = 'agent-test-4';

      // 先在工作记忆中放入一些数据 / Put some data in working memory first
      const workingMemory = adapter._engines.workingMemory;
      workingMemory.put('test-key-1', 'test-value-1', { priority: 9 });
      workingMemory.put('test-key-2', 'test-value-2', { priority: 5 });

      // 调用记忆固化钩子 / Call memory consolidation hook
      const result = await hooks.onMemoryConsolidate({ agentId });

      // 验证返回值 / Verify return value
      expect(result).toBeDefined();
      expect(result).toHaveProperty('consolidatedCount');
      expect(typeof result.consolidatedCount).toBe('number');
      // 工作记忆中有数据, 固化数量应 > 0 / Working memory has data, consolidated count should be > 0
      expect(result.consolidatedCount).toBeGreaterThan(0);
    });

    // -- 额外: onSubAgentSpawn 返回 soulSnippet --
    it('onSubAgentSpawn should return soulSnippet / onSubAgentSpawn 应返回 soulSnippet', async () => {
      const event = {
        subAgentId: 'sub-agent-1',
        subAgentName: 'test-sub-agent',
        parentAgentId: 'parent-1',
        tier: 'trainee',
        persona: 'worker-bee',
      };

      const result = await hooks.onSubAgentSpawn(event);

      // 验证返回值有 soulSnippet 属性 / Verify return has soulSnippet property
      expect(result).toBeDefined();
      expect(result).toHaveProperty('soulSnippet');
      expect(typeof result.soulSnippet).toBe('string');
    });

    // -- 额外: onToolCall 不抛出 --
    it('onToolCall should not throw / onToolCall 不应抛出异常', async () => {
      await expect(
        hooks.onToolCall({ toolName: 'test-tool', agentId: 'a1', args: {} })
      ).resolves.not.toThrow();
    });

    // -- 额外: onSubAgentAbort 更新 gossip --
    it('onSubAgentAbort should update gossip state to aborted / onSubAgentAbort 应更新 gossip 状态为 aborted', async () => {
      const subAgentId = 'sub-abort-1';

      await hooks.onSubAgentAbort({
        subAgentId,
        taskId: 'task-1',
        reason: 'test abort',
      });

      const gossip = adapter._engines.gossipProtocol;
      const allStates = gossip.getAllStates();
      expect(allStates.has(subAgentId)).toBe(true);

      const state = allStates.get(subAgentId);
      expect(state.status).toBe('aborted');
      expect(state.reason).toBe('test abort');
    });
  });

  // --------------------------------------------------------------------------
  // 11. 子 Agent 生命周期辅助方法 / Sub-Agent Lifecycle Helper Methods
  // --------------------------------------------------------------------------
  describe('findAgentRecord / findTaskForAgent', () => {
    let adapter;

    beforeEach(() => {
      adapter = new PluginAdapter({ config: createTestConfig(), logger: silentLogger });
      adapter.init({});
    });

    afterEach(() => {
      try { adapter?.close(); } catch { /* ignore */ }
    });

    it('findAgentRecord should return null for unknown agent / 未知 Agent 返回 null', () => {
      const result = adapter.findAgentRecord('nonexistent-agent');
      expect(result).toBeNull();
    });

    it('findAgentRecord should return agent record after creation / 创建后返回 Agent 记录', () => {
      const agentRepo = adapter._engines.repos.agentRepo;
      const agentId = agentRepo.createAgent({
        name: 'test-sub',
        role: 'developer',
        tier: 'trainee',
        status: 'active',
      });

      const result = adapter.findAgentRecord(agentId);
      expect(result).toBeDefined();
      expect(result.role).toBe('developer');
    });

    it('findTaskForAgent should return null when no tasks / 无任务时返回 null', () => {
      const result = adapter.findTaskForAgent('no-task-agent');
      expect(result).toBeNull();
    });

    it('findTaskForAgent should return task assigned to agent / 返回分配给 Agent 的任务', () => {
      const taskRepo = adapter._engines.repos.taskRepo;
      const taskId = 'test-task-1';

      taskRepo.createTask(taskId, {
        description: 'test task',
        assignedAgent: 'my-agent-id',
      }, 'live');
      taskRepo.updateTaskStatus(taskId, 'running');

      const result = adapter.findTaskForAgent('my-agent-id');
      expect(result).toBeDefined();
      expect(result.id).toBe(taskId);
    });
  });
});
