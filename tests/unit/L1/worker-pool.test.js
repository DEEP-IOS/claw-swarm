/**
 * WorkerPool 单元测试 / WorkerPool Unit Tests
 *
 * V6.0 L1: Worker 线程池测试
 * V6.0 L1: Tests for worker_threads pool manager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkerPool } from '../../../src/L1-infrastructure/worker-pool.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('WorkerPool', () => {
  describe('构造 / Construction', () => {
    it('创建实例不报错 / creates instance without error', () => {
      const pool = new WorkerPool({
        workerScript: new URL('../../../src/L1-infrastructure/workers/compute-worker.js', import.meta.url),
        workerCount: 1,
        logger: silentLogger,
      });
      expect(pool).toBeDefined();
    });

    it('getStats 返回初始值 / getStats returns initial values', () => {
      const pool = new WorkerPool({
        workerScript: new URL('../../../src/L1-infrastructure/workers/compute-worker.js', import.meta.url),
        workerCount: 2,
        logger: silentLogger,
      });
      const stats = pool.getStats();
      expect(stats).toBeDefined();
      expect(stats.active).toBe(0);
      expect(stats.queued).toBe(0);
    });
  });

  describe('SharedArrayBuffer 管理 / SharedArrayBuffer Management', () => {
    it('传入 sharedBuffers 可通过 getSharedBuffer 获取 / getSharedBuffer returns passed buffers', () => {
      const buf = new SharedArrayBuffer(1024);
      const pool = new WorkerPool({
        workerScript: new URL('../../../src/L1-infrastructure/workers/compute-worker.js', import.meta.url),
        workerCount: 1,
        sharedBuffers: { pheromone: buf },
        logger: silentLogger,
      });

      expect(pool.getSharedBuffer('pheromone')).toBe(buf);
      expect(pool.getSharedBuffer('nonexistent')).toBeUndefined();
    });
  });

  describe('任务提交 / Task Submission', () => {
    it('submit 无 init 时回退到直接失败或排队 / submit without init queues or rejects', async () => {
      const pool = new WorkerPool({
        workerScript: new URL('../../../src/L1-infrastructure/workers/compute-worker.js', import.meta.url),
        workerCount: 0, // 无 worker
        logger: silentLogger,
      });

      // 无 worker 时 submit 应超时或失败
      await expect(pool.submit('test', {}, 100)).rejects.toThrow();
    });
  });

  describe('销毁 / Destroy', () => {
    it('destroy 清理资源 / destroy cleans up', async () => {
      const pool = new WorkerPool({
        workerScript: new URL('../../../src/L1-infrastructure/workers/compute-worker.js', import.meta.url),
        workerCount: 1,
        logger: silentLogger,
      });
      await pool.destroy();
      const stats = pool.getStats();
      expect(stats.active).toBe(0);
    });
  });
});
