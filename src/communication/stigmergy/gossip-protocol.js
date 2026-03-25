/**
 * GossipProtocol — 知识传播的时间模型
 * Temporal model for knowledge propagation across agents
 *
 * V9 重定义：不是分布式一致性协议，而是信息扩散的时间约束。
 * 后创建的 Agent 不能立即看到前序 Agent 的发现，需要经历"追赶"延迟，
 * 从而创造更真实的信息扩散效果。
 *
 * 可见性传播层级（按延迟递增）：
 *   writer-only → session → scope → global
 *
 * @module communication/stigmergy/gossip-protocol
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_KNOWLEDGE } from '../../core/field/types.js'

class GossipProtocol extends ModuleBase {
  static produces()   { return [DIM_KNOWLEDGE] }
  static consumes()   { return [DIM_KNOWLEDGE] }
  static publishes()  { return [] }
  static subscribes() { return ['agent.lifecycle.spawned'] }

  constructor({ eventBus, roundDurationMs = 30000 } = {}) {
    super()
    this._eventBus = eventBus
    this._roundDurationMs = roundDurationMs
    /** @type {Map<string, {writtenAt:number, writerAgentId:string, writerSession:string, writerScope:string}>} */
    this._entries = new Map()
    /** @type {Map<string, {session:string, scope:string, spawnedAt:number}>} */
    this._agentInfo = new Map()

    /** @private */
    this._onAgentSpawned = (envelope) => {
      const data = envelope?.data?.payload || envelope?.data || envelope || {}
      const { agentId, session, scope } = data
      if (agentId) {
        this._agentInfo.set(agentId, { session, scope, spawnedAt: Date.now() })
      }
    }

    if (this._eventBus) {
      this._eventBus.subscribe('agent.lifecycle.spawned', this._onAgentSpawned)
    }
  }

  async stop() {
    if (this._eventBus) {
      this._eventBus.unsubscribe('agent.lifecycle.spawned', this._onAgentSpawned)
    }
  }

  registerAgent(agentId, { session, scope } = {}) {
    this._agentInfo.set(agentId, { session, scope, spawnedAt: Date.now() })
  }

  scheduleVisibility(key, writerAgentId, writerScope, writerSession) {
    this._entries.set(key, {
      writtenAt: Date.now(),
      writerAgentId,
      writerSession: writerSession || this._agentInfo.get(writerAgentId)?.session || 'default',
      writerScope: writerScope || this._agentInfo.get(writerAgentId)?.scope || 'global',
    })
  }

  isVisible(key, readerAgentId) {
    const entry = this._entries.get(key)
    if (!entry) return true

    if (readerAgentId === entry.writerAgentId) return true

    const reader = this._agentInfo.get(readerAgentId)
    let delay
    if (reader && reader.session === entry.writerSession) {
      delay = 1 * this._roundDurationMs
    } else if (reader && reader.scope === entry.writerScope) {
      delay = 2 * this._roundDurationMs
    } else {
      delay = 3 * this._roundDurationMs
    }
    return Date.now() - entry.writtenAt >= delay
  }

  getVisibilityStatus(key) {
    const entry = this._entries.get(key)
    if (!entry) return 'global'

    const elapsed = Date.now() - entry.writtenAt
    if (elapsed < 1 * this._roundDurationMs) return 'writer-only'
    if (elapsed < 2 * this._roundDurationMs) return 'session'
    if (elapsed < 3 * this._roundDurationMs) return 'scope'
    return 'global'
  }

  getEntryCount() { return this._entries.size }
  getAgentCount() { return this._agentInfo.size }
}

export { GossipProtocol }
export default GossipProtocol
