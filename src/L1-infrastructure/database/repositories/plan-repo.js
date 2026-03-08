/**
 * PlanRepository — 执行计划数据访问 / Execution Plan Data Access
 *
 * 管理 execution_plans 表。
 * Manages execution_plans table.
 *
 * @module L1-infrastructure/database/repositories/plan-repo
 * @author DEEP-IOS
 */

export class PlanRepository {
  constructor(dbManager) {
    this.db = dbManager;
  }

  /**
   * 创建执行计划
   * Create execution plan
   */
  create({ id, taskId, planData, status = 'draft', createdBy, maturityScore }) {
    const planId = id || this.db.generateId('plan');
    const now = Date.now();
    const stmt = this.db.prepare('plan_create', `
      INSERT INTO execution_plans (id, task_id, plan_data, status, created_by, maturity_score, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(planId, taskId || null, JSON.stringify(planData), status, createdBy || null, maturityScore || null, now, now);
    return planId;
  }

  /**
   * 获取计划
   * Get plan by ID
   */
  get(id) {
    const row = this.db.get('SELECT * FROM execution_plans WHERE id = ?', id);
    return row ? this._parse(row) : null;
  }

  /**
   * 按任务获取计划
   * Get plans by task ID
   */
  getByTask(taskId) {
    return this.db.all(
      'SELECT * FROM execution_plans WHERE task_id = ? ORDER BY created_at DESC', taskId,
    ).map(r => this._parse(r));
  }

  /**
   * 更新计划状态
   * Update plan status
   */
  updateStatus(id, status) {
    this.db.run(
      'UPDATE execution_plans SET status = ?, updated_at = ? WHERE id = ?',
      status, Date.now(), id,
    );
  }

  /**
   * 更新计划数据
   * Update plan data
   */
  updatePlanData(id, planData, maturityScore = null) {
    const now = Date.now();
    if (maturityScore !== null) {
      this.db.run(
        'UPDATE execution_plans SET plan_data = ?, maturity_score = ?, updated_at = ? WHERE id = ?',
        JSON.stringify(planData), maturityScore, now, id,
      );
    } else {
      this.db.run(
        'UPDATE execution_plans SET plan_data = ?, updated_at = ? WHERE id = ?',
        JSON.stringify(planData), now, id,
      );
    }
  }

  /**
   * 列出计划
   * List plans with optional status filter
   */
  list(statusFilter = null, limit = 50) {
    if (statusFilter) {
      return this.db.all(
        'SELECT * FROM execution_plans WHERE status = ? ORDER BY created_at DESC LIMIT ?',
        statusFilter, limit,
      ).map(r => this._parse(r));
    }
    return this.db.all(
      'SELECT * FROM execution_plans ORDER BY created_at DESC LIMIT ?', limit,
    ).map(r => this._parse(r));
  }

  /**
   * 删除计划
   * Delete plan
   */
  delete(id) {
    this.db.run('DELETE FROM execution_plans WHERE id = ?', id);
  }

  _parse(row) {
    return {
      id: row.id,
      taskId: row.task_id,
      planData: row.plan_data ? JSON.parse(row.plan_data) : null,
      status: row.status,
      createdBy: row.created_by,
      maturityScore: row.maturity_score,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
