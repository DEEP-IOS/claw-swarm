/**
 * PluginAdapter — 插件适配器 / Plugin Adapter
 *
 * OpenClaw 插件 API 的唯一耦合点。负责初始化所有子系统，
 * 注册钩子、工具和服务，管理生命周期。
 *
 * The sole coupling point with OpenClaw Plugin API. Initializes all subsystems,
 * registers hooks/tools/services, and manages lifecycle.
 *
 * [WHY] Layer 4 是唯一依赖 OpenClaw API 的层。
 * 当 OpenClaw 升级时，只需修改这一个适配器层。
 * Layer 4 is the only layer depending on OpenClaw API.
 * When OpenClaw upgrades, only this adapter layer needs changes.
 *
 * @module plugin-adapter
 * @author DEEP-IOS
 */

import * as db from '../layer1-core/db.js';
import { migrateWithBackup, importOmeDatabase, importSwarmLiteDatabase } from '../layer1-core/db-migration.js';
import { mergeConfig, resolveDbPath } from '../layer1-core/config.js';
import { createLogger } from '../layer1-core/logger.js';
import { Monitor } from '../layer1-core/monitor.js';
import { CircuitBreaker } from '../layer1-core/circuit-breaker.js';

// Layer 2 engines
import { PheromoneEngine } from '../layer2-engines/pheromone/pheromone-engine.js';

// Memory — context-service exports a function (not a class)
import { buildPrependContext } from '../layer2-engines/memory/context-service.js';

// Memory — agent-state-service exports individual functions (not a class)
import * as agentState from '../layer2-engines/memory/agent-state-service.js';

// Governance — 四维能力评分 + 声誉账本 + 评估队列
// Governance — 4D capability scoring + reputation ledger + evaluation queue
import { CapabilityEngine } from '../layer2-engines/governance/capability-engine.js';
import { ReputationLedger } from '../layer2-engines/governance/reputation-ledger.js';
import { EvaluationQueue } from '../layer2-engines/governance/evaluation-queue.js';

// Layer 3 — collaboration
import { PeerDirectory } from '../layer3-intelligence/collaboration/peer-directory.js';
import { StruggleDetector } from '../layer3-intelligence/collaboration/struggle-detector.js';

// Layer 3 — soul
import { SoulDesigner } from '../layer3-intelligence/soul/soul-designer.js';
import { PersonaEvolution } from '../layer3-intelligence/soul/persona-evolution.js';

// Hooks — all 8 lifecycle hooks
import { handleBeforeAgentStart } from './hooks/before-agent-start.js';
import { handleAfterToolCall } from './hooks/after-tool-call.js';
import { handleAgentEnd } from './hooks/agent-end.js';
import { handleBeforeReset } from './hooks/before-reset.js';
import { handleGatewayStop } from './hooks/gateway-stop.js';
import { handleMessageSending } from './hooks/message-sending.js';
import { handleSubagentSpawning } from './hooks/subagent-spawning.js';
import { handleSubagentEnded } from './hooks/subagent-ended.js';

// Tools — 5 agent-facing tools
import { collaborateToolDefinition, createCollaborateHandler } from './tools/collaborate-tool.js';
import { pheromoneToolDefinition, createPheromoneHandler } from './tools/pheromone-tool.js';
import { swarmManageToolDefinition, createSwarmManageHandler } from './tools/swarm-manage-tool.js';
import { swarmSpawnToolDefinition, createSwarmSpawnHandler } from './tools/swarm-spawn-tool.js';
import { swarmDesignToolDefinition, createSwarmDesignHandler } from './tools/swarm-design-tool.js';

export class PluginAdapter {
  constructor() {
    this.logger = null;
    this.config = null;
    this.engines = {};
    this._decayInterval = null;
  }

  /**
   * 注册插件到 OpenClaw API
   * Register the plugin with OpenClaw API
   *
   * @param {object} api - OpenClaw plugin API
   */
  register(api) {
    // ── 1. 配置合并 / Config merge ─────────────────────────────────────
    const userConfig = api.pluginConfig || {};
    this.config = mergeConfig(userConfig);

    this.logger = createLogger('swarm', this.config.logLevel);
    this.logger.info('Claw-Swarm v4.0 initializing...');

    // ── 2. 初始化统一数据库 / Initialize unified DB ────────────────────
    const dbPath = this.config.dbPath || resolveDbPath(api.dataDir || '');
    db.initDb(dbPath);

    // ── 3. 运行迁移 / Run migrations ──────────────────────────────────
    try {
      migrateWithBackup(dbPath);
    } catch (err) {
      this.logger.error('Migration failed:', err.message);
    }

    // ── 4. 导入旧数据库 / Import legacy databases ─────────────────────
    if (this.config.memory?.importOmePath) {
      try {
        const result = importOmeDatabase(this.config.memory.importOmePath);
        this.logger.info('OME data imported:', result);
      } catch (err) {
        this.logger.warn('OME import skipped:', err.message);
      }
    }

    if (this.config.governance?.importSwarmLitePath) {
      try {
        const result = importSwarmLiteDatabase(this.config.governance.importSwarmLitePath);
        this.logger.info('Swarm Lite data imported:', result);
      } catch (err) {
        this.logger.warn('Swarm Lite import skipped:', err.message);
      }
    }

    // ── 5. 初始化引擎 / Initialize engines ────────────────────────────
    this.engines = {};

    // Memory engine
    if (this.config.memory?.enabled) {
      this.engines.agentState = agentState;
      this.engines.buildPrependContext = buildPrependContext;
      this.logger.info('Memory engine enabled');
    }

    // Pheromone engine
    if (this.config.pheromone?.enabled) {
      this.engines.pheromone = new PheromoneEngine(this.config);
      // 后台衰减服务 / Background decay service
      this._decayInterval = setInterval(() => {
        this.engines.pheromone.decayPass();
      }, this.config.pheromone.decayIntervalMs || 60000);
      if (this._decayInterval.unref) this._decayInterval.unref();
      this.logger.info('Pheromone engine enabled');
    }

    // Collaboration — peer directory + struggle detector
    if (this.config.collaboration?.enabled) {
      // 惰性读取，每次访问实时读配置 / Lazy-read, fresh config every access
      this.engines.peerDirectory = new PeerDirectory(() => api.config);
      // StruggleDetector 构造函数接受完整 config（内部读 config.collaboration.*）
      // pheromoneEngine 通过方法参数传递，不是构造函数参数
      // Constructor takes full config; pheromoneEngine is a method-level param
      this.engines.struggleDetector = new StruggleDetector(this.config);
      this.logger.info('Collaboration engine enabled');
    }

    // Governance — 能力引擎 + 声誉账本 + 评估队列
    // Governance — capability engine + reputation ledger + evaluation queue
    if (this.config.governance?.enabled) {
      const govConfig = this.config.governance;
      this.engines.capabilityEngine = new CapabilityEngine(govConfig);
      this.engines.reputationLedger = new ReputationLedger(govConfig);
      this.engines.evaluationQueue = new EvaluationQueue(govConfig);
      // [WHY] CapabilityEngine 通过 evaluationQueue 异步处理评估，
      //       避免在 hook 中做阻塞计算
      // CapabilityEngine processes evaluations asynchronously via queue,
      // avoiding blocking computation inside hooks
      this.engines.capabilityEngine.setEvaluationQueue(this.engines.evaluationQueue);
      this.logger.info('Governance engine enabled');
    }

    // Soul — 人格进化需要先于 SoulDesigner 初始化
    // Soul — PersonaEvolution must initialize before SoulDesigner
    if (this.config.soul?.enabled) {
      this.engines.personaEvolution = new PersonaEvolution();
      this.engines.soulDesigner = new SoulDesigner(this.config, this.engines.personaEvolution);
      this.logger.info('Soul designer enabled');
    }

    // Monitor — always on (low overhead / 低开销，始终开启)
    this.engines.monitor = new Monitor(db, this.config.orchestration || {});

    // Circuit breaker
    this.engines.circuitBreaker = new CircuitBreaker(db, {});

    // ── 6. 注册钩子 / Register hooks ──────────────────────────────────

    // 核心钩子 / Core hooks (always registered)
    api.on('before_agent_start', (event, ctx) => {
      return handleBeforeAgentStart(event, ctx, this.engines, this.config, this.logger, api);
    }, { priority: 50 });

    api.on('after_tool_call', (event, ctx) => {
      handleAfterToolCall(event, ctx, this.engines, this.config, this.logger);
    });

    api.on('agent_end', (event, ctx) => {
      handleAgentEnd(event, ctx, this.engines, this.config, this.logger);
    });

    api.on('before_reset', (event, ctx) => {
      handleBeforeReset(event, ctx, this.engines, this.config, this.logger);
    });

    api.on('gateway_stop', () => {
      handleGatewayStop(this.engines, this.config, this.logger, this._decayInterval);
      db.closeDb();
    });

    // 消息发送 @mention 修复 / Message sending @mention fixer
    if (this.config.collaboration?.mentionFixer !== false) {
      api.on('message_sending', (event, ctx) => {
        handleMessageSending(event, ctx, this.engines, this.config, this.logger);
      });
    }

    // 子代理生成门控 / Subagent spawning governance gate
    if (this.config.governance?.enabled) {
      api.on('subagent_spawning', (event, ctx) => {
        handleSubagentSpawning(event, ctx, this.engines, this.config, this.logger);
      });
    }

    // 子代理结束评估 / Subagent ended evaluation
    api.on('subagent_ended', (event, ctx) => {
      handleSubagentEnded(event, ctx, this.engines, this.config, this.logger);
    });

    // ── 7. 注册工具 / Register tools ──────────────────────────────────

    // collaborate — 多通道同伴通信 / Multi-channel peer communication
    if (this.config.collaboration?.enabled) {
      api.registerTool({
        ...collaborateToolDefinition,
        handler: createCollaborateHandler(this.engines, this.config, this.logger),
      });
    }

    // pheromone — 信息素信号 / Pheromone signals
    if (this.config.pheromone?.enabled) {
      api.registerTool({
        ...pheromoneToolDefinition,
        handler: createPheromoneHandler(this.engines, this.config, this.logger),
      });
    }

    // swarm_manage — 任务管理 / Task management (always available)
    api.registerTool({
      ...swarmManageToolDefinition,
      handler: createSwarmManageHandler(this.engines, this.config, this.logger),
    });

    // swarm_spawn — 蜂群生成 / Swarm spawning
    if (this.config.orchestration?.enabled) {
      api.registerTool({
        ...swarmSpawnToolDefinition,
        handler: createSwarmSpawnHandler(this.engines, this.config, this.logger),
      });
    }

    // swarm_design — SOUL 模板推荐 / SOUL template recommendations
    if (this.config.soul?.enabled) {
      api.registerTool({
        ...swarmDesignToolDefinition,
        handler: createSwarmDesignHandler(this.engines, this.config, this.logger),
      });
    }

    this.logger.info('Claw-Swarm v4.0 initialized successfully');
  }
}
