/**
 * FileBasedStrategy — 文件策略 / File-Based Strategy — Inter-agent task distribution via the filesystem.
 *
 * 将 .task.json 文件写入共享目录并轮询相应的 .result.json 文件。
 * 如果在 orphanTimeout 内没有外部代理接手任务，则回退到 SimulatedStrategy。
 *
 * Writes a .task.json file into a shared directory and polls for a
 * corresponding .result.json file. If no external agent picks up the
 * task within orphanTimeout, execution falls back to the SimulatedStrategy.
 *
 * [WHY] 从 v3.0 移植，更新导入路径以适应 v4.0 分层架构。
 * Ported from v3.0 with updated import paths for the v4.0 layered architecture.
 *
 * @module orchestration/strategies/file-based-strategy
 * @author DEEP-IOS
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { BaseStrategy } from './base-strategy.js';
import { SimulatedStrategy } from './simulated-strategy.js';
import { SwarmTimeoutError } from '../../../layer1-core/errors.js';

export class FileBasedStrategy extends BaseStrategy {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.taskDir] - 任务/结果文件目录 / Directory for task/result files.
   * @param {number} [options.orphanTimeout=60000] - 回退前的等待时间（毫秒）/ Time (ms) before fallback.
   */
  constructor(options = {}) {
    super('file-based');

    /** @type {string} */
    this.taskDir = options.taskDir || path.join(os.homedir(), '.openclaw', 'swarm-tasks');

    /** @type {number} */
    this.orphanTimeout = options.orphanTimeout || 60000;
  }

  /**
   * 通过写入任务文件并等待外部代理生成结果来执行角色。
   *
   * Execute a role by writing a task file and waiting for an external
   * agent to produce the result.
   *
   * 流程 / Flow:
   *  1. 如果任务目录不存在则创建 / Create the task directory if it does not exist.
   *  2. 写入 {taskId}-{roleName}.task.json
   *  3. 轮询 {taskId}-{roleName}.result.json
   *  4. 如果在 orphanTimeout 内未被接手，回退到模拟 / Fall back to simulated if not picked up.
   *  5. 清理任务和结果文件 / Clean up task and result files.
   *
   * @param {import('../../../layer1-core/types.js').Role} role
   * @param {string} prompt
   * @param {import('../../../layer1-core/types.js').ExecutionContext} context
   * @returns {Promise<import('../../../layer1-core/types.js').RoleResult>}
   */
  async execute(role, prompt, context) {
    const taskId = context.taskId;
    const roleName = role.name;

    // 确保任务目录存在 / Ensure the task directory exists
    if (!fs.existsSync(this.taskDir)) {
      fs.mkdirSync(this.taskDir, { recursive: true });
    }

    // 写入任务文件供外部代理接手 / Write the task file for external agents to pick up
    const taskData = {
      taskId,
      role: {
        name: role.name,
        description: role.description,
        capabilities: role.capabilities,
        priority: role.priority,
      },
      prompt,
      context: {
        taskId,
        timeout: context.timeout,
      },
      status: 'pending',
      createdAt: Date.now(),
    };

    this._writeTaskFile(taskId, roleName, taskData);

    try {
      // 等待外部代理写入结果文件 / Wait for an external agent to write the result file
      const result = await this._waitForResult(
        taskId,
        roleName,
        this.orphanTimeout,
      );
      return result;
    } catch (err) {
      if (err instanceof SwarmTimeoutError) {
        // 没有外部代理接手任务 — 回退到模拟 / No external agent picked up — fall back to simulation
        return this._fallbackToSimulated(role, prompt, context);
      }
      throw err;
    } finally {
      // 无论结果如何都清理任务和结果文件 / Clean up both files regardless of outcome
      this._cleanupTaskFile(taskId, roleName);
    }
  }

  /**
   * 将任务 JSON 文件写入任务目录 / Write a task JSON file to the task directory.
   *
   * @param {string} taskId
   * @param {string} roleName
   * @param {Object} data - 可序列化的任务负载 / Serialisable task payload.
   * @private
   */
  _writeTaskFile(taskId, roleName, data) {
    const filePath = path.join(this.taskDir, `${taskId}-${roleName}.task.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 轮询任务目录中的 .result.json 文件。
   *
   * Poll the task directory for a .result.json file.
   *
   * 每 1 秒检查一次。如果文件在 timeout 毫秒内未出现则抛出 SwarmTimeoutError。
   *
   * Checks every 1 second. If the file does not appear within timeout
   * milliseconds a SwarmTimeoutError is thrown.
   *
   * @param {string} taskId
   * @param {string} roleName
   * @param {number} timeout - 最大等待时间（毫秒）/ Maximum wait time in ms.
   * @returns {Promise<import('../../../layer1-core/types.js').RoleResult>}
   * @throws {SwarmTimeoutError}
   * @private
   */
  _waitForResult(taskId, roleName, timeout) {
    const resultPath = path.join(
      this.taskDir,
      `${taskId}-${roleName}.result.json`,
    );
    const pollInterval = 1000;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const check = () => {
        // 检查结果文件是否已出现 / Check if the result file has appeared
        if (fs.existsSync(resultPath)) {
          try {
            const raw = fs.readFileSync(resultPath, 'utf-8');
            const result = JSON.parse(raw);
            resolve(result);
          } catch (parseErr) {
            reject(
              new SwarmTimeoutError(
                `Failed to parse result file for ${roleName}: ${parseErr.message}`,
                { timeoutMs: timeout, context: { role: roleName } },
              ),
            );
          }
          return;
        }

        // 检查是否超过超时时间 / Check if we have exceeded the timeout
        if (Date.now() - startTime >= timeout) {
          reject(
            new SwarmTimeoutError(
              `No agent picked up task for role "${roleName}" within ${timeout}ms`,
              { timeoutMs: timeout, context: { role: roleName } },
            ),
          );
          return;
        }

        // 安排下一次轮询 / Schedule next poll
        setTimeout(check, pollInterval);
      };

      // 开始第一次检查 / Start the first check
      check();
    });
  }

  /**
   * 从任务目录移除任务和结果文件。
   * Remove task and result files from the task directory.
   *
   * 静默忽略缺失的文件，因此可以安全地重复调用。
   * Silently ignores missing files so this is safe to call repeatedly.
   *
   * @param {string} taskId
   * @param {string} roleName
   * @private
   */
  _cleanupTaskFile(taskId, roleName) {
    const taskPath = path.join(this.taskDir, `${taskId}-${roleName}.task.json`);
    const resultPath = path.join(this.taskDir, `${taskId}-${roleName}.result.json`);

    try { fs.unlinkSync(taskPath); } catch { /* 文件可能不存在 / file may not exist */ }
    try { fs.unlinkSync(resultPath); } catch { /* 文件可能不存在 / file may not exist */ }
  }

  /**
   * 当没有外部代理在孤儿超时内接手任务时，回退到 SimulatedStrategy。
   *
   * Fall back to the SimulatedStrategy when no external agent
   * picks up the task within the orphan timeout.
   *
   * @param {import('../../../layer1-core/types.js').Role} role
   * @param {string} prompt
   * @param {import('../../../layer1-core/types.js').ExecutionContext} context
   * @returns {Promise<import('../../../layer1-core/types.js').RoleResult>}
   * @private
   */
  async _fallbackToSimulated(role, prompt, context) {
    const simulated = new SimulatedStrategy();
    return simulated.execute(role, prompt, context);
  }
}
