/**
 * EvaluationQueue — Crash-resilient async batch evaluation with DB persistence.
 * 评估队列 — 具有数据库持久化的崩溃恢复异步批量评估。
 *
 * Processes queued capability evaluations in batches, persisting state to SQLite
 * so that pending items survive process crashes. Replaces the v3.1 in-memory-only
 * queue (Bug #5 fix) and uses transactional batch processing (R3 fix).
 *
 * 批量处理排队的能力评估，将状态持久化到SQLite以确保待处理项在进程崩溃后
 * 仍然存在。替换v3.1的纯内存队列（Bug #5修复），并使用事务性批处理（R3修复）。
 *
 * @module layer2-engines/governance/evaluation-queue
 * @author DEEP-IOS
 */

import { EventEmitter } from 'node:events';
import * as db from '../../layer1-core/db.js';

class EvaluationQueue extends EventEmitter {
  /**
   * Create an EvaluationQueue instance.
   *
   * @param {object} [config={}] - Configuration object.
   * @param {object} [config.performance] - Performance tuning section.
   * @param {object} [config.performance.asyncQueue] - Queue-specific settings.
   * @param {number} [config.performance.asyncQueue.batchSize=10] - Items per batch.
   * @param {number} [config.performance.asyncQueue.flushInterval=5000] - Processor interval in ms.
   */
  constructor(config = {}) {
    super();
    const perf = config.performance?.asyncQueue || {};
    this.batchSize = perf.batchSize || 10;
    this.flushInterval = perf.flushInterval || 5000;
    this._processorInterval = null;
    this._processing = false;
  }

  /**
   * Enqueue a capability evaluation for an agent. Persists to the
   * `evaluation_queue` table so items survive process crashes (Bug #5 fix).
   *
   * @param {string} agentId - The agent to evaluate.
   * @param {object} updates - Evaluation payload (e.g. `{ dimension, score, subScores }`).
   * @returns {void}
   */
  enqueue(agentId, updates) {
    db.enqueueEvaluation(agentId, updates);
    this.emit('itemEnqueued', { agentId });
  }

  /**
   * Process a batch of pending evaluations atomically.
   *
   * Uses a mutex flag to prevent concurrent processing and wraps all
   * operations in a DB transaction for atomicity (R3 fix).
   *
   * @param {number} [batchSize=this.batchSize] - Maximum items to process in this batch.
   * @returns {number} The number of items processed.
   */
  processQueue(batchSize = this.batchSize) {
    if (this._processing) return 0;
    this._processing = true;

    try {
      const items = db.withTransaction(() => {
        const pending = db.dequeueEvaluations(batchSize);

        for (const item of pending) {
          this._applyEvaluation(item);
          db.markEvaluationProcessed(item.id);
        }

        return pending;
      });

      this.emit('queueProcessed', { count: items.length });
      return items.length;
    } finally {
      this._processing = false;
    }
  }

  /**
   * Apply a single evaluation item to the agent's capability scores.
   *
   * Updates the top-level dimension score and, when present, each sub-dimension
   * score via capability detail records.
   *
   * @param {object} item - Dequeued evaluation record.
   * @param {number} item.id - Row id from the evaluation_queue table.
   * @param {string} item.agent_id - Target agent identifier.
   * @param {object} item.updates - Parsed evaluation payload.
   * @param {string} [item.updates.dimension] - Capability dimension to update.
   * @param {number} [item.updates.score] - New dimension score.
   * @param {object} [item.updates.subScores] - Map of sub-dimension names to scores.
   * @returns {void}
   */
  _applyEvaluation(item) {
    if (item.updates.dimension) {
      db.updateCapabilityScore(
        item.agent_id,
        item.updates.dimension,
        item.updates.score,
      );
    }

    if (item.updates.subScores && typeof item.updates.subScores === 'object') {
      for (const [subDim, subScore] of Object.entries(item.updates.subScores)) {
        db.createCapabilityDetail(
          item.agent_id,
          item.updates.dimension,
          subDim,
          subScore,
        );
      }
    }

    this.emit('evaluationApplied', { agentId: item.agent_id });
  }

  /**
   * Start the periodic batch processor.
   *
   * The interval is unref'd so it does not prevent the Node.js process from
   * exiting naturally.
   *
   * @returns {void}
   */
  startProcessor() {
    if (this._processorInterval !== null) return;

    this._processorInterval = setInterval(
      () => this.processQueue(),
      this.flushInterval,
    );
    this._processorInterval.unref();
  }

  /**
   * Stop the periodic batch processor.
   *
   * @returns {void}
   */
  stopProcessor() {
    if (this._processorInterval) {
      clearInterval(this._processorInterval);
      this._processorInterval = null;
    }
  }

  /**
   * Recover items that were still pending when the process last crashed.
   *
   * Should be called once at startup. Processes all pending items in a single
   * large batch to clear the backlog.
   *
   * @returns {number} Count of recovered (processed) items.
   */
  recoverPendingItems() {
    const count = db.getPendingEvaluationCount();

    if (count > 0) {
      console.log(`[SwarmLite] Recovering ${count} pending evaluation(s) from previous session`);
      this.processQueue(1000);
    }

    this.emit('recoveryCompleted', { count });
    return count;
  }

  /**
   * Gracefully shut down the evaluation queue.
   *
   * Stops the periodic processor and attempts to flush any remaining
   * pending items.
   *
   * @returns {void}
   */
  shutdown() {
    this.stopProcessor();

    try {
      this.processQueue(1000);
    } catch (err) {
      console.log(`[SwarmLite] EvaluationQueue shutdown flush error: ${err.message}`);
    }
  }
}

export { EvaluationQueue };
