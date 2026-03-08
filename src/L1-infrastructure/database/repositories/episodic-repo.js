/**
 * EpisodicRepository — 情景记忆数据访问 / Episodic Memory Data Access
 *
 * 管理 episodic_events 表, 支持:
 * - 事件三元组 (subject-predicate-object) 记录
 * - 多维检索 (importance, timeDecay, reward)
 * - Ebbinghaus 遗忘曲线过期清理
 *
 * @module L1-infrastructure/database/repositories/episodic-repo
 * @author DEEP-IOS
 */

export class EpisodicRepository {
  /**
   * @param {import('../database-manager.js').DatabaseManager} dbManager
   */
  constructor(dbManager) {
    this.db = dbManager;
  }

  /**
   * 记录情景事件
   * Record episodic event
   *
   * @param {Object} params
   * @param {string} [params.id]
   * @param {string} params.agentId
   * @param {string} params.eventType - action/observation/decision/error/success
   * @param {string} params.subject
   * @param {string} params.predicate
   * @param {string} [params.object]
   * @param {Object} [params.context]
   * @param {number} [params.importance=0.5]
   * @param {number} [params.reward]
   * @param {string} [params.sessionId]
   * @returns {string} event ID
   */
  record({ id, agentId, eventType, subject, predicate, object, context, importance = 0.5, reward, sessionId }) {
    const eventId = id || this.db.generateId('ep');
    const stmt = this.db.prepare('ep_record', `
      INSERT INTO episodic_events (id, agent_id, event_type, subject, predicate, object, context, importance, reward, timestamp, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      eventId, agentId, eventType, subject, predicate,
      object || null,
      context ? JSON.stringify(context) : null,
      importance, reward || null,
      Date.now(), sessionId || null,
    );
    return eventId;
  }

  /**
   * 检索情景记忆 (多维排序)
   * Recall episodic memories (multi-dimensional ranking)
   *
   * score = similarity×0.4 + timeDecay×0.2 + importance×0.2 + reward×0.2
   *
   * @param {string} agentId
   * @param {Object} [options]
   * @param {string} [options.eventType]
   * @param {string} [options.keyword] - 在 subject/predicate/object 中搜索
   * @param {number} [options.limit=10]
   * @param {number} [options.minImportance=0]
   * @returns {Array<Object>}
   */
  recall(agentId, { eventType, keyword, limit = 10, minImportance = 0 } = {}) {
    let sql = 'SELECT * FROM episodic_events WHERE agent_id = ?';
    const params = [agentId];

    if (eventType) {
      sql += ' AND event_type = ?';
      params.push(eventType);
    }

    if (keyword) {
      sql += ' AND (subject LIKE ? OR predicate LIKE ? OR object LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    if (minImportance > 0) {
      sql += ' AND importance >= ?';
      params.push(minImportance);
    }

    // 按 importance * recency 排序 / Sort by importance * recency
    sql += ' ORDER BY (importance * (1.0 / (1.0 + (? - timestamp) / 86400000.0))) DESC LIMIT ?';
    params.push(Date.now(), limit);

    const rows = this.db.getDb().prepare(sql).all(...params);
    return rows.map(r => this._parseRow(r));
  }

  /**
   * 获取 Agent 最近的事件
   * Get recent events for an agent
   */
  getRecent(agentId, limit = 20) {
    const rows = this.db.all(
      'SELECT * FROM episodic_events WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?',
      agentId, limit,
    );
    return rows.map(r => this._parseRow(r));
  }

  /**
   * 按会话获取事件
   * Get events by session
   */
  getBySession(sessionId) {
    const rows = this.db.all(
      'SELECT * FROM episodic_events WHERE session_id = ? ORDER BY timestamp ASC',
      sessionId,
    );
    return rows.map(r => this._parseRow(r));
  }

  /**
   * 清理低重要性旧事件 (Ebbinghaus 遗忘)
   * Prune low-importance old events (Ebbinghaus forgetting)
   *
   * retention(t) = e^(-t / (λ × importance))
   * 当 retention < threshold 时删除
   *
   * @param {number} [lambdaDays=30] - 遗忘衰减常数 (天)
   * @param {number} [retentionThreshold=0.1] - 保留阈值
   * @returns {number} 删除数量
   */
  prune(lambdaDays = 30, retentionThreshold = 0.1) {
    const now = Date.now();
    const lambdaMs = lambdaDays * 86400000;

    // 获取所有事件, 计算保留率 / Get all events, compute retention
    const allEvents = this.db.all('SELECT id, importance, timestamp FROM episodic_events');
    const toDelete = [];

    for (const event of allEvents) {
      const ageMs = now - event.timestamp;
      const imp = Math.max(event.importance, 0.01); // 防止除零
      const retention = Math.exp(-ageMs / (lambdaMs * imp));

      if (retention < retentionThreshold) {
        toDelete.push(event.id);
      }
    }

    if (toDelete.length === 0) return 0;

    // 批量删除 / Batch delete
    this.db.transaction(() => {
      const stmt = this.db.prepare('ep_delete', 'DELETE FROM episodic_events WHERE id = ?');
      for (const id of toDelete) {
        stmt.run(id);
      }
    });

    return toDelete.length;
  }

  /**
   * 获取事件总数
   * Get total event count
   */
  count(agentId = null) {
    if (agentId) {
      const row = this.db.get('SELECT COUNT(*) as count FROM episodic_events WHERE agent_id = ?', agentId);
      return row ? row.count : 0;
    }
    const row = this.db.get('SELECT COUNT(*) as count FROM episodic_events');
    return row ? row.count : 0;
  }

  /**
   * 删除事件
   * Delete event
   */
  delete(id) {
    this.db.run('DELETE FROM episodic_events WHERE id = ?', id);
  }

  // ━━━ 内部方法 / Internal ━━━

  _parseRow(row) {
    return {
      id: row.id,
      agentId: row.agent_id,
      eventType: row.event_type,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      context: row.context ? JSON.parse(row.context) : null,
      importance: row.importance,
      reward: row.reward,
      timestamp: row.timestamp,
      sessionId: row.session_id,
    };
  }
}
