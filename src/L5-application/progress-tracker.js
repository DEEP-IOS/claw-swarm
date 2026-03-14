/**
 * ProgressTracker — 蜂群执行进度追踪器 / Swarm Execution Progress Tracker
 *
 * 轻量级进度追踪: 记录子代理的工具调用步骤, 汇总为人类可读的进度摘要,
 * 并通过节流控制推送频率 (每 30s 或每 5 步)。
 *
 * Lightweight progress tracking: records sub-agent tool call steps,
 * summarizes into human-readable progress, and throttles push frequency
 * (every 30s or every 5 steps).
 *
 * @module L5-application/progress-tracker
 * @version 6.3.0
 * @author DEEP-IOS
 */

'use strict';

/** 最小推送间隔 (ms) / Minimum push interval */
const MIN_NOTIFY_INTERVAL_MS = 30_000;

/** 最小推送步数间隔 / Minimum step interval for push */
const MIN_NOTIFY_STEPS = 5;

export class ProgressTracker {
  constructor() {
    /** @type {Map<string, Array<{ agent: string, tool: string, timestamp: number }>>} taskId → steps */
    this._steps = new Map();
    /** @type {{ lastNotifyTime: number, lastNotifyStepCount: number }} */
    this._throttle = { lastNotifyTime: 0, lastNotifyStepCount: 0 };
  }

  /**
   * 记录一个工具调用步骤
   * Record a tool call step
   *
   * @param {string} taskId
   * @param {{ agent: string, tool: string, timestamp: number }} step
   */
  recordStep(taskId, step) {
    if (!this._steps.has(taskId)) this._steps.set(taskId, []);
    this._steps.get(taskId).push(step);
  }

  /**
   * 获取进度摘要 (含推送节流判断)
   * Get progress summary with push throttle check
   *
   * @param {string} [dagId] - 可选 DAG ID, 汇总该 DAG 下所有 task
   * @returns {{ text: string, shouldNotify: boolean, totalSteps: number }}
   */
  getSummary(dagId) {
    let totalSteps = 0;
    const agentSummaries = [];

    for (const [taskId, steps] of this._steps) {
      if (dagId && !taskId.includes(dagId)) continue;
      totalSteps += steps.length;
      if (steps.length > 0) {
        const lastStep = steps[steps.length - 1];
        agentSummaries.push(`${lastStep.agent}: ${steps.length} 步, 最新: ${lastStep.tool}`);
      }
    }

    const now = Date.now();
    const timeSinceLastNotify = now - this._throttle.lastNotifyTime;
    const stepsSinceLastNotify = totalSteps - this._throttle.lastNotifyStepCount;

    const shouldNotify =
      timeSinceLastNotify >= MIN_NOTIFY_INTERVAL_MS ||
      stepsSinceLastNotify >= MIN_NOTIFY_STEPS;

    if (shouldNotify) {
      this._throttle.lastNotifyTime = now;
      this._throttle.lastNotifyStepCount = totalSteps;
    }

    const text = agentSummaries.length > 0
      ? agentSummaries.join('; ')
      : `${totalSteps} 步已完成`;

    return { text, shouldNotify, totalSteps };
  }

  /**
   * 清理已完成任务的步骤记录
   * Clean up step records for completed tasks
   *
   * @param {string} taskId
   */
  clearTask(taskId) {
    this._steps.delete(taskId);
  }

  /**
   * 获取统计
   * @returns {{ trackedTasks: number, totalSteps: number }}
   */
  getStats() {
    let totalSteps = 0;
    for (const steps of this._steps.values()) totalSteps += steps.length;
    return { trackedTasks: this._steps.size, totalSteps };
  }
}
