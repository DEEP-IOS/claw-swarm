/**
 * ProtocolSemantics v0 — 协议语义层 / Protocol Semantic Layer
 *
 * V5.4: 定义 9 种语义消息类型, 为蜂群协作提供结构化通信协议。
 * 取代非结构化 messageBus.publish, 每条消息附带语义元数据。
 *
 * V5.4: Defines 9 semantic message types for structured swarm communication.
 * Replaces unstructured messageBus.publish with typed, metadata-rich messages.
 *
 * 9 种消息类型 / 9 message types:
 *   REQUEST   — 任务请求: 发起者请求执行某任务
 *   COMMIT    — 承诺执行: 接受者承诺执行请求
 *   ACK       — 确认收达: 确认消息已被接收和理解
 *   DELEGATE  — 委派转发: 将任务转给更合适的 agent
 *   ESCALATE  — 上报升级: 将问题上报到更高层级
 *   REJECT    — 拒绝请求: 明确拒绝并附理由
 *   REVISE    — 修订要求: 要求修改已提交的结果
 *   REPAIR    — 修复通知: 通知已执行修复操作
 *   REPORT    — 结果报告: 报告任务执行结果
 *
 * @module L2-communication/protocol-semantics
 * @version 5.4.0
 * @author DEEP-IOS
 */

import { randomUUID } from 'node:crypto';
import { EventTopics, wrapEvent } from '../event-catalog.js';

const SOURCE = 'protocol-semantics';

// ============================================================================
// 常量 / Constants
// ============================================================================

/**
 * 语义消息类型枚举 / Semantic message type enum
 */
export const MESSAGE_TYPES = {
  REQUEST:  'REQUEST',
  COMMIT:   'COMMIT',
  ACK:      'ACK',
  DELEGATE: 'DELEGATE',
  ESCALATE: 'ESCALATE',
  REJECT:   'REJECT',
  REVISE:   'REVISE',
  REPAIR:   'REPAIR',
  REPORT:   'REPORT',
};

/** 消息类型验证集合 / Valid message type set */
const VALID_TYPES = new Set(Object.values(MESSAGE_TYPES));

/** 消息历史最大容量 / Max message history */
const MAX_HISTORY = 500;

/** 会话最大容量 / Max conversations */
const MAX_CONVERSATIONS = 100;

// ============================================================================
// ProtocolSemantics 类 / ProtocolSemantics Class
// ============================================================================

export class ProtocolSemantics {
  /**
   * @param {Object} deps
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.logger]
   */
  constructor({ messageBus, logger } = {}) {
    this._messageBus = messageBus || null;
    this._logger = logger || console;

    /** @type {Map<string, Array<Object>>} 会话消息历史 (conversationId → messages) */
    this._conversations = new Map();

    /** @type {Object} 统计 */
    this._stats = {
      totalMessages: 0,
      byType: Object.fromEntries(Object.values(MESSAGE_TYPES).map(t => [t, 0])),
      conversations: 0,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 消息发送 / Message Sending
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 发送语义消息
   * Send a semantic message
   *
   * @param {Object} params
   * @param {string} params.type - MESSAGE_TYPES.*
   * @param {string} params.from - 发送者 agent ID
   * @param {string} params.to - 接收者 agent ID
   * @param {string} [params.conversationId] - 会话 ID (自动生成)
   * @param {string} [params.replyTo] - 回复的消息 ID
   * @param {Object} [params.payload] - 消息负载
   * @param {string} [params.reason] - 原因/理由 (用于 REJECT, ESCALATE, REVISE)
   * @returns {Object} 发送的消息记录
   */
  send({ type, from, to, conversationId, replyTo, payload, reason }) {
    if (!VALID_TYPES.has(type)) {
      throw new Error(`Invalid message type: ${type}. Must be one of: ${[...VALID_TYPES].join(', ')}`);
    }
    if (!from) throw new Error('Message sender (from) is required');
    if (!to) throw new Error('Message recipient (to) is required');

    const convId = conversationId || randomUUID();
    const msgId = randomUUID();

    const message = {
      messageId: msgId,
      type,
      from,
      to,
      conversationId: convId,
      replyTo: replyTo || null,
      payload: payload || {},
      reason: reason || null,
      timestamp: Date.now(),
    };

    // 存储到会话 / Store in conversation
    if (!this._conversations.has(convId)) {
      this._conversations.set(convId, []);
      this._stats.conversations++;
    }
    this._conversations.get(convId).push(message);

    // 更新统计
    this._stats.totalMessages++;
    if (this._stats.byType[type] !== undefined) {
      this._stats.byType[type]++;
    }

    // 发布事件
    this._publish(EventTopics.PROTOCOL_MESSAGE_SENT, {
      messageId: msgId,
      type,
      from,
      to,
      conversationId: convId,
      replyTo,
    });

    this._cleanupOld();

    return message;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 快捷方法 / Shorthand Methods
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 发送 REQUEST: 请求执行任务
   * @param {string} from
   * @param {string} to
   * @param {Object} task - { goal, context, priority }
   * @param {string} [conversationId]
   * @returns {Object}
   */
  request(from, to, task, conversationId) {
    return this.send({
      type: MESSAGE_TYPES.REQUEST,
      from, to, conversationId,
      payload: { task },
    });
  }

  /**
   * 发送 COMMIT: 承诺执行请求
   * @param {string} from
   * @param {string} to
   * @param {string} replyTo - 回复的 REQUEST 消息 ID
   * @param {Object} [plan] - 执行计划
   * @param {string} [conversationId]
   * @returns {Object}
   */
  commit(from, to, replyTo, plan, conversationId) {
    return this.send({
      type: MESSAGE_TYPES.COMMIT,
      from, to, replyTo, conversationId,
      payload: { plan },
    });
  }

  /**
   * 发送 ACK: 确认收达
   * @param {string} from
   * @param {string} to
   * @param {string} replyTo - 确认的消息 ID
   * @param {string} [conversationId]
   * @returns {Object}
   */
  ack(from, to, replyTo, conversationId) {
    return this.send({
      type: MESSAGE_TYPES.ACK,
      from, to, replyTo, conversationId,
    });
  }

  /**
   * 发送 DELEGATE: 委派到其他 agent
   * @param {string} from
   * @param {string} to - 被委派的 agent
   * @param {string} replyTo - 原始请求消息 ID
   * @param {string} reason - 委派原因
   * @param {Object} [task] - 委派任务
   * @param {string} [conversationId]
   * @returns {Object}
   */
  delegate(from, to, replyTo, reason, task, conversationId) {
    return this.send({
      type: MESSAGE_TYPES.DELEGATE,
      from, to, replyTo, conversationId,
      reason,
      payload: { task },
    });
  }

  /**
   * 发送 ESCALATE: 上报升级
   * @param {string} from
   * @param {string} to - 上报目标 (通常是 MPU-T)
   * @param {string} reason - 上报原因
   * @param {Object} [context] - 上下文信息
   * @param {string} [conversationId]
   * @returns {Object}
   */
  escalate(from, to, reason, context, conversationId) {
    return this.send({
      type: MESSAGE_TYPES.ESCALATE,
      from, to, conversationId,
      reason,
      payload: { context },
    });
  }

  /**
   * 发送 REJECT: 拒绝请求
   * @param {string} from
   * @param {string} to
   * @param {string} replyTo - 被拒绝的消息 ID
   * @param {string} reason - 拒绝原因
   * @param {string} [conversationId]
   * @returns {Object}
   */
  reject(from, to, replyTo, reason, conversationId) {
    return this.send({
      type: MESSAGE_TYPES.REJECT,
      from, to, replyTo, conversationId,
      reason,
    });
  }

  /**
   * 发送 REVISE: 修订要求
   * @param {string} from
   * @param {string} to
   * @param {string} replyTo - 需修订的消息 ID
   * @param {string} reason - 修订原因
   * @param {Object} [suggestions] - 修改建议
   * @param {string} [conversationId]
   * @returns {Object}
   */
  revise(from, to, replyTo, reason, suggestions, conversationId) {
    return this.send({
      type: MESSAGE_TYPES.REVISE,
      from, to, replyTo, conversationId,
      reason,
      payload: { suggestions },
    });
  }

  /**
   * 发送 REPAIR: 修复通知
   * @param {string} from
   * @param {string} to
   * @param {Object} repair - { failurePattern, strategy, result }
   * @param {string} [conversationId]
   * @returns {Object}
   */
  repair(from, to, repairInfo, conversationId) {
    return this.send({
      type: MESSAGE_TYPES.REPAIR,
      from, to, conversationId,
      payload: { repair: repairInfo },
    });
  }

  /**
   * 发送 REPORT: 结果报告
   * @param {string} from
   * @param {string} to
   * @param {string} replyTo - 对应的 REQUEST 消息 ID
   * @param {Object} result - 执行结果
   * @param {string} [conversationId]
   * @returns {Object}
   */
  report(from, to, replyTo, result, conversationId) {
    return this.send({
      type: MESSAGE_TYPES.REPORT,
      from, to, replyTo, conversationId,
      payload: { result },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 查询 / Query
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 获取会话全部消息
   * Get all messages in a conversation
   *
   * @param {string} conversationId
   * @returns {Array<Object>}
   */
  getConversation(conversationId) {
    const msgs = this._conversations.get(conversationId);
    if (!msgs) return [];
    return msgs.map(m => ({ ...m }));
  }

  /**
   * 获取会话中某类型的消息
   * Get messages of a specific type in a conversation
   *
   * @param {string} conversationId
   * @param {string} type - MESSAGE_TYPES.*
   * @returns {Array<Object>}
   */
  getMessagesByType(conversationId, type) {
    const msgs = this._conversations.get(conversationId);
    if (!msgs) return [];
    return msgs.filter(m => m.type === type).map(m => ({ ...m }));
  }

  /**
   * 获取消息的回复链 (从 replyTo 向上追溯)
   * Get reply chain for a message (trace back via replyTo)
   *
   * @param {string} conversationId
   * @param {string} messageId
   * @returns {Array<Object>}
   */
  getReplyChain(conversationId, messageId) {
    const msgs = this._conversations.get(conversationId);
    if (!msgs) return [];

    const chain = [];
    const msgMap = new Map(msgs.map(m => [m.messageId, m]));

    let current = msgMap.get(messageId);
    while (current) {
      chain.push({ ...current });
      current = current.replyTo ? msgMap.get(current.replyTo) : null;
    }

    return chain;
  }

  /**
   * 获取 agent 参与的所有会话 ID
   * Get all conversation IDs an agent participates in
   *
   * @param {string} agentId
   * @returns {Array<string>}
   */
  getAgentConversations(agentId) {
    const result = [];
    for (const [convId, msgs] of this._conversations) {
      if (msgs.some(m => m.from === agentId || m.to === agentId)) {
        result.push(convId);
      }
    }
    return result;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 协议验证 / Protocol Validation
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 验证会话是否遵循协议约束
   * Validate if a conversation follows protocol constraints
   *
   * 基本约束:
   * - COMMIT 必须 replyTo 一个 REQUEST
   * - REPORT 必须 replyTo 一个 REQUEST 或 COMMIT
   * - REJECT 必须 replyTo 一个 REQUEST
   * - ACK 必须有 replyTo
   *
   * @param {string} conversationId
   * @returns {{ valid: boolean, violations: Array<string> }}
   */
  validateConversation(conversationId) {
    const msgs = this._conversations.get(conversationId);
    if (!msgs || msgs.length === 0) return { valid: true, violations: [] };

    const violations = [];
    const msgMap = new Map(msgs.map(m => [m.messageId, m]));

    for (const msg of msgs) {
      switch (msg.type) {
        case MESSAGE_TYPES.COMMIT:
          if (!msg.replyTo || !msgMap.has(msg.replyTo)) {
            violations.push(`COMMIT(${msg.messageId.substring(0, 8)}) has no valid replyTo`);
          } else {
            const target = msgMap.get(msg.replyTo);
            if (target.type !== MESSAGE_TYPES.REQUEST) {
              violations.push(`COMMIT(${msg.messageId.substring(0, 8)}) replies to ${target.type}, expected REQUEST`);
            }
          }
          break;

        case MESSAGE_TYPES.REJECT:
          if (!msg.replyTo || !msgMap.has(msg.replyTo)) {
            violations.push(`REJECT(${msg.messageId.substring(0, 8)}) has no valid replyTo`);
          }
          break;

        case MESSAGE_TYPES.ACK:
          if (!msg.replyTo) {
            violations.push(`ACK(${msg.messageId.substring(0, 8)}) has no replyTo`);
          }
          break;

        case MESSAGE_TYPES.REPORT:
          if (!msg.replyTo || !msgMap.has(msg.replyTo)) {
            violations.push(`REPORT(${msg.messageId.substring(0, 8)}) has no valid replyTo`);
          }
          break;
      }
    }

    return { valid: violations.length === 0, violations };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 统计 / Statistics
  // ══════════════════════════════════════════════════════════════════════════

  getStats() {
    return {
      ...this._stats,
      byType: { ...this._stats.byType },
      activeConversations: this._conversations.size,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 内部方法 / Internal
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 清理超出容量的旧会话
   * @private
   */
  _cleanupOld() {
    if (this._conversations.size <= MAX_CONVERSATIONS) return;

    // 按最早消息时间排序, 删除最旧的会话
    const entries = [...this._conversations.entries()]
      .map(([id, msgs]) => ({ id, oldest: msgs[0]?.timestamp || 0 }))
      .sort((a, b) => a.oldest - b.oldest);

    const toRemove = entries.length - MAX_CONVERSATIONS;
    for (let i = 0; i < toRemove; i++) {
      this._conversations.delete(entries[i].id);
    }
  }

  /**
   * 发布事件
   * @private
   */
  _publish(topic, payload) {
    if (!this._messageBus) return;
    try {
      this._messageBus.publish(topic, wrapEvent(topic, payload, SOURCE));
    } catch { /* non-fatal */ }
  }
}
