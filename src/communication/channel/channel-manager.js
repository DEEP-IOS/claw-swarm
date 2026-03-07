/**
 * ChannelManager -- 通道生命周期管理器
 * Manages lifecycle of TaskChannels: creation, lookup, cleanup, auto-leave
 *
 * @module communication/channel/channel-manager
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { TaskChannel } from './task-channel.js'

export class ChannelManager extends ModuleBase {
  static produces() { return ['DIM_COORDINATION'] }
  static consumes() { return ['DIM_COORDINATION'] }
  static publishes() { return [] }
  static subscribes() { return ['agent.lifecycle.ended'] }

  /**
   * @param {Object} opts
   * @param {Object} opts.field        - SignalStore 实例
   * @param {Object} opts.eventBus     - EventBus 实例 (需要 publish / subscribe 方法)
   * @param {number} [opts.maxChannels=100] - 同时存在的最大通道数
   */
  constructor({ field, eventBus, maxChannels = 100 }) {
    super()
    this._field = field
    this._eventBus = eventBus
    this._maxChannels = maxChannels

    /** @type {Map<string, TaskChannel>} */
    this._channels = new Map()

    // 订阅 agent 生命周期结束事件，自动 leave
    this._onAgentEnded = ({ agentId }) => {
      if (!agentId) return
      for (const ch of this._channels.values()) {
        if (!ch.isClosed()) {
          try { ch.leave(agentId) } catch (_) { /* ignore */ }
        }
      }
    }
    this._eventBus.subscribe('agent.lifecycle.ended', this._onAgentEnded)
  }

  /**
   * 创建通道 / Create a new channel
   * @param {string} channelId
   * @param {Object} [options] - 传递给 TaskChannel 构造函数的额外选项
   * @returns {TaskChannel}
   */
  create(channelId, options = {}) {
    const existing = this._channels.get(channelId)
    if (existing && !existing.isClosed()) {
      throw new Error(`Channel ${channelId} already exists and is active`)
    }

    // 检查活跃通道数上限
    const activeCount = this._activeCount()
    if (activeCount >= this._maxChannels) {
      this.cleanup()
      if (this._activeCount() >= this._maxChannels) {
        throw new Error(`Max channels (${this._maxChannels}) reached`)
      }
    }

    const channel = new TaskChannel({
      channelId,
      field: this._field,
      eventBus: this._eventBus,
      ...options,
    })
    this._channels.set(channelId, channel)
    return channel
  }

  /**
   * 获取通道 / Get channel by ID
   * @param {string} channelId
   * @returns {TaskChannel|undefined}
   */
  get(channelId) {
    return this._channels.get(channelId) || undefined
  }

  /**
   * 关闭并移除通道 / Close and remove a channel
   * @param {string} channelId
   */
  close(channelId) {
    const ch = this._channels.get(channelId)
    if (!ch) return
    ch.close()
    this._channels.delete(channelId)
  }

  /**
   * 列出所有活跃（未关闭）通道的 ID / List active channel IDs
   * @returns {string[]}
   */
  listActive() {
    const ids = []
    for (const [id, ch] of this._channels) {
      if (!ch.isClosed()) ids.push(id)
    }
    return ids
  }

  /**
   * 清理所有已关闭的通道 / Remove all closed channels from the map
   */
  cleanup() {
    for (const [id, ch] of this._channels) {
      if (ch.isClosed()) this._channels.delete(id)
    }
  }

  /**
   * 汇总统计 / Aggregate stats
   */
  stats() {
    let activeChannels = 0
    let closedChannels = 0
    let totalMessages = 0
    for (const ch of this._channels.values()) {
      const s = ch.stats()
      if (s.closed) closedChannels++; else activeChannels++
      totalMessages += s.messageCount
    }
    return { activeChannels, closedChannels, totalMessages }
  }

  // ---- lifecycle ----

  async start() {
    // 构造函数已订阅，此处为扩展预留
  }

  async stop() {
    for (const [id, ch] of this._channels) {
      if (!ch.isClosed()) ch.close()
    }
    this._channels.clear()
  }

  /** @private */
  _activeCount() {
    let n = 0
    for (const ch of this._channels.values()) {
      if (!ch.isClosed()) n++
    }
    return n
  }
}
