/**
 * 领域存储接口类型定义
 * Domain store interface type definitions
 * @module core/store/types
 */

/**
 * 存储接口 — 所有领域存储必须实现此接口
 * Store interface — all domain stores must implement this contract
 *
 * @typedef {Object} StoreInterface
 * @property {function(string, string, *): void} put - put(collection, key, value)
 * @property {function(string, string): *} get - get(collection, key)
 * @property {function(string, function): Array} query - query(collection, filterFn)
 * @property {function(string, string): boolean} delete - delete(collection, key)
 * @property {function(string, Array<{key: string, value: *}>): void} putBatch
 * @property {function(string): Array} queryAll - queryAll(collection)
 * @property {function(): Promise<void>} snapshot - 写入 JSON 快照 / write JSON snapshot
 * @property {function(): Promise<void>} restore - 从 JSON 快照恢复 / restore from JSON snapshot
 */

/**
 * 快照统计信息
 * Snapshot statistics
 *
 * @typedef {Object} SnapshotStats
 * @property {boolean} dirty - 是否有未持久化的写入 / whether there are unpersisted writes
 * @property {number} collectionCount - 集合数量 / number of collections
 */

export default {};
