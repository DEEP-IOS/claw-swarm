/**
 * ChatBridge — EventBus → 用户聊天窗口的"最后一公里"桥接
 *
 * 核心问题: EventBus 事件能到达 Console Dashboard (WebSocket/SSE)，
 * 但无法到达用户的 Telegram/飞书/Discord 聊天窗口。
 *
 * Delivery priority (Swarm = OS, OpenClaw = Hardware):
 *   1. HostAdapter.pushToUser()         — T0 direct control (preferred)
 *   2. registerInteractiveHandler cb    — Plugin API fallback
 *   3. Drop (message lost, but system continues)
 *
 * 功能:
 *   1. 订阅关键 EventBus 事件 (agent 对话、任务进度、决策、错误)
 *   2. 格式化为用户友好的聊天消息
 *   3. 通过 T0 直接推送 或 interactiveHandler 推送到用户聊天平台
 *   4. 支持 verbose/normal/quiet 三种模式
 *   5. 支持用户通过聊天窗口向运行中的 agent 注入消息 (interjection)
 *
 * @module observe/bridge/chat-bridge
 * @version 9.2.0
 */

const VERBOSITY = Object.freeze({
  QUIET: 'quiet',     // 仅错误和最终结果
  NORMAL: 'normal',   // 关键节点 + 阶段摘要
  VERBOSE: 'verbose', // 全部 agent 对话可见
});

/**
 * 事件 → 消息映射: 哪些事件在哪个 verbosity 级别被推送
 */
const EVENT_CONFIG = [
  // ── Agent 生命周期 (用户最关心的) ────────────────────────
  { topic: 'agent.lifecycle.spawned',   level: VERBOSITY.NORMAL,  formatter: 'agentSpawned' },
  { topic: 'agent.lifecycle.completed', level: VERBOSITY.NORMAL,  formatter: 'agentCompleted' },
  { topic: 'agent.lifecycle.failed',    level: VERBOSITY.QUIET,   formatter: 'agentFailed' },

  // ── Agent 对话 (verbose 模式下可见) ─────────────────────
  { topic: 'runtime.session.transcript', level: VERBOSITY.VERBOSE, formatter: 'sessionTranscript' },
  { topic: 'runtime.agent.event',        level: VERBOSITY.VERBOSE, formatter: 'agentEvent' },
  { topic: 'message.created',            level: VERBOSITY.VERBOSE, formatter: 'messageCreated' },

  // ── 任务/DAG 进度 ──────────────────────────────────────
  { topic: 'dag.created',          level: VERBOSITY.NORMAL,  formatter: 'dagCreated' },
  { topic: 'dag.completed',        level: VERBOSITY.QUIET,   formatter: 'dagCompleted' },
  { topic: 'synthesis.completed', level: VERBOSITY.QUIET,   formatter: 'synthesisCompleted' },
  { topic: 'dag.node.status',    level: VERBOSITY.NORMAL,  formatter: 'dagNodeStatus' },
  { topic: 'dag.phase.started',    level: VERBOSITY.NORMAL,  formatter: 'phaseStarted' },
  { topic: 'dag.phase.completed',  level: VERBOSITY.NORMAL,  formatter: 'phaseCompleted' },
  { topic: 'dag.phase.failed',     level: VERBOSITY.QUIET,   formatter: 'phaseFailed' },
  { topic: 'progress.step.recorded', level: VERBOSITY.VERBOSE, formatter: 'stepRecorded' },

  // ── 用户通知 (始终推送) ─────────────────────────────────
  { topic: 'user.notification',     level: VERBOSITY.QUIET,   formatter: 'userNotification' },

  // ── 质量/安全事件 ──────────────────────────────────────
  { topic: 'quality.breaker.tripped',    level: VERBOSITY.QUIET,   formatter: 'breakerTripped' },
  { topic: 'quality.compliance.violation', level: VERBOSITY.QUIET, formatter: 'complianceViolation' },

  // ── 协作事件 ──────────────────────────────────────────
  { topic: 'channel.message',       level: VERBOSITY.VERBOSE, formatter: 'channelMessage' },
  { topic: 'pheromone.deposited',   level: VERBOSITY.VERBOSE, formatter: 'pheromoneDeposited' },
  { topic: 'spawn.advised',         level: VERBOSITY.NORMAL,  formatter: 'spawnAdvised' },

  // ── 停滞/预算警告 ─────────────────────────────────────
  { topic: 'stagnation.detected',   level: VERBOSITY.QUIET,   formatter: 'stagnationDetected' },
  { topic: 'deadline.warning',      level: VERBOSITY.NORMAL,  formatter: 'deadlineWarning' },
  { topic: 'deadline.exceeded',     level: VERBOSITY.QUIET,   formatter: 'deadlineExceeded' },
];

/**
 * Verbosity 级别排序 (低→高)
 */
const VERBOSITY_ORDER = { [VERBOSITY.QUIET]: 0, [VERBOSITY.NORMAL]: 1, [VERBOSITY.VERBOSE]: 2 };

export class ChatBridge {
  /**
   * @param {Object} opts
   * @param {import('../../core/bus/event-bus.js').EventBus} opts.bus
   * @param {Object} [opts.hostAdapter] - HostAdapter for T0 direct pushToUser (preferred path)
   * @param {Function} [opts.interactiveHandler] - OpenClaw registerInteractiveHandler 回调 (fallback)
   * @param {Object} [opts.config]
   * @param {string} [opts.config.verbosity='normal']
   * @param {number} [opts.config.throttleMs=5000]     - 同类消息最小间隔
   * @param {number} [opts.config.maxQueueSize=50]      - 消息队列上限 (防止积压)
   */
  constructor({ bus, hostAdapter, interactiveHandler, config = {} }) {
    this._bus = bus;
    this._hostAdapter = hostAdapter || null;
    this._handler = interactiveHandler || null;
    this._verbosity = config.verbosity || VERBOSITY.NORMAL;
    this._throttleMs = config.throttleMs ?? 5000;
    this._maxQueueSize = config.maxQueueSize ?? 50;

    /** @type {Array<{ topic: string, unsub: Function }>} */
    this._subscriptions = [];

    /** @type {Map<string, number>} topic → last send timestamp */
    this._lastSendAt = new Map();

    /** @type {Array<{ text: string, ts: number }>} */
    this._queue = [];
    this._flushing = false;

    /** @type {Map<string, Function>} dagId → interjection callback */
    this._interjectionCallbacks = new Map();

    this._stats = { sent: 0, throttled: 0, queued: 0, dropped: 0, interjections: 0 };
  }

  /**
   * 设置 HostAdapter (可以延迟绑定) — T0 direct control path
   * @param {Object} adapter - HostAdapter interface with pushToUser()
   */
  setHostAdapter(adapter) {
    this._hostAdapter = adapter;
  }

  /**
   * 设置 interactive handler (可以延迟绑定) — Plugin API fallback
   * @param {Function} handler - (message) => Promise<void>
   */
  setHandler(handler) {
    this._handler = handler;
  }

  /**
   * 切换 verbosity 级别
   * @param {'quiet'|'normal'|'verbose'} level
   */
  setVerbosity(level) {
    if (Object.values(VERBOSITY).includes(level)) {
      this._verbosity = level;
    }
  }

  /** @returns {string} 当前 verbosity */
  getVerbosity() {
    return this._verbosity;
  }

  /**
   * 注册用户介入回调: 当用户在聊天窗口发送消息时触发
   * @param {string} dagId
   * @param {Function} callback - (message: string) => void
   */
  registerInterjection(dagId, callback) {
    this._interjectionCallbacks.set(dagId, callback);
  }

  /**
   * 用户介入: 将用户消息注入到运行中的 DAG
   * @param {string} dagId
   * @param {string} message
   * @returns {boolean} 是否成功
   */
  interject(dagId, message) {
    const cb = this._interjectionCallbacks.get(dagId);
    if (cb) {
      try {
        cb(message);
        this._stats.interjections++;
        this._bus?.publish?.('user.interjection', { dagId, message, ts: Date.now() }, 'chat-bridge');
        return true;
      } catch { return false; }
    }

    // 如果没有特定 DAG 回调，广播到 bus
    this._bus?.publish?.('user.interjection', { dagId: dagId || 'global', message, ts: Date.now() }, 'chat-bridge');
    this._stats.interjections++;
    return true;
  }

  /**
   * 启动: 订阅所有配置的 EventBus 事件
   */
  start() {
    for (const eventConfig of EVENT_CONFIG) {
      const handler = (envelope) => {
        if (!this._shouldDeliver(eventConfig.level)) return;
        if (this._shouldThrottle(eventConfig.topic)) {
          this._stats.throttled++;
          return;
        }
        const text = this._format(eventConfig.formatter, envelope.data, envelope);
        if (text) {
          this._enqueue(text);
        }
      };
      const unsub = this._bus.subscribe(eventConfig.topic, handler);
      this._subscriptions.push({ topic: eventConfig.topic, unsub });
    }
  }

  /**
   * 停止: 取消所有订阅
   */
  stop() {
    for (const { topic, unsub } of this._subscriptions) {
      try { unsub?.(); } catch { /* ignore */ }
    }
    this._subscriptions.length = 0;
    this._interjectionCallbacks.clear();
    this._queue.length = 0;
  }

  // ── 内部方法 ──────────────────────────────────────────────

  /**
   * 判断当前 verbosity 是否应该推送此级别的消息
   */
  _shouldDeliver(requiredLevel) {
    return VERBOSITY_ORDER[this._verbosity] >= VERBOSITY_ORDER[requiredLevel];
  }

  /**
   * 按 topic 节流
   */
  _shouldThrottle(topic) {
    const now = Date.now();
    const last = this._lastSendAt.get(topic) || 0;
    if (now - last < this._throttleMs) return true;
    this._lastSendAt.set(topic, now);
    return false;
  }

  /**
   * 入队消息
   */
  _enqueue(text) {
    if (this._queue.length >= this._maxQueueSize) {
      this._queue.shift(); // 丢弃最旧的
      this._stats.dropped++;
    }
    this._queue.push({ text, ts: Date.now() });
    this._stats.queued++;
    this._flush();
  }

  /**
   * 刷新队列: 逐条发送
   *
   * Delivery priority (T0 direct control > Plugin API fallback):
   *   1. HostAdapter.pushToUser() — bypasses Plugin API entirely
   *   2. interactiveHandler callback — Plugin API path
   */
  async _flush() {
    if (this._flushing) return;
    // Need at least one delivery path
    if (!this._hostAdapter?.pushToUser && !this._handler) return;
    this._flushing = true;

    while (this._queue.length > 0) {
      const item = this._queue.shift();
      let delivered = false;

      // T0 path: HostAdapter.pushToUser() — direct control, no Plugin API dependency
      if (!delivered && this._hostAdapter?.pushToUser) {
        try {
          const result = this._hostAdapter.pushToUser(item.text, { type: 'swarm_update', ts: item.ts });
          if (result !== false) delivered = true;
        } catch { /* T0 path failed, try fallback */ }
      }

      // Fallback: Plugin API interactiveHandler
      if (!delivered && this._handler) {
        try {
          await this._handler({
            type: 'swarm_update',
            text: item.text,
            ts: item.ts,
          });
          delivered = true;
        } catch { /* handler failed, message dropped */ }
      }

      if (delivered) this._stats.sent++;
    }

    this._flushing = false;
  }

  // ── 格式化器 ──────────────────────────────────────────────

  _format(formatterName, data, envelope) {
    const fn = this._formatters[formatterName];
    if (!fn) return null;
    try {
      return fn(data, envelope);
    } catch {
      return null;
    }
  }

  _formatters = {
    // ── Agent 生命周期 ───
    agentSpawned(data) {
      const id = data?.agentId || data?.id || '?';
      const role = data?.role || data?.swarmRole || '';
      return `🐝 Agent [${id}] 已启动${role ? ` (角色: ${role})` : ''}`;
    },
    agentCompleted(data) {
      const id = data?.agentId || data?.id || '?';
      const summary = data?.summary || data?.result?.substring?.(0, 100) || '';
      return `✅ Agent [${id}] 完成${summary ? `: ${summary}` : ''}`;
    },
    agentFailed(data) {
      const id = data?.agentId || data?.id || '?';
      const err = data?.error || data?.reason || '未知错误';
      return `❌ Agent [${id}] 失败: ${err}`;
    },

    // ── Session 对话 (verbose) ───
    sessionTranscript(data) {
      const agent = data?.agentId || data?.sessionId || '?';
      const role = data?.message?.role || '';
      const content = data?.message?.content;
      if (!content) return null;
      const text = typeof content === 'string' ? content : JSON.stringify(content);
      const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;
      return `💬 [${agent}] ${role}: ${preview}`;
    },
    agentEvent(data) {
      const type = data?.type || data?.event || '';
      const agent = data?.agentId || '?';
      if (type === 'tool_use') {
        const tool = data?.tool || data?.name || '?';
        return `🔧 [${agent}] 调用工具: ${tool}`;
      }
      return null; // 其他 runtime 事件不推送
    },
    messageCreated(data) {
      const agent = data?.agentId || data?.sessionId || '?';
      const text = data?.content || data?.text || '';
      if (!text) return null;
      const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;
      return `💬 [${agent}]: ${preview}`;
    },

    // ── DAG/任务进度 ───
    dagCreated(data) {
      const goal = data?.goal || data?.description || '新任务';
      const nodes = data?.nodeCount || data?.nodes?.length || '?';
      return `📋 任务已创建: "${goal}" (${nodes} 个子任务)`;
    },
    dagCompleted(data) {
      const dagId = data?.dagId || '?';
      const duration = data?.durationMs ? `${Math.round(data.durationMs / 1000)}s` : '';
      return `🎉 任务完成${duration ? ` (耗时 ${duration})` : ''} [${dagId}]`;
    },
    phaseStarted(data) {
      const phase = data?.phase || data?.nodeId || '?';
      const agent = data?.agentId || '';
      return `▶️ 阶段开始: ${phase}${agent ? ` → [${agent}]` : ''}`;
    },
    phaseCompleted(data) {
      const phase = data?.phase || data?.nodeId || '?';
      return `✔️ 阶段完成: ${phase}`;
    },
    phaseFailed(data) {
      const phase = data?.phase || data?.nodeId || '?';
      const err = data?.error || '未知错误';
      return `❌ 阶段失败: ${phase} — ${err}`;
    },
    stepRecorded(data) {
      const step = data?.step || '步骤';
      const total = data?.total || '?';
      return `📌 步骤 ${total}: ${step}`;
    },

    // ── 综合结果 ───
    synthesisCompleted(data) {
      const summary = data?.summary || `任务完成`;
      const texts = data?.mergedResult?.texts || [];
      const output = texts.map(t => typeof t === 'string' ? t : t?.content || '').join('\n\n');
      const quality = typeof data?.avgQuality === 'number' ? ` (质量: ${Math.round(data.avgQuality * 100)}%)` : '';
      return `✅ ${summary}${quality}\n\n${output.slice(0, 2000)}`;
    },
    dagNodeStatus(data) {
      const node = data?.nodeId || '?';
      const status = data?.status || '?';
      const icons = { completed: '✅', failed: '❌', executing: '🔄', assigned: '📋' };
      return `${icons[status] || '📌'} 节点 ${node}: ${status}`;
    },

    // ── 用户通知 ───
    userNotification(data) {
      const type = data?.type || 'info';
      if (type === 'complete' && data?.result) {
        const r = data.result;
        const summary = r.summary || '任务完成';
        const output = r.output ? `\n\n${r.output.slice(0, 2000)}` : '';
        const confidence = typeof r.confidence === 'number' ? ` (置信度: ${Math.round(r.confidence * 100)}%)` : '';
        return `🎉 ${summary}${confidence}${output}`;
      }
      const msg = data?.message || data?.reason || '';
      const icons = { progress: '⏳', blocked: '🚫', choice: '❓', complete: '🎉' };
      return `${icons[type] || 'ℹ️'} ${msg}`;
    },

    // ── 质量/安全 ───
    breakerTripped(data) {
      const name = data?.breakerName || data?.component || '?';
      return `⚡ 断路器触发: ${name} — 暂停相关操作`;
    },
    complianceViolation(data) {
      const rule = data?.rule || data?.violation || '?';
      return `⚠️ 合规违规: ${rule}`;
    },

    // ── 协作 ───
    channelMessage(data) {
      const channel = data?.channelId || data?.channel || '?';
      const from = data?.from || data?.agentId || '?';
      const text = data?.content || data?.message || '';
      const preview = (typeof text === 'string' ? text : JSON.stringify(text)).substring(0, 150);
      return `📡 [${channel}] ${from}: ${preview}`;
    },
    pheromoneDeposited(data) {
      const type = data?.type || '?';
      const from = data?.agentId || '?';
      return `🧪 [${from}] 释放信息素: ${type}`;
    },
    spawnAdvised(data) {
      const role = data?.role || data?.agentType || '?';
      const reason = data?.reason || '';
      return `🐣 建议派遣新 Agent: ${role}${reason ? ` (${reason})` : ''}`;
    },

    // ── 停滞/预警 ───
    stagnationDetected(data) {
      const agent = data?.agentId || data?.dagId || '?';
      const rounds = data?.rounds || '?';
      return `🔄 停滞检测: [${agent}] 已 ${rounds} 轮无进展 — 考虑介入`;
    },
    deadlineWarning(data) {
      const task = data?.taskId || data?.dagId || '?';
      const remaining = data?.remainingMs ? `${Math.round(data.remainingMs / 60000)}分钟` : '';
      return `⏰ 截止日期警告: ${task}${remaining ? ` (剩余 ${remaining})` : ''}`;
    },
    deadlineExceeded(data) {
      const task = data?.taskId || data?.dagId || '?';
      return `🚨 截止日期已过: ${task}`;
    },
  };

  // ── Stats ──────────────────────────────────────────────────

  getStats() {
    return {
      ...this._stats,
      verbosity: this._verbosity,
      subscriptions: this._subscriptions.length,
      queueSize: this._queue.length,
      activeInterjections: this._interjectionCallbacks.size,
    };
  }
}

export { VERBOSITY };
