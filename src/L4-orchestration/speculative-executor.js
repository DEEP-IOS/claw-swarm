/**
 * SpeculativeExecutor — 推测执行引擎 / Speculative Execution Engine
 *
 * V5.6: 当 GlobalModulator 处于 EXPLORE 模式且有空闲 Agent 时,
 * 对临界路径任务启动并行候选执行。首个完成的路径保留结果, 其余取消。
 *
 * V5.6: When GlobalModulator is in EXPLORE mode and idle agents are
 * available, speculatively run alternative execution paths for
 * critical-path tasks. First completion wins, others are cancelled.
 *
 * 推测条件（全部满足）/ Speculation conditions (all must hold):
 *   1. speculativeExecution feature flag enabled
 *   2. GlobalModulator mode === EXPLORE
 *   3. activeSpeculations < speculationBudget
 *   4. task isCritical === true (from CPM analysis)
 *   5. idle agents available
 *
 * @module L4-orchestration/speculative-executor
 * @version 5.6.0
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

const SOURCE = 'speculative-executor';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认最大推测路径数（每个临界任务） / Default max speculative paths per critical task */
const DEFAULT_MAX_SPECULATIVE_PATHS = 2;

/** 默认系统级推测预算 / Default system-wide speculation budget */
const DEFAULT_SPECULATION_BUDGET = 3;

// ============================================================================
// SpeculativeExecutor 类 / SpeculativeExecutor Class
// ============================================================================

export class SpeculativeExecutor {
  /**
   * @param {Object} deps
   * @param {Object} deps.dagEngine - TaskDAGEngine 实例
   * @param {Object} [deps.globalModulator] - GlobalModulator 实例 (可延迟注入)
   * @param {Object} deps.agentRepo - AgentRepository 实例
   * @param {Object} deps.messageBus - MessageBus 实例
   * @param {Object} [deps.logger]
   * @param {Object} [deps.config]
   * @param {number} [deps.config.maxSpeculativePaths=2]
   * @param {number} [deps.config.speculationBudget=3]
   */
  constructor({ dagEngine, globalModulator, agentRepo, messageBus, logger, relayClient, config = {} } = {}) {
    this._dagEngine = dagEngine;
    this._globalModulator = globalModulator || null;
    this._agentRepo = agentRepo;
    this._messageBus = messageBus || null;
    this._logger = logger || console;
    /** V7.0 §16: relayClient for real speculative spawning */
    this._relayClient = relayClient || null;

    this._maxPaths = config.maxSpeculativePaths || DEFAULT_MAX_SPECULATIVE_PATHS;
    this._budget = config.speculationBudget || DEFAULT_SPECULATION_BUDGET;

    /**
     * 活跃推测: key → SpeculationEntry
     * Active speculations: key → SpeculationEntry
     *
     * SpeculationEntry = {
     *   dagId: string,
     *   nodeId: string,
     *   primaryAgent: string|null,
     *   paths: Array<{ agentId: string, startedAt: number, status: 'running'|'resolved'|'cancelled' }>,
     *   resolvedResult: any,
     *   resolvedAt: number|null,
     * }
     *
     * @type {Map<string, Object>}
     */
    this._activeSpeculations = new Map();

    /** @type {Object} 统计 / Statistics */
    this._stats = {
      started: 0,
      resolved: 0,
      cancelled: 0,
      savingsMs: 0,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 推测启动 / Speculation Launch
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 检查条件并可能启动推测执行
   * Check conditions and possibly launch speculative execution
   *
   * @param {string} dagId
   * @param {string} nodeId
   * @returns {boolean} 是否启动了推测 / whether speculation was started
   */
  maybeSpeculate(dagId, nodeId) {
    // 1. 检查全局预算 / Check global budget
    if (this._activeSpeculations.size >= this._budget) {
      return false;
    }

    // 2. 检查 GlobalModulator 模式 / Check GlobalModulator mode
    if (!this._isExploreMode()) {
      return false;
    }

    // 3. 检查 DAG 引擎可用性 / Check DAG engine availability
    if (!this._dagEngine) {
      return false;
    }

    // 4. 检查任务是否为临界路径 / Check if task is critical
    const dagSnapshot = this._dagEngine.getDAGSnapshot?.(dagId);
    if (!dagSnapshot) return false;

    const node = dagSnapshot.nodes?.find(n => n.id === nodeId);
    if (!node || !node.isCritical) {
      return false;
    }

    // 5. 避免重复推测 / Avoid duplicate speculation
    const key = `${dagId}:${nodeId}`;
    if (this._activeSpeculations.has(key)) {
      return false;
    }

    // 6. 查找空闲 Agent / Find idle agents
    const idleAgents = this._findIdleAgents(node.assignedAgent);
    if (idleAgents.length === 0) {
      return false;
    }

    // 启动推测 / Launch speculation
    const pathCount = Math.min(this._maxPaths, idleAgents.length);
    const paths = [];

    for (let i = 0; i < pathCount; i++) {
      paths.push({
        agentId: idleAgents[i],
        startedAt: Date.now(),
        status: 'running',
      });
    }

    const entry = {
      dagId,
      nodeId,
      primaryAgent: node.assignedAgent || null,
      paths,
      resolvedResult: null,
      resolvedAt: null,
    };

    this._activeSpeculations.set(key, entry);
    this._stats.started++;

    // 注册到 DAG 引擎的完成集合 / Register in DAG engine's completion set
    if (this._dagEngine._completionSet) {
      this._dagEngine._completionSet.set(key, {
        speculative: true,
        pathCount: pathCount + 1, // +1 for primary
      });
    }

    // V7.0 §16: 真实推测执行 — 通过 relayClient 实际 spawn 多个 agent
    // V7.0 §16: Real speculative execution — spawn multiple agents via relayClient
    const relayClient = this._relayClient;
    if (relayClient) {
      for (const path of paths) {
        try {
          const taskDesc = `[Speculative] ${dagId}:${nodeId} — path ${path.agentId}`;
          relayClient.spawnAndMonitor({
            agentId: path.agentId,
            task: taskDesc,
            timeoutSeconds: 300,
            label: `spec:${dagId}:${nodeId}:${path.agentId}`,
            onEnded: (evt) => {
              if (evt.outcome === 'ok' || evt.outcome === 'success') {
                this.resolveSpeculation(dagId, nodeId, evt.result, path.agentId);
              } else {
                path.status = 'cancelled';
              }
            },
          }).catch(() => { path.status = 'cancelled'; });
        } catch {
          path.status = 'cancelled';
        }
      }
    } else {
      // Fallback: 仅拍卖 (无真实 spawn) / Fallback: auction only (no real spawn)
      for (const path of paths) {
        try {
          this._dagEngine.auctionTask?.(dagId, nodeId);
        } catch {
          path.status = 'cancelled';
        }
      }
    }

    this._publish(EventTopics.SPECULATIVE_TASK_STARTED, {
      dagId,
      nodeId,
      primaryAgent: entry.primaryAgent,
      speculativePaths: pathCount,
      totalPaths: pathCount + 1,
    });

    this._logger.info?.(
      `[SpeculativeExecutor] Started ${pathCount} speculative path(s) for ` +
      `${dagId}:${nodeId} (critical path task)`
    );

    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 推测解析 / Speculation Resolution
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 解析推测执行: 首个完成保留, 其余取消
   * Resolve speculation: first completion wins, cancel rest
   *
   * @param {string} dagId
   * @param {string} nodeId
   * @param {*} result - 完成结果
   * @param {string} [winnerAgent] - 完成的 Agent ID
   */
  resolveSpeculation(dagId, nodeId, result, winnerAgent) {
    const key = `${dagId}:${nodeId}`;
    const entry = this._activeSpeculations.get(key);
    if (!entry) return;

    // 已经解析过了（第二个完成的路径到达） / Already resolved (late arrival)
    if (entry.resolvedAt) {
      this._stats.cancelled++;

      this._publish(EventTopics.SPECULATIVE_TASK_CANCELLED, {
        dagId,
        nodeId,
        reason: 'late_arrival',
        winnerAgent: entry.paths.find(p => p.status === 'resolved')?.agentId || entry.primaryAgent,
        cancelledAgent: winnerAgent,
      });

      return;
    }

    // 首次解析 / First resolution
    entry.resolvedResult = result;
    entry.resolvedAt = Date.now();

    // 标记胜出路径 / Mark winning path
    let cancelled = 0;
    for (const path of entry.paths) {
      if (path.agentId === winnerAgent) {
        path.status = 'resolved';
      } else if (path.status === 'running') {
        path.status = 'cancelled';
        cancelled++;
      }
    }

    // 如果胜者不是推测路径中的 agent，那是主路径胜出
    // If winner isn't in speculative paths, it's the primary path winning
    const isPrimaryWinner = !entry.paths.some(p => p.agentId === winnerAgent);
    if (isPrimaryWinner) {
      cancelled = entry.paths.filter(p => p.status === 'running').length;
      for (const path of entry.paths) {
        if (path.status === 'running') path.status = 'cancelled';
      }
    }

    this._stats.resolved++;
    this._stats.cancelled += cancelled;

    // 计算节省时间 / Calculate time savings
    const earliestStart = Math.min(
      ...entry.paths.map(p => p.startedAt),
    );
    const savingsMs = Math.max(0, Date.now() - earliestStart);
    this._stats.savingsMs += savingsMs;

    // 清理 DAG 完成集合 / Clean up DAG completion set
    if (this._dagEngine._completionSet) {
      this._dagEngine._completionSet.delete(key);
    }

    this._publish(EventTopics.SPECULATIVE_TASK_RESOLVED, {
      dagId,
      nodeId,
      winnerAgent: winnerAgent || entry.primaryAgent,
      isPrimaryWinner,
      cancelledPaths: cancelled,
      savingsMs,
    });

    // 延迟清理 / Deferred cleanup
    setTimeout(() => this._activeSpeculations.delete(key), 5000);

    this._logger.info?.(
      `[SpeculativeExecutor] Resolved ${dagId}:${nodeId} — ` +
      `winner=${winnerAgent || 'primary'}, cancelled=${cancelled}`
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 查询 / Query
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 查询任务是否正在推测执行
   * Check if task is under speculative execution
   *
   * @param {string} dagId
   * @param {string} nodeId
   * @returns {boolean}
   */
  isSpeculative(dagId, nodeId) {
    return this._activeSpeculations.has(`${dagId}:${nodeId}`);
  }

  /**
   * 获取推测执行统计
   * Get speculation statistics
   *
   * @returns {{ activeSpeculations: number, started: number, resolved: number, cancelled: number, savingsMs: number, budget: number }}
   */
  getStats() {
    return {
      activeSpeculations: this._activeSpeculations.size,
      ...this._stats,
      budget: this._budget,
      maxPaths: this._maxPaths,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 生命周期 / Lifecycle
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 清理所有推测状态
   * Clean up all speculation state
   */
  destroy() {
    // 取消所有活跃推测 / Cancel all active speculations
    for (const [key, entry] of this._activeSpeculations) {
      for (const path of entry.paths) {
        if (path.status === 'running') {
          path.status = 'cancelled';
          this._stats.cancelled++;
        }
      }
      if (this._dagEngine?._completionSet) {
        this._dagEngine._completionSet.delete(key);
      }
    }
    this._activeSpeculations.clear();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 内部方法 / Internal
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 检查 GlobalModulator 是否处于 EXPLORE 模式
   * Check if GlobalModulator is in EXPLORE mode
   * @private
   */
  _isExploreMode() {
    if (!this._globalModulator) return false;
    const mode = this._globalModulator.getCurrentMode?.();
    return mode === 'EXPLORE';
  }

  /**
   * 查找空闲 Agent（排除指定的主 Agent）
   * Find idle agents (excluding the specified primary agent)
   * @private
   */
  _findIdleAgents(excludeAgentId) {
    if (!this._agentRepo) return [];

    try {
      const agents = this._agentRepo.listAgents?.('active') || [];
      const busyAgents = new Set();

      // 从 DAG 引擎的 agent 队列获取繁忙 agent
      // Get busy agents from DAG engine's agent queues
      if (this._dagEngine?._agentQueues) {
        for (const [agentId, queue] of this._dagEngine._agentQueues) {
          if (queue.length > 0) busyAgents.add(agentId);
        }
      }

      return agents
        .filter(a => {
          const id = a.agent_id || a.agentId || a.id;
          return id !== excludeAgentId && !busyAgents.has(id);
        })
        .map(a => a.agent_id || a.agentId || a.id)
        .slice(0, this._maxPaths);
    } catch {
      return [];
    }
  }

  /**
   * 发布事件
   * Publish event
   * @private
   */
  _publish(topic, payload) {
    if (!this._messageBus) return;
    try {
      this._messageBus.publish(topic, wrapEvent(topic, payload, SOURCE));
    } catch { /* non-fatal */ }
  }
}
