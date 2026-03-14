/**
 * ContractNet -- FIPA 合同网协议 / FIPA Contract Net Protocol
 *
 * V5.0 新增模块: 实现 FIPA Contract Net Protocol (CNP) 用于任务协商。
 * 管理者发布 CFP (Call For Proposals), 参与者提交 Bid, 管理者评估并授予合同。
 *
 * V5.0 new module: implements FIPA Contract Net Protocol (CNP) for
 * task negotiation. Manager publishes CFP (Call For Proposals),
 * participants submit Bids, manager evaluates and awards contract.
 *
 * Protocol Flow / 协议流程:
 *   CFP → BID → AWARD → EXECUTE → COMPLETE / FAIL
 *
 * Bid Scoring Formula / 投标评分公式:
 *   bid = capability_match * 0.4 + workload_factor * 0.2
 *       + success_rate * 0.3 - opportunity_cost * 0.1
 *
 * Award Scoring Formula / 授予评分公式:
 *   score = capability_match * 0.4 + reputation * 0.3
 *         + resource * 0.2 + load_factor * 0.1
 *
 * @module L4-orchestration/contract-net
 * @author DEEP-IOS
 */

import { nanoid } from 'nanoid';
import { ContractNetPhase } from '../L1-infrastructure/types.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认 CFP 超时 (ms) / Default CFP timeout (ms) */
const DEFAULT_CFP_TIMEOUT = 30_000;

/** 最大并发 CFP 数 / Max concurrent CFPs */
const MAX_CONCURRENT_CFPS = 100;

/**
 * 投标评分权重 / Bid scoring weights
 * @type {{ capabilityMatch: number, workloadFactor: number, successRate: number, opportunityCost: number }}
 */
const BID_WEIGHTS = {
  capabilityMatch: 0.36,
  workloadFactor: 0.18,
  successRate: 0.26,
  opportunityCost: 0.08,
  affinityScore: 0.06,    // V6.0: 任务亲和度 / Task affinity
  symbiosisScore: 0.06,   // V5.7: 团队互补度 / Team complementarity
};

/**
 * 授予评分权重 / Award scoring weights
 *
 * V6.3: 新增 modelCostFactor (成本效率) + pheromoneSignal (信息素信号)
 * V6.3: Added modelCostFactor (cost efficiency) + pheromoneSignal (pheromone signal)
 *
 * @type {{ capabilityMatch: number, reputation: number, resource: number, loadFactor: number, modelCostFactor: number, pheromoneSignal: number }}
 */
const AWARD_WEIGHTS = {
  capabilityMatch: 0.30,
  reputation: 0.25,
  resource: 0.15,
  loadFactor: 0.10,
  modelCostFactor: 0.12,   // V6.3: 成本效率 (便宜模型得分高)
  pheromoneSignal: 0.08,    // V6.3: 信息素信号
};

/**
 * CFP 生命周期状态 / CFP lifecycle status
 * @enum {string}
 */
const CFPStatus = Object.freeze({
  open: 'open',         // 开放投标 / Open for bidding
  evaluating: 'evaluating', // 评估中 / Evaluating bids
  awarded: 'awarded',   // 已授予 / Contract awarded
  expired: 'expired',   // 已过期 / Timeout with no award
  cancelled: 'cancelled', // 已取消 / Cancelled
});

/**
 * 合同状态 / Contract status
 * @enum {string}
 */
const ContractStatus = Object.freeze({
  active: 'active',       // 执行中 / Being executed
  completed: 'completed', // 已完成 / Completed successfully
  failed: 'failed',       // 已失败 / Failed
});

// ============================================================================
// ContractNet 类 / ContractNet Class
// ============================================================================

/**
 * FIPA 合同网协议实现: CFP 管理、投标评估、合同授予。
 * FIPA Contract Net Protocol implementation: CFP management, bid evaluation,
 * contract award.
 *
 * @example
 * ```js
 * const cn = new ContractNet({ messageBus, config, logger });
 *
 * // 1. 发布 CFP / Publish CFP
 * const cfpId = cn.createCFP('task-123', { coding: 0.8 }, { timeout: 10000 });
 *
 * // 2. Agent 提交投标 / Agents submit bids
 * cn.submitBid(cfpId, 'agent-A', {
 *   capabilityMatch: 0.85,
 *   workloadFactor: 0.7,
 *   successRate: 0.9,
 *   opportunityCost: 0.1,
 * });
 *
 * // 3. 评估投标 / Evaluate bids
 * const result = cn.evaluateBids(cfpId);
 *
 * // 4. 授予合同 / Award contract
 * const contractId = cn.awardContract(cfpId, result.winner.agentId);
 *
 * // 5. 完成/失败 / Complete/Fail
 * cn.completeContract(contractId, { output: '...' });
 * ```
 */
export class ContractNet {
  /**
   * @param {Object} [deps] - 依赖注入 / Dependency injection
   * @param {import('../L2-communication/message-bus.js').MessageBus} [deps.messageBus] - 消息总线
   * @param {Object} [deps.config] - 配置 / Configuration
   * @param {number} [deps.config.defaultTimeout=30000] - 默认 CFP 超时 (ms)
   * @param {Object} [deps.config.bidWeights] - 投标权重覆盖
   * @param {Object} [deps.config.awardWeights] - 授予权重覆盖
   * @param {Object} [deps.logger] - 日志器 / Logger
   */
  constructor({ messageBus, config = {}, logger, skillSymbiosis } = {}) {
    /** @private */
    this._messageBus = messageBus || null;

    /** @private */
    this._logger = logger || console;

    /** @private @type {number} */
    this._defaultTimeout = config.defaultTimeout ?? DEFAULT_CFP_TIMEOUT;

    /** @private @type {typeof BID_WEIGHTS} */
    this._bidWeights = { ...BID_WEIGHTS, ...(config.bidWeights || {}) };

    /** @private @type {typeof AWARD_WEIGHTS} */
    this._awardWeights = { ...AWARD_WEIGHTS, ...(config.awardWeights || {}) };

    /** @private V5.7: skill-symbiosis 调度集成 */
    this._skillSymbiosis = skillSymbiosis || null;

    /**
     * 活跃 CFP: cfpId -> CFP data
     * Active CFPs: cfpId -> CFP data
     * @private @type {Map<string, Object>}
     */
    this._cfps = new Map();

    /**
     * 合同: contractId -> Contract data
     * Contracts: contractId -> Contract data
     * @private @type {Map<string, Object>}
     */
    this._contracts = new Map();

    /**
     * 超时句柄: cfpId -> timeoutId
     * Timeout handles: cfpId -> timeoutId
     * @private @type {Map<string, number>}
     */
    this._timeouts = new Map();

    /** @private @type {{ cfpsCreated: number, bidsReceived: number, awarded: number, completed: number, failed: number, expired: number }} */
    this._stats = {
      cfpsCreated: 0,
      bidsReceived: 0,
      awarded: 0,
      completed: 0,
      failed: 0,
      expired: 0,
    };
  }

  // =========================================================================
  // CFP 管理 / CFP Management
  // =========================================================================

  /**
   * 创建并发布 CFP (Call For Proposals)
   * Create and publish a CFP (Call For Proposals)
   *
   * @param {string} taskId - 关联任务 ID / Associated task ID
   * @param {Object} requirements - 能力需求 / Capability requirements
   * @param {Object} [options]
   * @param {number} [options.timeout] - 超时时间 (ms) / Timeout in ms
   * @param {Object} [options.metadata] - 附加元数据 / Additional metadata
   * @returns {string} cfpId
   * @throws {Error} 超出并发限制 / When concurrent limit exceeded
   */
  createCFP(taskId, requirements, { timeout, metadata } = {}) {
    // 并发限制 / Concurrency limit
    const activeCfps = this._countActiveCFPs();
    if (activeCfps >= MAX_CONCURRENT_CFPS) {
      throw new Error(
        `Max concurrent CFPs reached (${MAX_CONCURRENT_CFPS}). ` +
        `当前活跃 CFP 数已达上限。`
      );
    }

    const cfpId = nanoid();
    const cfpTimeout = timeout ?? this._defaultTimeout;
    const now = Date.now();

    const cfp = {
      id: cfpId,
      taskId,
      requirements: requirements ? { ...requirements } : {},
      status: CFPStatus.open,
      bids: [],
      winnerId: null,
      contractId: null,
      metadata: metadata ? { ...metadata } : {},
      createdAt: now,
      expiresAt: now + cfpTimeout,
    };

    this._cfps.set(cfpId, cfp);
    this._stats.cfpsCreated++;

    // 设置超时 / Set timeout
    const timeoutHandle = setTimeout(() => {
      this._expireCFP(cfpId);
    }, cfpTimeout);
    this._timeouts.set(cfpId, timeoutHandle);

    // 广播 CFP / Broadcast CFP
    this._emit('contract.cfp.created', {
      cfpId,
      taskId,
      requirements,
      expiresAt: cfp.expiresAt,
    });

    this._logger.debug?.(
      `[ContractNet] CFP 创建 / CFP created: ${cfpId} for task ${taskId} ` +
      `(timeout=${cfpTimeout}ms)`
    );

    return cfpId;
  }

  /**
   * V7.0 §4: 创建真实竞标 CFP — 通过 LLM 子代理生成真实投标
   * V7.0 §4: Create live CFP — spawn lightweight bidding subagents for real bids
   *
   * 向每个候选 agent spawn 一个轻量 "竞标 subagent", 任务:
   * "评估以下任务, 返回 JSON { confidence, estimatedTime, approach }"
   * 收集 LLM 返回的真实投标 → 综合内部指标做最终决策。
   *
   * Spawns a lightweight "bidding subagent" for each candidate.
   * Task: "Evaluate this task, return JSON { confidence, estimatedTime, approach }"
   * Collects real LLM bids → combines with internal metrics for final decision.
   *
   * @param {string} taskId - 任务 ID
   * @param {Object} requirements - 任务需求描述
   * @param {Array<{ id: string, modelId?: string }>} candidateAgents - 候选 agent 列表
   * @param {Object} [options]
   * @param {Object} [options.relayClient] - SwarmRelayClient 实例
   * @returns {Promise<{ cfpId: string, liveBids: Array<Object>, winner?: string }>}
   */
  async createLiveCFP(taskId, requirements, candidateAgents, options = {}) {
    const { relayClient } = options;
    const cfpId = this.createCFP(taskId, requirements, { metadata: { isLive: true } });

    if (!relayClient || !candidateAgents || candidateAgents.length < 2) {
      // 无 relayClient 或不足 2 个候选时, 回退为普通 CFP / Fallback to standard CFP
      return { cfpId, liveBids: [], fallback: true };
    }

    const liveBids = [];
    const bidPromises = candidateAgents.map(async (candidate) => {
      try {
        const bidTask =
          `[Live CFP Bid] 评估以下任务并返回 JSON:\n` +
          `任务: ${JSON.stringify(requirements).substring(0, 300)}\n` +
          `返回格式: { "confidence": 0.0-1.0, "estimatedTime": "预计耗时", "approach": "简述方案" }`;

        const result = await relayClient.spawnAndMonitor({
          agentId: candidate.id,
          task: bidTask,
          model: candidate.modelId || undefined,
          timeoutSeconds: 60, // 竞标用较短超时 / Short timeout for bidding
          label: `cfp:${cfpId}:${candidate.id}`,
          onEnded: () => {}, // 必须提供以启动 monitor / Required to start monitor
        });

        if (result?.status === 'spawned') {
          liveBids.push({
            agentId: candidate.id,
            cfpId,
            status: 'submitted',
            modelId: candidate.modelId,
          });
        }
      } catch (err) {
        this._logger.debug?.(`[ContractNet] Live CFP bid error for ${candidate.id}: ${err.message}`);
      }
    });

    // 等待所有竞标完成 (最多 60s) / Wait for all bids (max 60s)
    await Promise.allSettled(bidPromises);

    this._emit('contract.live_cfp.completed', {
      cfpId,
      taskId,
      candidateCount: candidateAgents.length,
      bidCount: liveBids.length,
    });

    this._logger.info?.(
      `[ContractNet] Live CFP completed: ${cfpId}, bids=${liveBids.length}/${candidateAgents.length}`
    );

    return { cfpId, liveBids };
  }

  /**
   * 获取 CFP 状态
   * Get CFP status
   *
   * @param {string} cfpId
   * @returns {{
   *   id: string,
   *   taskId: string,
   *   status: string,
   *   bidCount: number,
   *   winnerId: string|null,
   *   contractId: string|null,
   *   createdAt: number,
   *   expiresAt: number
   * }|null}
   */
  getCFPStatus(cfpId) {
    const cfp = this._cfps.get(cfpId);
    if (!cfp) return null;

    return {
      id: cfp.id,
      taskId: cfp.taskId,
      status: cfp.status,
      bidCount: cfp.bids.length,
      winnerId: cfp.winnerId,
      contractId: cfp.contractId,
      createdAt: cfp.createdAt,
      expiresAt: cfp.expiresAt,
    };
  }

  // =========================================================================
  // 投标 / Bidding
  // =========================================================================

  /**
   * 提交投标
   * Submit a bid for a CFP
   *
   * @param {string} cfpId - CFP ID
   * @param {string} agentId - 投标 Agent ID / Bidding agent ID
   * @param {Object} bidData - 投标数据 / Bid data
   * @param {number} bidData.capabilityMatch - 能力匹配度 (0-1) / Capability match
   * @param {number} [bidData.workloadFactor=0.5] - 工作负载因子 (0-1, 0=满载) / Workload factor
   * @param {number} [bidData.successRate=0.5] - 历史成功率 (0-1) / Historical success rate
   * @param {number} [bidData.opportunityCost=0] - 机会成本 (0-1) / Opportunity cost
   * @param {number} [bidData.reputation=0.5] - 声誉分 (0-1) / Reputation score
   * @param {number} [bidData.resource=0.5] - 资源可用度 (0-1) / Resource availability
   * @param {string} [bidData.modelId] - V6.3: 竞标模型 ID / Bidding model ID
   * @param {number} [bidData.modelCost] - V6.3: 模型成本 ($/1K token) / Model cost
   * @param {number} [bidData.modelCapability] - V6.3: 模型能力分 (0-1) / Model capability score
   * @param {number} [bidData.pheromoneSignal=0] - V6.3: 信息素信号 (0-1) / Pheromone signal
   * @param {Object} [bidData.metadata] - 附加数据 / Additional data
   * @returns {string} bidId
   * @throws {Error} CFP 不存在或已关闭 / CFP not found or closed
   */
  submitBid(cfpId, agentId, bidData) {
    const cfp = this._cfps.get(cfpId);

    if (!cfp) {
      throw new Error(`CFP not found: ${cfpId}. CFP 不存在。`);
    }

    if (cfp.status !== CFPStatus.open) {
      throw new Error(
        `CFP ${cfpId} is not open (status: ${cfp.status}). CFP 非开放状态。`
      );
    }

    // 检查重复投标 / Check duplicate bid
    // V6.3: 同一 agent 可以用不同 model 提交多个 bid, 但同一 (agent, model) 不可重复
    // V6.3: Same agent can submit multiple bids with different models, but same (agent, model) pair cannot repeat
    const modelId = bidData.modelId || null;
    const existingBid = cfp.bids.find(b => b.agentId === agentId && b.modelId === modelId);
    if (existingBid) {
      throw new Error(
        `Agent ${agentId} has already bid on CFP ${cfpId}` +
        (modelId ? ` with model ${modelId}` : '') +
        `. 该 Agent 已投标。`
      );
    }

    const bidId = nanoid();
    const bid = {
      id: bidId,
      cfpId,
      agentId,
      capabilityMatch: bidData.capabilityMatch ?? 0,
      workloadFactor: bidData.workloadFactor ?? 0.5,
      successRate: bidData.successRate ?? 0.5,
      opportunityCost: bidData.opportunityCost ?? 0,
      reputation: bidData.reputation ?? 0.5,
      resource: bidData.resource ?? 0.5,
      // V6.3: model 竞标字段 / Model bidding fields
      modelId: bidData.modelId || null,
      modelCost: bidData.modelCost ?? null,
      modelCapability: bidData.modelCapability ?? null,
      pheromoneSignal: bidData.pheromoneSignal ?? 0,
      metadata: bidData.metadata ? { ...bidData.metadata } : {},
      score: 0, // 评估时计算 / Computed at evaluation
      submittedAt: Date.now(),
    };

    // V5.7: 计算共生互补度 / Compute symbiosis complementarity
    if (this._skillSymbiosis && cfp.bids.length > 0) {
      const currentTeam = cfp.bids.map(b => b.agentId);
      bid.symbiosisScore = this._skillSymbiosis.getTeamComplementarity(agentId, currentTeam);
    }

    cfp.bids.push(bid);
    this._stats.bidsReceived++;

    this._emit('contract.bid.submitted', {
      cfpId,
      bidId,
      agentId,
      taskId: cfp.taskId,
      model: bid.modelId || null,
      score: bid.capabilityScore || 0,
      bid: bid.capabilityScore || 0,
    });

    this._logger.debug?.(
      `[ContractNet] 投标提交 / Bid submitted: ${bidId} by ${agentId} for CFP ${cfpId}`
    );

    return bidId;
  }

  // =========================================================================
  // 投标评估 / Bid Evaluation
  // =========================================================================

  /**
   * 评估 CFP 的所有投标并选出赢家
   * Evaluate all bids for a CFP and select winner
   *
   * 评估使用两阶段评分:
   *   1. 投标分: bid_score = cap*0.4 + workload*0.2 + success*0.3 - cost*0.1
   *   2. 授予分: award_score = cap*0.4 + reputation*0.3 + resource*0.2 + load*0.1
   *   3. 综合分 = bid_score * 0.5 + award_score * 0.5
   *
   * Evaluation uses two-phase scoring:
   *   1. Bid score: bid = cap*0.4 + workload*0.2 + success*0.3 - cost*0.1
   *   2. Award score: award = cap*0.4 + reputation*0.3 + resource*0.2 + load*0.1
   *   3. Combined = bid_score * 0.5 + award_score * 0.5
   *
   * @param {string} cfpId
   * @returns {{
   *   winner: { agentId: string, score: number, bidId: string } | null,
   *   bids: Array<{ agentId: string, bidId: string, bidScore: number, awardScore: number, combinedScore: number }>,
   *   scores: Array<number>
   * }}
   * @throws {Error} CFP 不存在 / CFP not found
   */
  evaluateBids(cfpId) {
    const cfp = this._cfps.get(cfpId);

    if (!cfp) {
      throw new Error(`CFP not found: ${cfpId}. CFP 不存在。`);
    }

    // 标记为评估中 / Mark as evaluating
    cfp.status = CFPStatus.evaluating;

    if (cfp.bids.length === 0) {
      this._logger.debug?.(
        `[ContractNet] 无投标 / No bids for CFP ${cfpId}`
      );
      return { winner: null, bids: [], scores: [] };
    }

    // 对每个投标计算综合分 / Score each bid
    const evaluated = cfp.bids.map(bid => {
      const bidScore = this.computeBidScore(bid);
      const awardScore = this._computeAwardScore(bid);
      const combinedScore = bidScore * 0.5 + awardScore * 0.5;

      // 回写分数到 bid / Write score back to bid
      bid.score = Math.round(combinedScore * 10000) / 10000;

      return {
        agentId: bid.agentId,
        bidId: bid.id,
        modelId: bid.modelId || null,  // V6.3: 竞标模型
        bidScore: Math.round(bidScore * 10000) / 10000,
        awardScore: Math.round(awardScore * 10000) / 10000,
        combinedScore: Math.round(combinedScore * 10000) / 10000,
      };
    });

    // V6.3: 两阶段排序 / Two-stage ranking
    // 阶段1 (intra-agent): 按 agent 分组, 每组内选出最优 model bid
    // Phase 1 (intra-agent): group by agent, pick best model bid per agent
    const byAgent = new Map();
    for (const e of evaluated) {
      const existing = byAgent.get(e.agentId);
      if (!existing || e.combinedScore > existing.combinedScore) {
        byAgent.set(e.agentId, e);
      }
    }

    // 阶段2 (inter-agent): 各 agent 最优 bid 之间竞争
    // Phase 2 (inter-agent): best bids from each agent compete
    const finalists = [...byAgent.values()];
    finalists.sort((a, b) => b.combinedScore - a.combinedScore);

    const winner = finalists.length > 0
      ? {
          agentId: finalists[0].agentId,
          score: finalists[0].combinedScore,
          bidId: finalists[0].bidId,
          modelId: finalists[0].modelId,  // V6.3: 选中的模型
        }
      : null;

    this._emit('contract.bids.evaluated', {
      cfpId,
      taskId: cfp.taskId,
      bidCount: evaluated.length,
      finalistCount: finalists.length,  // V6.3: 进入决赛的 agent 数
      winner: winner ? winner.agentId : null,
      winnerModelId: winner?.modelId || null,  // V6.3: 胜出模型
      topScore: winner ? winner.score : 0,
    });

    this._logger.debug?.(
      `[ContractNet] 投标评估完成 / Bids evaluated for CFP ${cfpId}: ` +
      `${evaluated.length} bids (${finalists.length} agents), winner=${winner?.agentId || 'none'}` +
      (winner?.modelId ? ` model=${winner.modelId}` : '')
    );

    return {
      winner,
      bids: finalists,           // V6.3: 返回 finalist 而非所有 bid
      allBids: evaluated,        // V6.3: 所有 bid (含同一 agent 的多 model)
      scores: finalists.map(e => e.combinedScore),
    };
  }

  /**
   * 计算投标分数 (公开方法, 可独立使用)
   * Compute bid score (public method, can be used independently)
   *
   * bid = capability_match * 0.4 + workload_factor * 0.2
   *     + success_rate * 0.3 - opportunity_cost * 0.1
   *
   * @param {Object} bidData
   * @param {number} bidData.capabilityMatch - 能力匹配度 (0-1)
   * @param {number} [bidData.workloadFactor=0.5] - 工作负载因子 (0-1)
   * @param {number} [bidData.successRate=0.5] - 成功率 (0-1)
   * @param {number} [bidData.opportunityCost=0] - 机会成本 (0-1)
   * @returns {number} 分数 / Score
   */
  computeBidScore(bidData) {
    const cap = bidData.capabilityMatch ?? 0;
    const workload = bidData.workloadFactor ?? 0.5;
    const success = bidData.successRate ?? 0.5;
    const cost = bidData.opportunityCost ?? 0;
    const affinity = bidData.affinityScore ?? 0;       // V6.0: 任务亲和度
    const symbiosis = bidData.symbiosisScore ?? 0;     // V5.7: 团队互补度

    const score =
      cap * this._bidWeights.capabilityMatch +
      workload * this._bidWeights.workloadFactor +
      success * this._bidWeights.successRate -
      cost * this._bidWeights.opportunityCost +
      affinity * (this._bidWeights.affinityScore || 0) +
      symbiosis * (this._bidWeights.symbiosisScore || 0);

    // clamp 到 [0, 1] / Clamp to [0, 1]
    return Math.max(0, Math.min(1, score));
  }

  // =========================================================================
  // 合同授予 / Contract Award
  // =========================================================================

  /**
   * 授予合同给指定 Agent
   * Award contract to specified agent
   *
   * @param {string} cfpId - CFP ID
   * @param {string} agentId - 获胜 Agent ID / Winning agent ID
   * @returns {string} contractId
   * @throws {Error} CFP 不存在或状态不正确 / CFP not found or invalid status
   */
  awardContract(cfpId, agentId) {
    const cfp = this._cfps.get(cfpId);

    if (!cfp) {
      throw new Error(`CFP not found: ${cfpId}. CFP 不存在。`);
    }

    if (cfp.status !== CFPStatus.evaluating && cfp.status !== CFPStatus.open) {
      throw new Error(
        `CFP ${cfpId} cannot be awarded (status: ${cfp.status}). ` +
        `CFP 当前状态不允许授予。`
      );
    }

    // 验证 Agent 确实投标了 / Verify agent actually bid
    const bid = cfp.bids.find(b => b.agentId === agentId);
    if (!bid) {
      throw new Error(
        `Agent ${agentId} did not bid on CFP ${cfpId}. ` +
        `该 Agent 未投标。`
      );
    }

    // 清除超时 / Clear timeout
    this._clearTimeout(cfpId);

    // 创建合同 / Create contract
    const contractId = nanoid();
    const now = Date.now();

    const contract = {
      id: contractId,
      cfpId,
      taskId: cfp.taskId,
      agentId,
      bidId: bid.id,
      bidScore: bid.score,
      modelId: bid.modelId || null,  // V6.3: 选中的模型
      status: ContractStatus.active,
      result: null,
      error: null,
      awardedAt: now,
      completedAt: null,
    };

    this._contracts.set(contractId, contract);

    // 更新 CFP 状态 / Update CFP status
    cfp.status = CFPStatus.awarded;
    cfp.winnerId = agentId;
    cfp.contractId = contractId;

    this._stats.awarded++;

    this._emit('contract.awarded', {
      cfpId,
      contractId,
      taskId: cfp.taskId,
      agentId,
      bidScore: bid.score,
    });

    this._logger.debug?.(
      `[ContractNet] 合同授予 / Contract awarded: ${contractId} to ${agentId} ` +
      `(CFP ${cfpId})`
    );

    return contractId;
  }

  // =========================================================================
  // 合同完成/失败 / Contract Complete/Fail
  // =========================================================================

  /**
   * 标记合同完成
   * Mark contract as completed
   *
   * @param {string} contractId
   * @param {Object} [result] - 执行结果 / Execution result
   * @throws {Error} 合同不存在或已结束 / Contract not found or already finished
   */
  completeContract(contractId, result) {
    const contract = this._contracts.get(contractId);

    if (!contract) {
      throw new Error(`Contract not found: ${contractId}. 合同不存在。`);
    }

    if (contract.status !== ContractStatus.active) {
      throw new Error(
        `Contract ${contractId} is not active (status: ${contract.status}). ` +
        `合同非活跃状态。`
      );
    }

    contract.status = ContractStatus.completed;
    contract.result = result || null;
    contract.completedAt = Date.now();

    this._stats.completed++;

    this._emit('contract.completed', {
      contractId,
      cfpId: contract.cfpId,
      taskId: contract.taskId,
      agentId: contract.agentId,
    });

    this._logger.debug?.(
      `[ContractNet] 合同完成 / Contract completed: ${contractId}`
    );
  }

  /**
   * 标记合同失败
   * Mark contract as failed
   *
   * @param {string} contractId
   * @param {Error|string|Object} [error] - 失败原因 / Failure reason
   * @throws {Error} 合同不存在或已结束 / Contract not found or already finished
   */
  failContract(contractId, error) {
    const contract = this._contracts.get(contractId);

    if (!contract) {
      throw new Error(`Contract not found: ${contractId}. 合同不存在。`);
    }

    if (contract.status !== ContractStatus.active) {
      throw new Error(
        `Contract ${contractId} is not active (status: ${contract.status}). ` +
        `合同非活跃状态。`
      );
    }

    contract.status = ContractStatus.failed;
    contract.error = error instanceof Error ? error.message : error;
    contract.completedAt = Date.now();

    this._stats.failed++;

    this._emit('contract.failed', {
      contractId,
      cfpId: contract.cfpId,
      taskId: contract.taskId,
      agentId: contract.agentId,
      error: contract.error,
    });

    this._logger.debug?.(
      `[ContractNet] 合同失败 / Contract failed: ${contractId}: ${contract.error}`
    );
  }

  // =========================================================================
  // 统计与清理 / Statistics & Cleanup
  // =========================================================================

  /**
   * 获取协议统计
   * Get protocol statistics
   *
   * @returns {{
   *   cfpsCreated: number,
   *   bidsReceived: number,
   *   awarded: number,
   *   completed: number,
   *   failed: number,
   *   expired: number,
   *   activeCfps: number,
   *   activeContracts: number
   * }}
   */
  getStats() {
    return {
      ...this._stats,
      activeCfps: this._countActiveCFPs(),
      activeContracts: this._countActiveContracts(),
    };
  }

  /**
   * 销毁: 清理所有超时和数据
   * Destroy: clean up all timeouts and data
   */
  destroy() {
    // 清除所有超时 / Clear all timeouts
    for (const [cfpId, handle] of this._timeouts) {
      clearTimeout(handle);
    }
    this._timeouts.clear();
    this._cfps.clear();
    this._contracts.clear();
  }

  // =========================================================================
  // 内部方法 / Internal Methods
  // =========================================================================

  /**
   * 计算授予评分
   * Compute award score
   *
   * V6.3: award = cap * 0.30 + rep * 0.25 + res * 0.15
   *              + load * 0.10 + modelCost * 0.12 + pheromone * 0.08
   *
   * @private
   * @param {Object} bid
   * @returns {number} 0-1
   */
  _computeAwardScore(bid) {
    const cap = bid.capabilityMatch ?? 0;
    const rep = bid.reputation ?? 0.5;
    const res = bid.resource ?? 0.5;
    const load = bid.workloadFactor ?? 0.5;

    // V6.3: model 成本因子 — 便宜模型得分高, 昂贵模型得分低
    // V6.3: model cost factor — cheaper models score higher
    const modelCost = bid.modelCost ?? null;
    const costFactor = modelCost !== null
      ? 1.0 / (1.0 + modelCost)  // 归一化到 (0, 1), cost=0 → 1.0, cost=1 → 0.5
      : 0.5;  // 无 model 信息时使用中性值

    // V6.3: 信息素信号 / Pheromone signal
    const pheromone = bid.pheromoneSignal ?? 0;

    let score =
      cap * this._awardWeights.capabilityMatch +
      rep * this._awardWeights.reputation +
      res * this._awardWeights.resource +
      load * this._awardWeights.loadFactor +
      costFactor * (this._awardWeights.modelCostFactor || 0) +
      pheromone * (this._awardWeights.pheromoneSignal || 0);

    // V5.7: 共生互补度信号注入 / Symbiosis complementarity signal injection
    if (this._skillSymbiosis && bid.symbiosisScore !== undefined) {
      const symbiosisWeight = this._config?.symbiosisWeight ?? 0.08;
      score = score * (1 - symbiosisWeight) + bid.symbiosisScore * symbiosisWeight;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * CFP 过期处理
   * Handle CFP expiration
   *
   * @private
   * @param {string} cfpId
   */
  _expireCFP(cfpId) {
    const cfp = this._cfps.get(cfpId);
    if (!cfp) return;

    // 只有 open 状态的 CFP 才会过期 / Only open CFPs can expire
    if (cfp.status !== CFPStatus.open) return;

    cfp.status = CFPStatus.expired;
    this._stats.expired++;

    this._timeouts.delete(cfpId);

    this._emit('contract.cfp.expired', {
      cfpId,
      taskId: cfp.taskId,
      bidCount: cfp.bids.length,
    });

    this._logger.debug?.(
      `[ContractNet] CFP 过期 / CFP expired: ${cfpId} ` +
      `(${cfp.bids.length} bids received)`
    );
  }

  /**
   * 清除 CFP 超时
   * Clear CFP timeout
   *
   * @private
   * @param {string} cfpId
   */
  _clearTimeout(cfpId) {
    const handle = this._timeouts.get(cfpId);
    if (handle) {
      clearTimeout(handle);
      this._timeouts.delete(cfpId);
    }
  }

  /**
   * 统计活跃 CFP 数 / Count active CFPs
   *
   * @private
   * @returns {number}
   */
  _countActiveCFPs() {
    let count = 0;
    for (const cfp of this._cfps.values()) {
      if (cfp.status === CFPStatus.open || cfp.status === CFPStatus.evaluating) {
        count++;
      }
    }
    return count;
  }

  /**
   * 统计活跃合同数 / Count active contracts
   *
   * @private
   * @returns {number}
   */
  _countActiveContracts() {
    let count = 0;
    for (const contract of this._contracts.values()) {
      if (contract.status === ContractStatus.active) {
        count++;
      }
    }
    return count;
  }

  /**
   * 发布消息总线事件
   * Publish to message bus
   *
   * @private
   * @param {string} topic
   * @param {Object} data
   */
  _emit(topic, data) {
    if (this._messageBus) {
      try {
        this._messageBus.publish(topic, data, { senderId: 'contract-net' });
      } catch {
        // 忽略消息总线错误 / Ignore message bus errors
      }
    }
  }
}
