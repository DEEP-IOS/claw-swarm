/**
 * 快照管理器 — 统一管理多个 DomainStore 实例的快照生命周期
 * Snapshot manager — manages snapshot lifecycle for multiple DomainStore instances
 * @module core/store/snapshot-manager
 */

export class SnapshotManager {
  /**
   * @param {Object} opts
   * @param {string} opts.snapshotDir - 快照目录 / snapshot directory path
   * @param {number} [opts.intervalMs=30000] - 全局快照间隔 / global snapshot interval in ms
   */
  constructor({ snapshotDir, intervalMs = 30000 }) {
    if (!snapshotDir || typeof snapshotDir !== 'string') {
      throw new Error('SnapshotManager: snapshotDir is required');
    }

    /** @type {string} 快照目录 / snapshot directory */
    this._snapshotDir = snapshotDir;

    /** @type {number} 快照间隔 / snapshot interval */
    this._intervalMs = intervalMs;

    /** @type {Map<string, import('./domain-store.js').DomainStore>} 已注册的存储 / registered stores */
    this._stores = new Map();

    /** @type {ReturnType<typeof setInterval>|null} 全局定时器 / global timer */
    this._timer = null;
  }

  /**
   * 注册一个领域存储
   * Register a domain store instance
   * @param {import('./domain-store.js').DomainStore} domainStore
   */
  register(domainStore) {
    if (!domainStore || !domainStore.domain) {
      throw new Error('SnapshotManager.register: invalid domainStore (missing domain)');
    }
    this._stores.set(domainStore.domain, domainStore);
  }

  /**
   * 注销一个领域存储
   * Unregister a domain store by domain name
   * @param {string} domain
   */
  unregister(domain) {
    this._stores.delete(domain);
  }

  /**
   * 启动全局快照定时器
   * Start global snapshot interval timer
   */
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      this.snapshotAll().catch(() => {
        // 静默处理，避免未捕获异常
        // Silently handle errors to avoid uncaught exceptions
      });
    }, this._intervalMs);

    // 允许进程正常退出 / allow process to exit normally
    if (this._timer.unref) {
      this._timer.unref();
    }
  }

  /**
   * 停止全局快照定时器
   * Stop global snapshot interval timer
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * 对所有已注册存储执行快照（错误隔离：单个失败不阻塞其他）
   * Snapshot all registered stores (error-isolated: one failure won't block others)
   * @returns {Promise<{succeeded: string[], failed: Array<{domain: string, error: Error}>}>}
   */
  async snapshotAll() {
    const succeeded = [];
    const failed = [];

    for (const [domain, store] of this._stores.entries()) {
      try {
        await store.snapshot();
        succeeded.push(domain);
      } catch (error) {
        failed.push({ domain, error });
      }
    }

    return { succeeded, failed };
  }

  /**
   * 恢复所有已注册存储的快照（错误隔离：单个失败不阻塞其他）
   * Restore all registered stores from snapshots (error-isolated)
   * @returns {Promise<{succeeded: string[], failed: Array<{domain: string, error: Error}>}>}
   */
  async restoreAll() {
    const succeeded = [];
    const failed = [];

    for (const [domain, store] of this._stores.entries()) {
      try {
        await store.restore();
        succeeded.push(domain);
      } catch (error) {
        failed.push({ domain, error });
      }
    }

    return { succeeded, failed };
  }

  /**
   * 获取所有存储的统计信息
   * Get stats for all registered stores
   * @returns {Map<string, {dirty: boolean, collectionCount: number}>}
   */
  getStats() {
    const stats = new Map();
    for (const [domain, store] of this._stores.entries()) {
      stats.set(domain, {
        dirty: store.dirty,
        collectionCount: store.collections().length,
      });
    }
    return stats;
  }
}

export default SnapshotManager;
