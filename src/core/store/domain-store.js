/**
 * 领域存储 — 基于内存 Map 的键值存储，支持 JSON 快照持久化
 * Domain store — in-memory Map-based key-value store with JSON snapshot persistence
 * @module core/store/domain-store
 */

import { writeFile, readFile, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export class DomainStore {
  /**
   * @param {Object} opts
   * @param {string} opts.domain - 领域名称 / domain name (e.g. 'agent', 'task')
   * @param {string} opts.snapshotDir - 快照目录 / snapshot directory path
   * @param {number} [opts.snapshotIntervalMs=30000] - 自动快照间隔 / auto-snapshot interval in ms
   */
  constructor({ domain, snapshotDir, snapshotIntervalMs = 30000 }) {
    if (!domain || typeof domain !== 'string') {
      throw new Error('DomainStore: domain is required');
    }
    if (!snapshotDir || typeof snapshotDir !== 'string') {
      throw new Error('DomainStore: snapshotDir is required');
    }

    /** @type {string} 领域名称 / domain name */
    this._domain = domain;

    /** @type {string} 快照目录 / snapshot directory */
    this._snapshotDir = snapshotDir;

    /** @type {number} 自动快照间隔 / auto-snapshot interval */
    this._snapshotIntervalMs = snapshotIntervalMs;

    /** @type {Map<string, Map<string, *>>} 集合映射 / collection map */
    this._collections = new Map();

    /** @type {boolean} 脏标记 — 自上次快照后是否有写入 / dirty flag */
    this._dirty = false;

    /** @type {ReturnType<typeof setInterval>|null} 自动快照定时器 / auto-snapshot timer */
    this._autoTimer = null;
  }

  // ─── 读写操作 / Read-Write Operations ───────────────────────

  /**
   * 写入键值对，若集合不存在则自动创建
   * Put a key-value pair; creates collection if it does not exist
   * @param {string} collection
   * @param {string} key
   * @param {*} value
   */
  put(collection, key, value) {
    let col = this._collections.get(collection);
    if (!col) {
      col = new Map();
      this._collections.set(collection, col);
    }
    col.set(key, value);
    this._dirty = true;
  }

  /**
   * 读取键值，不存在返回 undefined
   * Get value by key; returns undefined if not found
   * @param {string} collection
   * @param {string} key
   * @returns {*}
   */
  get(collection, key) {
    const col = this._collections.get(collection);
    return col ? col.get(key) : undefined;
  }

  /**
   * 按条件查询集合
   * Query collection with a filter function
   * @param {string} collection
   * @param {function(*, string): boolean} filterFn - filterFn(value, key)
   * @returns {Array}
   */
  query(collection, filterFn) {
    const col = this._collections.get(collection);
    if (!col) return [];
    const results = [];
    for (const [key, value] of col.entries()) {
      if (filterFn(value, key)) {
        results.push(value);
      }
    }
    return results;
  }

  /**
   * 删除键值对
   * Delete a key-value pair; returns true if existed
   * @param {string} collection
   * @param {string} key
   * @returns {boolean}
   */
  delete(collection, key) {
    const col = this._collections.get(collection);
    if (!col) return false;
    const existed = col.delete(key);
    if (existed) this._dirty = true;
    return existed;
  }

  /**
   * 批量写入
   * Bulk insert key-value pairs
   * @param {string} collection
   * @param {Array<{key: string, value: *}>} entries
   */
  putBatch(collection, entries) {
    if (!entries || entries.length === 0) return;
    let col = this._collections.get(collection);
    if (!col) {
      col = new Map();
      this._collections.set(collection, col);
    }
    for (const entry of entries) {
      col.set(entry.key, entry.value);
    }
    this._dirty = true;
  }

  /**
   * 返回集合所有值
   * Return all values in a collection
   * @param {string} collection
   * @returns {Array}
   */
  queryAll(collection) {
    const col = this._collections.get(collection);
    return col ? Array.from(col.values()) : [];
  }

  /**
   * 检查键是否存在
   * Check if a key exists in a collection
   * @param {string} collection
   * @param {string} key
   * @returns {boolean}
   */
  has(collection, key) {
    const col = this._collections.get(collection);
    return col ? col.has(key) : false;
  }

  /**
   * 返回集合中的键值对数量
   * Return the number of entries in a collection (0 if collection doesn't exist)
   * @param {string} collection
   * @returns {number}
   */
  count(collection) {
    const col = this._collections.get(collection);
    return col ? col.size : 0;
  }

  /**
   * 返回所有集合名称
   * Return all collection names
   * @returns {string[]}
   */
  collections() {
    return Array.from(this._collections.keys());
  }

  // ─── 属性访问 / Property Accessors ──────────────────────────

  /** @returns {string} 领域名称 / domain name */
  get domain() { return this._domain; }

  /** @returns {boolean} 是否有未持久化的写入 / whether there are unpersisted writes */
  get dirty() { return this._dirty; }

  // ─── 持久化 / Persistence ───────────────────────────────────

  /**
   * 将当前状态写入 JSON 快照（原子写入：.tmp → rename）
   * Write current state to JSON snapshot (atomic: .tmp then rename)
   */
  async snapshot() {
    // 无变更则跳过 / skip if not dirty
    if (!this._dirty) return;

    const snapshotPath = path.join(this._snapshotDir, `${this._domain}.json`);
    const tmpPath = snapshotPath + '.tmp';

    // 序列化所有集合 / serialize all collections
    const serialized = {};
    for (const [name, col] of this._collections.entries()) {
      const entries = [];
      for (const [key, value] of col.entries()) {
        entries.push({ key, value });
      }
      serialized[name] = entries;
    }

    const json = JSON.stringify(serialized, null, 2);

    // 确保目录存在 / ensure directory exists
    await mkdir(this._snapshotDir, { recursive: true });

    // 原子写入：先写临时文件，再 rename / atomic write: tmp then rename
    await writeFile(tmpPath, json, 'utf-8');
    await rename(tmpPath, snapshotPath);

    this._dirty = false;
  }

  /**
   * 从 JSON 快照恢复状态
   * Restore state from JSON snapshot; silent on file-not-found
   */
  async restore() {
    const snapshotPath = path.join(this._snapshotDir, `${this._domain}.json`);

    let json;
    try {
      json = await readFile(snapshotPath, 'utf-8');
    } catch (err) {
      // 文件不存在时静默返回 / silent on ENOENT
      if (err.code === 'ENOENT') return;
      throw err;
    }

    const serialized = JSON.parse(json);
    this._collections.clear();

    for (const [name, entries] of Object.entries(serialized)) {
      const col = new Map();
      for (const entry of entries) {
        col.set(entry.key, entry.value);
      }
      this._collections.set(name, col);
    }

    // 恢复后标记为干净 / mark clean after restore
    this._dirty = false;
  }

  /**
   * 压缩快照（R0 简单版本：仅保留最新快照）
   * Compact snapshots (R0 simple version: keep only the latest snapshot)
   */
  async compact() {
    // R0：快照本身就是单文件覆盖，无需额外清理
    // R0: snapshot is a single file overwrite, nothing extra to clean
    // 未来版本可能需要清理增量日志 / future versions may clean incremental logs
    await this.snapshot();
  }

  /**
   * 启动自动快照定时器
   * Start auto-snapshot interval timer
   */
  startAutoSnapshot() {
    if (this._autoTimer) return;
    this._autoTimer = setInterval(() => {
      this.snapshot().catch(() => {
        // 静默处理快照失败，避免未捕获异常
        // Silently handle snapshot failures to avoid uncaught exceptions
      });
    }, this._snapshotIntervalMs);

    // 允许进程正常退出 / allow process to exit normally
    if (this._autoTimer.unref) {
      this._autoTimer.unref();
    }
  }

  /**
   * 停止自动快照定时器
   * Stop auto-snapshot interval timer
   */
  stopAutoSnapshot() {
    if (this._autoTimer) {
      clearInterval(this._autoTimer);
      this._autoTimer = null;
    }
  }
}

export default DomainStore;
