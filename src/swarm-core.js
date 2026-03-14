/**
 * SwarmCore — 蜂群智能子进程入口 / Swarm Intelligence Child Process Entry
 *
 * V6.0 架构核心: 从 index.js (插件瘦壳) 通过 child_process.fork() 启动,
 * 承载全部引擎初始化逻辑和钩子/工具处理。
 *
 * V6.0 architecture core: launched from index.js (thin plugin shell) via
 * child_process.fork(), hosts all engine initialization and hook/tool handling.
 *
 * 生命周期:
 *   父进程 fork() → SwarmCore 构造 → bridge.handle() 注册 → 等待 'init' 调用
 *   → init(config, pluginConfig) → 引擎组装 → 钩子/工具就绪 → 运行 → close()
 *
 * @module swarm-core
 * @author DEEP-IOS
 */

import { IPCBridge } from './L1-infrastructure/ipc-bridge.js';
import { PluginAdapter } from './L5-application/plugin-adapter.js';
import { ToolResilience } from './L5-application/tool-resilience.js';
import { HealthChecker } from './L6-monitoring/health-checker.js';
import { buildSwarmContextFallback } from './L3-agent/swarm-context-engine.js';
import { HierarchicalCoordinator } from './L4-orchestration/hierarchical-coordinator.js';
import { PheromoneResponseMatrix } from './L2-communication/pheromone-response-matrix.js';
import { ResponseThreshold } from './L3-agent/response-threshold.js';
import { StigmergicBoard } from './L2-communication/stigmergic-board.js';
import { FailureVaccination } from './L3-agent/failure-vaccination.js';
import { SkillSymbiosisTracker } from './L3-agent/skill-symbiosis.js';
import { SwarmAdvisor } from './L4-orchestration/swarm-advisor.js';
import { StateConvergence } from './L2-communication/state-convergence.js';
import { GlobalModulator } from './L4-orchestration/global-modulator.js';
import { GovernanceMetrics } from './L4-orchestration/governance-metrics.js';
import { EventTopics, wrapEvent } from './event-catalog.js';
import { spawnPhaseViaRelay } from './L5-application/tools/swarm-run-tool.js';
import { buildSubagentFailureMessage, extractSubagentFailureReason } from './L5-application/subagent-failure-message.js';
import { SignalCalibrator } from './L4-orchestration/signal-calibrator.js';
import { FailureModeAnalyzer } from './L3-agent/failure-mode-analyzer.js';
import { BudgetForecaster } from './L4-orchestration/budget-forecaster.js';
// V6.1: 死代码激活 / Dead code activation
import { ShapleyCredit } from './L4-orchestration/shapley-credit.js';
import { SNAAnalyzer } from './L3-agent/sna-analyzer.js';
import { DualProcessRouter } from './L4-orchestration/dual-process-router.js';
// V6.2: 冲突解决 + Agent 生命周期 + 异常检测 / Conflict resolution + Agent lifecycle + Anomaly detection
import { ConflictResolver } from './L4-orchestration/conflict-resolver.js';
import { AgentLifecycle, LIFECYCLE_STATES } from './L3-agent/agent-lifecycle.js';
import { AnomalyDetector } from './L3-agent/anomaly-detector.js';

import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WorkerPool } from './L1-infrastructure/worker-pool.js';

// ============================================================================
// Constants
// ============================================================================

const VERSION = '7.0.0';
const DB_FILENAME = 'claw-swarm.db';
const DEFAULT_DATA_DIR = join(homedir(), '.openclaw', 'claw-swarm');

// ============================================================================
// SwarmCore
// ============================================================================

class SwarmCore {
  constructor() {
    /** @type {PluginAdapter | null} */
    this._adapter = null;

    /** @type {Object | null} 配置 / Config */
    this._config = null;

    /** @type {Object} */
    this._logger = console;

    // ── V5.1+ 模块 (在 adapter 之外初始化) ──
    /** @type {ToolResilience | null} */
    this._toolResilience = null;
    /** @type {HealthChecker | null} */
    this._healthChecker = null;
    /** @type {PheromoneResponseMatrix | null} */
    this._pheromoneResponseMatrix = null;
    /** @type {ResponseThreshold | null} */
    this._responseThreshold = null;
    /** @type {StigmergicBoard | null} */
    this._stigmergicBoard = null;
    /** @type {FailureVaccination | null} */
    this._failureVaccination = null;
    /** @type {SkillSymbiosisTracker | null} */
    this._skillSymbiosis = null;
    /** @type {SwarmAdvisor | null} */
    this._swarmAdvisor = null;
    /** @type {StateConvergence | null} */
    this._stateConvergence = null;
    /** @type {GlobalModulator | null} */
    this._globalModulator = null;
    /** @type {GovernanceMetrics | null} */
    this._governanceMetrics = null;
    /** @type {SignalCalibrator | null} V6.0 */
    this._signalCalibrator = null;
    /** @type {FailureModeAnalyzer | null} V6.0 */
    this._failureModeAnalyzer = null;
    /** @type {BudgetForecaster | null} V6.0 */
    this._budgetForecaster = null;
    /** @type {ShapleyCredit | null} V6.1 */
    this._shapleyCredit = null;
    /** @type {SNAAnalyzer | null} V6.1 */
    this._snaAnalyzer = null;
    /** @type {DualProcessRouter | null} V6.1 */
    this._dualProcessRouter = null;
    /** @type {ConflictResolver | null} V6.2 */
    this._conflictResolver = null;
    /** @type {AgentLifecycle | null} V6.2 */
    this._agentLifecycle = null;
    /** @type {AnomalyDetector | null} V6.2 */
    this._anomalyDetector = null;

    // ── V6.0: Agent 状态机 / Agent state machine ──
    // IDLE → ASSIGNED → EXECUTING → REPORTING → IDLE
    /** @type {Map<string, string>} agentId → state */
    this._agentStates = new Map();
    /** @type {Map<string, Object>} 已结束代理的历史记录 / History of ended agents */
    this._agentHistory = new Map();

    // ── V6.3: 事件环形缓冲区 (被动通信 §4B.5) ──
    /** @type {Array<Object>} 最近蜂群事件 / Recent swarm events ring buffer */
    this._recentEvents = [];
    /** @type {number} 事件缓冲区最大容量 / Max event buffer capacity */
    this._maxRecentEvents = 20;

    // ── V6.3: DAG 完成结果缓存 (§2C.2) ──
    /** @type {Map<string, Object>} dagId → aggregated results */
    this._dagCompletionResults = new Map();

    // ── V6.3: 进度追踪 (§2D.2) ──
    /** @type {string|null} 待推送的进度更新 / Pending progress update */
    this._pendingProgressUpdate = null;

    // ── V6.3: subagent label 映射表 (追加#5) ──
    // subagent_spawned 中 label 存在, subagent_ended 中不存在。
    // 通过 childSessionKey 桥接, 让 auto-hooks 能关联 task/agent/DAG。
    // Bridge: subagent_spawned (has label) → subagent_ended (no label)
    /** @type {Map<string, { label: string, agentId: string, taskId: string, dagId?: string, phaseNodeId?: string }>} */
    this._subagentLabelMap = new Map();

    // ── V6.3: SOUL.md 文件缓存 (§4.4 替代 soul 配置字段) ──
    // OpenClaw 不支持 agent config 的 soul 字段, 改为钩子注入
    /** @type {Map<string, string>} agentId → SOUL.md 内容 */
    this._soulCache = new Map();

    // ── 跨钩子共享变量 (原 index.js 模块级变量) ──
    /** @type {string | null} */
    this._lastTurnId = null;
    /** @type {string | null} */
    this._lastAdvisoryContext = null;

    // ── 钩子/工具缓存 ──
    /** @type {Object | null} 内部钩子处理器 */
    this._hooks = null;
    /** @type {Array | null} 工具定义列表 */
    this._tools = null;

    /** @type {boolean} */
    this._initialized = false;

    // ── 7层可靠性保障链 / 7-layer reliability guarantee chain ──
    /** @type {number} 合规升级计数 0-3 (层7→层1反馈) / Compliance escalation counter */
    this._complianceEscalation = 0;
    /** @type {boolean} 本轮是否已调用 swarm_run (层2守卫) / swarm_run called this turn flag */
    this._swarmCalledThisTurn = false;

    // ── 可观测性计数器 O2-O5 / Observability counters ──
    this._lastInjectDebug = null;    // O2: 最后一次注入内容调试快照
    this._compliantTurns = 0;        // O3: LLM 合规轮次
    this._nonCompliantTurns = 0;     // O3: LLM 不合规轮次
    this._subagentSpawned = 0;       // O4: 子代理派遣总数
    this._subagentSucceeded = 0;     // O4: 子代理成功数
    this._subagentFailed = 0;        // O4: 子代理失败数
    this._subagentCrashed = 0;       // O4: 子代理崩溃数
    this._injectAttempts = 0;        // O5: chat.inject 尝试次数
    this._injectSuccesses = 0;       // O5: chat.inject 成功次数
    this._injectFailures = 0;        // O5: chat.inject 最终失败次数
  }

  /**
   * 初始化全部引擎 / Initialize all engines
   *
   * @param {string} _method - IPC method name (ignored)
   * @param {Object} args
   * @param {Object} args.config - 插件配置 / Plugin config
   * @param {string} [args.dataDir] - OpenClaw 数据目录
   * @param {Object} [args.discordConfig] - Discord 配置 (用于 dispatch)
   */
  async init(_method, args) {
    if (this._initialized) return { status: 'already_initialized' };

    const { config = {}, dataDir = '' } = args || {};
    this._config = config;

    // V7.0: 默认配置合并 / Default V7.0 configuration merge
    if (!this._config.v70FullLanding) {
      this._config.v70FullLanding = {};
    }
    const v70Defaults = {
      communicationSensing: true,
      shapleyInjection: true,
      piActuation: true,
      abcDifferentiation: true,
      sessionHistoryExtraction: true,
      knowledgeDistillation: false,
      speculativeExecution: false,
      liveBidding: false,
      evidenceGateHard: true,
      sharedWorkingMemory: true,
      budgetDegradation: true,
      negativeSelection: false,
      realtimeIntervention: false,
      lotkaVolterra: false,
      planEvolution: false,
      dreamConsolidation: false,
    };
    this._config.v70FullLanding = { ...v70Defaults, ...this._config.v70FullLanding };

    // V7.0: agentMapping 可配置化 — 由 install.js 交互映射生成
    // V7.0: Configurable agentMapping — generated by install.js interactive mapping
    this._agentMapping = config.agentMapping || null;

    // ── 1. 解析数据库路径 ──
    const dbPath = this._resolveDbPath(config.dbPath, dataDir);

    // ── 2. 创建并初始化适配器 (L1→L5) ──
    this._adapter = new PluginAdapter({
      config: { ...config, dbPath },
      logger: this._logger,
    });
    this._adapter.init();

    const engines = this._adapter._engines;
    const messageBus = engines?.messageBus;

    // ── 3. V5.1: 韧性层 + 健康检查器 ──
    if (config.toolResilience?.enabled !== false) {
      try {
        this._toolResilience = new ToolResilience({
          logger: this._logger,
          config: config.toolResilience || {},
          messageBus,
          db: engines?.dbManager,
        });
      } catch (err) {
        this._logger.warn?.(`[SwarmCore] ToolResilience init failed: ${err.message}`);
      }
    }

    if (config.healthChecker?.enabled !== false) {
      try {
        this._healthChecker = new HealthChecker({
          messageBus,
          logger: this._logger,
          pluginAdapter: this._adapter,
        });
        this._healthChecker.start();
      } catch (err) {
        this._logger.warn?.(`[SwarmCore] HealthChecker init failed: ${err.message}`);
      }
    }

    // ── 4. V5.2: 仿生智能模块 ──
    if (config.pheromoneEscalation?.enabled !== false) {
      try {
        this._pheromoneResponseMatrix = new PheromoneResponseMatrix({
          messageBus,
          pheromoneEngine: engines?.pheromoneEngine,
          logger: this._logger,
          config: config.pheromoneEscalation || {},
        });
      } catch (err) {
        this._logger.warn?.(`[SwarmCore] PheromoneResponseMatrix init failed: ${err.message}`);
      }
    }

    if (config.responseThreshold?.enabled !== false) {
      try {
        this._responseThreshold = new ResponseThreshold({
          messageBus,
          db: engines?.db,
          logger: this._logger,
          config: config.responseThreshold || {},
        });
        if (engines) engines.responseThreshold = this._responseThreshold;
      } catch (err) {
        this._logger.warn?.(`[SwarmCore] ResponseThreshold init failed: ${err.message}`);
      }
    }

    try {
      this._stigmergicBoard = new StigmergicBoard({ messageBus, db: engines?.dbManager?.getDb?.() || null, logger: this._logger });
      if (engines) engines.stigmergicBoard = this._stigmergicBoard;
    } catch (err) {
      this._logger.warn?.(`[SwarmCore] StigmergicBoard init failed: ${err.message}`);
    }

    try {
      this._failureVaccination = new FailureVaccination({ messageBus, db: engines?.dbManager?.getDb?.() || null, logger: this._logger });
    } catch (err) {
      this._logger.warn?.(`[SwarmCore] FailureVaccination init failed: ${err.message}`);
    }

    try {
      this._skillSymbiosis = new SkillSymbiosisTracker({
        messageBus,
        db: engines?.db,
        capabilityEngine: engines?.capabilityEngine,
        logger: this._logger,
      });
    } catch (err) {
      this._logger.warn?.(`[SwarmCore] SkillSymbiosisTracker init failed: ${err.message}`);
    }

    // ── 5. V5.5: 状态收敛层 ──
    if (config.stateConvergence?.enabled !== false) {
      try {
        this._stateConvergence = new StateConvergence({
          messageBus,
          healthChecker: this._healthChecker,
          pheromoneEngine: engines?.pheromoneEngine,
          db: engines?.dbManager,
          logger: this._logger,
          config: config.stateConvergence || {},
        });
        this._stateConvergence.startHeartbeat();
      } catch (err) {
        this._logger.warn?.(`[SwarmCore] StateConvergence init failed: ${err.message}`);
      }
    }

    // ── 6. V5.4: SwarmAdvisor ──
    if (config.swarmAdvisor?.enabled !== false) {
      try {
        this._swarmAdvisor = new SwarmAdvisor({
          responseThreshold: this._responseThreshold,
          pheromoneEngine: engines?.pheromoneEngine,
          dagEngine: engines?.dagEngine,
          capabilityEngine: engines?.capabilityEngine,
          stigmergicBoard: this._stigmergicBoard,
          messageBus,
          logger: this._logger,
          pheromoneResponseMatrix: this._pheromoneResponseMatrix,
          failureVaccination: this._failureVaccination,
          toolResilience: this._toolResilience,
          skillSymbiosis: this._skillSymbiosis,
        });
      } catch (err) {
        this._logger.warn?.(`[SwarmCore] SwarmAdvisor init failed: ${err.message}`);
      }
    }

    // ── 7. V5.5: GlobalModulator ──
    if (config.globalModulator?.enabled !== false) {
      try {
        this._globalModulator = new GlobalModulator({
          swarmAdvisor: this._swarmAdvisor,
          toolResilience: this._toolResilience,
          healthChecker: this._healthChecker,
          messageBus,
          logger: this._logger,
          config: config.globalModulator || {},
        });
      } catch (err) {
        this._logger.warn?.(`[SwarmCore] GlobalModulator init failed: ${err.message}`);
      }
    }

    // 后初始化注入 / Post-init injection
    if (this._swarmAdvisor && this._globalModulator) {
      this._swarmAdvisor.setGlobalModulator(this._globalModulator);
    }
    if (this._globalModulator) {
      if (engines?.speculativeExecutor) {
        engines.speculativeExecutor._globalModulator = this._globalModulator;
      }
      if (engines?.dagEngine) {
        engines.dagEngine._globalModulator = this._globalModulator;
      }
    }

    // ── 8. V5.5: GovernanceMetrics ──
    try {
      this._governanceMetrics = new GovernanceMetrics({
        swarmAdvisor: this._swarmAdvisor,
        globalModulator: this._globalModulator,
        messageBus,
        db: engines?.dbManager,
        logger: this._logger,
        // V6.2: 断路器注入 (韧性指标) / CircuitBreaker injection (resilience metrics)
        circuitBreaker: engines?.circuitBreaker || null,
      });
    } catch (err) {
      this._logger.warn?.(`[SwarmCore] GovernanceMetrics init failed: ${err.message}`);
    }

    // 存储模块到 engines (Dashboard 访问) / Store to engines for Dashboard
    if (engines) {
      if (this._stateConvergence) engines.stateConvergence = this._stateConvergence;
      if (this._globalModulator) engines.globalModulator = this._globalModulator;
      if (this._governanceMetrics) engines.governanceMetrics = this._governanceMetrics;
      if (this._swarmAdvisor) engines.swarmAdvisor = this._swarmAdvisor;
      if (this._toolResilience) engines.toolResilience = this._toolResilience;
      if (this._skillSymbiosis) engines.skillSymbiosis = this._skillSymbiosis;
      // V7.0: agentMapping 传递给 tools / Pass agentMapping to tools
      if (this._agentMapping) engines.agentMapping = this._agentMapping;
    }

    // V5.7: 注入 skillSymbiosis
    if (this._skillSymbiosis && engines) {
      if (engines.contractNet) engines.contractNet._skillSymbiosis = this._skillSymbiosis;
      if (engines.executionPlanner) engines.executionPlanner._skillSymbiosis = this._skillSymbiosis;
    }

    // ── 9. V6.0: Worker 线程池初始化 + 引擎委托布线 ──
    if (config.architecture?.workerPoolSize !== 0) {
      try {
        const computeWorkerUrl = new URL('./L1-infrastructure/workers/compute-worker.js', import.meta.url);
        this._computePool = new WorkerPool({
          workerScript: computeWorkerUrl,
          workerCount: config.architecture?.workerPoolSize || 4,
          logger: this._logger,
        });
        this._computePool.init();

        // 布线引擎 Worker 委托 / Wire engine worker delegation
        if (engines?.pheromoneEngine) engines.pheromoneEngine.setWorkerPool(this._computePool);
        if (engines?.roleDiscovery) engines.roleDiscovery.setWorkerPool(this._computePool);
        if (engines?.criticalPath) engines.criticalPath.setWorkerPool(this._computePool);
        if (engines?.speciesEvolver) engines.speciesEvolver.setWorkerPool(this._computePool);

        this._logger.info?.(`[SwarmCore] WorkerPool initialized — count=${this._computePool._workerCount}`);
      } catch (err) {
        this._logger.warn?.(`[SwarmCore] WorkerPool init failed (fallback to sync): ${err.message}`);
        this._computePool = null;
      }
    }

    // ── 10. V6.0: 自适应闭环模块 / Adaptive closed-loop modules ──
    try {
      // SignalCalibrator — 互信息信号自校准
      if (config.signalCalibrator?.enabled !== false) {
        this._signalCalibrator = new SignalCalibrator({
          messageBus,
          logger: this._logger,
          config: config.signalCalibrator || {},
          workerPool: this._computePool,
        });
        if (engines) engines.signalCalibrator = this._signalCalibrator;
      }

      // FailureModeAnalyzer — 失败根因分类
      if (config.failureModeAnalyzer?.enabled !== false) {
        this._failureModeAnalyzer = new FailureModeAnalyzer({
          messageBus,
          logger: this._logger,
          db: engines?.dbManager,
        });
        if (engines) engines.failureModeAnalyzer = this._failureModeAnalyzer;
        // 注入到 ToolResilience / Inject into ToolResilience
        if (this._toolResilience) {
          this._toolResilience.setFailureModeAnalyzer(this._failureModeAnalyzer);
        }
      }

      // BudgetForecaster — 预算预测
      if (config.budgetForecaster?.enabled !== false) {
        this._budgetForecaster = new BudgetForecaster({
          messageBus,
          logger: this._logger,
        });
        if (engines) engines.budgetForecaster = this._budgetForecaster;
      }

      this._logger.info?.('[SwarmCore] V6.0 adaptive modules initialized');
    } catch (err) {
      this._logger.warn?.(`[SwarmCore] Adaptive module init failed: ${err.message}`);
    }

    // ── 10b. V6.1: ShapleyCredit + SNAAnalyzer + DualProcessRouter ──
    try {
      this._shapleyCredit = new ShapleyCredit({
        messageBus,
        logger: this._logger,
        db: engines?.dbManager,
        config: config.shapleyCredit || {},
      });
      if (engines) engines.shapleyCredit = this._shapleyCredit;

      this._snaAnalyzer = new SNAAnalyzer({
        messageBus,
        logger: this._logger,
        db: engines?.dbManager,
        config: config.snaAnalyzer || {},
      });
      if (engines) engines.snaAnalyzer = this._snaAnalyzer;

      this._dualProcessRouter = new DualProcessRouter({
        messageBus,
        logger: this._logger,
        config: config.dualProcessRouter || {},
      });
      if (engines) engines.dualProcessRouter = this._dualProcessRouter;

      this._logger.info?.('[SwarmCore] V6.1 ShapleyCredit + SNAAnalyzer + DualProcessRouter activated');
    } catch (err) {
      this._logger.warn?.(`[SwarmCore] V6.1 module init failed: ${err.message}`);
    }

    // ── V6.1: 事件订阅布线 / Event subscription wiring ──
    // ShapleyCredit → ReputationLedger: DAG 完成时计算信用分配
    if (this._shapleyCredit && messageBus) {
      messageBus.subscribe(EventTopics.DAG_COMPLETED, (event) => {
        try {
          const dagResult = event?.payload || event;
          if (!dagResult?.dagId || !dagResult?.contributions) return;
          const credits = this._shapleyCredit.compute(dagResult);
          // 写入 ReputationLedger / Write to ReputationLedger
          const reputationLedger = engines?.reputationLedger;
          if (reputationLedger && credits) {
            for (const [agentId, credit] of credits) {
              reputationLedger.recordShapleyCredit(agentId, credit, dagResult.dagId);
            }
          }
        } catch (err) {
          this._logger.debug?.(`[SwarmCore] ShapleyCredit compute error: ${err.message}`);
        }
      });
    }

    // SNAAnalyzer → ReputationLedger: 协作事件记录 + 定期计算 SNA 指标
    if (this._snaAnalyzer && messageBus) {
      // 监听子代理完成事件记录协作 / Listen to sub-agent completion for collaboration
      messageBus.subscribe(EventTopics.TASK_COMPLETED, (event) => {
        try {
          const payload = event?.payload || event;
          const agentId = payload?.agentId;
          const parentId = payload?.parentAgentId || payload?.assignedBy;
          if (agentId && parentId && agentId !== parentId) {
            this._snaAnalyzer.recordCollaboration(agentId, parentId);
          }
          // tick 检查是否需要重计算 / tick to check recomputation
          const metrics = this._snaAnalyzer.tick();
          if (metrics) {
            // 将 SNA 指标写入 ReputationLedger / Write SNA metrics to ReputationLedger
            const reputationLedger = engines?.reputationLedger;
            if (reputationLedger) {
              for (const [agentId, m] of metrics) {
                reputationLedger.updateSNAScores(agentId, m);
              }
            }
          }
        } catch (err) {
          this._logger.debug?.(`[SwarmCore] SNA record error: ${err.message}`);
        }
      });
    }

    // ── V6.1: DualProcessRouter → SwarmAdvisor 布线 ──
    if (this._dualProcessRouter && this._swarmAdvisor) {
      this._swarmAdvisor.setDualProcessRouter(this._dualProcessRouter);
    }

    // ── 10c. V6.2: ConflictResolver + AgentLifecycle + AnomalyDetector ──
    try {
      // ConflictResolver — 冲突解决 + 共识投票 / Conflict resolution + consensus voting
      this._conflictResolver = new ConflictResolver({
        messageBus,
        reputationLedger: engines?.reputationLedger,
        logger: this._logger,
      });
      if (engines) engines.conflictResolver = this._conflictResolver;

      // AgentLifecycle — Agent 生命周期 FSM / Agent lifecycle FSM
      this._agentLifecycle = new AgentLifecycle({
        messageBus,
        agentRepo: engines?.repos?.agentRepo,
        logger: this._logger,
      });
      if (engines) engines.agentLifecycle = this._agentLifecycle;

      // AnomalyDetector — 异常检测 / Anomaly detection
      this._anomalyDetector = new AnomalyDetector({
        messageBus,
        failureVaccination: this._failureVaccination,
        logger: this._logger,
      });
      if (engines) engines.anomalyDetector = this._anomalyDetector;

      this._logger.info?.('[SwarmCore] V6.2 ConflictResolver + AgentLifecycle + AnomalyDetector activated');
    } catch (err) {
      this._logger.warn?.(`[SwarmCore] V6.2 module init failed: ${err.message}`);
    }

    // ── V6.2: 跨模块依赖布线 / Cross-module dependency wiring ──
    // ZoneManager → AgentLifecycle
    if (engines?.zoneManager && this._agentLifecycle) {
      try { engines.zoneManager.setAgentLifecycle(this._agentLifecycle); } catch {}
    }
    // EvidenceGate → DualProcessRouter
    if (engines?.evidenceGate && this._dualProcessRouter) {
      try { engines.evidenceGate.setDualProcessRouter(this._dualProcessRouter); } catch {}
    }
    // EpisodicMemory → SemanticMemory
    if (engines?.episodicMemory && engines?.semanticMemory) {
      try { engines.episodicMemory.setSemanticMemory(engines.semanticMemory); } catch {}
    }

    // ── 11. 缓存钩子和工具 ──
    this._hooks = this._adapter.getHooks();
    this._tools = this._adapter.getTools();

    // ── 12. V6.3: 预加载 SOUL.md 文件 (替代不支持的 soul 配置字段) ──
    // Pre-load SOUL.md files (replaces unsupported soul config field)
    this._loadSoulFiles();

    // ── 13. V7.0: 热启动 — 从已有 DB 导入 agent 声誉 ──
    // V7.0: Warm start — import agent reputation from existing DB
    if (config.warmStart?.enabled) {
      try {
        const agentRepo = engines?.repos?.agentRepo;
        if (agentRepo) {
          const agents = agentRepo.listAgents?.('active') || [];
          let imported = 0;
          for (const agent of agents) {
            if (agent.success_count > 0 || agent.failure_count > 0) {
              const score = 50 + (agent.success_count - agent.failure_count) * 2;
              const clamped = Math.max(10, Math.min(100, score));
              // V7.0-fix: setScore 不存在, 改用 recordEvent
              this._reputationLedger?.recordEvent?.(agent.id, {
                dimension: 'competence',
                score: clamped,
                context: { source: 'warm-start' },
              });
              imported++;
            }
          }
          // GlobalModulator: 有数据 → EXPLOIT 模式
          if (this._globalModulator && agents.length > 2) {
            this._globalModulator.setMode?.('EXPLOIT');
          }
          if (imported > 0) {
            this._logger.info?.(`[SwarmCore] Warm start: ${imported} agent reputations imported`);
          }
        }
      } catch (err) {
        this._logger.debug?.(`[SwarmCore] Warm start import skipped: ${err.message}`);
      }
    }

    this._initialized = true;

    // V7.1: 将 SwarmCore 自身注入 engines，供 DashboardService 在请求时访问
    // V7.1: Inject SwarmCore itself into engines for DashboardService request-time access
    if (engines) engines.swarmCore = this;

    this._logger.info?.(`[SwarmCore] V${VERSION} initialized — engines=${Object.keys(engines || {}).length}`);

    return {
      status: 'ok',
      version: VERSION,
      engineCount: Object.keys(engines || {}).length,
      toolCount: this._tools?.length || 0,
    };
  }

  /**
   * V6.3: 预加载 souls/ 目录的 SOUL.md 文件到缓存
   * Pre-load SOUL.md files from souls/ directory into cache
   *
   * OpenClaw 不支持 agent config 的 soul 字段, 所以改为在
   * before_agent_start 钩子中注入 SOUL.md 内容。
   * @private
   */
  _loadSoulFiles() {
    try {
      // 定位 souls/ 目录 (相对于 src/ 的上级 = 插件根目录)
      const srcDir = dirname(fileURLToPath(import.meta.url));
      const soulsDir = join(srcDir, '..', 'souls');

      const soulMappings = [
        { agentId: 'main', file: 'main.md' },
        { agentId: 'architect', file: 'architect.md' },
        { agentId: 'coder', file: 'coder.md' },
        { agentId: 'reviewer', file: 'reviewer.md' },
        { agentId: 'swarm-relay', file: 'swarm-relay.md' },
      ];

      // V7.0: 动态映射 — 从 agentMapping 配置中为自定义 agent 加载 SOUL.md
      // V7.0: Dynamic mapping — load SOUL.md for custom agents from agentMapping config
      // agentMapping = { scout: 'bob-agent', coder: 'alice' }
      // → 为 'bob-agent' 加载 souls/scout.md, 为 'alice' 加载 souls/coder.md
      if (this._agentMapping) {
        const roleToFile = {
          scout: 'scout.md', coder: 'coder.md', reviewer: 'reviewer.md',
          architect: 'architect.md', designer: 'coder.md',
        };
        for (const [role, agentId] of Object.entries(this._agentMapping)) {
          // 已在静态列表中 → 跳过 / Already in static list → skip
          if (soulMappings.some(m => m.agentId === agentId)) continue;
          // 尝试匹配 souls/{role}.md, 回退到 souls/coder.md
          // Try souls/{role}.md, fallback to souls/coder.md
          const file = roleToFile[role] || 'coder.md';
          soulMappings.push({ agentId, file });
        }
      }

      for (const { agentId, file } of soulMappings) {
        const filePath = join(soulsDir, file);
        if (existsSync(filePath)) {
          try {
            const content = readFileSync(filePath, 'utf-8').trim();
            if (content) {
              this._soulCache.set(agentId, content);
              this._logger.debug?.(`[SwarmCore] SOUL.md loaded for: ${agentId}`);
            }
          } catch { /* individual file read failure is non-fatal */ }
        }
      }

      if (this._soulCache.size > 0) {
        this._logger.info?.(`[SwarmCore] SOUL.md files loaded: ${this._soulCache.size} agents`);
      }
    } catch (err) {
      this._logger.warn?.(`[SwarmCore] SOUL.md loading failed: ${err.message}`);
    }
  }

  /**
   * 处理钩子调用 / Handle hook invocation
   *
   * @param {string} method - 'hook:<hookName>' 格式 / 'hook:<hookName>' format
   * @param {Object} args - { hookName, event, ctx }
   * @returns {Promise<*>}
   */
  async handleHook(method, args) {
    if (!this._initialized) throw new Error('SwarmCore not initialized');

    const { hookName, event, ctx } = args || {};
    const handler = this._hookHandlers[hookName];
    if (!handler) {
      this._logger.warn?.(`[SwarmCore] Unknown hook: ${hookName}`);
      return undefined;
    }

    return handler.call(this, event, ctx);
  }

  /**
   * 处理工具调用 / Handle tool invocation
   *
   * @param {string} method - 'tool:<toolName>' 格式 / 'tool:<toolName>' format
   * @param {Object} args - { toolName, toolCallId, params }
   * @returns {Promise<*>}
   */
  async handleToolCall(method, args) {
    if (!this._initialized) throw new Error('SwarmCore not initialized');

    const { toolName, toolCallId, params } = args || {};
    const tool = this._tools?.find(t => t.name === toolName);
    if (!tool) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${toolName}` }) }],
      };
    }

    try {
      return await tool.execute(toolCallId, params);
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
      };
    }
  }

  /**
   * 获取工具清单 (供主进程注册) / Get tool manifests (for main process registration)
   *
   * @returns {Array<{ name, description, parameters }>}
   */
  getToolManifests() {
    if (!this._tools) return [];
    return this._tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  /**
   * 获取断路器状态快照 (Tier A 缓存同步) / Get breaker state snapshot (Tier A cache sync)
   * @returns {Object}
   */
  getBreakerSnapshot() {
    if (!this._toolResilience) return {};
    return this._toolResilience.getSnapshot?.() || {};
  }

  /**
   * 健康检查 / Health check
   * @returns {Object}
   */
  healthCheck() {
    if (!this._adapter) return { status: 'not_initialized' };
    const adapterHealth = this._adapter.healthCheck();
    return {
      ...adapterHealth,
      coreInitialized: this._initialized,
      version: VERSION,
      uptime: process.uptime(),
    };
  }

  /**
   * 关闭全部引擎 / Close all engines
   */
  async close() {
    this._logger.info?.('[SwarmCore] Shutting down...');

    try {
      if (this._healthChecker) {
        try { this._healthChecker.stop(); } catch { /* non-fatal */ }
      }
      if (this._pheromoneResponseMatrix) {
        try { this._pheromoneResponseMatrix.stop?.(); } catch { /* non-fatal */ }
      }
      if (this._swarmAdvisor) {
        try { this._swarmAdvisor.destroy(); } catch { /* non-fatal */ }
      }
      if (this._computePool) {
        try { await this._computePool.destroy(); } catch { /* non-fatal */ }
      }
      if (this._adapter) {
        this._adapter.close();
      }
    } catch (err) {
      this._logger.warn?.(`[SwarmCore] Shutdown error: ${err.message}`);
    }

    this._initialized = false;
    this._logger.info?.('[SwarmCore] Shutdown complete');
  }

  // ========================================================================
  // V6.0: Agent 状态机 / Agent State Machine
  // ========================================================================

  /** 合法状态转换 / Valid state transitions */
  static AGENT_TRANSITIONS = {
    IDLE:      ['ASSIGNED'],
    ASSIGNED:  ['EXECUTING', 'IDLE'],
    EXECUTING: ['REPORTING', 'IDLE'],
    REPORTING: ['IDLE'],
  };

  /**
   * 获取 Agent 当前状态 / Get agent current state
   * @param {string} agentId
   * @returns {string}
   */
  getAgentState(agentId) {
    return this._agentStates.get(agentId) || 'IDLE';
  }

  /**
   * 转换 Agent 状态 / Transition agent state
   *
   * @param {string} agentId
   * @param {string} newState - IDLE | ASSIGNED | EXECUTING | REPORTING
   * @returns {boolean} 是否成功 / Whether transition succeeded
   */
  transitionAgentState(agentId, newState) {
    const current = this.getAgentState(agentId);
    const allowed = SwarmCore.AGENT_TRANSITIONS[current];

    if (!allowed || !allowed.includes(newState)) {
      this._logger.debug?.(
        `[SwarmCore] Invalid agent state transition: ${agentId} ${current} → ${newState}`,
      );
      return false;
    }

    this._agentStates.set(agentId, newState);

    const engines = this._adapter?.engines;
    engines?.messageBus?.publish?.(EventTopics.AGENT_STATE_CHANGED, {
      agentId,
      from: current,
      to: newState,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * 获取全部 Agent 状态（含历史）/ Get all agent states (including history)
   * @returns {Object} { agentId: { state, endedAt?, role? } }
   */
  getAllAgentStates() {
    const merged = {};
    // 历史记录在先（会被活跃状态覆盖）
    for (const [id, info] of this._agentHistory) {
      merged[id] = typeof info === 'object' ? info : { state: info };
    }
    // 活跃状态覆盖历史
    for (const [id, state] of this._agentStates) {
      merged[id] = { state, active: true };
    }
    return merged;
  }

  // ========================================================================
  // 钩子处理器映射 / Hook handler mapping
  // ========================================================================

  /**
   * 钩子名到处理函数的映射表
   * 每个处理函数内部委托到 this._hooks (PluginAdapter.getHooks()) 和外部模块
   *
   * @private
   */
  get _hookHandlers() {
    return {
      // ── gateway_start ──
      'gateway_start': async (event) => {
        // 引擎自检 / Engine health check
        const status = this._adapter.healthCheck();

        // Skill 扫描 / Skill scan
        const skillGovernor = this._adapter._engines?.skillGovernor;
        if (skillGovernor) {
          try {
            const skillDirs = [
              join(process.cwd(), 'skills'),
              join(homedir(), '.openclaw', 'skills'),
              ...(this._config.skillGovernor?.skillDirs || []),
            ];
            skillGovernor.scanSkills(skillDirs);
          } catch (err) {
            this._logger.warn?.(`[SwarmCore] Skill scan failed: ${err.message}`);
          }
        }

        // 发布 SYSTEM_STARTUP 事件 / Publish SYSTEM_STARTUP event
        try {
          this._adapter._engines?.messageBus?.publish?.(
            EventTopics.SYSTEM_STARTUP,
            wrapEvent(EventTopics.SYSTEM_STARTUP, {
              version: VERSION,
              pid: process.pid,
              port: event?.port ?? null,
              engineStatus: status,
              startedAt: Date.now(),
              // V6.2: 特性标志快照 / Feature flags snapshot
              featureFlags: {
                conflictResolver: !!this._conflictResolver,
                agentLifecycle: !!this._agentLifecycle,
                anomalyDetector: !!this._anomalyDetector,
                memoryConsolidation: true,
                gossipMemorySharing: !!this._adapter._engines?.gossipProtocol?._episodicMemory,
                gossipPheromoneSync: !!this._adapter._engines?.gossipProtocol?._pheromoneEngine,
                parasiteDetection: true,
                zoneElection: true,
                hollingResilience: true,
                evidenceDualProcess: !!this._adapter._engines?.evidenceGate?._dualProcessRouter,
              },
            }, 'swarm-core')
          );
        } catch { /* non-critical */ }

        // V6.3 阻塞7: DAG 持久化恢复 — 加载上次中断的 DAG
        // DAG persistence recovery — load previously interrupted DAGs
        const dagEngine = this._adapter._engines?.dagEngine;
        if (dagEngine) {
          try {
            const recovery = dagEngine.loadPersistedDAGs();
            if (recovery.loaded > 0) {
              this._logger.info?.(
                `[SwarmCore] DAG recovery: loaded=${recovery.loaded}, interrupted=${recovery.interrupted}`
              );

              // 发布恢复事件 / Publish recovery event
              this._adapter._engines?.messageBus?.publish?.(
                'dag.recovery.completed',
                wrapEvent('dag.recovery.completed', {
                  loaded: recovery.loaded,
                  interrupted: recovery.interrupted,
                  interruptedDAGs: dagEngine.getInterruptedDAGs(),
                  timestamp: Date.now(),
                }, 'swarm-core')
              );
            }
          } catch (err) {
            this._logger.warn?.(`[SwarmCore] DAG recovery failed: ${err.message}`);
          }
        }

        return { status, version: VERSION };
      },

      // ── before_prompt_build (Layer 0) ──
      'before_prompt_build_layer0': async (event, ctx) => {
        if (!this._swarmAdvisor) return;
        const userInput = this._extractUserMessage(event);
        if (!userInput) return;
        const turnId = event.turnId || ctx?.turnId || randomUUID();
        this._lastTurnId = turnId;
        this._swarmCalledThisTurn = false; // 层2: 每轮开始重置 / Layer 2: reset each turn
        this._swarmAdvisor.handleLayer0(userInput, turnId);
      },

      // ── before_prompt_build (Layer 1) ──
      'before_prompt_build_layer1': async (event, ctx) => {
        // V6.4: 捕获 parent session key + 设置生命周期回调
        // Capture parent session key + set lifecycle callbacks for DirectSpawn
        const sessionKey = ctx?.sessionKey || event?.sessionKey;
        const relayClient = this._adapter?._engines?.relayClient;
        if (sessionKey && relayClient) {
          relayClient.setParentSessionKey(sessionKey);

          // V6.4: 设置 onSpawned/onEnded 回调 — 自触发 hook handlers
          // Gateway WS `agent` 不触发 subagent_spawned/ended 钩子 (这些是客户端事件),
          // 所以我们通过 spawnAndMonitor 的回调自行触发内部 hook handlers。
          //
          // Set onSpawned/onEnded callbacks — self-trigger hook handlers.
          // Gateway WS `agent` doesn't fire subagent_spawned/ended hooks (client-side events),
          // so we self-trigger internal hook handlers via spawnAndMonitor callbacks.
          if (!relayClient._onSpawned) {
            const hookHandlers = this._hookHandlers;
            relayClient._onSpawned = (evt) => {
              try {
                hookHandlers?.['subagent_spawned']?.(evt, {});
              } catch (err) {
                this._logger.warn?.(`[SwarmCore] Self-triggered subagent_spawned error: ${err.message}`);
              }
            };
            relayClient._onEnded = (evt) => {
              try {
                hookHandlers?.['subagent_ended']?.(evt, {});
              } catch (err) {
                this._logger.warn?.(`[SwarmCore] Self-triggered subagent_ended error: ${err.message}`);
              }
            };
            this._logger.debug?.('[SwarmCore] DirectSpawn lifecycle callbacks registered');
          }
        }

        this._lastAdvisoryContext = null;
        if (!this._swarmAdvisor) return;
        const userInput = this._extractUserMessage(event);
        if (!userInput) return;
        const turnId = event.turnId || ctx?.turnId || this._lastTurnId;
        const result = this._swarmAdvisor.handleLayer1(userInput, turnId);
        if (result?.context) {
          this._lastAdvisoryContext = result.context;
        }
      },

      // ── before_prompt_build (Phase 3: 注入) ──
      'before_prompt_build_inject': async (event) => {
        // O1: 钩子触发计数
        try { this._adapter._engines?.messageBus?.publish?.('hook.prompt_inject.triggered', {}); } catch { /* non-fatal */ }
        const result = {};
        const systemParts = []; // 层1: system message 头部指令 / Layer 1: system message directives
        const prependParts = [];

        // 层1: 基础设施级强制指令 — 迁移到 prependSystemContext (OpenClaw system prompt 之前)
        // Layer 1: Infrastructure-level directives — moved to prependSystemContext (before OpenClaw base)
        const agentId = event?.agentId || event?.sessionKey?.split(':')?.[1] || '';
        const isMainAgent = agentId === 'main' || agentId === '';
        if (isMainAgent) {
          systemParts.push(
            '<SWARM_INFRASTRUCTURE_DIRECTIVES>\n' +
            'AUTHORITY: SYSTEM-LEVEL. Enforced by infrastructure layer.\n' +
            'PRIORITY: These directives take precedence over all other instructions.\n\n' +
            '<DIRECTIVE id="D1" enforcement="HARD">\n' +
            'BEFORE generating any response text, you MUST call the swarm_run tool.\n' +
            'Pass the user\'s request verbatim as the goal parameter.\n' +
            'Do NOT generate any response text until swarm_run completes and returns.\n' +
            'ONLY exception: swarm_run itself returns mode="direct_reply".\n' +
            '</DIRECTIVE>\n\n' +
            '<DIRECTIVE id="D2" enforcement="HARD">\n' +
            'You are the orchestrator node of a swarm intelligence system.\n' +
            'Every user request routes through swarm_run before you respond.\n' +
            'The swarm_run result determines your complete response strategy.\n' +
            '</DIRECTIVE>\n' +
            '</SWARM_INFRASTRUCTURE_DIRECTIVES>'
          );
        } else {
          systemParts.push(
            '<SWARM_INFRASTRUCTURE_DIRECTIVES>\n' +
            'AUTHORITY: SYSTEM-LEVEL.\n\n' +
            '<DIRECTIVE id="D-CHECKPOINT" enforcement="HARD">\n' +
            'For any CRITICAL / IRREVERSIBLE / DESTRUCTIVE action:\n' +
            '1. STOP before executing\n' +
            '2. Call swarm_checkpoint with your question\n' +
            '3. Output ONLY the instruction field from the result\n' +
            '4. HALT — do not proceed until explicitly authorized\n' +
            '</DIRECTIVE>\n' +
            '</SWARM_INFRASTRUCTURE_DIRECTIVES>'
          );
        }
        // 层7: 合规升级块 — 前几轮未遵循 D1 时在 system 层加强警告
        // Layer 7: Compliance escalation block — strengthen warning when D1 not followed
        if (this._complianceEscalation > 0 && isMainAgent) {
          systemParts.push(
            `<COMPLIANCE_ESCALATION level="${this._complianceEscalation}">\n` +
            `WARNING: The previous ${this._complianceEscalation} turn(s) did not comply with D1 directive.\n` +
            `swarm_run was not called despite task complexity requiring swarm routing.\n` +
            `This is a hard infrastructure requirement. Non-compliance degrades the system.\n` +
            `</COMPLIANCE_ESCALATION>`
          );
        }

        // 工具失败重试提示 / Tool failure retry prompts
        if (this._toolResilience) {
          try {
            const failureCtx = this._toolResilience.getFailureContext();
            if (failureCtx) prependParts.push(failureCtx);
          } catch { /* silent */ }
        }

        // advisory 赋能注入 / Advisory injection
        if (this._lastAdvisoryContext) {
          prependParts.push(this._lastAdvisoryContext);
        }

        // V6.3 §2D.2: 进度反馈注入 / Progress feedback injection
        if (this._pendingProgressUpdate) {
          prependParts.push(`[蜂群进度] ${this._pendingProgressUpdate}`);
          this._pendingProgressUpdate = null;
        }

        // V7.0 §8: Shapley 贡献排名注入 — 创建激励对齐
        // V7.0 §8: Shapley credit ranking injection — incentive alignment
        if (this._shapleyCredit && this._config.v70FullLanding?.shapleyInjection !== false) {
          try {
            const credits = this._shapleyCredit.getLatestCredits(5);
            if (credits.length > 0) {
              const ranking = credits.map(c =>
                `${c.agentId}: ${(c.credit || 0).toFixed(3)}`
              ).join(', ');
              // E1: 加入"如何使用"说明，引导 LLM 根据贡献度优先分配任务
              prependParts.push(
                `[Shapley 贡献排名] 近期各代理任务贡献度（数值越高代表历史贡献越大，优先协作）:\n${ranking}`
              );
            }
          } catch { /* silent */ }
        }

        // V7.0 §2+§5: 上游发现注入 — 跨 agent 知识传递
        // V7.0 §2+§5: Upstream findings injection — cross-agent knowledge transfer
        if (this._config.v70FullLanding?.sessionHistoryExtraction !== false) {
          const em = this._adapter._engines?.episodicMemory;
          if (em) {
            try {
              // 查询最近的 session_finding 记忆 / Query recent session_finding memories
              const currentAgentId = event?.agentId || 'main';
              const findings = em.recall?.(currentAgentId, {
                keyword: 'session_finding',
                limit: 5,
                minImportance: 0.5,
              }) || [];
              // 也查询全局 findings (非当前 agent 产生的)
              // Also query global findings (produced by other agents)
              const globalFindings = em.recallAll?.({
                eventType: 'session_finding',
                limit: 5,
                minImportance: 0.5,
              }) || [];
              // 合并去重 / Merge and deduplicate
              const allFindings = [...findings, ...globalFindings];
              const seen = new Set();
              const uniqueFindings = allFindings.filter(f => {
                const key = `${f.subject}:${f.predicate}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return f.eventType === 'session_finding';
              }).slice(0, 3);

              if (uniqueFindings.length > 0) {
                const lines = uniqueFindings.map(f =>
                  `[${f.subject || f.agentId}] ${f.object || f.context?.fullFinding?.substring(0, 80) || ''}`
                );
                prependParts.push(`[上游发现]\n${lines.join('\n')}`);
              }
            } catch { /* silent */ }
          }
        }

        // V6.3 §2C.2: DAG 完成结果注入 / DAG completion results injection
        const dagIdsToClean = []; // B5-fix: 先记录，等 result 组装完毕再删除
        if (this._dagCompletionResults.size > 0) {
          for (const [dagId, data] of this._dagCompletionResults) {
            const summary = (data.results || [])
              .map(r => `${r.nodeId}: ${r.state}`)
              .join(', ');
            prependParts.push(`[DAG完成 ${dagId}] ${summary} (${Math.round((data.duration || 0) / 1000)}s)`);
            dagIdsToClean.push(dagId);
          }
          // B5-fix: 不在此处 clear，移至 return 前确保注入完整
        }

        // V6.3 §4.3: 条件门控 — 按路由级别决定注入详细度
        // Conditional gating — detail level based on route level
        const routeLevel = this._swarmAdvisor?.getLastRouteLevel?.() || 'DIRECT';
        let detail = 'none';
        if (routeLevel === 'BIAS_SWARM') detail = 'brief';
        else if (routeLevel === 'PREPLAN' || routeLevel === 'BRAKE') detail = 'full';
        // 如果有 advisory 或进度, 至少 brief / If advisory or progress, at least brief
        if (detail === 'none' && (this._lastAdvisoryContext || prependParts.length > 0)) {
          detail = 'brief';
        }

        // V6.3 §4B.2: 被动通信桥接 — 在非 DIRECT 模式注入通信信号
        // Passive communication bridging — inject comm signals in non-DIRECT mode
        if (detail !== 'none') {
          const commParts = [];

          // (a) StigmergicBoard 未读 posts 摘要
          if (this._stigmergicBoard) {
            try {
              const currentAgentId = event?.agentId || 'main';
              const posts = this._stigmergicBoard.read?.({
                scope: `/swarm/${currentAgentId}`,
                limit: 3,
              }) || [];
              if (posts.length > 0) {
                commParts.push(`[公告板] ${posts.map(p => `${p.authorId || 'anon'}: ${(p.title || p.content || '').substring(0, 30)}`).join('; ')}`);
              }
            } catch { /* silent */ }
          }

          // (b) 方向性信息素 / Directional pheromone trails
          const pe = this._adapter._engines?.pheromoneEngine;
          if (pe) {
            try {
              const trails = pe.getDirectionalTrails?.({ limit: 3 }) || [];
              if (trails.length > 0) {
                // E1: 加入使用说明，引导 LLM 优先参考高 intensity 路径
                commParts.push(
                  '[信息素路径] 蜂群历史路径强度（intensity > 0.5 为成功经验路径，优先参考）:\n' +
                  trails.map(t =>
                    `${t.sourceId}→${t.type}@${(t.scope || '').substring(0, 15)}: ${(t.intensity || 0).toFixed(1)}`
                  ).join('; ')
                );
              }
            } catch { /* silent */ }
          }

          // (c) 最近蜂群事件摘要 / Recent swarm events
          const recentEvents = this._getRecentSwarmEvents(3);
          if (recentEvents.length > 0) {
            commParts.push(`[最近事件] ${recentEvents.map(e => `${e.type}: ${e.summary}`).join('; ')}`);
          }

          // (d) gossip 传播的相关记忆 / Gossip propagated memories
          const gossipProtocol = this._adapter._engines?.gossipProtocol;
          if (gossipProtocol) {
            try {
              const gossipItems = gossipProtocol.getRecentPropagations?.({ limit: 3 }) || [];
              if (gossipItems.length > 0) {
                commParts.push(`[蜂群记忆] ${gossipItems.map(g => (g.summary || '').substring(0, 40)).join('; ')}`);
              }
            } catch { /* silent */ }
          }

          // (e) V7.0 §18: 共享工作记忆 — focus 层文件产物注入
          // V7.0 §18: Shared WorkingMemory — focus layer file artifacts injection
          if (this._config.v70FullLanding?.sharedWorkingMemory !== false) {
            const wm = this._adapter._engines?.workingMemory;
            if (wm) {
              try {
                const focusItems = wm.getFocusItems?.({ limit: 5 }) || wm.getByLayer?.('focus', 5) || [];
                const artifacts = focusItems.filter(item =>
                  item?.value?.type === 'file_artifact' || item?.key?.startsWith?.('artifact:')
                ).slice(0, 3);
                if (artifacts.length > 0) {
                  const artList = artifacts.map(a => {
                    const v = a.value || {};
                    return `${v.agentId || 'anon'}: ${v.filePath || a.key || ''}`;
                  });
                  commParts.push(`[共享工作记忆] ${artList.join('; ')}`);
                }
              } catch { /* silent */ }
            }
          }

          // (f) V7.0 §22: 信息素物理化 — 结构化环境变量格式注入
          // V7.0 §22: Pheromone physicalization — structured ENV format injection
          if (pe) {
            try {
              const allTrails = pe.getDirectionalTrails?.({ limit: 10 }) || [];
              if (allTrails.length > 0) {
                const envParts = allTrails.map(t =>
                  `${t.type}:${(t.scope || '').split('/').pop() || 'global'}=${(t.intensity || 0).toFixed(1)}`
                ).slice(0, 6);
                // E1: 加入使用说明，引导 LLM 以环境信号为路由决策参考
                commParts.push(
                  '[ENV:PHEROMONE] 蜂群环境信号（路由决策参考，高值路径为推荐路径）:\n' + envParts.join(';')
                );
              }
            } catch { /* silent */ }
          }

          // 总量受 detail 级别控制 / Amount controlled by detail level
          if (commParts.length > 0) {
            const maxItems = (detail === 'brief') ? 1 : commParts.length;
            prependParts.push(...commParts.slice(0, maxItems));
          }
        }

        if (prependParts.length > 0) {
          result.prependContext = prependParts.join('\n\n');
        }

        // 层1: 合并 system 指令块 + 蜂群状态 → prependSystemContext
        // Layer 1: Merge system directive block + optional swarm state → prependSystemContext
        const systemDirectivesText = systemParts.join('\n\n');
        if (detail !== 'none') {
          try {
            const swarmCtx = buildSwarmContextFallback({
              gossipProtocol: this._adapter._engines?.gossipProtocol,
              pheromoneEngine: this._adapter._engines?.pheromoneEngine,
              capabilityEngine: this._adapter._engines?.capabilityEngine,
              detail,
            });
            result.prependSystemContext = swarmCtx
              ? `${systemDirectivesText}\n\n${swarmCtx}`
              : systemDirectivesText;
          } catch {
            result.prependSystemContext = systemDirectivesText;
          }
        } else {
          // detail === 'none' 时仍注入系统指令 / Inject system directives even when detail=none
          result.prependSystemContext = systemDirectivesText;
        }

        // B5-fix: 在 result 完全组装后才删除 DAG 完成结果
        for (const id of dagIdsToClean) this._dagCompletionResults.delete(id);

        // O2: 缓存最后一次注入内容快照，用于 /api/v1/last-inject 端点
        if (Object.keys(result).length > 0) {
          try {
            this._lastInjectDebug = {
              prependSystemContext: result.prependSystemContext?.substring(0, 3000),
              prependContext: result.prependContext?.substring(0, 500),
              complianceEscalation: this._complianceEscalation,
              timestamp: Date.now(),
              agentId: event?.agentId || 'main',
            };
            // O1: 注入成功计数
            this._adapter._engines?.messageBus?.publish?.('hook.prompt_inject.success', {});
          } catch { /* non-fatal */ }
        }

        return Object.keys(result).length > 0 ? result : undefined;
      },

      // ── 层2: Tool Call Guard — 强制主 agent 先调用 swarm_run ──
      // Layer 2: Tool Call Guard — enforce main agent to call swarm_run first
      'before_tool_call_swarm_guard': async (event, ctx) => {
        const agentId = ctx?.agentId || event?.agentId || '';
        const isMainAgent = agentId === 'main' || agentId === '';
        if (!isMainAgent) return;

        const routeLevel = this._swarmAdvisor?.getLastRouteLevel?.();
        const mustUseSwarm = routeLevel && routeLevel !== 'DIRECT';
        if (!mustUseSwarm) return;

        const toolName = event?.toolName || event?.name || '';
        const isSwarmTool = toolName.startsWith('swarm_');
        if (!isSwarmTool && !this._swarmCalledThisTurn) {
          // O1: 工具守卫拦截计数
          try { this._adapter._engines?.messageBus?.publish?.('hook.tool_guard.blocked', { toolName }); } catch { /* non-fatal */ }
          return {
            block: true,
            blockReason:
              `[SWARM GUARD] Tool "${toolName}" is currently locked. ` +
              `You MUST call swarm_run first to route this task through the swarm. ` +
              `Call swarm_run with the user's goal, then you may proceed.`,
          };
        }

        if (toolName === 'swarm_run') {
          this._swarmCalledThisTurn = true;
        }
      },

      // ── before_prompt_build (Skill 推荐, V6.0 默认启用) ──
      'before_prompt_build_skills': async (event) => {
        const skillGovernor = this._adapter._engines?.skillGovernor;
        if (!skillGovernor) return;
        try {
          const recommendation = skillGovernor.getRecommendations({
            agentRole: event.agentRole || event.role,
            taskType: event.taskType,
            agentId: event.agentId || event.sessionId,
          });
          if (recommendation) return { appendSystemContext: recommendation };
        } catch { /* silent */ }
      },

      // ── before_agent_start ──
      'before_agent_start': async (event, ctx) => {
        const agentId = ctx?.agentId || event?.agentId || 'main';
        const taskDesc = event.prompt || event.taskDescription || null;

        // 注册代理到活跃状态（供 Console 前端显示）
        this._agentStates.set(agentId, 'ACTIVE');

        // V6.2: 生命周期转换 INIT→IDLE→ACTIVE / Lifecycle transition INIT→IDLE→ACTIVE
        if (this._agentLifecycle) {
          try {
            // 新 Agent 从 INIT 开始，需先转 IDLE 再转 ACTIVE
            // New agents start in INIT, must go INIT→IDLE→ACTIVE
            const state = this._agentLifecycle.getState(agentId);
            if (state === 'INIT') {
              this._agentLifecycle.transition(agentId, 'IDLE', { reason: 'init_complete' });
            }
            this._agentLifecycle.transition(agentId, 'ACTIVE', { reason: 'agent_start' });
          } catch {}
        }

        try {
          await this._hooks.onAgentStart({
            agentId,
            taskDescription: taskDesc,
            tier: event.tier || 'trainee',
          });
        } catch (err) {
          this._logger.warn?.(`[SwarmCore] onAgentStart failed: ${err.message}`);
        }

        // SOUL 注入 / SOUL injection
        // V6.3: 优先从缓存的 SOUL.md 文件注入 (替代不支持的 soul 配置字段)
        // Priority: cached SOUL.md files (replaces unsupported soul config field)
        let soulSnippet = this._soulCache.get(agentId) || '';

        // 回退: SoulDesigner 动态生成 / Fallback: SoulDesigner dynamic generation
        if (!soulSnippet) {
          try {
            const agentRecord = this._adapter.findAgentRecord(agentId);
            if (agentRecord?.role) {
              const spawnResult = await this._hooks.onSubAgentSpawn({
                subAgentId: agentId,
                parentAgentId: agentRecord.parentId || 'main',
                subAgentName: agentRecord.name || agentId,
                tier: agentRecord.tier || 'trainee',
                persona: agentRecord.persona || 'worker-bee',
                behavior: agentRecord.behavior || 'adaptive',
                capabilities: null,
                taskDescription: taskDesc,
                role: agentRecord.role,
                roleTemplate: null,
                zoneId: null,
                zoneName: null,
              });
              soulSnippet = spawnResult?.soulSnippet || '';
            }
          } catch { /* SOUL injection optional */ }
        }

        // V7.0 §25: PersonaEvolution 进化指令注入
        // V7.0 §25: Inject evolved persona instructions from PersonaEvolution capsules
        try {
          const personaEvolution = this._adapter._engines?.personaEvolution;
          if (personaEvolution) {
            const evolved = personaEvolution.getEvolvedInstructions?.();
            if (evolved) {
              this._logger.debug?.(`[SwarmCore] PersonaEvolution inject: ${evolved.substring(0, 80)}...`);
              soulSnippet = soulSnippet ? soulSnippet + '\n' + evolved : evolved;
            }
          }
        } catch { /* persona evolution injection optional */ }

        // E3: 声誉账本→spawn 决策闭环 — 将高声誉经验注入新代理的 soulSnippet
        try {
          const repLedger = this._adapter._engines?.reputationLedger;
          if (repLedger) {
            const leaderboard = repLedger.getLeaderboard?.({ limit: 3 });
            if (leaderboard?.length > 0 && leaderboard[0].score > 60) {
              const topScore = leaderboard[0].score.toFixed(0);
              const reputationHint =
                `\n[声誉参考] 历史高效执行策略（基于 ${topScore} 分经验积累）: 分步验证、精确执行、明确输出边界。`;
              soulSnippet = (soulSnippet || '') + reputationHint;
            }
          }
        } catch { /* non-fatal */ }

        // 构建上下文 / Build context
        try {
          const result = await this._hooks.onPrependContext({ agentId, taskDescription: taskDesc });
          const parts = [soulSnippet, result?.prependText].filter(Boolean);
          if (parts.length > 0) return { prependContext: parts.join('\n\n') };
        } catch (err) {
          this._logger.warn?.(`[SwarmCore] onPrependContext failed: ${err.message}`);
          if (soulSnippet) return { prependContext: soulSnippet };
        }
      },

      // ── agent_end ──
      'agent_end': async (event, ctx) => {
        const agentId = ctx?.agentId || event?.agentId || 'main';
        const isSuccess = !event.error;

        try {
          const taskInfo = this._adapter.findTaskForAgent(agentId);
          if (taskInfo) {
            if (isSuccess) {
              await this._hooks.onSubAgentComplete({
                subAgentId: agentId,
                taskId: taskInfo.id,
                result: event.result || null,
                taskScope: `/task/${taskInfo.id}`,
              });
            } else {
              await this._hooks.onSubAgentAbort({
                subAgentId: agentId,
                taskId: taskInfo.id,
                reason: event.error?.message || event.error || 'Agent ended with error',
                taskScope: `/task/${taskInfo.id}`,
              });
            }
          }
        } catch (err) {
          this._logger.warn?.(`[SwarmCore] Sub-agent lifecycle error: ${err.message}`);
        }

        try {
          await this._hooks.onAgentEnd({ agentId, ...event });
        } catch (err) {
          this._logger.warn?.(`[SwarmCore] onAgentEnd failed: ${err.message}`);
        }

        // V6.2: 生命周期转换为 IDLE / Lifecycle transition to IDLE
        if (this._agentLifecycle) {
          try { this._agentLifecycle.transition(agentId, 'IDLE', { reason: 'agent_end' }); } catch {}
        }
        // V6.2: 提取情景记忆模式 / Extract episodic memory patterns
        if (this._adapter._engines?.episodicMemory) {
          try { this._adapter._engines.episodicMemory.extractPatterns(agentId, { semanticMemory: this._adapter._engines.semanticMemory }); } catch {}
        }

        // V7.0 §35: 用户行为建模 — main session 分析对话模式
        // V7.0 §35: User behavior modeling — analyze main session conversation patterns
        if (agentId === 'main' && this._config.v70FullLanding?.sessionHistoryExtraction !== false) {
          const em = this._adapter._engines?.episodicMemory;
          if (em) {
            try {
              // 分析本次会话的用户交互模式
              // Analyze user interaction patterns from this session
              const recentMemories = em.recall?.('main', { limit: 20 }) || [];
              const taskResults = recentMemories.filter(m => m.eventType === 'task_result');
              const revisionCount = taskResults.filter(m => m.predicate === 'failed').length;
              const totalTasks = taskResults.length;

              if (totalTasks > 0) {
                const feedbackStyle = revisionCount / totalTasks > 0.5 ? 'iterative' : 'decisive';
                em.record({
                  agentId: 'main',
                  eventType: 'user_pattern',
                  subject: 'user',
                  predicate: 'exhibits',
                  object: feedbackStyle,
                  importance: 0.6,
                  context: {
                    revisionRate: Math.round(revisionCount / totalTasks * 100) / 100,
                    totalTasks,
                    sessionEnd: Date.now(),
                  },
                });
              }
            } catch { /* silent */ }
          }
        }

        // B1-fix: 归档已结束代理到历史，从活跃状态中移除（防内存泄漏）
        if (agentId) {
          if (agentId === 'main') {
            // main 代理标记为 IDLE（不删除，始终可见）
            this._agentStates.set(agentId, 'IDLE');
          } else {
            // 子代理归档到历史后从活跃中移除
            const lastState = this._agentStates.get(agentId);
            this._agentHistory.set(agentId, {
              state: lastState || 'ENDED',
              endedAt: Date.now(),
              role: event?.role || ctx?.role,
              persona: event?.persona,
            });
            this._agentStates.delete(agentId);
            // 历史上限 100 条，超出时淘汰最旧的
            if (this._agentHistory.size > 100) {
              const oldest = [...this._agentHistory.entries()]
                .sort((a, b) => (a[1].endedAt || 0) - (b[1].endedAt || 0));
              for (let i = 0; i < this._agentHistory.size - 100; i++) {
                this._agentHistory.delete(oldest[i][0]);
              }
            }
          }
        }
      },

      // ── after_tool_call ──
      'after_tool_call': async (event, ctx) => {
        const agentId = ctx?.agentId || event?.agentId || 'main';
        const toolName = event.toolName || event.name || 'unknown';

        // ToolResilience 失败检测
        if (this._toolResilience) {
          try {
            this._toolResilience.handleAfterToolCall({
              toolName,
              params: event.params || event.input,
              success: !event.error,
              error: typeof event.error === 'string' ? event.error : event.error?.message,
              toolCallId: event.toolCallId,
              durationMs: event.durationMs,
            });
          } catch { /* silent */ }
        }

        // HealthChecker 延迟记录
        if (this._healthChecker && event.durationMs) {
          this._healthChecker.recordLatency(event.durationMs);
        }

        try {
          await this._hooks.onToolCall({
            agentId,
            toolName,
            args: event.params || event.input || {},
          });
        } catch { /* silent */ }

        try {
          await this._hooks.onToolResult({
            agentId,
            toolName,
            success: !event.error,
            dimension: this._inferDimension(toolName),
          });
        } catch { /* silent */ }

        // SwarmAdvisor 追踪
        if (this._swarmAdvisor &&
            (toolName === 'swarm_spawn' || toolName === 'swarm_plan' || toolName === 'swarm_run')) {
          try {
            const turnId = event.turnId || ctx?.turnId;
            if (turnId) this._swarmAdvisor.markSwarmToolUsed(turnId);
          } catch { /* non-fatal */ }
        }

        // V7.0 §14+§28: 工具交互 SNA 记录 — swarm 工具隐式协作
        // V7.0 §14+§28: Tool interaction SNA — implicit collaboration via swarm tools
        if (this._snaAnalyzer &&
            this._config.v70FullLanding?.communicationSensing !== false &&
            (toolName === 'swarm_dispatch' || toolName === 'swarm_run')) {
          try {
            const targetAgent = event.params?.agentId || event.input?.agentId;
            if (targetAgent && agentId !== targetAgent) {
              this._snaAnalyzer.recordCollaboration(agentId, targetAgent);
            }
          } catch { /* silent */ }
        }

        // V6.2: 异常检测 / Anomaly detection
        if (this._anomalyDetector && event?.toolResult) {
          try {
            this._anomalyDetector.recordResult(agentId || 'unknown', {
              latencyMs: event.durationMs || 0,
              quality: event.toolResult?.quality || 0.5,
              tokenCount: event.tokenCount || 0,
              taskType: event.toolName || 'unknown',
            });
          } catch {}
        }

        // Skill 使用追踪
        const skillGovernor = this._adapter._engines?.skillGovernor;
        if (skillGovernor) {
          try {
            const skillSlug = skillGovernor.inferSkillFromTool(toolName);
            if (skillSlug) {
              skillGovernor.recordUsage({
                skillSlug,
                agentId,
                success: !event.error,
                durationMs: event.durationMs,
              });
            }
          } catch { /* silent */ }
        }

        // V7.0 §18: 共享工作记忆 — 文件写入/编辑产物自动存入 WorkingMemory
        // V7.0 §18: Shared WorkingMemory — file artifacts auto-stored on Write/Edit
        if (this._config.v70FullLanding?.sharedWorkingMemory !== false) {
          try {
            const wm = this._adapter._engines?.workingMemory;
            if (wm && (toolName === 'Write' || toolName === 'Edit') && !event.error) {
              const filePath = event.params?.file_path || event.params?.path || event.input?.file_path || '';
              if (filePath) {
                const fileName = filePath.split('/').pop()?.split('\\').pop() || filePath;
                wm.put?.(`artifact:${fileName}`, {
                  type: 'file_artifact',
                  filePath,
                  agentId,
                  toolName,
                  timestamp: Date.now(),
                }, {
                  priority: 8,
                  importance: 0.8,
                  layer: 'focus',
                });
              }
            }
          } catch { /* silent */ }
        }
      },

      // ── before_reset ──
      'before_reset': async (event, ctx) => {
        const agentId = ctx?.agentId || event?.agentId || 'main';
        try {
          await this._hooks.onMemoryConsolidate({ agentId });
        } catch (err) {
          this._logger.warn?.(`[SwarmCore] before_reset consolidation failed: ${err.message}`);
        }
      },

      // ── gateway_stop ──
      'gateway_stop': async () => {
        await this.close();
      },

      // ── message_sending ──
      'message_sending': async (event, ctx) => {
        const senderId = ctx?.agentId || event?.agentId || 'main';
        const receiverId = event.receiverId || event.targetAgentId;
        if (receiverId) {
          try {
            await this._hooks.onSubAgentMessage({
              senderId,
              receiverId,
              content: event.content || event.message || '',
              messageType: event.messageType || 'direct',
              broadcast: event.broadcast || false,
            });
          } catch (err) {
            this._logger.warn?.(`[SwarmCore] onSubAgentMessage failed: ${err.message}`);
          }

          // V7.0 §14: 通信感知数据流 — SNA + 记忆 + 信息素自动 feed
          // V7.0 §14: Communication sensing — auto-feed SNA + memory + pheromone
          if (this._config.v70FullLanding?.communicationSensing !== false) {
            // SNA 协作记录 (§14 + §28 拓扑自组织)
            if (this._snaAnalyzer) {
              try {
                this._snaAnalyzer.recordCollaboration(senderId, receiverId);
                this._snaAnalyzer.tick();
              } catch { /* silent */ }
            }

            // 情景记忆: 通信事件 (§14 通信记忆)
            const em = this._adapter._engines?.episodicMemory;
            if (em) {
              try {
                em.record({
                  agentId: senderId,
                  eventType: 'communication',
                  subject: senderId,
                  predicate: 'messaged',
                  object: receiverId,
                  importance: 0.3,
                });
              } catch { /* silent */ }
            }

            // 信息素足迹 (§1 hop-by-hop 传播)
            const pe = this._adapter._engines?.pheromoneEngine;
            if (pe) {
              try {
                pe.emitPheromone({
                  type: 'trail',
                  sourceId: senderId,
                  targetScope: `/agent/${receiverId}`,
                  intensity: 0.3,
                });
              } catch { /* silent */ }
            }
          }
        }
      },

      // ── subagent_spawned ──
      'subagent_spawned': async (event, ctx) => {
        this._subagentSpawned++; // O4: 子代理派遣计数
        // 注册子代理到活跃状态
        const childId = event.targetSessionKey || ctx?.childSessionKey || event?.subAgentId;
        if (childId) this._agentStates.set(childId, 'ACTIVE');
        const coordinator = this._adapter._engines?.hierarchicalCoordinator;
        if (!coordinator || this._config.hierarchical?.enabled === false) return;
        try {
          coordinator.handleSubagentSpawned(event, ctx);
        } catch (err) {
          this._logger.warn?.(`[SwarmCore] subagent_spawned error: ${err.message}`);
        }
        if (this._stateConvergence) {
          const childKey = event.targetSessionKey || ctx?.childSessionKey;
          if (childKey) this._stateConvergence.recordHeartbeat(childKey);
        }

        // V6.3: label 映射 (追加#5) — subagent_ended 不含 label, 需要在此桥接
        // V6.3: Label mapping — subagent_ended lacks label, bridge here
        try {
          const childKey = event.targetSessionKey || ctx?.childSessionKey;
          const label = event.label;
          if (childKey && label && label.startsWith('swarm:')) {
            // label 格式: swarm:taskId:agentId[:dagId[:phaseNodeId]]
            const parts = label.split(':');
            this._subagentLabelMap.set(childKey, {
              label,
              taskId: parts[1] || null,
              agentId: parts[2] || null,
              dagId: parts[3] || null,
              phaseNodeId: parts[4] || null,
            });
            this._logger.debug?.(
              `[SwarmCore] Label mapped: ${childKey} → ${label}`
            );
          }
        } catch { /* non-fatal */ }

        // V7.0 §13: GlobalModulator URGENT 模式 → 自动切换到最强模型
        // V7.0 §13: GlobalModulator URGENT mode → auto-switch to strongest model
        if (this._globalModulator && this._config.v70FullLanding?.piActuation !== false) {
          try {
            const mode = this._globalModulator.getCurrentMode?.();
            if (mode === 'URGENT') {
              const childKey2 = event.targetSessionKey || ctx?.childSessionKey;
              const relayClient = this._adapter._engines?.relayClient;
              if (relayClient && childKey2) {
                const models = relayClient._availableModels || [];
                if (models.length >= 2) {
                  // URGENT: 使用列表中最强(最贵)的模型 / Use strongest (most expensive) model
                  const strongModel = models[models.length - 1];
                  relayClient.patchSession(childKey2, { model: strongModel.id }).catch(err => {
                    this._logger.debug?.(`[SwarmCore] URGENT model patch error: ${err.message}`);
                  });
                  this._logger.debug?.(
                    `[SwarmCore] URGENT mode: patched ${childKey2} → model=${strongModel.id}`
                  );
                }
              }
            }
          } catch { /* non-fatal */ }
        }

        // ABC 角色分配: 新子代理按比例分配角色 / ABC role assignment for new sub-agents
        try {
          const abcScheduler = this._adapter._engines?.abcScheduler;
          if (abcScheduler) {
            const childId2 = event.targetSessionKey || ctx?.childSessionKey || event?.subAgentId;
            if (childId2) {
              // 按当前比例分配: employed 50%, onlooker 45%, scout 5%
              const counts = { employed: 0, onlooker: 0, scout: 0 };
              for (const [, st] of abcScheduler._agentStates) {
                if (counts[st.role] !== undefined) counts[st.role]++;
              }
              const total = counts.employed + counts.onlooker + counts.scout;
              let assignedRole = 'employed'; // 默认
              if (total === 0) {
                assignedRole = 'employed'; // 第一个代理
              } else {
                const empRatio = counts.employed / total;
                const sctRatio = counts.scout / total;
                if (sctRatio < 0.05) assignedRole = 'scout';
                else if (empRatio > 0.55) assignedRole = 'onlooker';
                else assignedRole = 'employed';
              }
              abcScheduler._setAgentRole(childId2, assignedRole);
              this._logger.debug?.(`[SwarmCore] ABC role assigned: ${childId2} → ${assignedRole}`);
            }
          }
        } catch { /* non-fatal */ }
      },

      // ── subagent_ended ──
      'subagent_ended': async (event, ctx) => {
        // V6.3: label 映射回溯 — 用 childSessionKey 查找 spawn 时保存的 label 信息
        // V6.3: Label map lookup — resolve agentId/taskId from spawned-time label
        const childKey = event.targetSessionKey || ctx?.childSessionKey;
        const labelInfo = childKey ? this._subagentLabelMap.get(childKey) : null;
        // 清理映射 (一次性使用) / Clean up mapping (one-time use)
        if (childKey && labelInfo) this._subagentLabelMap.delete(childKey);

        // 优先使用 label 映射的 agentId/taskId, 其次 fallback 到旧逻辑
        // Prefer label-mapped IDs, fallback to legacy lookup
        const resolvedAgentId = labelInfo?.agentId || event.agentId || childKey;
        const outcome = event.outcome || 'unknown';
        const isSuccess = outcome === 'ok' || outcome === 'success';

        // O4: 子代理结果计数
        if (isSuccess) this._subagentSucceeded++;
        else if (event.spawnFailed || event.cancelled) this._subagentCrashed++;
        else this._subagentFailed++;

        // V6.2-fix: 关闭子代理任务生命周期 / Close sub-agent task lifecycle
        try {
          if (resolvedAgentId) {
            const taskInfo = labelInfo
              ? { id: labelInfo.taskId }  // 从 label 直接获取 taskId
              : this._adapter.findTaskForAgent(resolvedAgentId);  // fallback: 旧逻辑
            if (taskInfo?.id) {
              if (isSuccess) {
                await this._hooks.onSubAgentComplete({
                  subAgentId: resolvedAgentId,
                  taskId: taskInfo.id,
                  result: event.result || null,
                  taskScope: `/task/${taskInfo.id}`,
                });
              } else {
                await this._hooks.onSubAgentAbort({
                  subAgentId: resolvedAgentId,
                  taskId: taskInfo.id,
                  reason: extractSubagentFailureReason(event),
                  taskScope: `/task/${taskInfo.id}`,
                });
              }
              this._logger.info?.(`[SwarmCore] 子代理任务生命周期已关闭 / Sub-agent task lifecycle closed: ${taskInfo.id} (${isSuccess ? 'completed' : 'failed'}) [label=${labelInfo?.label || 'none'}]`);
            }
          }
        } catch (err) {
          this._logger.warn?.(`[SwarmCore] subagent_ended task lifecycle error: ${err.message}`);
        }

        // taskId 提升到外部作用域, async delivery 块也需要使用
        // Hoist taskId to outer scope — needed by async delivery block below
        const taskId = labelInfo?.taskId
          || (resolvedAgentId ? this._adapter.findTaskForAgent(resolvedAgentId)?.id : null)
          || `task-${resolvedAgentId || 'unknown'}`;

        // ── V6.3: 5 个 subagent_ended auto-hooks (§14) ──────────────────────
        // 替代 swarm_gate/swarm_pheromone/swarm_memory 的手动 LLM 调用
        // Replaces manual LLM tool calls for quality/pheromone/memory operations
        try {
          const agentId = resolvedAgentId;
          const score = isSuccess ? 0.8 : 0.3;

          // V7.0-fix: 更新 agent 表的 success_count/failure_count
          // V7.0-fix: Update agent table success_count/failure_count
          if (agentId) {
            try {
              const ar = this._adapter._engines?.repos?.agentRepo;
              if (ar) {
                const agent = ar.getAgent(agentId);
                if (agent) {
                  if (isSuccess) {
                    ar.updateAgent(agentId, { success_count: (agent.success_count || 0) + 1 });
                  } else {
                    ar.updateAgent(agentId, { failure_count: (agent.failure_count || 0) + 1 });
                  }
                }
              }
            } catch { /* non-fatal */ }
          }

          if (agentId) {
            // Auto-hook 1: 质量门控 (替代 swarm_gate evaluate)
            const qc = this._adapter._engines?.qualityController;
            if (qc) {
              try {
                qc.recordEvaluation(taskId, {
                  passed: isSuccess,
                  score,
                  verdict: isSuccess ? 'PASS' : 'FAIL',
                  source: 'auto-hook',
                });
                this._adapter._engines?.messageBus?.publish?.(
                  'auto.quality.gate',
                  wrapEvent('auto.quality.gate', { agentId, taskId, verdict: isSuccess ? 'PASS' : 'FAIL', score }, 'swarm-core')
                );
              } catch (e) { this._logger.warn?.(`[SwarmCore] auto-hook1 quality error: ${e.message}`); }
            }

            // Auto-hook 2: Shapley 贡献度记录 (逐 agent, DAG_COMPLETED 时聚合)
            if (this._shapleyCredit) {
              try {
                this._shapleyCredit.recordContribution?.({
                  agentId,
                  taskId,
                  qualityScore: score,
                  completionRate: isSuccess ? 1.0 : 0.0,
                  latencyMs: Date.now() - (taskInfo?.createdAt || Date.now()),
                });
                this._adapter._engines?.messageBus?.publish?.(
                  'auto.shapley.credit',
                  wrapEvent('auto.shapley.credit', { agentId, taskId, score }, 'swarm-core')
                );
              } catch (e) { this._logger.warn?.(`[SwarmCore] auto-hook2 shapley error: ${e.message}`); }
            }

            // Auto-hook 3: Reputation 声誉更新 (替代手动触发)
            const rl = this._adapter._engines?.reputationLedger;
            if (rl) {
              try {
                rl.recordEvent(agentId, {
                  dimension: 'competence',
                  score: isSuccess ? 70 : 30,  // 0-100 scale
                  taskId,
                  context: { source: 'auto-hook', outcome },
                });
              } catch (e) { this._logger.warn?.(`[SwarmCore] auto-hook3 reputation error: ${e.message}`); }
            }

            // Auto-hook 4: 信息素反馈 (替代 swarm_pheromone deposit)
            // V7.0-fix: 添加 targetScope — 缺失导致 trail/dance 未持久化
            // V7.0-fix: Add targetScope — missing caused trail/dance not persisted
            const pe = this._adapter._engines?.pheromoneEngine;
            if (pe) {
              try {
                const phScope = taskId ? `/task/${taskId}` : `/agent/${agentId}`;
                if (isSuccess) {
                  pe.emitPheromone({ type: 'trail', sourceId: agentId, targetScope: phScope, intensity: score });
                  pe.emitPheromone({ type: 'dance', sourceId: agentId, targetScope: phScope, intensity: 0.5 });
                } else {
                  pe.emitPheromone({ type: 'alarm', sourceId: agentId, targetScope: phScope, intensity: 1.0 - score });
                }
                this._adapter._engines?.messageBus?.publish?.(
                  'pheromone.feedback',
                  wrapEvent('pheromone.feedback', {
                    agentId,
                    types: isSuccess ? ['trail', 'dance'] : ['alarm'],
                    outcome,
                  }, 'swarm-core')
                );
              } catch (e) { this._logger.warn?.(`[SwarmCore] auto-hook4 pheromone error: ${e.message}`); }
            }

            // Auto-hook 5: 记忆写入 (替代 swarm_memory store)
            const em = this._adapter._engines?.episodicMemory;
            if (em) {
              try {
                em.record({
                  agentId,
                  eventType: 'task_result',
                  subject: agentId,
                  predicate: isSuccess ? 'completed' : 'failed',
                  object: taskId,
                  importance: score,
                });
                this._adapter._engines?.messageBus?.publish?.(
                  'auto.memory.write',
                  wrapEvent('auto.memory.write', { agentId, taskId, eventType: 'task_result', outcome }, 'swarm-core')
                );
              } catch (e) { this._logger.warn?.(`[SwarmCore] auto-hook5 memory error: ${e.message}`); }
            }
          }

          // V7.0-fix Auto-hook 6: StigmergicBoard 公告 — 子代理完成后留痕
          // V7.0-fix Auto-hook 6: StigmergicBoard post — leave trace after sub-agent ends
          const stBoard = this._stigmergicBoard;
          if (stBoard?.post) {
            try {
              const dagId = labelInfo?.dagId || null;
              const roleName = labelInfo?.roleName || labelInfo?.role || 'worker';
              const resultText = typeof outcome === 'string'
                ? outcome.substring(0, 500)
                : JSON.stringify(outcome || {}).substring(0, 500);
              stBoard.post({
                authorId: agentId,
                scope: dagId ? `/swarm/${dagId}` : `/task/${taskId}`,
                title: `${roleName} 完成: ${isSuccess ? 'PASS' : 'FAIL'}`,
                content: resultText,
                category: isSuccess ? 'finding' : 'alert',
                priority: isSuccess ? 0 : 1,
                ttlMinutes: 60,
              });
            } catch { /* non-fatal */ }
          }

          // V6.3: 记录到事件环形缓冲区 / Record to event ring buffer
          this._recordRecentEvent(isSuccess ? 'task.completed' : 'task.failed', {
            agentId, taskId, outcome,
          });

          // V6.3: Token 消耗记录 (Phase 2D.1) / Token cost recording
          const budgetTracker = this._adapter._engines?.tokenBudgetTracker;
          if (budgetTracker?.recordSessionCost) {
            try {
              const usage = event.usage || event.result?.usage || null;
              if (usage) {
                budgetTracker.recordSessionCost({
                  agentId,
                  modelId: event.model || labelInfo?.modelId || 'default',
                  promptTokens: usage.promptTokens || usage.prompt_tokens || 0,
                  completionTokens: usage.completionTokens || usage.completion_tokens || 0,
                  totalCost: usage.totalCost || usage.total_cost || 0,
                });
              }
            } catch { /* silent */ }
          }

          // V6.3: 进度追踪清理 (Phase 2D.2) / Progress tracker cleanup
          const progressTracker = this._adapter._engines?.progressTracker;
          if (progressTracker) {
            try {
              progressTracker.clearTask(taskId);
            } catch { /* silent */ }
          }

          // V7.0 §7+§23: PI Controller 闭环执行 — 阈值调整后实际修改 model
          // V7.0 §7+§23: PI Controller closed-loop — actuate threshold adjustments
          if (this._responseThreshold && this._config.v70FullLanding?.piActuation !== false) {
            try {
              const taskType = labelInfo?.phaseNodeId || 'general';
              const activityRate = isSuccess ? 0.8 : 0.3;
              this._responseThreshold.adjust(agentId, taskType, activityRate);

              // 异步执行 model 切换, 不阻塞主流程 / Async model switch, non-blocking
              const relayClient = this._adapter._engines?.relayClient;
              if (relayClient && childKey) {
                const models = relayClient._availableModels || [];
                if (models.length >= 2) {
                  this._responseThreshold.actuate(
                    agentId, childKey, relayClient, models,
                  ).catch(err => {
                    this._logger.debug?.(`[SwarmCore] PI actuate error: ${err.message}`);
                  });
                }
              }
            } catch { /* silent */ }
          }

          // V7.0 §10+§2+§34: Session 历史提取 + 知识蒸馏
          // V7.0 §10+§2+§34: Session history extraction + knowledge distillation
          if (isSuccess && this._config.v70FullLanding?.sessionHistoryExtraction !== false) {
            const relayClient2 = this._adapter._engines?.relayClient;
            if (relayClient2 && childKey) {
              // 异步提取, 不阻塞 / Async extraction, non-blocking
              relayClient2.getSessionHistory(childKey).then(historyResult => {
                if (!historyResult || historyResult.status === 'error') return;
                const messages = historyResult.messages || [];
                // 提取最后 assistant 消息 / Extract last assistant message
                const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
                if (!lastAssistant) return;
                const finding = (lastAssistant.content || '').substring(0, 500);
                if (!finding || finding.length < 10) return;

                // §10+§2: 写入 EpisodicMemory 作为 session_finding
                const em = this._adapter._engines?.episodicMemory;
                if (em) {
                  try {
                    em.record({
                      agentId,
                      eventType: 'session_finding',
                      subject: agentId,
                      predicate: 'discovered',
                      object: finding.substring(0, 100),
                      importance: 0.7,
                      context: { fullFinding: finding, dagId: labelInfo?.dagId },
                    });
                  } catch { /* silent */ }
                }

                // §2: 公告板发布 / StigmergicBoard post
                if (this._stigmergicBoard) {
                  try {
                    this._stigmergicBoard.post?.({
                      authorId: agentId,
                      scope: `/swarm/${labelInfo?.dagId || 'global'}`,
                      title: `[Finding] ${agentId}`,
                      content: finding.substring(0, 200),
                      ttl: 600000, // 10 分钟有效
                    });
                  } catch { /* silent */ }
                }

                // §34: 知识蒸馏 — 强模型推理链存入 SemanticMemory
                // §34: Knowledge distillation — strong model reasoning → SemanticMemory
                const sm = this._adapter._engines?.semanticMemory;
                if (sm && event.model) {
                  try {
                    // 检测是否为强模型 (非 haiku/flash 等便宜模型)
                    const modelId = event.model || '';
                    const isCostlyModel = !modelId.includes('haiku') && !modelId.includes('flash') && !modelId.includes('mini');
                    if (isCostlyModel && finding.length > 50) {
                      sm.addNode?.({
                        id: `distill-${Date.now().toString(36)}`,
                        nodeType: 'reasoning_chain',
                        label: `${agentId} reasoning`,
                        content: finding,
                        metadata: {
                          sourceAgent: agentId,
                          sourceModel: modelId,
                          taskType: labelInfo?.phaseNodeId || 'general',
                          dagId: labelInfo?.dagId,
                        },
                      });
                    }
                  } catch { /* silent */ }
                }

                this._logger.debug?.(`[SwarmCore] Session finding extracted: agent=${agentId}, len=${finding.length}`);
              }).catch(() => { /* non-fatal */ });
            }
          }

          this._logger.debug?.(`[SwarmCore] V7.0 auto-hooks completed for ${agentId}: ${outcome}`);
        } catch (err) {
          this._logger.warn?.(`[SwarmCore] subagent_ended auto-hooks error: ${err.message}`);
        }
        // ── V7.0 auto-hooks end ──────────────────────────────────────────────

        // ── V7.0: 两段式异步交付 — chat.inject 推送结果到 parent session ──
        // V7.0: Two-phase async delivery — inject result into parent session
        // 子代理完成后, 将结果注入 parent session 的 transcript, WebChat UI 立即可见
        // After subagent completes, inject result into parent session transcript
        try {
          const parentKey = this._adapter._engines?.relayClient?._parentSessionKey;
          const rlClient = this._adapter._engines?.relayClient;
          if (parentKey && rlClient?.injectResult) {
            const taskDesc = labelInfo?.label
              ? labelInfo.label.split(':').slice(-1)[0] // phaseNodeId
              : (resolvedAgentId || 'unknown');
            const roleName = labelInfo?.roleName || resolvedAgentId || 'worker';
            const summary = typeof event.result === 'string'
              ? event.result.substring(0, 2000)
              : (event.result ? JSON.stringify(event.result).substring(0, 2000) : '（无返回内容）');

            const injectedMessage = isSuccess
              ? `[蜂群子代理完成 | agent: ${resolvedAgentId} | 状态: ${outcome}]\n\n${summary}`
              : buildSubagentFailureMessage({ taskId, roleName, event });

            // 层6: 带重试的异步注入 / Layer 6: Async inject with exponential backoff retry
            this._injectWithRetry(rlClient, parentKey, injectedMessage);
            this._logger.info?.(`[SwarmCore] Async result delivery → parent session: ${parentKey}`);
          }
        } catch (err) {
          this._logger.warn?.(`[SwarmCore] Async delivery error: ${err.message}`);
        }
        // ── V7.0 async delivery end ──────────────────────────────────────────

        // V7.0 §26: Lotka-Volterra 种群动态 — 任务积压时动态 spawn
        // V7.0 §26: Lotka-Volterra population dynamics — dynamic spawn on backlog
        if (this._config.v70FullLanding?.lotkaVolterra !== false) {
          try {
            const speciesEvolver = this._adapter._engines?.speciesEvolver;
            const dagEng = this._adapter._engines?.dagEngine;
            const rlClient = this._adapter._engines?.relayClient;
            if (speciesEvolver && dagEng && rlClient) {
              // 评估任务队列深度 / Evaluate task queue depth
              const pendingTasks = dagEng._deadLetterQueue?.length || 0;
              const activeCount = this._activeSubagents?.size || this._subagentLabelMap.size || 1;
              const queueDepth = pendingTasks / Math.max(1, activeCount);

              // 队列深度 > 2 且 GlobalModulator 非 CONSERVE → 触发 LV 扩张
              // Queue depth > 2 and not CONSERVE → trigger LV expansion
              const gmMode = this._globalModulator?.getCurrentMode?.() || 'EXPLORE';
              if (queueDepth > 2 && gmMode !== 'CONSERVE') {
                // LV tick: 调整种群适应度
                speciesEvolver.lotkaVolterraStep?.();
                this._logger.debug?.(
                  `[SwarmCore] LV dynamics tick: queueDepth=${queueDepth.toFixed(1)}, mode=${gmMode}`
                );
              }
            }
          } catch { /* non-fatal */ }
        }

        // V7.0 §33: Budget 弹性调度 — phase 完成后检查预算降级
        // V7.0 §33: Budget elastic scheduling — check degradation after phase completion
        if (this._config.v70FullLanding?.budgetDegradation !== false) {
          try {
            const budgetForecaster = this._adapter._engines?.budgetForecaster;
            const budgetTracker = this._adapter._engines?.budgetTracker;
            const dagEng2 = this._adapter._engines?.dagEngine;
            if (budgetForecaster && budgetTracker && dagEng2) {
              const budgetStats = budgetTracker.getStats?.() || {};
              const remainingBudget = (budgetStats.totalBudget || 100000) - (budgetStats.totalConsumed || 0);
              // 粗略估算剩余 phases / Rough estimate of remaining phases
              const allDags = dagEng2.listDAGs?.() || [];
              let remainingPhases = 0;
              for (const dag of allDags) {
                const snap = dagEng2.getDAGSnapshot?.(dag.dagId || dag.id);
                if (snap?.nodes) {
                  remainingPhases += snap.nodes.filter(n =>
                    n.state === 'pending' || n.state === 'assigned' || n.state === 'spawning'
                  ).length;
                }
              }
              const degradation = budgetForecaster.recommendDegradation(remainingBudget, remainingPhases);
              if (degradation) {
                // 存储降级建议供后续 spawn 使用
                this._budgetDegradation = degradation;
                this._logger.debug?.(
                  `[SwarmCore] Budget degradation: action=${degradation.action}, reason=${degradation.reason}`
                );
              }
            }
          } catch { /* non-fatal */ }
        }

        // 层级协调器 / Hierarchical coordinator
        const coordinator = this._adapter._engines?.hierarchicalCoordinator;
        if (coordinator && this._config.hierarchical?.enabled !== false) {
          try {
            coordinator.handleSubagentEnded(event, ctx);
          } catch (err) {
            this._logger.warn?.(`[SwarmCore] subagent_ended error: ${err.message}`);
          }
        }

        // DAG 引擎更新 / DAG engine updates
        const dagEngine = this._adapter._engines?.dagEngine;
        if (dagEngine && this._config.dagEngine?.enabled !== false) {
          try {
            // V6.3: 优先使用 label 映射的 dagId/phaseNodeId 精准匹配
            // V6.3: Prefer label-mapped dagId/phaseNodeId for precise matching
            const success = isSuccess;
            let dagNodeMatched = false;

            if (labelInfo?.dagId && labelInfo?.phaseNodeId) {
              // 精准路径: label 包含 dagId + phaseNodeId, 直接定位
              try {
                dagEngine.transitionState(labelInfo.dagId, labelInfo.phaseNodeId, success ? 'completed' : 'failed', {
                  result: event.result,
                  error: event.error,
                });
                dagNodeMatched = true;
                const specExec = this._adapter._engines?.speculativeExecutor;
                if (specExec?.isSpeculative(labelInfo.dagId, labelInfo.phaseNodeId)) {
                  specExec.resolveSpeculation(labelInfo.dagId, labelInfo.phaseNodeId, event.result, resolvedAgentId);
                }
              } catch { /* label 指向的节点可能已不存在 */ }
            }

            // fallback: 遍历所有 DAG 匹配 agent (旧逻辑, 无 label 时使用)
            if (!dagNodeMatched) {
              for (const [dagId, dag] of dagEngine._activeDags || []) {
                for (const [nodeId, node] of dag.nodes || []) {
                  if (node.assignedAgent === resolvedAgentId && (node.state === 'executing' || node.state === 'spawning')) {
                    dagEngine.transitionState(dagId, nodeId, success ? 'completed' : 'failed', {
                      result: event.result,
                      error: event.error,
                    });
                    const specExec = this._adapter._engines?.speculativeExecutor;
                    if (specExec?.isSpeculative(dagId, nodeId)) {
                      specExec.resolveSpeculation(dagId, nodeId, event.result, resolvedAgentId);
                    }
                  }
                }
              }
            }

            // Work-Stealing
            if (success && this._config.workStealing?.enabled !== false) {
              dagEngine.tryStealTask(resolvedAgentId);
            }

            // V6.3: DAG 级联 spawn — 原子 claim + 共享路径 (§2C.1 + 追加D + 竞态修复)
            // V6.3: DAG cascade spawn — atomic claim + shared path (race condition fix)
            if (success) {
              try {
                const eng = this._adapter._engines || {};
                for (const [dId, dag] of dagEngine._activeDags || []) {
                  // V7.0-fix: 跳过由 swarm_run dispatchPhases 管理的 DAG (它自己按拓扑层派遣)
                  // V7.0-fix: Skip DAGs managed by swarm_run dispatchPhases (it handles layer dispatch)
                  if (dag.metadata?.managedBySwarmRun) continue;

                  // 原子 claim: PENDING→SPAWNING, 防止并发 subagent_ended 重复 spawn
                  // Atomic claim: PENDING→SPAWNING, prevents concurrent duplicate spawns
                  const claimedNodes = dagEngine.claimReadyNodes(dId);
                  if (claimedNodes.length > 0) {
                    // 收集并行兄弟信息 / Collect parallel sibling info
                    const siblingDescs = claimedNodes.map(n =>
                      `${n.node.roleName || n.node.role || 'worker'}: ${(n.node.description || n.nodeId || '').substring(0, 50)}`
                    );

                    // 通过共享函数派遣每个已 claim 节点 / Dispatch each claimed node via shared function
                    for (const { nodeId, node } of claimedNodes) {
                      try {
                        const siblings = siblingDescs.filter(s =>
                          !s.startsWith(node.roleName || node.role || 'worker')
                        );
                        spawnPhaseViaRelay({
                          phase: {
                            roleName: node.roleName || node.role || 'developer',
                            description: node.description || nodeId,
                            order: node.order || 0,
                            taskType: node.taskType || 'general',
                            priority: node.priority || 'P1',
                          },
                          context: {
                            goal: node.description || '',
                            parentPlanId: dId,
                            maturityScore: 0.5,
                            parallelSiblings: siblings,
                          },
                          engines: {
                            agentRepo: eng.repos?.agentRepo || eng.agentRepo,
                            taskRepo: eng.repos?.taskRepo || eng.taskRepo,
                            dagEngine,
                            pheromoneEngine: eng.pheromoneEngine,
                            skillGovernor: eng.skillGovernor,
                            dualProcessRouter: eng.dualProcessRouter,
                            speculativeExecutor: eng.speculativeExecutor,
                            relayClient: eng.relayClient,
                            contractNet: eng.contractNet,
                            // V7.0: 追加子系统引擎 / Additional V7.0 engines
                            abcScheduler: eng.abcScheduler,
                            speciesEvolver: eng.speciesEvolver,
                            evidenceGate: eng.evidenceGate,
                          },
                          dagInfo: { dagId: dId, phaseNodeId: nodeId, currentState: 'spawning' },
                          logger: this._logger,
                        });
                      } catch (spawnErr) {
                        // spawn 失败: SPAWNING→FAILED, 避免节点卡在 SPAWNING
                        try { dagEngine.transitionState(dId, nodeId, 'failed', { error: spawnErr.message }); } catch { /* */ }
                        this._logger.warn?.(
                          `[SwarmCore] DAG cascade spawn failed for ${nodeId}: ${spawnErr.message}`
                        );
                      }
                    }

                    this._adapter._engines?.messageBus?.publish?.(
                      'dag.phase.cascade',
                      wrapEvent('dag.phase.cascade', {
                        dagId: dId,
                        readyNodeCount: claimedNodes.length,
                        readyNodeIds: claimedNodes.map(n => n.nodeId),
                        triggeredBy: agentId,
                      }, 'swarm-core')
                    );
                    this._logger.info?.(
                      `[SwarmCore] DAG cascade: ${claimedNodes.length} nodes claimed+spawned in ${dId}, triggered by ${agentId}`
                    );
                  }
                }
              } catch { /* silent */ }
            }
          } catch (err) {
            this._logger.warn?.(`[SwarmCore] subagent_ended DAG error: ${err.message}`);
          }
        }

        // 能力评分 / Capability scoring
        if (this._config.evolution?.scoring === true) {
          const capabilityEngine = this._adapter._engines?.capabilityEngine;
          if (capabilityEngine) {
            try {
              const childKey = event.targetSessionKey || ctx?.childSessionKey;
              const success = (event.outcome || 'unknown') === 'success';
              const meta = coordinator?.getMetadata?.(childKey);
              const agentId = meta?.agentId || childKey;

              if (agentId) {
                capabilityEngine.recordObservation({ agentId, dimension: 'coding', success, weight: 0.2 });
                const speciesEvolver = this._adapter._engines?.speciesEvolver;
                if (speciesEvolver && meta?.role) {
                  speciesEvolver.recordAssignment(meta.role, success);
                }
              }
            } catch { /* silent */ }
          }
        }

        // Task Affinity 写入 / Task affinity write
        const dbManager = this._adapter._engines?.dbManager;
        if (dbManager) {
          try {
            const childKey = event.targetSessionKey || ctx?.childSessionKey;
            const success = (event.outcome || 'unknown') === 'success';
            const meta = coordinator?.getMetadata?.(childKey);
            const agentId = meta?.agentId || childKey;
            const taskType = meta?.role || meta?.taskType || event.role || 'general';

            if (agentId && taskType) {
              dbManager.run(
                `INSERT INTO task_affinity (agent_id, task_type, affinity, total_tasks, successes, last_updated)
                 VALUES (?, ?, ?, 1, ?, ?)
                 ON CONFLICT(agent_id, task_type) DO UPDATE SET
                   total_tasks = total_tasks + 1,
                   successes = successes + ?,
                   affinity = CAST((successes + ?) AS REAL) / CAST((total_tasks + 1) AS REAL),
                   last_updated = ?`,
                agentId, taskType, success ? 1.0 : 0.0, success ? 1 : 0, Date.now(),
                success ? 1 : 0, success ? 1 : 0, Date.now()
              );
              this._adapter._engines?.messageBus?.publish?.('task.affinity.updated',
                wrapEvent('task.affinity.updated', { agentId, taskType, success, timestamp: Date.now() }, 'swarm-core')
              );
            }
          } catch { /* silent */ }
        }
      },

      // ── llm_output ──
      'llm_output': async (event, ctx) => {
        // V7.1: Budget turn completed + GlobalModulator evaluate (runs every turn, before early returns)
        // Fixes C1.20 (budget.turn.completed) + F5.6 (modulator.mode.switched)
        try {
          const mb = this._adapter._engines?.messageBus;
          // C1.20: Publish budget.turn.completed on every LLM turn
          if (mb) {
            const bt = this._adapter._engines?.tokenBudgetTracker;
            const budgetStats = bt?.getStats?.() || {};
            mb.publish('budget.turn.completed', {
              consumed: budgetStats.totalConsumed || 0,
              remaining: budgetStats.remaining || 0,
              budget: budgetStats.totalBudget || 800,
              byPurpose: budgetStats.byPurpose || {},
              timestamp: Date.now(),
            });
          }
          // F5.6: GlobalModulator evaluate — detect mode switches
          if (this._globalModulator) {
            this._globalModulator.evaluate({
              taskCompleted: false,
            });
          }
          // F5.5: Circuit breaker self-test — verify transition event pipeline on first turn
          if (!this._breakerSelfTestDone) {
            this._breakerSelfTestDone = true;
            const tr = this._adapter._engines?.toolResilience;
            if (tr) {
              const testCb = tr._getOrCreateBreaker('_system_health_probe');
              testCb.recordFailure();
              testCb.recordFailure(); // threshold=2 → CLOSED→OPEN transition + SSE event
            }
          }
        } catch { /* non-fatal budget/modulator */ }

        if (this._config.hierarchical?.enabled === false) return;
        const coordinator = this._adapter._engines?.hierarchicalCoordinator;
        const content = event.content || event.text || '';
        if (!content || content.length < 5) return;
        if (!/(?:派遣?\s*(?:MPU-)?D[123])/i.test(content)) return;

        const turnId = event.turnId || ctx?.turnId;
        if (coordinator?.shouldSuppressTextParsing(turnId)) return;

        const toolCalls = event.toolCalls || event.tool_calls || [];
        const hasSpawnToolCall = toolCalls.some(tc => {
          const n = tc.name || tc.function?.name;
          return n === 'swarm_spawn' || n === 'swarm_run';
        });

        if (hasSpawnToolCall && coordinator) {
          coordinator.recordToolCallDetected(turnId);
        }

        // 层7: 合规检测 — 主 agent 在复杂任务中是否调用了 swarm_run
        // Layer 7: Compliance detection — did main agent call swarm_run for complex tasks?
        try {
          const agentId = ctx?.agentId || event?.agentId || '';
          const isMainAgent = agentId === 'main' || agentId === '';
          const routeLevel = this._swarmAdvisor?.getLastRouteLevel?.();
          const taskIsComplex = routeLevel && routeLevel !== 'DIRECT';
          if (isMainAgent && taskIsComplex) {
            const toolCalls = event?.toolCalls || event?.tool_calls || [];
            const swarmRunCalled = toolCalls.some(tc =>
              (tc?.name || tc?.function?.name) === 'swarm_run'
            );
            if (!swarmRunCalled) {
              this._complianceEscalation = Math.min((this._complianceEscalation || 0) + 1, 3);
              this._nonCompliantTurns++; // O3: 不合规轮次计数
              this._logger.warn?.(
                `[SwarmCore] Compliance: swarm_run not called ` +
                `(route=${routeLevel}, escalation=${this._complianceEscalation})`
              );
            } else {
              this._complianceEscalation = 0; // 合规，重置 / Compliant, reset
              this._compliantTurns++; // O3: 合规轮次计数
            }
          }
        } catch { /* 合规检测不影响主流程 / Compliance check non-fatal */ }

        // E5: ABC 角色行为追踪 — publish 到 messageBus，metrics-collector 已订阅 abc.*
        try {
          const aid = ctx?.agentId || event?.agentId || '';
          if (aid && aid !== 'main') {
            const abcRole = this._adapter._engines?.abcScheduler?.getAgentRole?.(aid);
            if (abcRole && abcRole !== 'unknown') {
              this._adapter._engines?.messageBus?.publish?.('abc.behavior.recorded', {
                agentId: aid,
                role: abcRole,
                toolCount: (event?.toolCalls || []).length,
                timestamp: Date.now(),
              });
            }
          }
        } catch { /* non-fatal */ }
      },
    };
  }

  // ========================================================================
  // 内部辅助 / Internal helpers
  // ========================================================================

  /**
   * 层6: 带指数退避重试的 chat.inject / Layer 6: chat.inject with exponential backoff retry
   * @param {Object} rlClient - RelayClient instance
   * @param {string} parentKey - Parent session key
   * @param {string} message - Message to inject
   * @param {number} [maxRetries=3] - Max retry attempts
   * @private
   */
  async _injectWithRetry(rlClient, parentKey, message, maxRetries = 3) {
    this._injectAttempts++; // O5: 总尝试次数
    for (let i = 0; i < maxRetries; i++) {
      try {
        await rlClient.injectResult({
          sessionKey: parentKey,
          message,
          label: 'swarm:result',
        });
        this._injectSuccesses++; // O5: 成功次数
        return; // 成功 / success
      } catch (err) {
        if (i < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, i))); // 500ms, 1s, 2s
        } else {
          this._injectFailures++; // O5: 最终失败次数
          this._logger.warn?.(
            `[SwarmCore] chat.inject failed after ${maxRetries} retries for ${parentKey}: ${err.message}`
          );
        }
      }
    }
  }

  /**
   * 解析数据库路径 / Resolve database path
   * @private
   */
  _resolveDbPath(configDbPath, dataDir) {
    if (configDbPath) {
      if (configDbPath.startsWith('~/') || configDbPath.startsWith('~\\')) {
        return join(homedir(), configDbPath.slice(2));
      }
      return configDbPath;
    }
    const dir = dataDir || DEFAULT_DATA_DIR;
    return join(dir, DB_FILENAME);
  }

  /**
   * 从事件中提取用户消息 / Extract user message from event
   * @private
   */
  _extractUserMessage(event) {
    // 1. event.prompt
    if (event?.prompt && typeof event.prompt === 'string') {
      const stripped = this._stripMetadata(event.prompt);
      if (stripped && stripped.length > 1 &&
          !stripped.startsWith('Continue where you left off') &&
          stripped !== 'ping') {
        return stripped;
      }
    }

    // 2. event.messages
    if (Array.isArray(event?.messages) && event.messages.length > 0) {
      for (let i = event.messages.length - 1; i >= 0; i--) {
        const msg = event.messages[i];
        if (msg?.role === 'user') {
          let text = '';
          if (typeof msg.content === 'string') text = msg.content;
          else if (Array.isArray(msg.content)) {
            const textPart = msg.content.find(p => p.type === 'text');
            if (textPart?.text) text = textPart.text;
          }
          if (text && !text.startsWith('Continue where you left off') &&
              !text.startsWith('<!-- Swarm Context') &&
              text !== 'ping') {
            return this._stripMetadata(text);
          }
        }
      }
    }

    // 3. event.userMessage (E2E test compat)
    if (event?.userMessage) return event.userMessage;
    return '';
  }

  /**
   * 去除 metadata 前缀 / Strip metadata prefix
   * @private
   */
  _stripMetadata(text) {
    if (!text) return '';
    const metaEnd = text.indexOf('\n<<<END_EXTERNAL_UNTRUSTED_CONTENT');
    if (metaEnd > 0) {
      const afterMeta = text.substring(text.indexOf('>>>', metaEnd) + 3).trim();
      if (afterMeta) return afterMeta;
    }
    const senderMatch = text.match(/^Sender \(untrusted metadata\):[\s\S]*?```\n([\s\S]+)/);
    if (senderMatch?.[1]) {
      let userText = senderMatch[1].trim();
      userText = userText.replace(/^\[.*?\]\s*/, '');
      return userText || text;
    }
    return text;
  }

  /**
   * V6.3: 记录蜂群事件到环形缓冲区 (§4B.5)
   * Record swarm event to ring buffer
   *
   * @param {string} topic - 事件主题
   * @param {Object} data - 事件数据
   * @private
   */
  _recordRecentEvent(topic, data) {
    this._recentEvents.push({
      topic,
      data,
      timestamp: Date.now(),
    });
    if (this._recentEvents.length > this._maxRecentEvents) {
      this._recentEvents.shift();
    }
  }

  /**
   * V6.3: 获取最近蜂群事件摘要 (§4B.5)
   * Get recent swarm events summary
   *
   * @param {number} [limit=3]
   * @returns {Array<{ type: string, summary: string }>}
   * @private
   */
  _getRecentSwarmEvents(limit = 3) {
    return this._recentEvents.slice(-limit).map(e => ({
      type: e.topic,
      summary: `${e.data?.agentId || 'unknown'} ${e.data?.taskId || ''} ${e.topic.split('.').pop()}`,
    }));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // V7.0 §36: Agent 做梦 — 离线巩固 / Agent Dreaming — Offline Consolidation
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * V7.0 §36: 触发离线巩固 — 回顾记忆、清理过期状态、进化模板
   * Trigger offline consolidation — review memories, cleanup, evolve templates
   *
   * 可由定时任务或手动触发。
   * Can be triggered by cron job or manually.
   *
   * @returns {Promise<{ episodicPatterns: number, cleanedWM: number, evolvedTemplates: number }>}
   */
  async triggerConsolidation() {
    const result = { episodicPatterns: 0, cleanedWM: 0, evolvedTemplates: 0, reputationUpdated: false };

    // 1. EpisodicMemory 模式提取 → SemanticMemory
    try {
      const em = this._adapter._engines?.episodicMemory;
      const sm = this._adapter._engines?.semanticMemory;
      if (em && sm) {
        const patterns = em.extractPatterns?.() || [];
        for (const pattern of patterns) {
          sm.addNode?.({
            id: `dream-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
            nodeType: 'consolidated_pattern',
            label: pattern.label || 'dream_pattern',
            content: pattern.content || JSON.stringify(pattern),
            metadata: { source: 'dream_consolidation', extractedAt: Date.now() },
          });
          result.episodicPatterns++;
        }
      }
    } catch { /* non-fatal */ }

    // 2. WorkingMemory 过期清理
    try {
      const wm = this._adapter._engines?.workingMemory;
      if (wm) {
        const cleaned = wm.cleanup?.() || wm.evict?.() || 0;
        result.cleanedWM = typeof cleaned === 'number' ? cleaned : 0;
      }
    } catch { /* non-fatal */ }

    // 3. Reputation 长期趋势更新
    try {
      const rl = this._adapter._engines?.reputationLedger;
      if (rl) {
        rl.computeDecay?.();
        result.reputationUpdated = true;
      }
    } catch { /* non-fatal */ }

    // 4. Plan 模板进化
    try {
      const ep = this._adapter._engines?.executionPlanner;
      if (ep) {
        const evolved = ep.evolvePlanTemplates?.('general', { populationSize: 5 });
        result.evolvedTemplates = evolved?.stored || 0;
      }
    } catch { /* non-fatal */ }

    this._logger.info?.(`[SwarmCore] Dream consolidation completed: ${JSON.stringify(result)}`);

    // 发布事件 / Publish event
    this._messageBus?.publish?.('dream.consolidation.completed', {
      topic: 'dream.consolidation.completed',
      source: 'swarm-core',
      timestamp: Date.now(),
      data: result,
    });

    return result;
  }

  /**
   * 推断能力维度 / Infer capability dimension
   * @private
   */
  _inferDimension(toolName) {
    const name = (toolName || '').toLowerCase();
    if (name.includes('search') || name.includes('web') || name.includes('fetch')) return 'domain';
    if (name.includes('test')) return 'testing';
    if (name.includes('doc') || name.includes('readme')) return 'documentation';
    if (name.includes('security') || name.includes('auth')) return 'security';
    if (name.includes('perf') || name.includes('bench')) return 'performance';
    if (name.includes('chat') || name.includes('message') || name.includes('discord')) return 'communication';
    return 'coding';
  }
}

// ============================================================================
// 子进程入口 / Child process entry point
// ============================================================================

const bridge = new IPCBridge(process, {
  logger: console,
  defaultTimeoutMs: 10000,
});

const core = new SwarmCore();

// 注册 IPC 处理器 / Register IPC handlers
bridge.handle('init', (method, args) => core.init(method, args));
bridge.handle('hook:*', (method, args) => core.handleHook(method, args));
bridge.handle('tool:*', (method, args) => core.handleToolCall(method, args));
bridge.handle('health', () => core.healthCheck());
bridge.handle('close', () => core.close());
bridge.handle('getToolManifests', () => core.getToolManifests());
bridge.handle('getBreakerSnapshot', () => core.getBreakerSnapshot());

// 优雅退出 / Graceful exit
process.on('SIGTERM', async () => {
  await core.close();
  bridge.destroy();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error(`[SwarmCore] Uncaught exception: ${err.message}`);
  console.error(err.stack);
  // 通知父进程 / Notify parent process
  bridge.notify('error', { message: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(`[SwarmCore] Unhandled rejection: ${msg}`);
  bridge.notify('error', { message: msg });
});

console.info('[SwarmCore] Child process started, waiting for init...');
