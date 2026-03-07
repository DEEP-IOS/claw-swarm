/**
 * TaskChannel -- 任务通道，用于代理间的结构化消息通信
 * Task channel for structured message-based communication between agents
 *
 * 通道生命周期：创建 -> 成员加入 -> 消息交换 -> 关闭
 * Channel lifecycle: create -> members join -> message exchange -> close
 *
 * @module communication/channel/task-channel
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_COORDINATION } from '../../core/field/types.js'

const VALID_MESSAGE_TYPES = new Set(['finding', 'question', 'decision', 'progress', 'error'])

export class TaskChannel extends ModuleBase {
  static produces() { return [DIM_COORDINATION] }
  static consumes() { return [] }
  static publishes() { return ['channel.message', 'channel.created', 'channel.closed'] }
  static subscribes() { return [] }

  /**
   * @param {Object} opts
   * @param {string} opts.channelId       - 通道唯一标识
   * @param {Object} opts.field           - SignalStore 实例 (需要 emit 方法)
   * @param {Object} opts.eventBus        - EventBus 实例 (需要 publish 方法)
   * @param {number} [opts.maxMembers=10] - 最大成员数
   * @param {number} [opts.maxMessages=1000] - 最大消息缓存数
   */
  constructor({ channelId, field, eventBus, maxMembers = 10, maxMessages = 1000 }) {
    super()
    this._channelId = channelId
    this._field = field
    this._eventBus = eventBus
    this._maxMembers = maxMembers
    this._maxMessages = maxMessages

    /** @type {Map<string, { role: string, joinedAt: number }>} */
    this._members = new Map()
    /** @type {Array<{ from: string, type: string, data: *, ts: number }>} */
    this._messages = []
    this._closed = false
    this._createdAt = null
    this._closedAt = null
  }

  /**
   * 加入通道 / Join channel
   * @param {string} agentId
   * @param {string} [role='member']
   */
  join(agentId, role = 'member') {
    if (this._closed) throw new Error('Channel is closed')
    if (!this._members.has(agentId) && this._members.size >= this._maxMembers) {
      throw new Error(`Channel ${this._channelId} is full (max ${this._maxMembers})`)
    }

    const isFirst = this._members.size === 0 && !this._members.has(agentId)
    this._members.set(agentId, { role, joinedAt: this._members.get(agentId)?.joinedAt ?? Date.now() })

    if (isFirst) {
      this._createdAt = Date.now()
      this._safePublish('channel.created', {
        channelId: this._channelId,
        createdBy: agentId,
        createdAt: this._createdAt,
      })
    }
  }

  /**
   * 离开通道 / Leave channel
   * @param {string} agentId
   */
  leave(agentId) {
    if (!this._members.has(agentId)) return
    this._members.delete(agentId)
    if (this._members.size === 0) {
      this.close()
    }
  }

  /**
   * 发送消息 / Post a message
   * @param {string} agentId
   * @param {{ type: string, data: * }} message
   */
  post(agentId, message) {
    if (this._closed) throw new Error('Channel is closed')
    if (!this._members.has(agentId)) throw new Error('Not a member')
    if (!message || !VALID_MESSAGE_TYPES.has(message.type)) {
      throw new Error(`Invalid message type: ${message?.type}. Must be one of: ${[...VALID_MESSAGE_TYPES].join(', ')}`)
    }

    const entry = { from: agentId, type: message.type, data: message.data, ts: Date.now() }
    this._messages.push(entry)
    if (this._messages.length > this._maxMessages) {
      this._messages.shift()
    }

    this._safePublish('channel.message', {
      channelId: this._channelId,
      from: agentId,
      message: { type: message.type, data: message.data },
    })
    this._safeEmit({
      dimension: DIM_COORDINATION,
      scope: this._channelId,
      strength: 0.3,
      emitterId: agentId,
      metadata: { action: 'message' },
    })
  }

  /**
   * 查询消息 / Get messages with optional filters
   * @param {Object} [options]
   * @param {number} [options.since]  - 仅返回 ts >= since 的消息
   * @param {number} [options.limit]  - 最多返回 N 条（取最新的）
   * @param {string} [options.type]   - 按 type 过滤
   * @returns {Array<{ from: string, type: string, data: *, ts: number }>}
   */
  getMessages(options = {}) {
    let result = this._messages

    if (options.since != null) {
      result = result.filter(m => m.ts >= options.since)
    }
    if (options.type != null) {
      result = result.filter(m => m.type === options.type)
    }
    if (options.limit != null && options.limit > 0) {
      result = result.slice(-options.limit)
    }
    return result
  }

  /**
   * 获取成员列表 / Get member list
   * @returns {Array<{ agentId: string, role: string, joinedAt: number }>}
   */
  getMembers() {
    return [...this._members.entries()].map(([agentId, info]) => ({
      agentId,
      role: info.role,
      joinedAt: info.joinedAt,
    }))
  }

  /**
   * 关闭通道 / Close channel
   */
  close() {
    if (this._closed) return
    this._closed = true
    this._closedAt = Date.now()

    this._safePublish('channel.closed', { channelId: this._channelId })
    this._safeEmit({
      dimension: DIM_COORDINATION,
      scope: this._channelId,
      strength: 0.1,
      emitterId: 'system',
      metadata: { action: 'closed' },
    })
  }

  /** @returns {boolean} */
  isClosed() { return this._closed }

  /**
   * 通道统计 / Channel stats
   */
  stats() {
    return {
      channelId: this._channelId,
      memberCount: this._members.size,
      messageCount: this._messages.length,
      createdAt: this._createdAt,
      closedAt: this._closedAt,
      closed: this._closed,
    }
  }

  // ---- internal helpers ----

  /** @private */
  _safePublish(topic, payload) {
    try { this._eventBus.publish(topic, payload) } catch (_) { /* non-fatal */ }
  }

  /** @private */
  _safeEmit(signal) {
    try { this._field.emit(signal) } catch (_) { /* non-fatal */ }
  }
}
