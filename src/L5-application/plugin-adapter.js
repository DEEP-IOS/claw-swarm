/**
 * PluginAdapter -- OpenClaw 蜂群智能插件适配器 / OpenClaw Swarm Intelligence Plugin Adapter
 *
 * V5.0 L5 应用层核心: OpenClaw 生命周期与蜂群引擎的桥接器。
 * V5.0 L5 application layer core: bridges OpenClaw lifecycle with swarm engine.
 *
 * 职责 / Responsibilities:
 * - 管理引擎生命周期 (init, close, cleanup)
 * - 注册 14 个 V5.0 内部钩子, 将生命周期事件路由到内部引擎
 * - 注册 7 个 OpenClaw 工具, 向 Agent 暴露蜂群能力
 * - 提供 getHooks() / getTools() 供 src/index.js 的 register(api) 桥接使用
 * - 提供 findAgentRecord() / findTaskForAgent() 供工具驱动的子 Agent 生命周期使用
 *
 * - Manages engine lifecycle (init, close, cleanup)
 * - Registers 14 internal V5.0 hooks, routing lifecycle events to internal engines
 * - Registers 7 OpenClaw tools, exposing swarm capabilities to agents
 * - Provides getHooks() / getTools() for src/index.js register(api) bridge
 * - Provides findAgentRecord() / findTaskForAgent() for tool-driven sub-agent lifecycle
 *
 * 架构原则 / Architecture principle:
 * - L5 是唯一与 OpenClaw API 耦合的层
 * - 所有下层引擎通过依赖注入组装
 * - close() 按创建的逆序关闭所有引擎
 *
 * - L5 is the ONLY layer coupled to OpenClaw API
 * - All lower-layer engines are wired via dependency injection
 * - close() shuts down engines in reverse creation order
 *
 * [MAINTAINER] 维护者注意 / Maintainer notes:
 *
 *   1. 此类不直接调用 OpenClaw 的 api.on() — 那是 src/index.js 的职责。
 *      本类返回 14 个内部钩子处理器 (getHooks()), index.js 负责将它们
 *      映射到 OpenClaw 的 8 个事件上。
 *      This class does NOT call api.on() directly — that's src/index.js's job.
 *      This class returns 14 internal hook handlers (getHooks()), and index.js
 *      maps them to OpenClaw's 8 events.
 *
 *   2. 引擎创建顺序 (init): L1 → L2 → L3 → L4 → L5
 *      引擎销毁顺序 (close): L4 Orchestrator → L2 Gossip → L2 MessageBus → L1 DB
 *      Engine creation order (init): L1 → L2 → L3 → L4 → L5
 *      Engine destruction order (close): L4 Orchestrator → L2 Gossip → L2 MessageBus → L1 DB
 *
 *   3. 新增引擎时: 在 init() 中添加创建代码, 在 close() 中按逆序添加销毁代码。
 *      When adding new engines: add creation in init(), add destruction in close() in reverse order.
 *
 *   4. 14 个内部钩子中, 8 个有对应 OpenClaw 事件, 6 个仅在内部通过 MessageBus 触发:
 *      - 有映射: onAgentStart, onAgentEnd, onSubAgentSpawn, onSubAgentComplete,
 *               onSubAgentAbort, onToolCall, onToolResult, onPrependContext,
 *               onSubAgentMessage, onMemoryConsolidate
 *      - 仅内部: onTaskDecompose, onReplanTrigger, onZoneEvent, onPheromoneThreshold
 *      Of the 14 internal hooks, 8 map to OpenClaw events, 6 are internal-only via MessageBus.
 *
 * @module L5-application/plugin-adapter
 * @author DEEP-IOS
 */

// ── L1 基础设施 / L1 Infrastructure ─────────────────────────────────────────
import { DatabaseManager } from '../L1-infrastructure/database/database-manager.js';
import { PheromoneRepository } from '../L1-infrastructure/database/repositories/pheromone-repo.js';
import { TaskRepository } from '../L1-infrastructure/database/repositories/task-repo.js';
import { AgentRepository } from '../L1-infrastructure/database/repositories/agent-repo.js';
import { KnowledgeRepository } from '../L1-infrastructure/database/repositories/knowledge-repo.js';
import { EpisodicRepository } from '../L1-infrastructure/database/repositories/episodic-repo.js';
import { ZoneRepository } from '../L1-infrastructure/database/repositories/zone-repo.js';
import { PlanRepository } from '../L1-infrastructure/database/repositories/plan-repo.js';
import { PheromoneTypeRepository } from '../L1-infrastructure/database/repositories/pheromone-type-repo.js';
import { TABLE_SCHEMAS } from '../L1-infrastructure/schemas/database-schemas.js';
import { ConfigManager } from '../L1-infrastructure/config/config-manager.js';

// ── L2 通信层 / L2 Communication ────────────────────────────────────────────
import { MessageBus } from '../L2-communication/message-bus.js';
import { PheromoneEngine } from '../L2-communication/pheromone-engine.js';
import { GossipProtocol } from '../L2-communication/gossip-protocol.js';
import { PheromoneTypeRegistry } from '../L2-communication/pheromone-type-registry.js';

// ── L3 代理层 / L3 Agent ────────────────────────────────────────────────────
import { WorkingMemory } from '../L3-agent/memory/working-memory.js';
import { EpisodicMemory } from '../L3-agent/memory/episodic-memory.js';
import { SemanticMemory } from '../L3-agent/memory/semantic-memory.js';
import { ContextCompressor } from '../L3-agent/memory/context-compressor.js';
import { CapabilityEngine } from '../L3-agent/capability-engine.js';
import { PersonaEvolution } from '../L3-agent/persona-evolution.js';
import { ReputationLedger } from '../L3-agent/reputation-ledger.js';
import { SoulDesigner } from '../L3-agent/soul-designer.js';

// ── L4 编排层 / L4 Orchestration ────────────────────────────────────────────
import { Orchestrator } from '../L4-orchestration/orchestrator.js';
import { CriticalPathAnalyzer } from '../L4-orchestration/critical-path.js';
import { QualityController } from '../L4-orchestration/quality-controller.js';
import { PipelineBreaker } from '../L4-orchestration/pipeline-breaker.js';
import { ResultSynthesizer } from '../L4-orchestration/result-synthesizer.js';
import { ExecutionPlanner } from '../L4-orchestration/execution-planner.js';
import { ContractNet } from '../L4-orchestration/contract-net.js';
import { ReplanEngine } from '../L4-orchestration/replan-engine.js';
import { ABCScheduler } from '../L4-orchestration/abc-scheduler.js';
import { RoleDiscovery } from '../L4-orchestration/role-discovery.js';
import { RoleManager } from '../L4-orchestration/role-manager.js';
import { ZoneManager } from '../L4-orchestration/zone-manager.js';
// V5.1 新增 / V5.1 additions
import { HierarchicalCoordinator } from '../L4-orchestration/hierarchical-coordinator.js';
import { TaskDAGEngine } from '../L4-orchestration/task-dag-engine.js';
import { SpeciesEvolver } from '../L4-orchestration/species-evolver.js';

// ── L5 应用层 / L5 Application ──────────────────────────────────────────────
import { ContextService } from './context-service.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { SkillGovernor } from './skill-governor.js';
import { TokenBudgetTracker } from './token-budget-tracker.js';

// ── V5.1 事件目录 / V5.1 Event Catalog ──────────────────────────────────────
import { EventTopics, wrapEvent } from '../event-catalog.js';

// ── 工具工厂 / Tool Factories ───────────────────────────────────────────────
import { createSpawnTool } from './tools/swarm-spawn-tool.js';
import { createQueryTool } from './tools/swarm-query-tool.js';
import { createPheromoneTool } from './tools/swarm-pheromone-tool.js';
import { createGateTool } from './tools/swarm-gate-tool.js';
import { createMemoryTool } from './tools/swarm-memory-tool.js';
import { createPlanTool } from './tools/swarm-plan-tool.js';
import { createZoneTool } from './tools/swarm-zone-tool.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 版本号 / Version */
const VERSION = '5.2.0';

/** 默认信息素衰减间隔 (ms) / Default pheromone decay interval */
const DEFAULT_DECAY_INTERVAL_MS = 60_000;

/** Gossip 心跳间隔 (ms) / Gossip heartbeat interval */
const DEFAULT_GOSSIP_HEARTBEAT_MS = 5_000;

// ============================================================================
// PluginAdapter 主类 / Main Class
// ============================================================================

export class PluginAdapter {
  /**
   * @param {Object} options
   * @param {Object} options.config - 用户配置 (由 ConfigManager 合并后) / User config (merged via ConfigManager)
   * @param {Object} options.logger - pino logger 实例 / pino logger instance
   */
  constructor({ config, logger }) {
    /** @type {Object} 合并后的配置 / Merged config */
    this._config = config;

    /** @type {Object} pino logger */
    this._logger = logger;

    /** @type {Object} 所有引擎实例 / All engine instances */
    this._engines = {};

    /** @type {boolean} 初始化标志 / Initialization flag */
    this._initialized = false;

    /** @type {number | null} 衰减定时器 / Decay interval timer */
    this._decayInterval = null;
  }

  // ━━━ 生命周期 / Lifecycle ━━━

  /**
   * 初始化所有下层引擎, 组装依赖关系
   * Initialize all lower-layer engines and wire dependencies
   *
   * 按层级顺序创建: L1 -> L2 -> L3 -> L4 -> L5 (ContextService, CircuitBreaker)
   * Creates in layer order: L1 -> L2 -> L3 -> L4 -> L5
   *
   * @param {Object} openclaw - OpenClaw API 对象 / OpenClaw API object
   */
  init(openclaw) {
    if (this._initialized) {
      this._logger.warn?.('[PluginAdapter] 已初始化, 跳过 / Already initialized, skipping');
      return;
    }

    this._logger.info?.(`[PluginAdapter] Claw-Swarm V${VERSION} 初始化中... / Initializing...`);
    const config = this._config;
    const logger = this._logger;

    // ── L1: 数据库 + Repositories ──────────────────────────────────────
    const dbManager = new DatabaseManager({
      dbPath: config.dbPath || null,
      memory: config.memory?.inMemory || false,
      logger,
    });
    dbManager.open(TABLE_SCHEMAS);
    this._engines.dbManager = dbManager;

    // 创建所有仓库 / Create all repositories
    const pheromoneRepo = new PheromoneRepository(dbManager);
    const taskRepo = new TaskRepository(dbManager);
    const agentRepo = new AgentRepository(dbManager);
    const knowledgeRepo = new KnowledgeRepository(dbManager);
    const episodicRepo = new EpisodicRepository(dbManager);
    const zoneRepo = new ZoneRepository(dbManager);
    const planRepo = new PlanRepository(dbManager);
    const pheromoneTypeRepo = new PheromoneTypeRepository(dbManager);

    this._engines.repos = {
      pheromoneRepo, taskRepo, agentRepo, knowledgeRepo,
      episodicRepo, zoneRepo, planRepo, pheromoneTypeRepo,
    };

    // ── L2: 通信层 ────────────────────────────────────────────────────
    const messageBus = new MessageBus({
      logger,
      enableHistory: config.messageBus?.enableHistory ?? true,
      enableDLQ: config.messageBus?.enableDLQ ?? true,
    });
    this._engines.messageBus = messageBus;

    const pheromoneTypeRegistry = new PheromoneTypeRegistry({ pheromoneTypeRepo, logger });
    this._engines.pheromoneTypeRegistry = pheromoneTypeRegistry;

    const pheromoneEngine = new PheromoneEngine({
      pheromoneRepo,
      typeRegistry: pheromoneTypeRegistry,
      messageBus,
      logger,
      config: config.pheromone || {},
    });
    this._engines.pheromoneEngine = pheromoneEngine;

    const gossipProtocol = new GossipProtocol({
      messageBus,
      logger,
      fanout: config.gossip?.fanout || 3,
    });
    this._engines.gossipProtocol = gossipProtocol;

    // 启动 Gossip 心跳 / Start gossip heartbeat
    gossipProtocol.startHeartbeat(
      config.gossip?.heartbeatMs || DEFAULT_GOSSIP_HEARTBEAT_MS,
    );

    // 启动后台信息素衰减 / Start background pheromone decay
    const decayMs = config.pheromone?.decayIntervalMs || DEFAULT_DECAY_INTERVAL_MS;
    this._decayInterval = setInterval(() => {
      try {
        pheromoneEngine.decayPass();
      } catch (err) {
        logger.warn?.(`[PluginAdapter] 信息素衰减出错 / Pheromone decay error: ${err.message}`);
      }
    }, decayMs);
    if (this._decayInterval.unref) this._decayInterval.unref();

    // ── L3: 代理层 ────────────────────────────────────────────────────
    const workingMemory = new WorkingMemory({
      maxFocus: config.memory?.maxFocus || 5,
      maxContext: config.memory?.maxContext || 15,
      maxScratch: config.memory?.maxScratch || 30,
      logger,
    });
    this._engines.workingMemory = workingMemory;

    const episodicMemory = new EpisodicMemory({ episodicRepo, messageBus, logger });
    this._engines.episodicMemory = episodicMemory;

    const semanticMemory = new SemanticMemory({ knowledgeRepo, messageBus, logger });
    this._engines.semanticMemory = semanticMemory;

    const contextCompressor = new ContextCompressor({
      maxItems: config.context?.maxItems || 20,
      maxChars: config.context?.maxChars || 4000,
    });
    this._engines.contextCompressor = contextCompressor;

    const capabilityEngine = new CapabilityEngine({
      agentRepo,
      messageBus,
      logger,
      config: {
        ...(config.capability || {}),
        // V5.1: evolution.scoring 控制评分启用
        enabled: config.evolution?.scoring ?? false,
      },
    });
    this._engines.capabilityEngine = capabilityEngine;

    const personaEvolution = new PersonaEvolution({ agentRepo, messageBus, logger });
    this._engines.personaEvolution = personaEvolution;

    const reputationLedger = new ReputationLedger({
      agentRepo,
      messageBus,
      logger,
      config: config.reputation || {},
    });
    this._engines.reputationLedger = reputationLedger;

    const soulDesigner = new SoulDesigner({ logger });
    this._engines.soulDesigner = soulDesigner;

    // ── L4: 编排层 ────────────────────────────────────────────────────
    const orchestrator = new Orchestrator({
      taskRepo, agentRepo, messageBus,
      config: config.orchestration || {},
      logger,
    });
    this._engines.orchestrator = orchestrator;

    const criticalPathAnalyzer = new CriticalPathAnalyzer({ logger });
    this._engines.criticalPathAnalyzer = criticalPathAnalyzer;

    const qualityController = new QualityController({
      taskRepo, agentRepo, messageBus,
      config: config.quality || {},
      logger,
    });
    this._engines.qualityController = qualityController;

    const pipelineBreaker = new PipelineBreaker({
      taskRepo, messageBus,
      config: config.pipeline || {},
      logger,
    });
    this._engines.pipelineBreaker = pipelineBreaker;

    const resultSynthesizer = new ResultSynthesizer({
      config: config.synthesizer || {},
      logger,
    });
    this._engines.resultSynthesizer = resultSynthesizer;

    const roleManager = new RoleManager({
      taskRepo, messageBus,
      config: config.roleManager || {},
      logger,
    });
    this._engines.roleManager = roleManager;

    const executionPlanner = new ExecutionPlanner({
      taskRepo, agentRepo, roleManager, messageBus,
      config: config.planner || {},
      logger,
    });
    this._engines.executionPlanner = executionPlanner;

    const contractNet = new ContractNet({
      messageBus,
      config: config.contractNet || {},
      logger,
    });
    this._engines.contractNet = contractNet;

    const replanEngine = new ReplanEngine({
      pheromoneEngine, orchestrator, messageBus,
      config: config.replan || {},
      logger,
    });
    this._engines.replanEngine = replanEngine;

    const abcScheduler = new ABCScheduler({
      messageBus,
      config: config.abc || {},
      logger,
    });
    this._engines.abcScheduler = abcScheduler;

    const roleDiscovery = new RoleDiscovery({
      agentRepo, roleManager, messageBus, logger,
    });
    this._engines.roleDiscovery = roleDiscovery;

    const zoneManager = new ZoneManager({
      zoneRepo, agentRepo, messageBus,
      config: config.zone || {},
      logger,
    });
    this._engines.zoneManager = zoneManager;

    // V5.1: 层级蜂群协调器 / Hierarchical swarm coordinator
    if (config.hierarchical?.enabled !== false) {
      try {
        const hierarchicalCoordinator = new HierarchicalCoordinator({
          messageBus, pheromoneEngine, agentRepo,
          logger,
          config: config.hierarchical || {},
        });
        this._engines.hierarchicalCoordinator = hierarchicalCoordinator;
        logger.info?.('[PluginAdapter] HierarchicalCoordinator initialized');
      } catch (err) {
        logger.warn?.(`[PluginAdapter] HierarchicalCoordinator init failed: ${err.message}`);
      }
    }

    // V5.1: DAG 任务编排引擎 / DAG task orchestration engine
    if (config.dagEngine?.enabled !== false && config.hierarchical?.enabled !== false) {
      try {
        const dagEngine = new TaskDAGEngine({
          messageBus, pheromoneEngine, agentRepo, taskRepo,
          capabilityEngine,
          logger,
          config: config.dagEngine || {},
        });
        this._engines.dagEngine = dagEngine;
        logger.info?.('[PluginAdapter] TaskDAGEngine initialized');
      } catch (err) {
        logger.warn?.(`[PluginAdapter] TaskDAGEngine init failed: ${err.message}`);
      }
    }

    // V5.1 Phase 4: 种群进化器（依赖 evolution.scoring）
    // V5.1 Phase 4: Species evolver (requires evolution.scoring)
    if (config.evolution?.scoring) {
      try {
        const speciesEvolver = new SpeciesEvolver({
          messageBus,
          capabilityEngine,
          roleManager,
          logger,
          config: {
            enabled: true,
            clustering: config.evolution?.clustering ?? false,
            gep: config.evolution?.gep ?? false,
            minTasksPerAgent: config.evolution?.minTasksPerAgent ?? 10,
            silhouetteThreshold: config.evolution?.silhouetteThreshold ?? 0.45,
          },
        });
        this._engines.speciesEvolver = speciesEvolver;
        logger.info?.('[PluginAdapter] SpeciesEvolver initialized');
      } catch (err) {
        logger.warn?.(`[PluginAdapter] SpeciesEvolver init failed: ${err.message}`);
      }
    }

    // ── L5: 应用层服务 ────────────────────────────────────────────────
    const contextService = new ContextService({
      workingMemory, episodicMemory, semanticMemory, contextCompressor,
      pheromoneEngine, gossipProtocol, messageBus, logger,
    });
    this._engines.contextService = contextService;

    const circuitBreaker = new CircuitBreaker({
      failureThreshold: config.circuitBreaker?.failureThreshold || 5,
      successThreshold: config.circuitBreaker?.successThreshold || 3,
      resetTimeoutMs: config.circuitBreaker?.resetTimeoutMs || 30000,
      logger,
    });
    this._engines.circuitBreaker = circuitBreaker;

    // V5.1 Phase 5: Skills 治理引擎 / V5.1 Phase 5: Skill Governor
    if (config.skillGovernor?.enabled) {
      try {
        const skillGovernor = new SkillGovernor({
          messageBus,
          capabilityEngine,
          roleManager,
          logger,
          config: {
            enabled: true,
            useCapabilityWeighting: config.skillGovernor?.useCapabilityWeighting ?? true,
            skillDirs: config.skillGovernor?.skillDirs || [],
          },
        });
        this._engines.skillGovernor = skillGovernor;
        logger.info?.('[PluginAdapter] SkillGovernor initialized');
      } catch (err) {
        logger.warn?.(`[PluginAdapter] SkillGovernor init failed: ${err.message}`);
      }
    }

    // V5.1: Token 预算协调器 / Token budget tracker
    this._engines.tokenBudgetTracker = new TokenBudgetTracker({
      totalBudget: 800,
      quotas: {
        swarmContext: 500,
        skillRecommendation: 200,
        toolFailureHint: 100,
      },
    });

    // V5.1: 去重守卫——plugin-adapter 内部维护已发布 agent ID Set
    // V5.1: Dedup guard — plugin-adapter maintains its own published agent ID Set
    /** @type {Set<string>} */
    this._publishedAgentIds = new Set();

    this._initialized = true;
    this._logger.info?.(`[PluginAdapter] Claw-Swarm V${VERSION} 初始化完成 / Initialized successfully`);
  }

  /**
   * V5.1: 引擎健康自检 / Engine health self-check
   *
   * @returns {{ initialized: boolean, dbReachable: boolean, messageBusActive: boolean, engineCount: number }}
   */
  healthCheck() {
    let dbReachable = false;
    try {
      const db = this._engines.dbManager;
      if (db) {
        // 简单查询测试 DB 可达性 / Simple query to test DB reachability
        db._db?.prepare?.('SELECT 1')?.get?.();
        dbReachable = true;
      }
    } catch {
      // DB 不可达 / DB unreachable
    }

    return {
      initialized: this._initialized,
      dbReachable,
      messageBusActive: !!(this._engines.messageBus?.subscriberCount > 0 ||
                           this._engines.messageBus?._subscribers?.size > 0),
      engineCount: Object.keys(this._engines).length,
    };
  }

  /**
   * 关闭所有引擎, 释放资源 (按创建逆序)
   * Close all engines and release resources (in reverse creation order)
   */
  close() {
    if (!this._initialized) return;

    this._logger.info?.('[PluginAdapter] 正在关闭... / Shutting down...');

    // 停止定时器 / Stop timers
    if (this._decayInterval) {
      clearInterval(this._decayInterval);
      this._decayInterval = null;
    }

    // 逆序关闭 / Close in reverse order

    // L5: V5.1 Skills 治理引擎销毁 / L5: V5.1 Skill Governor destroy
    try { this._engines.skillGovernor?.destroy?.(); } catch (e) { this._logCloseError('skillGovernor', e); }

    // L4: V5.1 种群进化器销毁 / L4: V5.1 Species evolver destroy
    try { this._engines.speciesEvolver?.destroy?.(); } catch (e) { this._logCloseError('speciesEvolver', e); }

    // L4: V5.1 DAG 引擎销毁 / L4: V5.1 DAG engine destroy
    try { this._engines.dagEngine?.destroy?.(); } catch (e) { this._logCloseError('dagEngine', e); }

    // L4: V5.1 层级协调器销毁 / L4: V5.1 Hierarchical coordinator destroy
    try { this._engines.hierarchicalCoordinator?.destroy?.(); } catch (e) { this._logCloseError('hierarchicalCoordinator', e); }

    // L4: 编排层销毁 / L4: Orchestration layer destroy
    try { this._engines.orchestrator?.destroy?.(); } catch (e) { this._logCloseError('orchestrator', e); }

    // L2: Gossip 停止心跳 / L2: Gossip stop heartbeat
    try { this._engines.gossipProtocol?.destroy?.(); } catch (e) { this._logCloseError('gossipProtocol', e); }

    // L2: 消息总线销毁 / L2: Message bus destroy
    try { this._engines.messageBus?.destroy?.(); } catch (e) { this._logCloseError('messageBus', e); }

    // L1: 数据库关闭 / L1: Database close
    try { this._engines.dbManager?.close?.(); } catch (e) { this._logCloseError('dbManager', e); }

    this._engines = {};
    this._initialized = false;
    this._logger.info?.('[PluginAdapter] 关闭完成 / Shutdown complete');
  }

  // ━━━ 钩子注册 / Hook Registration ━━━

  /**
   * 获取所有 OpenClaw 钩子定义
   * Get all OpenClaw hook definitions
   *
   * 返回一个对象, 键为钩子名, 值为处理函数。
   * Returns an object mapping hook names to handler functions.
   *
   * @returns {Object<string, Function>} 钩子映射 / Hook map
   */
  getHooks() {
    const engines = this._engines;
    const logger = this._logger;
    const config = this._config;
    const publishedAgentIds = this._publishedAgentIds;

    return {
      // ── 1. onAgentStart: 初始化蜂群引擎 / Initialize swarm engine ──
      onAgentStart: async (event) => {
        logger.info?.(`[Hook:onAgentStart] Agent 启动 / Agent starting: ${event.agentId}`);

        // 在 Gossip 中注册 Agent 状态 / Register agent state in gossip
        engines.gossipProtocol?.updateState(event.agentId, {
          status: 'active',
          startedAt: Date.now(),
          task: event.taskDescription || null,
        });

        // 在 Agent 仓库中注册 / Register in agent repository
        try {
          engines.repos?.agentRepo?.upsertAgent?.(event.agentId, {
            status: 'active',
            tier: event.tier || 'trainee',
          });
        } catch (err) {
          logger.warn?.(`[Hook:onAgentStart] Agent 注册失败 / Agent registration failed: ${err.message}`);
        }

        // V5.1: 发布 agent.registered 事件（去重守卫）
        // V5.1: Publish agent.registered event (with dedup guard)
        if (!publishedAgentIds.has(event.agentId)) {
          publishedAgentIds.add(event.agentId);
          engines.messageBus?.publish?.(
            EventTopics.AGENT_REGISTERED,
            wrapEvent(EventTopics.AGENT_REGISTERED, {
              agentId: event.agentId,
              role: event.role || null,
              tier: event.tier || 'trainee',
              status: 'online',
            }, 'plugin-adapter')
          );
        }
      },

      // ── 2. onAgentEnd: 保存状态, 清理 / Save state, cleanup ──────
      onAgentEnd: async (event) => {
        const traceId = event.traceId || null;
        logger.info?.(`[Hook:onAgentEnd]${traceId ? ` [trace:${traceId}]` : ''} Agent 结束 / Agent ending: ${event.agentId}`);

        // 固化工作记忆到情景记忆 / Consolidate working memory to episodic
        try {
          const snapshot = engines.workingMemory?.snapshot?.();
          if (snapshot && snapshot.totalItems > 0) {
            const allItems = [...snapshot.focus, ...snapshot.context, ...snapshot.scratchpad];
            engines.episodicMemory?.consolidate?.(event.agentId, allItems);
          }
        } catch (err) {
          logger.warn?.(`[Hook:onAgentEnd] 记忆固化失败 / Memory consolidation failed: ${err.message}`);
        }

        // 更新 Gossip 状态 / Update gossip state
        engines.gossipProtocol?.updateState(event.agentId, {
          status: 'completed',
          completedAt: Date.now(),
        });

        // 清除上下文缓存 / Clear context cache
        engines.contextService?.invalidateCache?.(event.agentId);

        // V5.1: 发布 agent.end 事件 / Publish agent.end event
        engines.messageBus?.publish?.(
          EventTopics.AGENT_END,
          wrapEvent(EventTopics.AGENT_END, {
            agentId: event.agentId,
            status: 'offline',
          }, 'plugin-adapter')
        );
        publishedAgentIds.delete(event.agentId);
      },

      // ── 3. onSubAgentSpawn: 注入 SOUL 片段 + Trace 传播 / Inject SOUL snippet + Trace propagation ──
      onSubAgentSpawn: async (event) => {
        // 生成 Trace Context / Generate Trace Context
        const traceId = event.traceId || `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const spanId = `sp_${Math.random().toString(36).slice(2, 10)}`;
        logger.info?.(`[Hook:onSubAgentSpawn] [trace:${traceId}] 子代理生成 / SubAgent spawning: ${event.subAgentId}`);

        // 通过 SoulDesigner 生成 SOUL 片段 / Generate SOUL snippet via SoulDesigner
        let soulSnippet = '';
        try {
          const profile = {
            id: event.subAgentId,
            name: event.subAgentName || event.subAgentId,
            tier: event.tier || 'trainee',
            persona: event.persona || 'worker-bee',
            behavior: event.behavior || 'adaptive',
            capabilities: event.capabilities || null,
            zoneId: event.zoneId || null,
            zoneName: event.zoneName || null,
            taskDescription: event.taskDescription || null,
            role: event.role || null,
          };

          soulSnippet = engines.soulDesigner?.design?.(profile) || '';

          // 如果有角色模板, 使用角色 SOUL / If role template available, use role SOUL
          if (event.roleTemplate) {
            soulSnippet = engines.soulDesigner?.designForRole?.(event.roleTemplate, profile) || soulSnippet;
          }
        } catch (err) {
          logger.warn?.(`[Hook:onSubAgentSpawn] SOUL 生成失败 / SOUL generation failed: ${err.message}`);
        }

        // 在 Gossip 中注册子代理 / Register sub-agent in gossip
        engines.gossipProtocol?.updateState(event.subAgentId, {
          status: 'spawned',
          parentId: event.parentAgentId || null,
          spawnedAt: Date.now(),
        });

        return { soulSnippet, traceId, spanId };
      },

      // ── 4. onSubAgentComplete: 质量门控 + 信息素强化 ──────────────
      //    Quality gate check + pheromone reinforcement
      onSubAgentComplete: async (event) => {
        const traceId = event.traceId || null;
        logger.info?.(`[Hook:onSubAgentComplete]${traceId ? ` [trace:${traceId}]` : ''} 子代理完成 / SubAgent completed: ${event.subAgentId}`);

        // 质量门控检查 / Quality gate check
        let qualityResult = null;
        try {
          qualityResult = await engines.qualityController?.evaluate?.({
            taskId: event.taskId,
            agentId: event.subAgentId,
            result: event.result,
          });
        } catch (err) {
          logger.warn?.(`[Hook:onSubAgentComplete] 质量评审失败 / Quality review failed: ${err.message}`);
        }

        // 信息素强化: 成功 → TRAIL, 失败 → ALARM / Reinforce: success → TRAIL, fail → ALARM
        try {
          const passed = qualityResult?.verdict === 'pass' || qualityResult?.verdict === 'conditional';
          engines.pheromoneEngine?.emitPheromone?.({
            type: passed ? 'trail' : 'alarm',
            sourceId: event.subAgentId,
            targetScope: event.taskScope || `/task/${event.taskId}`,
            intensity: passed ? 0.8 : 0.6,
            payload: { taskId: event.taskId, verdict: qualityResult?.verdict, traceId },
          });
        } catch (err) {
          logger.warn?.(`[Hook:onSubAgentComplete] 信息素发射失败 / Pheromone emit failed: ${err.message}`);
        }

        // 更新声誉 / Update reputation
        try {
          engines.reputationLedger?.recordOutcome?.({
            agentId: event.subAgentId,
            taskId: event.taskId,
            success: qualityResult?.verdict === 'pass',
          });
        } catch (err) {
          logger.warn?.(`[Hook:onSubAgentComplete] 声誉更新失败 / Reputation update failed: ${err.message}`);
        }

        // V5.1: 发布 task.completed 事件 / Publish task.completed event
        engines.messageBus?.publish?.(
          EventTopics.TASK_COMPLETED,
          wrapEvent(EventTopics.TASK_COMPLETED, {
            taskId: event.taskId,
            agentId: event.subAgentId,
            verdict: qualityResult?.verdict || 'unknown',
          }, 'plugin-adapter', { traceId })
        );

        return { qualityResult, traceId };
      },

      // ── 5. onSubAgentAbort: 管道中断 + ALARM 信息素 ──────────────
      //    Pipeline breaker + alarm pheromone
      onSubAgentAbort: async (event) => {
        const traceId = event.traceId || null;
        logger.warn?.(`[Hook:onSubAgentAbort]${traceId ? ` [trace:${traceId}]` : ''} 子代理中止 / SubAgent aborted: ${event.subAgentId}`);

        // 管道中断器处理 / Pipeline breaker handling
        try {
          engines.pipelineBreaker?.transition?.(event.taskId, 'failed', {
            reason: event.reason || 'SubAgent aborted',
            agentId: event.subAgentId,
          });
        } catch (err) {
          logger.warn?.(`[Hook:onSubAgentAbort] 管道中断失败 / Pipeline break failed: ${err.message}`);
        }

        // 发射 ALARM 信息素 / Emit ALARM pheromone
        try {
          engines.pheromoneEngine?.emitPheromone?.({
            type: 'alarm',
            sourceId: event.subAgentId,
            targetScope: event.taskScope || `/task/${event.taskId}`,
            intensity: 1.0,
            payload: { reason: event.reason, taskId: event.taskId, traceId },
          });
        } catch (err) {
          logger.warn?.(`[Hook:onSubAgentAbort] ALARM 发射失败 / ALARM emit failed: ${err.message}`);
        }

        // 更新 Gossip 状态 / Update gossip state
        engines.gossipProtocol?.updateState(event.subAgentId, {
          status: 'aborted',
          reason: event.reason,
          abortedAt: Date.now(),
        });

        // V5.1: 发布 task.failed 事件 / Publish task.failed event
        engines.messageBus?.publish?.(
          EventTopics.TASK_FAILED,
          wrapEvent(EventTopics.TASK_FAILED, {
            taskId: event.taskId,
            agentId: event.subAgentId,
            reason: event.reason,
          }, 'plugin-adapter', { traceId })
        );
      },

      // ── 6. onToolCall: 工具调用拦截/监控 ─────────────────────────
      //    Tool call interception / monitoring
      onToolCall: async (event) => {
        logger.debug?.(`[Hook:onToolCall] 工具调用 / Tool call: ${event.toolName} by ${event.agentId}`);

        // 记录到工作记忆 / Record to working memory
        try {
          engines.workingMemory?.put?.(`tool:${event.toolName}:${Date.now()}`, {
            toolName: event.toolName,
            agentId: event.agentId,
            args: event.args,
          }, { priority: 3, importance: 0.3 });
        } catch { /* 静默失败 / Silent failure */ }
      },

      // ── 7. onToolResult: 结果监控 + 指标收集 ─────────────────────
      //    Result monitoring + metric collection
      onToolResult: async (event) => {
        logger.debug?.(`[Hook:onToolResult] 工具结果 / Tool result: ${event.toolName}`);

        // 能力维度更新 / Capability dimension update
        try {
          if (event.agentId && event.success !== undefined) {
            engines.capabilityEngine?.recordObservation?.({
              agentId: event.agentId,
              dimension: event.dimension || 'coding',
              success: event.success,
              weight: 0.1,
            });
          }
        } catch { /* 静默失败 / Silent failure */ }
      },

      // ── 8. onPrependContext: 上下文注入 ───────────────────────────
      //    Context injection (memory + knowledge + pheromone)
      onPrependContext: async (event) => {
        logger.debug?.(`[Hook:onPrependContext] 上下文注入 / Context inject for ${event.agentId}`);

        try {
          const contextText = engines.contextService?.buildPrependContext?.(
            event.agentId,
            event.taskDescription || null,
          );
          return { prependText: contextText || '' };
        } catch (err) {
          logger.warn?.(`[Hook:onPrependContext] 上下文构建失败 / Context build failed: ${err.message}`);
          return { prependText: '' };
        }
      },

      // ── 9. onSubAgentMessage: Agent 间消息路由 ───────────────────
      //    Agent-to-agent message routing via MessageBus
      onSubAgentMessage: async (event) => {
        logger.debug?.(`[Hook:onSubAgentMessage] 消息路由 / Message routing: ${event.senderId} -> ${event.receiverId}`);

        try {
          engines.messageBus?.publish?.('agent.message', {
            senderId: event.senderId,
            receiverId: event.receiverId,
            content: event.content,
            messageType: event.messageType || 'direct',
          }, { senderId: event.senderId });

          // Gossip 广播 (如果是广播类型)
          // Gossip broadcast (if broadcast type)
          if (event.broadcast) {
            engines.gossipProtocol?.broadcast?.(event.senderId, {
              type: 'agent.message',
              content: event.content,
            });
          }
        } catch (err) {
          logger.warn?.(`[Hook:onSubAgentMessage] 消息路由失败 / Message routing failed: ${err.message}`);
        }
      },

      // ── 10. onTaskDecompose: 任务分解拦截 ────────────────────────
      //    Task decomposition interception
      onTaskDecompose: async (event) => {
        logger.info?.(`[Hook:onTaskDecompose] 任务分解 / Task decompose: ${event.taskId}`);

        try {
          const result = await engines.orchestrator?.decompose?.({
            id: event.taskId,
            description: event.description,
            roles: event.roles || [],
          });
          return { decomposition: result };
        } catch (err) {
          logger.warn?.(`[Hook:onTaskDecompose] 任务分解失败 / Task decomposition failed: ${err.message}`);
          return { decomposition: null };
        }
      },

      // ── 11. onReplanTrigger: 重规划事件 ──────────────────────────
      //    Replan event handling
      onReplanTrigger: async (event) => {
        logger.info?.(`[Hook:onReplanTrigger] 重规划触发 / Replan triggered for task: ${event.taskId}`);

        try {
          const result = await engines.replanEngine?.checkAndReplan?.(event.taskScope || `/task/${event.taskId}`);
          return { replanResult: result };
        } catch (err) {
          logger.warn?.(`[Hook:onReplanTrigger] 重规划失败 / Replan failed: ${err.message}`);
          return { replanResult: null };
        }
      },

      // ── 12. onZoneEvent: Zone 治理事件 ───────────────────────────
      //    Zone governance event handling
      onZoneEvent: async (event) => {
        logger.info?.(`[Hook:onZoneEvent] Zone 事件 / Zone event: ${event.eventType} for zone ${event.zoneId}`);

        try {
          switch (event.eventType) {
            case 'member.join':
              engines.zoneManager?.addMember?.(event.zoneId, event.agentId);
              break;
            case 'member.leave':
              engines.zoneManager?.removeMember?.(event.zoneId, event.agentId);
              break;
            case 'leader.elect':
              engines.zoneManager?.electLeader?.(event.zoneId);
              break;
            case 'health.check':
              return { health: engines.zoneManager?.healthCheck?.(event.zoneId) };
            default:
              logger.debug?.(`[Hook:onZoneEvent] 未知 Zone 事件类型 / Unknown zone event type: ${event.eventType}`);
          }
        } catch (err) {
          logger.warn?.(`[Hook:onZoneEvent] Zone 事件处理失败 / Zone event handling failed: ${err.message}`);
        }
      },

      // ── 13. onMemoryConsolidate: 记忆固化事件 ────────────────────
      //    Memory consolidation event
      onMemoryConsolidate: async (event) => {
        logger.info?.(`[Hook:onMemoryConsolidate] 记忆固化 / Memory consolidation for: ${event.agentId}`);

        try {
          // 工作记忆 -> 情景记忆 / Working memory -> Episodic memory
          const snapshot = engines.workingMemory?.snapshot?.();
          if (snapshot && snapshot.totalItems > 0) {
            const allItems = [...snapshot.focus, ...snapshot.context, ...snapshot.scratchpad];
            const eventIds = engines.episodicMemory?.consolidate?.(event.agentId, allItems);

            // 情景记忆清理 (Ebbinghaus 遗忘) / Episodic pruning (Ebbinghaus forgetting)
            engines.episodicMemory?.prune?.();

            return { consolidatedCount: eventIds?.length || 0 };
          }
        } catch (err) {
          logger.warn?.(`[Hook:onMemoryConsolidate] 记忆固化失败 / Consolidation failed: ${err.message}`);
        }

        return { consolidatedCount: 0 };
      },

      // ── 14. onPheromoneThreshold: 信息素阈值告警 ─────────────────
      //    Pheromone threshold alert
      onPheromoneThreshold: async (event) => {
        logger.warn?.(
          `[Hook:onPheromoneThreshold] 信息素阈值触发 / Pheromone threshold triggered: ` +
          `type=${event.type}, scope=${event.scope}, count=${event.count}`,
        );

        // 检查 ALARM 密度, 可能触发重规划
        // Check ALARM density, may trigger replan
        try {
          if (event.type === 'alarm') {
            const density = engines.pheromoneEngine?.getAlarmDensity?.(event.scope);
            if (density?.triggered) {
              logger.warn?.(`[Hook:onPheromoneThreshold] ALARM 密度超限, 触发重规划 / ALARM density exceeded, triggering replan`);
              await engines.replanEngine?.checkAndReplan?.(event.scope);
            }
          }
        } catch (err) {
          logger.warn?.(`[Hook:onPheromoneThreshold] 阈值处理失败 / Threshold handling failed: ${err.message}`);
        }
      },
    };
  }

  // ━━━ 工具注册 / Tool Registration ━━━

  /**
   * 获取所有 OpenClaw 工具定义
   * Get all OpenClaw tool definitions
   *
   * 每个工具由工厂函数创建, 接收 { engines, logger }。
   * Each tool is created by a factory function receiving { engines, logger }.
   *
   * @returns {Array<{ name: string, description: string, parameters: Object, execute: Function }>}
   */
  getTools() {
    // 展平 repos 到 engines 顶层, 工具可直接解构 agentRepo/taskRepo 等
    // Flatten repos onto engines top-level so tools can destructure directly
    const toolDeps = {
      engines: { ...this._engines, ...this._engines.repos },
      logger: this._logger,
    };

    return [
      // 1. swarm_spawn: 蜂群生成 / Swarm spawning
      createSpawnTool(toolDeps),

      // 2. swarm_query: 蜂群状态查询 / Swarm state query
      createQueryTool(toolDeps),

      // 3. swarm_pheromone: 信息素操作 / Pheromone operations
      createPheromoneTool(toolDeps),

      // 4. swarm_gate: 质量门控 / Quality gate
      createGateTool(toolDeps),

      // 5. swarm_memory: 记忆操作 / Memory operations
      createMemoryTool(toolDeps),

      // 6. swarm_plan: 执行计划 / Execution plan
      createPlanTool(toolDeps),

      // 7. swarm_zone: Zone 管理 / Zone management
      createZoneTool(toolDeps),
    ];
  }

  // ━━━ 子 Agent 生命周期辅助 / Sub-Agent Lifecycle Helpers ━━━

  /**
   * 查找 Agent 记录 (由 swarm_spawn 工具创建)
   * Find agent record (created by swarm_spawn tool)
   *
   * 用于 before_agent_start 中判断是否需要注入 SOUL 片段。
   * Used in before_agent_start to determine if SOUL snippet injection is needed.
   *
   * @param {string} agentId - Agent ID
   * @returns {Object | null} Agent 记录, 包含 role/tier/persona 等 / Agent record with role/tier/persona etc.
   */
  findAgentRecord(agentId) {
    try {
      return this._engines.repos?.agentRepo?.getAgent?.(agentId) || null;
    } catch {
      return null;
    }
  }

  /**
   * 查找 Agent 关联的任务 (由 swarm_spawn 工具创建)
   * Find task associated with an agent (created by swarm_spawn tool)
   *
   * 用于 agent_end 中判断是否需要触发质量门控。
   * Used in agent_end to determine if quality gate should be triggered.
   *
   * @param {string} agentId - Agent ID
   * @returns {Object | null} 任务记录 / Task record, or null
   */
  findTaskForAgent(agentId) {
    try {
      const taskRepo = this._engines.repos?.taskRepo;
      if (!taskRepo) return null;

      // 查找分配给此 Agent 的运行中任务
      // Find running tasks assigned to this agent
      const tasks = taskRepo.listTasks?.('running') || [];
      for (const task of tasks) {
        if (task.config?.assignedAgent === agentId) {
          return task;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 记录关闭时错误 (不中断关闭流程)
   * Log close-time error (does not interrupt shutdown)
   *
   * @param {string} name - 引擎名称 / Engine name
   * @param {Error} err - 错误 / Error
   * @private
   */
  _logCloseError(name, err) {
    this._logger.warn?.(`[PluginAdapter] 关闭 ${name} 时出错 / Error closing ${name}: ${err.message}`);
  }
}
