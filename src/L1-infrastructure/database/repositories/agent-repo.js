/**
 * AgentRepository — Agent 治理数据访问 / Agent Governance Data Access
 *
 * 管理 agents, capabilities, capability_details, skills, contributions,
 * votes, vote_results, behavior_tags, collaboration_history,
 * event_log, evaluation_queue 表。
 *
 * @module L1-infrastructure/database/repositories/agent-repo
 * @author DEEP-IOS
 */

export class AgentRepository {
  /**
   * @param {import('../database-manager.js').DatabaseManager} dbManager
   */
  constructor(dbManager) {
    this.db = dbManager;
  }

  // ━━━ Agents ━━━

  createAgent({ id, name, role = 'general', tier = 'trainee', status = 'active' }) {
    const agentId = id || this.db.generateId('agent');
    const stmt = this.db.prepare('agent_create', `
      INSERT INTO agents (id, name, role, tier, status, total_score, contribution_points,
        failure_count, success_count, created_at, updated_at, last_active)
      VALUES (?, ?, ?, ?, ?, 50, 0, 0, 0, datetime('now'), datetime('now'), datetime('now'))
    `);
    stmt.run(agentId, name, role, tier, status);
    return agentId;
  }

  getAgent(id) {
    return this.db.get('SELECT * FROM agents WHERE id = ?', id) || null;
  }

  updateAgent(id, updates) {
    const allowed = ['name', 'role', 'tier', 'status', 'total_score',
      'contribution_points', 'failure_count', 'success_count', 'last_active'];
    const sets = [];
    const values = [];

    for (const [key, val] of Object.entries(updates)) {
      if (allowed.includes(key)) {
        sets.push(`${key} = ?`);
        values.push(val);
      }
    }
    if (sets.length === 0) return;

    sets.push("updated_at = datetime('now')");
    values.push(id);
    this.db.run(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`, ...values);
  }

  listAgents(statusFilter = null) {
    if (statusFilter) {
      return this.db.all(
        'SELECT * FROM agents WHERE status = ? ORDER BY total_score DESC', statusFilter,
      );
    }
    return this.db.all('SELECT * FROM agents ORDER BY total_score DESC');
  }

  // ━━━ Capabilities ━━━

  createCapability(agentId, dimension, score = 50) {
    this.db.run(
      "INSERT OR REPLACE INTO capabilities (agent_id, dimension, score, updated_at) VALUES (?, ?, ?, datetime('now'))",
      agentId, dimension, score,
    );
  }

  getCapabilities(agentId) {
    return this.db.all('SELECT * FROM capabilities WHERE agent_id = ?', agentId);
  }

  updateCapabilityScore(agentId, dimension, score) {
    const clamped = Math.max(0, Math.min(100, score));
    this.db.run(
      "UPDATE capabilities SET score = ?, updated_at = datetime('now') WHERE agent_id = ? AND dimension = ?",
      clamped, agentId, dimension,
    );
  }

  // ━━━ Capability Details ━━━

  createCapabilityDetail(agentId, dimension, subDimension, score = 50) {
    this.db.run(
      "INSERT OR REPLACE INTO capability_details (agent_id, dimension, sub_dimension, score, updated_at) VALUES (?, ?, ?, ?, datetime('now'))",
      agentId, dimension, subDimension, score,
    );
  }

  getCapabilityDetails(agentId, dimension = null) {
    if (dimension) {
      return this.db.all(
        'SELECT * FROM capability_details WHERE agent_id = ? AND dimension = ?',
        agentId, dimension,
      );
    }
    return this.db.all('SELECT * FROM capability_details WHERE agent_id = ?', agentId);
  }

  // ━━━ Skills ━━━

  createSkill(agentId, skillName, level = 'beginner', evidence = null, verifiedBy = null, expiresAt = null) {
    this.db.run(
      "INSERT OR REPLACE INTO skills (agent_id, skill_name, level, certified_at, expires_at, evidence, verified_by) VALUES (?, ?, ?, datetime('now'), ?, ?, ?)",
      agentId, skillName, level, expiresAt, evidence, verifiedBy,
    );
  }

  getSkills(agentId) {
    return this.db.all('SELECT * FROM skills WHERE agent_id = ?', agentId);
  }

  getAgentSkillLevel(agentId, skillName) {
    const row = this.db.get(
      "SELECT level FROM skills WHERE agent_id = ? AND skill_name = ? AND (expires_at IS NULL OR expires_at > datetime('now'))",
      agentId, skillName,
    );
    return row ? row.level : null;
  }

  // ━━━ Contributions ━━━

  createContribution({ agentId, taskId, points = 0, category, qualityScore, impactScore, metadata }) {
    this.db.run(
      "INSERT INTO contributions (agent_id, task_id, points, category, quality_score, impact_score, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)",
      agentId, taskId || null, points, category || null,
      qualityScore || null, impactScore || null,
      metadata ? JSON.stringify(metadata) : null,
    );
  }

  getContributions(agentId, limit = 50) {
    return this.db.all(
      'SELECT * FROM contributions WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?',
      agentId, limit,
    );
  }

  getTotalPoints(agentId) {
    const row = this.db.get(
      'SELECT COALESCE(SUM(points), 0) as total FROM contributions WHERE agent_id = ?',
      agentId,
    );
    return row ? row.total : 0;
  }

  // ━━━ Votes ━━━

  createVoteRecord({ voteId, voterId, targetId, voteType, choice, weight = 1, expiresAt }) {
    this.db.run(
      "INSERT INTO votes (vote_id, voter_id, target_id, vote_type, choice, weight, timestamp, expires_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)",
      voteId, voterId, targetId, voteType, choice || null, weight, expiresAt || null,
    );
  }

  getVotesByVoteId(voteId) {
    return this.db.all('SELECT * FROM votes WHERE vote_id = ?', voteId);
  }

  createVoteResult({ voteId, targetId, voteType, expiresAt }) {
    this.db.run(
      'INSERT INTO vote_results (vote_id, target_id, vote_type, expires_at) VALUES (?, ?, ?, ?)',
      voteId, targetId, voteType, expiresAt || null,
    );
  }

  getVoteResult(voteId) {
    return this.db.get('SELECT * FROM vote_results WHERE vote_id = ?', voteId) || null;
  }

  updateVoteResult(voteId, updates) {
    const allowed = ['result', 'status', 'total_weight', 'approval_weight', 'rejection_weight', 'concluded_at'];
    const sets = [];
    const values = [];

    for (const [key, val] of Object.entries(updates)) {
      if (allowed.includes(key)) {
        sets.push(`${key} = ?`);
        values.push(val);
      }
    }
    if (sets.length === 0) return;
    values.push(voteId);
    this.db.run(`UPDATE vote_results SET ${sets.join(', ')} WHERE vote_id = ?`, ...values);
  }

  getVotesCountToday(voterId) {
    const row = this.db.get(
      "SELECT COUNT(*) as count FROM votes WHERE voter_id = ? AND timestamp > datetime('now', '-1 day')",
      voterId,
    );
    return row ? row.count : 0;
  }

  // ━━━ Behavior Tags ━━━

  addBehaviorTag(agentId, tag, weight = 1.0, source = 'auto') {
    this.db.run(
      "INSERT OR REPLACE INTO behavior_tags (agent_id, tag, weight, assigned_at, source) VALUES (?, ?, ?, datetime('now'), ?)",
      agentId, tag, weight, source,
    );
  }

  getBehaviorTags(agentId) {
    return this.db.all('SELECT * FROM behavior_tags WHERE agent_id = ?', agentId);
  }

  // ━━━ Collaboration History ━━━

  recordCollaboration(agentAId, agentBId, taskId, collaborationScore) {
    // 按字母排序确保一致性 / Sort alphabetically for consistency
    const [a, b] = [agentAId, agentBId].sort();
    this.db.run(
      "INSERT INTO collaboration_history (agent_a_id, agent_b_id, task_id, collaboration_score, timestamp) VALUES (?, ?, ?, ?, datetime('now'))",
      a, b, taskId || null, collaborationScore,
    );
  }

  getCollaborationScore(agentAId, agentBId) {
    const [a, b] = [agentAId, agentBId].sort();
    const row = this.db.get(
      'SELECT AVG(collaboration_score) as avg_score FROM collaboration_history WHERE agent_a_id = ? AND agent_b_id = ?',
      a, b,
    );
    return row ? row.avg_score : null;
  }

  getMaxCollaborationScore() {
    const row = this.db.get(
      'SELECT MAX(avg_score) as max_score FROM (SELECT AVG(collaboration_score) as avg_score FROM collaboration_history GROUP BY agent_a_id, agent_b_id)',
    );
    return row ? row.max_score : null;
  }

  getAgentAvgCollaboration(agentId) {
    const row = this.db.get(
      'SELECT AVG(collaboration_score) as avg_score FROM collaboration_history WHERE agent_a_id = ? OR agent_b_id = ?',
      agentId, agentId,
    );
    return row ? row.avg_score : null;
  }

  // ━━━ Event Log ━━━

  logEvent(eventType, agentId = null, details = null, severity = 'info') {
    this.db.run(
      "INSERT INTO event_log (event_type, agent_id, details, severity, timestamp) VALUES (?, ?, ?, ?, datetime('now'))",
      eventType, agentId, details ? JSON.stringify(details) : null, severity,
    );
  }

  getRecentEventLogs(limit = 50, eventType = null) {
    if (eventType) {
      return this.db.all(
        'SELECT * FROM event_log WHERE event_type = ? ORDER BY timestamp DESC LIMIT ?',
        eventType, limit,
      );
    }
    return this.db.all(
      'SELECT * FROM event_log ORDER BY timestamp DESC LIMIT ?', limit,
    );
  }

  // ━━━ Evaluation Queue ━━━

  enqueueEvaluation(agentId, updates) {
    this.db.run(
      "INSERT INTO evaluation_queue (agent_id, updates, status, created_at) VALUES (?, ?, 'pending', datetime('now'))",
      agentId, typeof updates === 'string' ? updates : JSON.stringify(updates),
    );
  }

  dequeueEvaluations(batchSize = 10) {
    const rows = this.db.all(
      "SELECT * FROM evaluation_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?",
      batchSize,
    );
    return rows.map((r) => ({
      ...r,
      updates: typeof r.updates === 'string' ? JSON.parse(r.updates) : r.updates,
    }));
  }

  markEvaluationProcessed(id) {
    this.db.run(
      "UPDATE evaluation_queue SET status = 'processed', processed_at = datetime('now') WHERE id = ?",
      id,
    );
  }

  getPendingEvaluationCount() {
    const row = this.db.get(
      "SELECT COUNT(*) as count FROM evaluation_queue WHERE status = 'pending'",
    );
    return row ? row.count : 0;
  }

  // ━━━ Persona Outcomes ━━━

  recordPersonaOutcome({ personaId, taskType, success, qualityScore, durationMs, notes }) {
    this.db.run(
      'INSERT INTO persona_outcomes (persona_id, task_type, success, quality_score, duration_ms, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      personaId, taskType, success ? 1 : 0, qualityScore || null, durationMs || null, notes || null, Date.now(),
    );
  }

  getPersonaStats(personaId, taskType = null) {
    let sql, params;
    if (taskType) {
      sql = 'SELECT COUNT(*) as count, AVG(success) as successRate, AVG(quality_score) as avgQuality FROM persona_outcomes WHERE persona_id = ? AND task_type = ?';
      params = [personaId, taskType];
    } else {
      sql = 'SELECT COUNT(*) as count, AVG(success) as successRate, AVG(quality_score) as avgQuality FROM persona_outcomes WHERE persona_id = ?';
      params = [personaId];
    }
    const row = this.db.get(sql, ...params);
    return {
      count: row?.count || 0,
      successRate: row?.successRate || 0,
      avgQuality: row?.avgQuality || 0,
    };
  }

  getBestPersona(taskType) {
    const row = this.db.get(`
      SELECT persona_id, COUNT(*) as count, AVG(success) as successRate, AVG(quality_score) as avgQuality
      FROM persona_outcomes
      WHERE task_type = ?
      GROUP BY persona_id
      HAVING count >= 3
      ORDER BY successRate DESC, avgQuality DESC
      LIMIT 1
    `, taskType);
    return row || null;
  }
}
