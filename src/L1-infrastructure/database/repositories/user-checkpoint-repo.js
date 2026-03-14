/**
 * UserCheckpointRepository — 人机协作检查点数据访问
 * UserCheckpointRepository — Human-in-the-loop checkpoint data access
 *
 * 管理 swarm_user_checkpoints 表，支持子代理执行中途向用户请求确认。
 * Manages swarm_user_checkpoints table for mid-execution user approval requests.
 *
 * @module L1-infrastructure/database/repositories/user-checkpoint-repo
 * @author DEEP-IOS
 */

export class UserCheckpointRepository {
  constructor(dbManager) {
    this.db = dbManager;
  }

  /**
   * 创建用户检查点 / Create user checkpoint
   *
   * @param {Object} params
   * @param {string} params.id
   * @param {string} params.question  - 向用户提问的内容 / Question for the user
   * @param {string} [params.taskId]
   * @param {string} [params.agentId]
   * @param {string} [params.phaseRole]     - 发起请求的角色 / Role that raised the checkpoint
   * @param {string} [params.phaseDesc]     - 阶段任务描述 / Phase task description
   * @param {string} [params.originalGoal]  - 原始目标，用于重新派遣 / Original goal for re-spawn
   * @returns {string} checkpoint id
   */
  create({ id, question, taskId, agentId, phaseRole, phaseDesc, originalGoal }) {
    this.db.run(
      `INSERT INTO swarm_user_checkpoints
         (id, question, task_id, agent_id, phase_role, phase_desc, original_goal, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      id, question,
      taskId || null, agentId || null,
      phaseRole || null, phaseDesc || null, originalGoal || null,
      Date.now(),
    );
    return id;
  }

  /**
   * 获取所有待处理检查点 (最新优先)
   * Get all pending checkpoints (newest first)
   *
   * @returns {Array<Object>}
   */
  getPending() {
    return this.db.all(
      `SELECT * FROM swarm_user_checkpoints WHERE status = 'pending' ORDER BY created_at DESC`,
    );
  }

  /**
   * 解决检查点 — 记录用户回复
   * Resolve checkpoint — record user answer
   *
   * @param {string} id
   * @param {string} answer - 用户回复 / User's answer
   */
  resolve(id, answer) {
    this.db.run(
      `UPDATE swarm_user_checkpoints
         SET status = 'resolved', answer = ?, resolved_at = ?
       WHERE id = ?`,
      answer, Date.now(), id,
    );
  }

  /**
   * 过期清理 — 删除超过指定时长的待处理检查点
   * Expire old pending checkpoints
   *
   * @param {number} [maxAgeMs=3600000] - 默认 1 小时 / Default 1 hour
   */
  expireOld(maxAgeMs = 3_600_000) {
    const cutoff = Date.now() - maxAgeMs;
    this.db.run(
      `UPDATE swarm_user_checkpoints
         SET status = 'expired'
       WHERE status = 'pending' AND created_at < ?`,
      cutoff,
    );
  }
}
