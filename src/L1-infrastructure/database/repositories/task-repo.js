/**
 * TaskRepository — 任务与角色数据访问 / Task & Role Data Access
 *
 * 管理 swarm_tasks, swarm_roles, swarm_checkpoints, swarm_artifacts, swarm_locks 表。
 * Manages swarm_tasks, swarm_roles, swarm_checkpoints, swarm_artifacts, swarm_locks tables.
 *
 * @module L1-infrastructure/database/repositories/task-repo
 * @author DEEP-IOS
 */

export class TaskRepository {
  /**
   * @param {import('../database-manager.js').DatabaseManager} dbManager
   */
  constructor(dbManager) {
    this.db = dbManager;
  }

  // ━━━ Swarm Tasks ━━━

  /**
   * 创建蜂群任务
   * Create swarm task
   */
  createTask(id, config, strategy = 'simulated') {
    const stmt = this.db.prepare('task_create', `
      INSERT INTO swarm_tasks (id, config, status, strategy, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, datetime('now'), datetime('now'))
    `);
    stmt.run(id, JSON.stringify(config), strategy);
    return id;
  }

  /**
   * 获取任务
   * Get task by ID
   */
  getTask(id) {
    const stmt = this.db.prepare('task_get', 'SELECT * FROM swarm_tasks WHERE id = ?');
    const row = stmt.get(id);
    if (!row) return null;
    return { ...row, config: JSON.parse(row.config) };
  }

  /**
   * 更新任务状态
   * Update task status
   */
  updateTaskStatus(id, status, error = null) {
    const stmt = this.db.prepare('task_updateStatus', `
      UPDATE swarm_tasks SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?
    `);
    stmt.run(status, error, id);
  }

  /**
   * 列出任务
   * List tasks with optional status filter
   */
  listTasks(statusFilter = null) {
    let rows;
    if (statusFilter) {
      rows = this.db.all(
        "SELECT * FROM swarm_tasks WHERE status = ? ORDER BY created_at DESC",
        statusFilter,
      );
    } else {
      rows = this.db.all("SELECT * FROM swarm_tasks ORDER BY created_at DESC");
    }
    return rows.map((r) => ({ ...r, config: JSON.parse(r.config) }));
  }

  /**
   * 检查幂等键
   * Check idempotency key
   */
  findByIdempotencyKey(key) {
    if (!key) return null;
    const row = this.db.get(
      'SELECT * FROM swarm_tasks WHERE idempotency_key = ?', key,
    );
    return row ? { ...row, config: JSON.parse(row.config) } : null;
  }

  // ━━━ Swarm Roles ━━━

  /**
   * 创建角色
   * Create role
   */
  createRole(id, taskId, name, description = null, capabilities = null, priority = 0, dependsOn = '[]') {
    const stmt = this.db.prepare('role_create', `
      INSERT INTO swarm_roles (id, task_id, name, description, capabilities, priority, depends_on, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
    `);
    stmt.run(id, taskId, name, description, capabilities, priority, dependsOn);
  }

  /**
   * 获取任务的所有角色
   * Get all roles for a task
   */
  getRolesByTask(taskId) {
    const rows = this.db.all(
      'SELECT * FROM swarm_roles WHERE task_id = ? ORDER BY priority DESC',
      taskId,
    );
    return rows.map((r) => ({
      ...r,
      capabilities: r.capabilities ? JSON.parse(r.capabilities) : null,
      depends_on: r.depends_on ? JSON.parse(r.depends_on) : [],
      result: r.result ? JSON.parse(r.result) : null,
    }));
  }

  /**
   * 更新角色状态
   * Update role status
   */
  updateRoleStatus(id, status, result = null) {
    const stmt = this.db.prepare('role_updateStatus', `
      UPDATE swarm_roles SET status = ?, result = ? WHERE id = ?
    `);
    stmt.run(status, result ? JSON.stringify(result) : null, id);
  }

  // ━━━ Swarm Checkpoints ━━━

  saveCheckpoint(id, taskId, roleName, trigger, data) {
    const stmt = this.db.prepare('scp_save', `
      INSERT OR IGNORE INTO swarm_checkpoints (id, task_id, role_name, trigger, data, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(id, taskId, roleName, trigger, JSON.stringify(data));
  }

  getCheckpoints(taskId) {
    const rows = this.db.all(
      'SELECT * FROM swarm_checkpoints WHERE task_id = ? ORDER BY created_at DESC',
      taskId,
    );
    return rows.map((r) => ({ ...r, data: JSON.parse(r.data) }));
  }

  // ━━━ Swarm Artifacts ━━━

  createArtifact(id, taskId, roleName, type, path = null, content = null) {
    const stmt = this.db.prepare('artifact_create', `
      INSERT INTO swarm_artifacts (id, task_id, role_name, type, path, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(id, taskId, roleName, type, path, content);
  }

  getArtifactsByTask(taskId) {
    return this.db.all(
      'SELECT * FROM swarm_artifacts WHERE task_id = ? ORDER BY created_at DESC',
      taskId,
    );
  }

  // ━━━ Swarm Locks ━━━

  acquireLock(resource, owner, ttlMs) {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    // 清理过期锁 / Clean expired locks
    this.db.run(
      "DELETE FROM swarm_locks WHERE resource = ? AND expires_at < datetime('now')",
      resource,
    );

    try {
      this.db.run(
        'INSERT INTO swarm_locks (resource, owner, acquired_at, expires_at) VALUES (?, ?, ?, ?)',
        resource, owner, now, expiresAt,
      );
      return true;
    } catch {
      return false; // 已被锁定 / Already locked
    }
  }

  releaseLock(resource, owner) {
    const result = this.db.run(
      'DELETE FROM swarm_locks WHERE resource = ? AND owner = ?',
      resource, owner,
    );
    return result.changes > 0;
  }

  isLocked(resource) {
    const row = this.db.get(
      "SELECT 1 FROM swarm_locks WHERE resource = ? AND expires_at > datetime('now')",
      resource,
    );
    return !!row;
  }

  // ━━━ Role Execution Stats ━━━

  insertRoleExecutionStat({ roleName, taskType, durationMs, success, qualityScore }) {
    const stmt = this.db.prepare('roleStats_insert', `
      INSERT INTO role_execution_stats (role_name, task_type, duration_ms, success, quality_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(roleName, taskType || null, durationMs, success ? 1 : 0, qualityScore || null, Date.now());
  }

  getRoleDurationStats(roleName, taskType = null) {
    let sql, params;
    if (taskType) {
      sql = 'SELECT duration_ms FROM role_execution_stats WHERE role_name = ? AND task_type = ? AND success = 1';
      params = [roleName, taskType];
    } else {
      sql = 'SELECT duration_ms FROM role_execution_stats WHERE role_name = ? AND success = 1';
      params = [roleName];
    }

    const rows = this.db.all(sql, ...params);
    if (rows.length === 0) return { count: 0, avg: 0, stddev: 0, min: 0, max: 0 };

    const durations = rows.map((r) => r.duration_ms);
    const count = durations.length;
    const avg = durations.reduce((a, b) => a + b, 0) / count;
    const min = Math.min(...durations);
    const max = Math.max(...durations);

    // 手动计算标准差 / Manual stddev calculation
    const sqDiffs = durations.map((d) => (d - avg) ** 2);
    const stddev = Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / count);

    return { count, avg, stddev, min, max };
  }

  // ━━━ Task State Transitions ━━━

  insertStateTransition({ taskId, roleName, fromState, toState, reason }) {
    const stmt = this.db.prepare('transition_insert', `
      INSERT INTO task_state_transitions (task_id, role_name, from_state, to_state, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(taskId, roleName || null, fromState, toState, reason || null, Date.now());
  }

  getStateTransitions(taskId) {
    return this.db.all(
      'SELECT * FROM task_state_transitions WHERE task_id = ? ORDER BY created_at ASC',
      taskId,
    );
  }
}
