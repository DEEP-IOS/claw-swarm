/**
 * SpawnCeiling — 绝对 spawn 深度/数量硬上限
 *
 * 即使配置和 loader 已移除 OpenClaw 的软限制，
 * 这里提供蜂群自身的硬上限，防止 fork bomb。
 *
 * 设计原则:
 *   - 这是"安全网"而非"限制" — 正常使用不会触及
 *   - 绝对上限不受配置覆盖 (除非修改代码)
 *   - 达到上限时发出警告，不是静默拒绝
 *
 * @module orchestration/adaptation/spawn-ceiling
 * @version 9.2.0
 */

const ABSOLUTE_MAX_DEPTH = 20;           // spawn 深度绝对上限
const ABSOLUTE_MAX_TOTAL_AGENTS = 100;   // 全局活跃 agent 总数上限
const ABSOLUTE_MAX_CHILDREN = 30;        // 单个 agent 直接子代上限

export class SpawnCeiling {
  /**
   * @param {Object} opts
   * @param {import('../../core/bus/event-bus.js').EventBus} opts.bus
   * @param {Object} [opts.config]
   * @param {number} [opts.config.maxDepth=20]
   * @param {number} [opts.config.maxTotalAgents=100]
   * @param {number} [opts.config.maxChildren=30]
   */
  constructor({ bus, config = {} }) {
    this._bus = bus;

    // 配置值不能超过绝对上限
    this._maxDepth = Math.min(config.maxDepth ?? ABSOLUTE_MAX_DEPTH, ABSOLUTE_MAX_DEPTH);
    this._maxTotal = Math.min(config.maxTotalAgents ?? ABSOLUTE_MAX_TOTAL_AGENTS, ABSOLUTE_MAX_TOTAL_AGENTS);
    this._maxChildren = Math.min(config.maxChildren ?? ABSOLUTE_MAX_CHILDREN, ABSOLUTE_MAX_CHILDREN);

    /**
     * 活跃 agent 跟踪
     * @type {Map<string, { parentId: string|null, depth: number, childCount: number, ts: number }>}
     */
    this._agents = new Map();

    /** @type {Array<Function>} */
    this._unsubs = [];

    this._stats = { spawnsAllowed: 0, spawnsBlocked: 0, depthBlocked: 0, totalBlocked: 0, childBlocked: 0 };
  }

  /**
   * 启动: 订阅 agent 生命周期事件
   */
  start() {
    this._unsubs.push(
      this._bus.on('agent.lifecycle.spawned', (data) => this._onSpawned(data)),
    );
    this._unsubs.push(
      this._bus.on('agent.lifecycle.completed', (data) => this._onEnded(data?.agentId)),
    );
    this._unsubs.push(
      this._bus.on('agent.lifecycle.failed', (data) => this._onEnded(data?.agentId)),
    );
    this._unsubs.push(
      this._bus.on('agent.lifecycle.ended', (data) => this._onEnded(data?.agentId)),
    );
  }

  stop() {
    for (const unsub of this._unsubs) {
      try { unsub?.(); } catch { /* ignore */ }
    }
    this._unsubs.length = 0;
    this._agents.clear();
  }

  /**
   * 检查是否允许 spawn
   * @param {Object} request
   * @param {string} [request.parentId]  - 父 agent ID
   * @param {number} [request.depth]     - 当前深度
   * @returns {{ allowed: boolean, reason?: string }}
   */
  canSpawn(request = {}) {
    const parentId = request.parentId;
    const currentDepth = request.depth ?? this._getDepth(parentId);

    // 检查 1: 深度
    if (currentDepth >= this._maxDepth) {
      this._stats.spawnsBlocked++;
      this._stats.depthBlocked++;
      this._warn('depth_limit', { depth: currentDepth, max: this._maxDepth, parentId });
      return { allowed: false, reason: `depth_ceiling: ${currentDepth}/${this._maxDepth}` };
    }

    // 检查 2: 全局总数
    if (this._agents.size >= this._maxTotal) {
      this._stats.spawnsBlocked++;
      this._stats.totalBlocked++;
      this._warn('total_limit', { total: this._agents.size, max: this._maxTotal });
      return { allowed: false, reason: `total_ceiling: ${this._agents.size}/${this._maxTotal}` };
    }

    // 检查 3: 单 agent 子代数
    if (parentId) {
      const parent = this._agents.get(parentId);
      if (parent && parent.childCount >= this._maxChildren) {
        this._stats.spawnsBlocked++;
        this._stats.childBlocked++;
        this._warn('child_limit', { parentId, children: parent.childCount, max: this._maxChildren });
        return { allowed: false, reason: `child_ceiling: ${parent.childCount}/${this._maxChildren}` };
      }
    }

    this._stats.spawnsAllowed++;
    return { allowed: true };
  }

  // ── 事件处理 ──────────────────────────────────────────────

  _onSpawned(data) {
    const agentId = data?.agentId || data?.id;
    if (!agentId) return;

    const parentId = data?.parentId || data?.parentAgentId || null;
    const depth = parentId ? (this._getDepth(parentId) + 1) : 0;

    this._agents.set(agentId, {
      parentId,
      depth,
      childCount: 0,
      ts: Date.now(),
    });

    // 更新父 agent 的 childCount
    if (parentId && this._agents.has(parentId)) {
      this._agents.get(parentId).childCount++;
    }
  }

  _onEnded(agentId) {
    if (!agentId) return;
    const agent = this._agents.get(agentId);
    if (agent?.parentId && this._agents.has(agent.parentId)) {
      this._agents.get(agent.parentId).childCount =
        Math.max(0, this._agents.get(agent.parentId).childCount - 1);
    }
    this._agents.delete(agentId);
  }

  _getDepth(agentId) {
    if (!agentId) return 0;
    const agent = this._agents.get(agentId);
    return agent?.depth ?? 0;
  }

  _warn(type, detail) {
    this._bus?.publish?.('spawn.ceiling.hit', {
      type,
      ...detail,
      ts: Date.now(),
    }, 'spawn-ceiling');
  }

  // ── Stats ──────────────────────────────────────────────────

  getActiveCount() {
    return this._agents.size;
  }

  getStats() {
    return {
      ...this._stats,
      activeAgents: this._agents.size,
      config: {
        maxDepth: this._maxDepth,
        maxTotalAgents: this._maxTotal,
        maxChildren: this._maxChildren,
      },
    };
  }
}
