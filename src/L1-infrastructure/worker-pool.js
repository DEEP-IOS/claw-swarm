/**
 * WorkerPool — Worker 线程池 / Worker Thread Pool
 *
 * V6.0 计算并行化核心, 管理 worker_threads 池:
 * - 任务排队与分发
 * - SharedArrayBuffer 共享内存管理
 * - 优雅关闭与错误恢复
 * - Worker 崩溃自动重启
 *
 * V6.0 computation parallelization core:
 * - Task queuing and dispatch
 * - SharedArrayBuffer shared memory management
 * - Graceful shutdown and error recovery
 * - Worker crash auto-restart
 *
 * @module L1-infrastructure/worker-pool
 * @author DEEP-IOS
 */

import { Worker } from 'node:worker_threads';
import { nanoid } from 'nanoid';

const DEFAULT_WORKER_COUNT = 4;
const MAX_QUEUE_SIZE = 500;

export class WorkerPool {
  /**
   * @param {Object} options
   * @param {URL|string} options.workerScript - Worker 脚本路径
   * @param {number} [options.workerCount=4] - Worker 线程数
   * @param {Object} [options.sharedBuffers] - SharedArrayBuffer 映射 { name: SAB }
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    if (!options.workerScript) {
      throw new Error('WorkerPool requires workerScript');
    }

    this._workerScript = options.workerScript;
    this._workerCount = options.workerCount || DEFAULT_WORKER_COUNT;
    this._sharedBuffers = options.sharedBuffers || {};
    this._logger = options.logger || console;

    /** @type {Array<{ worker: Worker, busy: boolean, id: string }>} */
    this._workers = [];

    /** @type {Array<{ taskType: string, payload: any, resolve: Function, reject: Function, id: string }>} */
    this._queue = [];

    /** @type {Object} */
    this._stats = {
      active: 0,
      idle: 0,
      queued: 0,
      completed: 0,
      errors: 0,
      totalSubmitted: 0,
    };

    this._destroyed = false;
    this._initialized = false;
  }

  /**
   * 初始化 Worker 池 / Initialize worker pool
   */
  init() {
    if (this._initialized) return;
    this._initialized = true;

    for (let i = 0; i < this._workerCount; i++) {
      this._spawnWorker();
    }
    this._stats.idle = this._workers.length;
  }

  /**
   * 提交任务到池 / Submit task to pool
   *
   * @param {string} taskType - 任务类型 (e.g., 'acoSelect', 'kMeans')
   * @param {*} payload - 任务数据
   * @param {number} [timeoutMs=30000] - 超时时间
   * @returns {Promise<*>} 任务结果
   */
  submit(taskType, payload, timeoutMs = 30000) {
    if (this._destroyed) {
      return Promise.reject(new Error('WorkerPool has been destroyed'));
    }

    if (!this._initialized) {
      this.init();
    }

    if (this._queue.length >= MAX_QUEUE_SIZE) {
      return Promise.reject(new Error(`WorkerPool queue full (max ${MAX_QUEUE_SIZE})`));
    }

    this._stats.totalSubmitted++;

    return new Promise((resolve, reject) => {
      const taskId = nanoid(8);

      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          reject(new Error(`WorkerPool task '${taskType}' timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      const wrappedResolve = (result) => {
        if (timer) clearTimeout(timer);
        resolve(result);
      };
      const wrappedReject = (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      };

      const task = { taskType, payload, resolve: wrappedResolve, reject: wrappedReject, id: taskId };

      // 查找空闲 Worker / Find idle worker
      const idle = this._workers.find((w) => !w.busy);
      if (idle) {
        this._dispatch(idle, task);
      } else {
        this._queue.push(task);
        this._stats.queued = this._queue.length;
      }
    });
  }

  /**
   * 获取共享缓冲区 / Get shared buffer by name
   *
   * @param {string} name
   * @returns {SharedArrayBuffer|undefined}
   */
  getSharedBuffer(name) {
    return this._sharedBuffers[name];
  }

  /**
   * 等待所有任务完成 / Drain all pending tasks
   *
   * @returns {Promise<void>}
   */
  async drain() {
    if (this._queue.length === 0 && this._stats.active === 0) return;

    return new Promise((resolve) => {
      const check = () => {
        if (this._queue.length === 0 && this._stats.active === 0) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  /**
   * 销毁线程池 / Destroy pool
   */
  async destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    // 拒绝队列中的任务 / Reject queued tasks
    for (const task of this._queue) {
      task.reject(new Error('WorkerPool destroyed'));
    }
    this._queue = [];

    // 终止所有 Worker / Terminate all workers
    const terminatePromises = this._workers.map((w) =>
      w.worker.terminate().catch(() => {})
    );
    await Promise.all(terminatePromises);
    this._workers = [];
    this._stats.active = 0;
    this._stats.idle = 0;
    this._stats.queued = 0;
  }

  /**
   * 获取统计信息 / Get pool statistics
   */
  getStats() {
    return {
      ...this._stats,
      idle: this._workers.filter((w) => !w.busy).length,
      active: this._workers.filter((w) => w.busy).length,
      queued: this._queue.length,
      workerCount: this._workers.length,
    };
  }

  // ━━━ 内部方法 / Internal ━━━

  /**
   * 创建 Worker / Spawn a new worker
   * @private
   */
  _spawnWorker() {
    const id = nanoid(6);
    const worker = new Worker(this._workerScript, {
      workerData: {
        sharedBuffers: this._sharedBuffers,
        workerId: id,
      },
    });

    const entry = { worker, busy: false, id };

    worker.on('message', (msg) => {
      this._onWorkerMessage(entry, msg);
    });

    worker.on('error', (err) => {
      this._logger.warn?.(`[WorkerPool] Worker ${id} error: ${err.message}`);
      this._onWorkerError(entry, err);
    });

    worker.on('exit', (code) => {
      if (!this._destroyed && code !== 0) {
        this._logger.warn?.(`[WorkerPool] Worker ${id} exited with code ${code}, respawning`);
        this._replaceWorker(entry);
      }
    });

    this._workers.push(entry);
  }

  /**
   * 分发任务到 Worker / Dispatch task to worker
   * @private
   */
  _dispatch(workerEntry, task) {
    workerEntry.busy = true;
    workerEntry._currentTask = task;
    this._stats.active++;
    this._stats.idle = Math.max(0, this._stats.idle - 1);

    workerEntry.worker.postMessage({
      type: 'task',
      id: task.id,
      taskType: task.taskType,
      payload: task.payload,
    });
  }

  /**
   * 处理 Worker 消息 / Handle worker message
   * @private
   */
  _onWorkerMessage(workerEntry, msg) {
    if (msg.type === 'result') {
      const task = workerEntry._currentTask;
      if (task) {
        if (msg.error) {
          this._stats.errors++;
          task.reject(new Error(msg.error));
        } else {
          this._stats.completed++;
          task.resolve(msg.result);
        }
      }
      workerEntry._currentTask = null;
      workerEntry.busy = false;
      this._stats.active = Math.max(0, this._stats.active - 1);
      this._stats.idle++;

      // 从队列取下一个任务 / Dequeue next task
      this._dequeue(workerEntry);
    }
  }

  /**
   * Worker 错误处理 / Handle worker error
   * @private
   */
  _onWorkerError(workerEntry, err) {
    const task = workerEntry._currentTask;
    if (task) {
      this._stats.errors++;
      task.reject(err);
      workerEntry._currentTask = null;
    }
    workerEntry.busy = false;
  }

  /**
   * 替换崩溃的 Worker / Replace crashed worker
   * @private
   */
  _replaceWorker(oldEntry) {
    const idx = this._workers.indexOf(oldEntry);
    if (idx !== -1) {
      this._workers.splice(idx, 1);
    }
    this._spawnWorker();

    // 如果有排队任务，立即分发 / Dispatch queued task to new worker
    const newWorker = this._workers[this._workers.length - 1];
    this._dequeue(newWorker);
  }

  /**
   * 从队列取任务分发 / Dequeue and dispatch
   * @private
   */
  _dequeue(workerEntry) {
    if (this._queue.length > 0 && !workerEntry.busy) {
      const nextTask = this._queue.shift();
      this._stats.queued = this._queue.length;
      this._dispatch(workerEntry, nextTask);
    }
  }
}
