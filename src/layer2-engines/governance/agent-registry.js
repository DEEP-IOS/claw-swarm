/**
 * AgentRegistry — Facade for agent lifecycle management.
 * 代理注册表 — 代理生命周期管理的门面模式。
 *
 * Provides a clean public API for agent registration, profile retrieval,
 * skill certification, and leaderboard access. Delegates all business logic
 * to CapabilityEngine and ReputationLedger internally.
 *
 * 提供代理注册、档案查询、技能认证和排行榜访问的简洁公共API。
 * 内部将所有业务逻辑委托给CapabilityEngine和ReputationLedger。
 *
 * Responsibility boundary:
 *   AgentRegistry  → lifecycle (register/deactivate), skill cert, facade API
 *   CapabilityEngine → 4D scoring, tier evaluation, task allocation
 *
 * 职责边界：
 *   AgentRegistry  → 生命周期（注册/停用）、技能认证、门面API
 *   CapabilityEngine → 四维评分、等级评估、任务分配
 *
 * @module layer2-engines/governance/agent-registry
 * @author DEEP-IOS
 */

import * as db from '../../layer1-core/db.js';
import { GovernanceError } from '../../layer1-core/errors.js';

class AgentRegistry {
  /**
   * @param {import('./capability-engine.js').CapabilityEngine} capabilityEngine
   * @param {import('./reputation-ledger.js').ReputationLedger} ledger
   * @param {Object} [config={}]
   */
  constructor(capabilityEngine, ledger, config = {}) {
    this._engine = capabilityEngine;
    this._ledger = ledger;
    this._config = config;
  }

  /**
   * Register a new agent in the governance system.
   *
   * @param {Object} agentData
   * @param {string} agentData.id    - Unique agent identifier
   * @param {string} agentData.name  - Display name
   * @param {string} [agentData.role='general'] - Primary role
   * @param {string} [agentData.tier='trainee'] - Starting tier
   * @param {Array<{name:string, level:string}>} [agentData.skills] - Initial skills
   * @returns {Object} The registered agent profile
   * @throws {GovernanceError} If id or name missing, or agent already exists
   */
  register(agentData) {
    if (!agentData || !agentData.id || !agentData.name) {
      throw new GovernanceError('Agent registration requires id and name', {
        code: 'REGISTRATION_ERROR',
      });
    }

    // Check for duplicate
    const existing = db.getAgent(agentData.id);
    if (existing) {
      throw new GovernanceError(`Agent '${agentData.id}' already registered`, {
        code: 'DUPLICATE_AGENT',
        agentId: agentData.id,
      });
    }

    return this._engine.registerAgent(agentData);
  }

  /**
   * Get a full agent profile including capabilities, skills, and tags.
   *
   * @param {string} agentId
   * @returns {Object|null} Agent profile or null if not found
   */
  getProfile(agentId) {
    return this._engine.getAgentProfile(agentId);
  }

  /**
   * List all agents with 'active' status.
   *
   * @returns {Object[]} Array of active agent records
   */
  getAvailableAgents() {
    return db.listAgents('active');
  }

  /**
   * List agents filtered by tier.
   *
   * @param {string} tier - AgentTier value
   * @returns {Object[]} Array of matching agents
   */
  getAgentsByTier(tier) {
    const allAgents = db.listAgents('active');
    return allAgents.filter(a => a.tier === tier);
  }

  /**
   * Update an agent's status.
   *
   * @param {string} agentId
   * @param {string} status - AgentStatus value ('active', 'inactive', 'suspended')
   */
  updateStatus(agentId, status) {
    const agent = db.getAgent(agentId);
    if (!agent) {
      throw new GovernanceError(`Agent '${agentId}' not found`, {
        code: 'AGENT_NOT_FOUND',
        agentId,
      });
    }
    db.updateAgent(agentId, { status });
    this._engine.clearCache(agentId);
  }

  /**
   * Certify a skill for an agent.
   *
   * @param {string} agentId
   * @param {string} skillName
   * @param {string} level - SkillLevel value
   * @param {string} [evidence] - Evidence for certification
   */
  certifySkill(agentId, skillName, level, evidence = null) {
    const agent = db.getAgent(agentId);
    if (!agent) {
      throw new GovernanceError(`Agent '${agentId}' not found`, {
        code: 'AGENT_NOT_FOUND',
        agentId,
      });
    }
    this._engine.certifySkill(agentId, skillName, level, evidence);
  }

  /**
   * Get all skills for an agent.
   *
   * @param {string} agentId
   * @returns {Object[]} Array of skill records
   */
  getSkills(agentId) {
    return db.getSkills(agentId);
  }

  /**
   * Get the agent leaderboard ranked by contribution points.
   *
   * @param {number} [limit=10]
   * @returns {Object[]} Ranked list of agents
   */
  getLeaderboard(limit = 10) {
    return this._ledger.getLeaderboard(limit);
  }

  /**
   * Deactivate an agent (set status to 'inactive').
   *
   * @param {string} agentId
   */
  deactivate(agentId) {
    this.updateStatus(agentId, 'inactive');
  }
}

export { AgentRegistry };
