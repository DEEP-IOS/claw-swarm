/**
 * GovernanceMetrics — 治理三联指标 / Governance Triple Metrics
 *
 * V5.5 核心治理模块，提供可审计、可策略配置、可 ROI 评估的指标体系。
 * V5.5 core governance module — audit, policy compliance, and ROI evaluation.
 *
 * 三联指标 / Triple metrics:
 * 1. Audit: 所有路由决策可追溯 (decision + result 事件完整性)
 * 2. Policy: 实际行为与配置策略的一致性
 * 3. ROI: 蜂群协作投入产出比 (质量提升 - 协作税成本)
 *
 * @module L4-orchestration/governance-metrics
 * @version 5.5.0
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 最大事件缓冲 / Max event buffer */
const MAX_EVENT_BUFFER = 500;

/** 报告间隔 turn 数 / Report interval in turns */
const REPORT_INTERVAL_TURNS = 20;

// ============================================================================
// GovernanceMetrics 类 / GovernanceMetrics Class
// ============================================================================

export class GovernanceMetrics {
  /**
   * @param {Object} deps
   * @param {Object} [deps.swarmAdvisor] - SwarmAdvisor 实例
   * @param {Object} [deps.globalModulator] - GlobalModulator 实例
   * @param {Object} [deps.budgetTracker] - BudgetTracker 实例
   * @param {Object} [deps.observabilityCore] - ObservabilityCore 实例
   * @param {Object} [deps.messageBus] - MessageBus 实例
   * @param {Object} [deps.db] - DatabaseManager 实例
   * @param {Object} [deps.logger] - Logger 实例
   */
  constructor({ swarmAdvisor, globalModulator, budgetTracker, observabilityCore, messageBus, db, logger } = {}) {
    this._swarmAdvisor = swarmAdvisor;
    this._globalModulator = globalModulator;
    this._budgetTracker = budgetTracker;
    this._observabilityCore = observabilityCore;
    this._messageBus = messageBus;
    this._db = db;
    this._logger = logger || console;

    /**
     * 决策事件缓冲 / Decision event buffer
     * @type {Array<{ type: string, turnId: string, timestamp: number, hasResult: boolean }>}
     */
    this._decisionEvents = [];

    /**
     * 协作结果缓冲 / Collaboration result buffer
     * @type {Array<{ turnId: string, swarmUsed: boolean, success: boolean, cost: number, timestamp: number }>}
     */
    this._collabResults = [];

    /** Turn 计数 / Turn counter */
    this._turnCount = 0;

    /** 上次报告的 turn / Last report turn */
    this._lastReportTurn = 0;

    // 自动订阅相关事件 / Auto-subscribe to relevant events
    this._subscribeEvents();
  }

  // ============================================================================
  // 事件订阅 / Event Subscription
  // ============================================================================

  /**
   * 订阅路由决策和结果事件
   * Subscribe to routing decision and result events
   * @private
   */
  _subscribeEvents() {
    if (!this._messageBus) return;

    // 订阅蜂群路由决策事件
    this._messageBus.subscribe?.('swarm.advisory.injected', (event) => {
      this._recordDecision('advisory', event);
    });

    // 订阅 budget 完成事件
    this._messageBus.subscribe?.('budget.turn.completed', (event) => {
      this._recordCollabResult(event);
    });

    // 订阅模式切换事件
    this._messageBus.subscribe?.('modulator.mode.switched', (event) => {
      this._recordDecision('mode_switch', event);
    });
  }

  /**
   * 记录决策事件 / Record decision event
   * @param {string} type
   * @param {Object} event
   * @private
   */
  _recordDecision(type, event) {
    const payload = event?.payload || event;
    this._decisionEvents.push({
      type,
      turnId: payload?.turnId || 'unknown',
      timestamp: Date.now(),
      hasResult: false,
    });

    if (this._decisionEvents.length > MAX_EVENT_BUFFER) {
      this._decisionEvents.shift();
    }
  }

  /**
   * 记录协作结果 / Record collaboration result
   * @param {Object} event
   * @private
   */
  _recordCollabResult(event) {
    const payload = event?.payload || event;
    this._collabResults.push({
      turnId: payload?.turnId || 'unknown',
      swarmUsed: payload?.swarmUsed || false,
      success: payload?.success !== false,
      cost: payload?.cost || 0,
      timestamp: Date.now(),
    });

    // 标记对应决策为有结果 / Mark corresponding decision as having result
    for (let i = this._decisionEvents.length - 1; i >= 0; i--) {
      const d = this._decisionEvents[i];
      if (d.turnId === payload?.turnId && !d.hasResult) {
        d.hasResult = true;
        break;
      }
    }

    if (this._collabResults.length > MAX_EVENT_BUFFER) {
      this._collabResults.shift();
    }
  }

  // ============================================================================
  // Audit 指标 / Audit Metrics
  // ============================================================================

  /**
   * 计算审计分数 — 事件完整性
   * Compute audit score — event completeness
   *
   * auditScore = 有结果的决策数 / 总决策数
   *
   * @returns {number} [0, 1]
   */
  computeAuditScore() {
    if (this._decisionEvents.length === 0) return 1.0; // 无决策时满分

    const withResult = this._decisionEvents.filter(d => d.hasResult).length;
    return withResult / this._decisionEvents.length;
  }

  // ============================================================================
  // Policy 指标 / Policy Metrics
  // ============================================================================

  /**
   * 计算策略合规性 — 实际行为与配置策略的一致性
   * Compute policy compliance — alignment between actual behavior and config
   *
   * @returns {number} [0, 1]
   */
  computePolicyCompliance() {
    // 从 GlobalModulator 获取稳定性指标
    if (this._globalModulator) {
      const stats = this._globalModulator.getStats();
      // 高稳定性 = 高合规性（频繁切换说明策略不一致）
      const stability = Math.min(stats.switchStability / MIN_EXPECTED_STABILITY, 1.0);
      return parseFloat(stability.toFixed(3));
    }
    return 1.0; // 无调节器时默认满分
  }

  // ============================================================================
  // ROI 指标 / ROI Metrics
  // ============================================================================

  /**
   * 计算蜂群协作 ROI
   * Compute swarm collaboration ROI
   *
   * ROI = (蜂群协作成功率 - 非蜂群成功率) / 平均协作成本
   * ROI = (swarm_success_rate - solo_success_rate) / avg_collab_cost
   *
   * @returns {{ roi: number, swarmSuccessRate: number, soloSuccessRate: number, avgCost: number }}
   */
  computeROI() {
    if (this._collabResults.length === 0) {
      return { roi: 0, swarmSuccessRate: 0, soloSuccessRate: 0, avgCost: 0 };
    }

    const swarmResults = this._collabResults.filter(r => r.swarmUsed);
    const soloResults = this._collabResults.filter(r => !r.swarmUsed);

    const swarmSuccessRate = swarmResults.length > 0
      ? swarmResults.filter(r => r.success).length / swarmResults.length
      : 0;

    const soloSuccessRate = soloResults.length > 0
      ? soloResults.filter(r => r.success).length / soloResults.length
      : 0;

    const totalCost = swarmResults.reduce((sum, r) => sum + r.cost, 0);
    const avgCost = swarmResults.length > 0 ? totalCost / swarmResults.length : 0;

    // ROI: 质量提升 / 成本（避免除零）
    const qualityGain = swarmSuccessRate - soloSuccessRate;
    const roi = avgCost > 0 ? qualityGain / avgCost : qualityGain;

    return {
      roi: parseFloat(roi.toFixed(3)),
      swarmSuccessRate: parseFloat(swarmSuccessRate.toFixed(3)),
      soloSuccessRate: parseFloat(soloSuccessRate.toFixed(3)),
      avgCost: parseFloat(avgCost.toFixed(3)),
    };
  }

  // ============================================================================
  // 汇总 / Summary
  // ============================================================================

  /**
   * 获取治理三联指标汇总
   * Get governance triple metrics summary
   *
   * @returns {Object}
   */
  getGovernanceSummary() {
    const auditScore = this.computeAuditScore();
    const policyCompliance = this.computePolicyCompliance();
    const roiData = this.computeROI();

    return {
      audit: {
        score: parseFloat(auditScore.toFixed(3)),
        totalDecisions: this._decisionEvents.length,
        decisionsWithResult: this._decisionEvents.filter(d => d.hasResult).length,
      },
      policy: {
        compliance: policyCompliance,
        currentMode: this._globalModulator?.getCurrentMode?.() || 'RELIABLE',
      },
      roi: roiData,
      totalCollabResults: this._collabResults.length,
      timestamp: Date.now(),
    };
  }

  /**
   * 检查是否需要发布治理报告
   * Check if governance report should be published
   *
   * @param {number} [turnCount] - 当前 turn 计数
   */
  maybePublishReport(turnCount) {
    this._turnCount = turnCount || this._turnCount + 1;

    if (this._turnCount - this._lastReportTurn >= REPORT_INTERVAL_TURNS) {
      this._lastReportTurn = this._turnCount;

      const summary = this.getGovernanceSummary();
      this._messageBus?.publish?.('governance.report', {
        ...summary,
        turn: this._turnCount,
      });

      this._logger.info?.(
        `[GovernanceMetrics] Report: audit=${summary.audit.score.toFixed(2)}, ` +
        `policy=${summary.policy.compliance.toFixed(2)}, ` +
        `ROI=${summary.roi.roi.toFixed(2)}`
      );
    }
  }
}

/** 策略合规性的期望稳定性常量 / Expected stability constant for policy compliance */
const MIN_EXPECTED_STABILITY = 5;
