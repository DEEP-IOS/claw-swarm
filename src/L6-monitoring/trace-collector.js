/**
 * TraceCollector — 轻量级追踪 Span 收集器 / Lightweight Trace Span Collector
 *
 * 订阅 MessageBus 事件自动写入 trace_spans 表，填补 V5.1-5.4 trace_spans
 * 表已定义但 API 返回空的数据管道断裂问题。
 *
 * Subscribes to MessageBus events and auto-writes to trace_spans table,
 * fixing the V5.1-5.4 data pipeline gap where trace_spans table was defined
 * but the API returned empty results.
 *
 * 设计方案 / Design:
 * - 维护 Map<traceId, startTime> 计算 duration_ms
 * - 批量写入（每 BATCH_SIZE 个 span 一次 transaction）
 * - 自动清理超时的 pending spans
 *
 * @module L6-monitoring/trace-collector
 * @version 5.5.0
 * @author DEEP-IOS
 */

import { randomUUID } from 'node:crypto';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 批量写入阈值 / Batch write threshold */
const BATCH_SIZE = 5;

/** Pending span 超时 (ms) — 超过此时间未结束的 span 自动关闭 */
const PENDING_TIMEOUT_MS = 300000; // 5 分钟

/** Pending spans 清理间隔 (ms) */
const CLEANUP_INTERVAL_MS = 60000; // 1 分钟

/** 最大 pending span 数量 / Max pending spans */
const MAX_PENDING = 200;

// ============================================================================
// TraceCollector 类 / TraceCollector Class
// ============================================================================

export class TraceCollector {
  /**
   * @param {Object} deps
   * @param {Object} deps.messageBus - MessageBus 实例
   * @param {Object} deps.db - DatabaseManager 实例
   * @param {Object} [deps.logger] - Logger 实例
   */
  constructor({ messageBus, db, logger }) {
    this._messageBus = messageBus;
    this._db = db;
    this._logger = logger || console;

    /**
     * Pending spans 等待结束事件
     * Map<spanId, { traceId, parentId, operation, service, startTime }>
     * @type {Map<string, Object>}
     */
    this._pendingSpans = new Map();

    /**
     * 待写入 span 缓冲区 / Write buffer for spans
     * @type {Array<Object>}
     */
    this._buffer = [];

    /** 清理定时器 / Cleanup timer */
    this._cleanupTimer = null;

    /** 是否已初始化 / Whether initialized */
    this._initialized = false;
  }

  /**
   * 启动收集器 — 订阅事件 + 启动定期清理
   * Start collector — subscribe to events + start periodic cleanup
   */
  start() {
    if (this._initialized) return;
    this._initialized = true;

    // 订阅 TRACE_SPAN 事件 / Subscribe to TRACE_SPAN events
    this._messageBus?.subscribe?.('trace.span', (event) => {
      try {
        this._handleTraceSpan(event);
      } catch (err) {
        this._logger.debug?.(`[TraceCollector] Error handling trace span: ${err.message}`);
      }
    });

    // 订阅生命周期事件自动创建 spans
    // Subscribe to lifecycle events to auto-create spans
    const lifecycleTopics = [
      'agent.registered', 'agent.online', 'agent.offline', 'agent.end',
      'task.created', 'task.completed', 'task.failed',
      'tool.failure',
      'pheromone.deposited',
      'dag.created', 'dag.completed',
    ];

    for (const topic of lifecycleTopics) {
      this._messageBus?.subscribe?.(topic, (event) => {
        try {
          this._autoCreateSpan(topic, event);
        } catch { /* non-fatal */ }
      });
    }

    // 定期清理超时的 pending spans
    // Periodically clean up timed-out pending spans
    this._cleanupTimer = setInterval(() => {
      this._cleanupPendingSpans();
    }, CLEANUP_INTERVAL_MS);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();

    this._logger.info?.('[TraceCollector] Started — subscribed to trace and lifecycle events');
  }

  /**
   * 处理 TRACE_SPAN 事件 / Handle TRACE_SPAN event
   *
   * 支持两种模式:
   * 1. 完整 span (含 startTime + durationMs) → 直接入库
   * 2. 开始/结束配对 (phase: 'start'/'end') → pending → complete
   *
   * @param {Object} event
   * @private
   */
  _handleTraceSpan(event) {
    const payload = event?.payload || event;
    const spanId = payload.spanId || payload.id || randomUUID();
    const traceId = payload.traceId || event?.traceId || randomUUID();

    // 模式 1: 完整 span（已知 duration）/ Complete span with known duration
    if (payload.durationMs != null || payload.duration_ms != null) {
      this._addToBuffer({
        id: spanId,
        trace_id: traceId,
        parent_id: payload.parentId || payload.parent_id || null,
        operation: payload.operation || payload.topic || 'unknown',
        service: payload.service || payload.source || 'claw-swarm',
        start_time: payload.startTime || payload.start_time || Date.now(),
        duration_ms: payload.durationMs || payload.duration_ms || 0,
        status: payload.status || 'ok',
        tags: typeof payload.tags === 'string' ? payload.tags : JSON.stringify(payload.tags || {}),
      });
      return;
    }

    // 模式 2: 开始/结束配对 / Start/end pairing
    if (payload.phase === 'start') {
      if (this._pendingSpans.size >= MAX_PENDING) {
        this._cleanupPendingSpans();
      }
      this._pendingSpans.set(spanId, {
        traceId,
        parentId: payload.parentId || payload.parent_id || null,
        operation: payload.operation || 'unknown',
        service: payload.service || payload.source || 'claw-swarm',
        startTime: Date.now(),
      });
      return;
    }

    if (payload.phase === 'end') {
      const targetId = payload.spanId || payload.id;
      const pending = this._pendingSpans.get(targetId);
      if (pending) {
        this._addToBuffer({
          id: targetId,
          trace_id: pending.traceId,
          parent_id: pending.parentId,
          operation: pending.operation,
          service: pending.service,
          start_time: pending.startTime,
          duration_ms: Date.now() - pending.startTime,
          status: payload.status || 'ok',
          tags: typeof payload.tags === 'string' ? payload.tags : JSON.stringify(payload.tags || {}),
        });
        this._pendingSpans.delete(targetId);
      }
      return;
    }

    // 模式 3: 即时 span（无 duration, 无 phase）→ duration=0
    // Instant span (no duration, no phase) → duration=0
    this._addToBuffer({
      id: spanId,
      trace_id: traceId,
      parent_id: payload.parentId || payload.parent_id || null,
      operation: payload.operation || payload.topic || 'unknown',
      service: payload.service || payload.source || 'claw-swarm',
      start_time: payload.startTime || payload.start_time || payload.timestamp || Date.now(),
      duration_ms: 0,
      status: payload.status || 'ok',
      tags: typeof payload.tags === 'string' ? payload.tags : JSON.stringify(payload.tags || {}),
    });
  }

  /**
   * 从生命周期事件自动创建即时 span
   * Auto-create instant span from lifecycle event
   *
   * @param {string} topic
   * @param {Object} event
   * @private
   */
  _autoCreateSpan(topic, event) {
    const payload = event?.payload || event;
    this._addToBuffer({
      id: randomUUID(),
      trace_id: event?.traceId || payload?.traceId || randomUUID(),
      parent_id: payload?.parentSpanId || null,
      operation: topic,
      service: event?.source || payload?.source || 'claw-swarm',
      start_time: event?.timestamp || payload?.timestamp || Date.now(),
      duration_ms: payload?.durationMs || 0,
      status: topic.includes('failed') || topic.includes('failure') ? 'error' : 'ok',
      tags: JSON.stringify({
        agentId: payload?.agentId,
        toolName: payload?.toolName,
        taskId: payload?.taskId || payload?.dagId,
      }),
    });
  }

  /**
   * 添加到写入缓冲区，达到阈值时批量写入
   * Add to write buffer, flush when threshold reached
   *
   * @param {Object} span
   * @private
   */
  _addToBuffer(span) {
    this._buffer.push(span);

    if (this._buffer.length >= BATCH_SIZE) {
      this._flushBuffer();
    }
  }

  /**
   * 批量写入缓冲区到 DB
   * Flush buffer to DB in a batch
   *
   * @private
   */
  _flushBuffer() {
    if (this._buffer.length === 0 || !this._db) return;

    const spans = this._buffer.splice(0);

    try {
      const insertSql = `INSERT OR IGNORE INTO trace_spans
        (id, trace_id, parent_id, operation, service, start_time, duration_ms, status, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      // 使用事务批量写入 / Batch write with transaction
      this._db.exec?.('BEGIN');
      for (const s of spans) {
        try {
          this._db.run(
            insertSql,
            s.id, s.trace_id, s.parent_id, s.operation, s.service,
            s.start_time, s.duration_ms, s.status, s.tags
          );
        } catch { /* skip duplicate or error */ }
      }
      this._db.exec?.('COMMIT');

      this._logger.debug?.(`[TraceCollector] Flushed ${spans.length} spans to DB`);
    } catch (err) {
      try { this._db.exec?.('ROLLBACK'); } catch { /* ignore */ }
      this._logger.debug?.(`[TraceCollector] Flush error: ${err.message}`);
    }
  }

  /**
   * 清理超时的 pending spans
   * Clean up timed-out pending spans
   *
   * @private
   */
  _cleanupPendingSpans() {
    const now = Date.now();
    const toRemove = [];

    for (const [spanId, pending] of this._pendingSpans) {
      if (now - pending.startTime > PENDING_TIMEOUT_MS) {
        // 超时：写入一个 timeout 状态的 span
        // Timeout: write a timeout-status span
        this._addToBuffer({
          id: spanId,
          trace_id: pending.traceId,
          parent_id: pending.parentId,
          operation: pending.operation,
          service: pending.service,
          start_time: pending.startTime,
          duration_ms: now - pending.startTime,
          status: 'timeout',
          tags: '{}',
        });
        toRemove.push(spanId);
      }
    }

    for (const id of toRemove) {
      this._pendingSpans.delete(id);
    }
  }

  /**
   * 获取收集器统计 / Get collector statistics
   *
   * @returns {Object}
   */
  getStats() {
    return {
      pendingSpans: this._pendingSpans.size,
      bufferedSpans: this._buffer.length,
      initialized: this._initialized,
    };
  }

  /**
   * 停止收集器 / Stop collector
   */
  stop() {
    // 刷写剩余缓冲 / Flush remaining buffer
    this._flushBuffer();

    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }

    this._pendingSpans.clear();
    this._initialized = false;
    this._logger.info?.('[TraceCollector] Stopped');
  }
}
