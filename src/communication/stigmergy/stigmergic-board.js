/**
 * StigmergicBoard — 间接通信黑板，Agent 通过环境留痕实现异步知识共享
 * Stigmergic blackboard for indirect agent communication via environmental traces
 *
 * Agent 将发现写入 board，其他 Agent 按可见性规则读取。
 * 结合 GossipProtocol 实现信息扩散延迟，结合 SignalField 发射知识信号。
 *
 * @module communication/stigmergy/stigmergic-board
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_KNOWLEDGE } from '../../core/field/types.js'

const COLLECTION = 'board'

class StigmergicBoard extends ModuleBase {
  static produces()    { return [DIM_KNOWLEDGE] }
  static consumes()    { return [] }
  static publishes()   { return ['stigmergy.entry.written', 'stigmergy.entry.read'] }
  static subscribes()  { return [] }

  /**
   * @param {Object} deps
   * @param {import('../../core/store/domain-store.js').DomainStore} deps.domainStore
   * @param {Object} [deps.field]           - SignalStore instance
   * @param {Object} [deps.eventBus]        - EventBus instance
   * @param {import('./gossip-protocol.js').GossipProtocol} [deps.gossipProtocol]
   */
  constructor({ domainStore, field, eventBus, gossipProtocol } = {}) {
    super()
    if (!domainStore) throw new Error('StigmergicBoard: domainStore is required')
    this._domainStore    = domainStore
    this._field          = field || null
    this._eventBus       = eventBus || null
    this._gossipProtocol = gossipProtocol || null
  }

  /**
   * 写入条目 / Write an entry to the board
   * @param {string} agentId
   * @param {string} key
   * @param {*} value
   * @param {Object} [metadata]
   * @param {string} [metadata.scope]       - 作用域，默认 'global'
   * @param {string} [metadata.visibility]  - 可见性策略，默认 'immediate'
   * @param {string} [metadata.session]     - 会话标识（传递给 gossip）
   */
  write(agentId, key, value, metadata = {}) {
    const scope      = metadata.scope || 'global'
    const visibility = metadata.visibility || 'immediate'

    const entry = {
      _key: key,
      value,
      writtenBy: agentId,
      writtenAt: Date.now(),
      scope,
      visibility,
    }

    this._domainStore.put(COLLECTION, key, entry)

    if (this._gossipProtocol) {
      this._gossipProtocol.scheduleVisibility(key, agentId, scope, metadata.session)
    }

    if (this._field) {
      const summary = typeof value === 'string' ? value.slice(0, 100) : String(key)
      this._field.emit({
        dimension: DIM_KNOWLEDGE,
        scope,
        strength: 0.4,
        emitterId: agentId,
        metadata: { key, summary },
      })
    }

    if (this._eventBus) {
      this._eventBus.publish('stigmergy.entry.written', { agentId, key, scope })
    }
  }

  /**
   * 读取条目 / Read an entry by key (respects gossip visibility)
   * @param {string} key
   * @param {string} readerAgentId
   * @returns {Object|undefined}
   */
  read(key, readerAgentId) {
    const entry = this._domainStore.get(COLLECTION, key)
    if (entry === undefined) return undefined

    if (this._gossipProtocol && !this._gossipProtocol.isVisible(key, readerAgentId)) {
      return undefined
    }

    if (this._eventBus) {
      this._eventBus.publish('stigmergy.entry.read', { key, readerAgentId })
    }

    return entry
  }

  /**
   * 搜索条目 / Search entries by substring match on key or value
   * @param {string} queryStr
   * @param {string} readerAgentId
   * @returns {Array<Object>}
   */
  search(queryStr, readerAgentId) {
    const matches = this._domainStore.query(COLLECTION, (entry, key) => {
      if (key.includes(queryStr)) return true
      if (typeof entry.value === 'string' && entry.value.includes(queryStr)) return true
      try { return JSON.stringify(entry.value).includes(queryStr) } catch { return false }
    })

    if (this._gossipProtocol) {
      return matches.filter(e => this._gossipProtocol.isVisible(e._key, readerAgentId))
    }

    return matches
  }

  /**
   * 按 scope 列出条目 / List entries filtered by scope
   * @param {string} scope
   * @param {string} readerAgentId
   * @returns {Array<Object>}
   */
  list(scope, readerAgentId) {
    const matches = this._domainStore.query(COLLECTION, (entry) => entry.scope === scope)

    if (this._gossipProtocol) {
      return matches.filter(e => this._gossipProtocol.isVisible(e._key, readerAgentId))
    }

    return matches
  }

  /**
   * 删除条目（仅原作者可删） / Remove entry (author-only)
   * @param {string} key
   * @param {string} agentId
   * @returns {boolean}
   */
  remove(key, agentId) {
    const entry = this._domainStore.get(COLLECTION, key)
    if (!entry) return false

    if (entry.writtenBy !== agentId) {
      throw new Error('Only the author can remove this entry')
    }

    this._domainStore.delete(COLLECTION, key)
    return true
  }

  /**
   * 统计信息 / Board statistics
   * @returns {{ totalEntries: number }}
   */
  stats() {
    return { totalEntries: this._domainStore.count(COLLECTION) }
  }
}

export { StigmergicBoard }
export default StigmergicBoard
