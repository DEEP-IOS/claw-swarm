/**
 * ZoneManager -- Zone 分区治理管理 / Zone Governance Management
 *
 * V5.0 新增模块, 实现 Zone 分区治理:
 * V5.0 new module, implements zone-based governance:
 *
 * - 自动分配: Jaccard(agent_skills, zone_tech_stack) > 0.3
 *   Auto-assignment: Jaccard similarity between agent skills and zone tech stack > 0.3
 * - Leader 选举: success_rate > 90% + reputation > 800 → 评分排序
 *   Leader election: success_rate > 90% + reputation > 800 → score ranking
 * - Zone 级信息素隔离: 范围限定 /zone/{zoneId}
 *   Zone-level pheromone isolation: scope restricted to /zone/{zoneId}
 * - Zone CRUD + 成员管理 + 健康检查
 *   Zone CRUD + membership management + health checks
 *
 * 设计来源 / Design source:
 * - design_governance.md: Zone 治理架构
 *
 * @module L4-orchestration/zone-manager
 * @author DEEP-IOS
 */

import { nanoid } from 'nanoid';
import { ZoneRole } from '../L1-infrastructure/types.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认 Jaccard 匹配阈值 / Default Jaccard match threshold */
const DEFAULT_JACCARD_THRESHOLD = 0.3;

/** Leader 选举: 最低成功率要求 / Leader election: minimum success rate */
const LEADER_MIN_SUCCESS_RATE = 0.90;

/** Leader 选举: 最低声誉要求 / Leader election: minimum reputation score */
const LEADER_MIN_REPUTATION = 800;

/** Zone 最大成员数默认值 / Default maximum zone members */
const DEFAULT_MAX_MEMBERS = 50;

/** 健康检查: 最小成员数 / Health check: minimum member count */
const HEALTH_MIN_MEMBERS = 1;

/** 信息素 scope 前缀 / Pheromone scope prefix */
const ZONE_SCOPE_PREFIX = '/zone/';

// ============================================================================
// 内部类型 / Internal Types
// ============================================================================

/**
 * @typedef {Object} ZoneInfo
 * Zone 信息 / Zone information
 * @property {string} id - Zone ID
 * @property {string} name - Zone 名称
 * @property {string} [description] - 描述
 * @property {string[]} techStack - 技术栈
 * @property {string} [leaderId] - Leader Agent ID
 * @property {Object} [config] - 配置
 * @property {number} createdAt - 创建时间
 * @property {number} updatedAt - 更新时间
 */

/**
 * @typedef {Object} AutoAssignResult
 * 自动分配结果 / Auto-assignment result
 * @property {string} zoneId - 分配到的 Zone ID / Assigned zone ID
 * @property {number} score - Jaccard 相似度 / Jaccard similarity score
 */

/**
 * @typedef {Object} ElectionResult
 * 选举结果 / Election result
 * @property {string} leaderId - 当选 Leader ID / Elected leader ID
 * @property {number} score - 综合评分 / Composite score
 */

/**
 * @typedef {Object} HealthCheckResult
 * 健康检查结果 / Health check result
 * @property {boolean} healthy - 是否健康 / Whether healthy
 * @property {string[]} issues - 问题列表 / List of issues
 */

// ============================================================================
// ZoneManager 主类 / Main Class
// ============================================================================

export class ZoneManager {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {import('../L1-infrastructure/database/repositories/zone-repo.js').ZoneRepository} deps.zoneRepo
   *   Zone 数据仓库 / Zone repository
   * @param {import('../L1-infrastructure/database/repositories/agent-repo.js').AgentRepository} deps.agentRepo
   *   Agent 数据仓库 / Agent repository
   * @param {import('../L2-communication/message-bus.js').MessageBus} [deps.messageBus]
   *   消息总线 / Message bus for event broadcasting
   * @param {Object} [deps.config] - Zone 管理配置 / Zone manager config
   * @param {number} [deps.config.jaccardThreshold=0.3] - Jaccard 匹配阈值
   * @param {number} [deps.config.maxMembers=50] - 最大成员数
   * @param {Object} [deps.logger]
   */
  constructor({ zoneRepo, agentRepo, messageBus, config, logger } = {}) {
    /** @type {import('../L1-infrastructure/database/repositories/zone-repo.js').ZoneRepository} */
    this._zoneRepo = zoneRepo;

    /** @type {import('../L1-infrastructure/database/repositories/agent-repo.js').AgentRepository} */
    this._agentRepo = agentRepo;

    /** @type {import('../L2-communication/message-bus.js').MessageBus | null} */
    this._messageBus = messageBus || null;

    /** @type {Object} */
    this._logger = logger || console;

    /**
     * Agent 生命周期管理器引用 (可选, 用于选举过滤)
     * Agent lifecycle manager reference (optional, used for election filtering)
     * @type {Object | null}
     */
    this._agentLifecycle = null;

    // 配置 / Configuration
    const cfg = config || {};

    /** @type {number} */
    this._jaccardThreshold = cfg.jaccardThreshold ?? DEFAULT_JACCARD_THRESHOLD;

    /** @type {number} */
    this._maxMembers = cfg.maxMembers ?? DEFAULT_MAX_MEMBERS;

    // 自动降级订阅: Leader 进入 MAINTENANCE/RETIRED 时自动降级并重新选举
    // Auto-demotion subscription: auto-demote leader on MAINTENANCE/RETIRED transition
    this._setupAutoDemotionSubscription();
  }

  // ━━━ 生命周期绑定 / Lifecycle Binding ━━━

  /**
   * 设置 Agent 生命周期管理器引用
   * Set agent lifecycle manager reference
   *
   * 绑定后, electLeader() 将额外过滤: 仅 IDLE/ACTIVE 状态的 Agent 可参选。
   * Once bound, electLeader() will additionally filter: only agents in IDLE/ACTIVE state are eligible.
   *
   * @param {Object} lifecycle - Agent 生命周期管理器 / Agent lifecycle manager
   * @param {Function} lifecycle.getState - 获取 Agent 当前状态 / Get agent current state
   */
  setAgentLifecycle(lifecycle) {
    this._agentLifecycle = lifecycle || null;
    this._logger.info?.(
      `[ZoneManager] AgentLifecycle ${lifecycle ? '已绑定' : '已解绑'} / AgentLifecycle ${lifecycle ? 'bound' : 'unbound'}`,
    );
  }

  // ━━━ Zone CRUD ━━━

  /**
   * 创建 Zone
   * Create a new zone
   *
   * @param {Object} params
   * @param {string} params.name - Zone 名称 (唯一) / Zone name (unique)
   * @param {string} [params.description] - 描述 / Description
   * @param {string[]} [params.techStack] - 技术栈 / Tech stack
   * @param {Object} [params.config] - 自定义配置 / Custom config
   * @returns {string} zoneId
   */
  createZone({ name, description, techStack, config }) {
    if (!name || typeof name !== 'string') {
      throw new Error('[ZoneManager] Zone 名称不能为空 / Zone name is required');
    }

    const zoneId = this._zoneRepo.createZone({
      name,
      description: description || null,
      techStack: techStack || [],
      config: config || null,
    });

    this._logger.info?.(`[ZoneManager] Zone 已创建 / Zone created: ${zoneId} (${name})`);

    this._emit('zone.created', {
      zoneId,
      name,
      techStack: techStack || [],
    });

    return zoneId;
  }

  /**
   * 获取 Zone 详情
   * Get zone details
   *
   * @param {string} id - Zone ID
   * @returns {ZoneInfo | null}
   */
  getZone(id) {
    return this._zoneRepo.getZone(id);
  }

  /**
   * 列出所有 Zone
   * List all zones
   *
   * @returns {ZoneInfo[]}
   */
  listZones() {
    return this._zoneRepo.listZones();
  }

  // ━━━ 成员管理 / Member Management ━━━

  /**
   * 将 Agent 分配到指定 Zone
   * Assign agent to a specific zone
   *
   * @param {string} agentId - Agent ID
   * @param {string} zoneId - Zone ID
   * @param {string} [role='member'] - 角色 / Role (member/leader/observer)
   */
  assignAgent(agentId, zoneId, role = ZoneRole.member) {
    // 验证 Zone 存在 / Validate zone exists
    const zone = this._zoneRepo.getZone(zoneId);
    if (!zone) {
      throw new Error(`[ZoneManager] Zone 不存在 / Zone not found: ${zoneId}`);
    }

    // 检查成员上限 / Check member cap
    const currentCount = this._zoneRepo.getMemberCount(zoneId);
    if (currentCount >= this._maxMembers) {
      throw new Error(
        `[ZoneManager] Zone 成员已满 / Zone member limit reached: ${currentCount}/${this._maxMembers}`,
      );
    }

    this._zoneRepo.addMember(zoneId, agentId, role);

    this._logger.info?.(
      `[ZoneManager] Agent ${agentId} 已分配到 Zone ${zoneId} (${role}) / Agent assigned to zone`,
    );

    this._emit('zone.agentAssigned', {
      agentId,
      zoneId,
      zoneName: zone.name,
      role,
    });
  }

  /**
   * 自动分配 Agent 到最佳匹配 Zone (Jaccard 相似度)
   * Auto-assign agent to best matching zone via Jaccard similarity
   *
   * 算法 / Algorithm:
   * 1. 获取 Agent 技能列表 / Get agent skill list
   * 2. 与每个 Zone 的 techStack 计算 Jaccard / Compute Jaccard with each zone's techStack
   * 3. 选择 Jaccard > threshold 的最高分 Zone / Pick zone with highest Jaccard > threshold
   *
   * @param {string} agentId - Agent ID
   * @returns {AutoAssignResult | null} 分配结果, 若无匹配返回 null / Assignment result, null if no match
   */
  autoAssignAgent(agentId, skills = null) {
    // 获取 Agent 技能: 优先使用传入的 skills, 回退到 AgentRepository 查询
    // Get agent skills: prefer passed-in skills, fallback to AgentRepository lookup
    const agentSkills = skills && skills.length > 0
      ? new Set(skills)
      : this._getAgentSkillSet(agentId);
    if (agentSkills.size === 0) {
      this._logger.warn?.(
        `[ZoneManager] Agent ${agentId} 无技能数据, 无法自动分配 / No skills data, cannot auto-assign`,
      );
      return null;
    }

    // 获取所有 Zone / Get all zones
    const zones = this._zoneRepo.listZones();
    if (zones.length === 0) {
      this._logger.warn?.('[ZoneManager] 无可用 Zone / No zones available');
      return null;
    }

    // 计算每个 Zone 的 Jaccard 分数 / Compute Jaccard for each zone
    let bestZone = null;
    let bestScore = 0;

    for (const zone of zones) {
      const techStack = new Set(zone.techStack || []);
      if (techStack.size === 0) continue;

      const score = this.computeJaccard(agentSkills, techStack);

      if (score > bestScore) {
        bestScore = score;
        bestZone = zone;
      }
    }

    // 阈值过滤 / Threshold filter
    if (!bestZone || bestScore < this._jaccardThreshold) {
      this._logger.info?.(
        `[ZoneManager] Agent ${agentId} 无匹配 Zone (bestScore=${bestScore.toFixed(3)}, threshold=${this._jaccardThreshold}) / No matching zone`,
      );
      return null;
    }

    // 执行分配 / Execute assignment
    this.assignAgent(agentId, bestZone.id);

    this._logger.info?.(
      `[ZoneManager] 自动分配: Agent ${agentId} → Zone ${bestZone.name} (Jaccard=${bestScore.toFixed(3)}) / Auto-assigned`,
    );

    return {
      zoneId: bestZone.id,
      score: bestScore,
    };
  }

  /**
   * 获取 Zone 成员列表
   * Get zone members
   *
   * @param {string} zoneId
   * @returns {Array<{ zone_id: string, agent_id: string, role: string, joined_at: number }>}
   */
  getMembers(zoneId) {
    return this._zoneRepo.getMembers(zoneId);
  }

  // ━━━ Leader 选举 / Leader Election ━━━

  /**
   * Zone Leader 选举
   * Zone leader election
   *
   * 算法 / Algorithm:
   * 1. 获取 Zone 所有成员 / Get all zone members
   * 2. 过滤: success_rate > 90% 且 reputation > 800 / Filter: success_rate > 90% and reputation > 800
   * 3. 综合评分: score = success_rate * 0.5 + normalized_reputation * 0.3 + contribution_factor * 0.2
   * 4. 选最高分者为 Leader / Elect highest scorer as leader
   *
   * @param {string} zoneId
   * @returns {ElectionResult | null} 选举结果, 无候选人返回 null / Election result, null if no candidates
   */
  electLeader(zoneId) {
    const zone = this._zoneRepo.getZone(zoneId);
    if (!zone) {
      throw new Error(`[ZoneManager] Zone 不存在 / Zone not found: ${zoneId}`);
    }

    const members = this._zoneRepo.getMembers(zoneId);
    if (members.length === 0) {
      this._logger.warn?.(`[ZoneManager] Zone ${zoneId} 无成员, 无法选举 / No members, cannot elect`);
      return null;
    }

    // 评估每个成员 / Evaluate each member
    const candidates = [];

    for (const member of members) {
      const agent = this._agentRepo.getAgent(member.agent_id);
      if (!agent) continue;

      // 生命周期状态过滤: 仅 IDLE/ACTIVE 可参选 (若 _agentLifecycle 可用)
      // Lifecycle state filter: only IDLE/ACTIVE eligible (if _agentLifecycle available)
      if (this._agentLifecycle) {
        try {
          const state = this._agentLifecycle.getState(member.agent_id);
          if (state && state !== 'IDLE' && state !== 'ACTIVE') {
            continue;
          }
        } catch {
          // 获取状态失败不阻断选举 / State lookup failure does not block election
        }
      }

      // 计算成功率 / Compute success rate
      const totalTasks = (agent.success_count || 0) + (agent.failure_count || 0);
      const successRate = totalTasks > 0
        ? (agent.success_count || 0) / totalTasks
        : 0;

      // 声誉分数 / Reputation score
      const reputation = agent.total_score || 0;

      // 过滤: 必须达到选举门槛 / Filter: must meet election threshold
      if (successRate < LEADER_MIN_SUCCESS_RATE || reputation < LEADER_MIN_REPUTATION) {
        continue;
      }

      // 贡献因子: 基于贡献积分 / Contribution factor: based on contribution points
      const contributionFactor = Math.min(1, (agent.contribution_points || 0) / 1000);

      // 综合评分 / Composite score
      const normalizedReputation = Math.min(1, reputation / 1000);
      const score =
        successRate * 0.5 +
        normalizedReputation * 0.3 +
        contributionFactor * 0.2;

      candidates.push({
        agentId: member.agent_id,
        score,
        successRate,
        reputation,
      });
    }

    if (candidates.length === 0) {
      this._logger.info?.(
        `[ZoneManager] Zone ${zoneId} 无符合选举条件的候选人 / No eligible candidates for election`,
      );
      return null;
    }

    // 按分数降序排列 / Sort by score descending
    candidates.sort((a, b) => b.score - a.score);
    const winner = candidates[0];

    // 更新 Zone leader / Update zone leader
    this._zoneRepo.updateZone(zoneId, { leaderId: winner.agentId });
    this._zoneRepo.updateMemberRole(zoneId, winner.agentId, ZoneRole.leader);

    this._logger.info?.(
      `[ZoneManager] Leader 选举完成: Zone ${zone.name} → Agent ${winner.agentId} (score=${winner.score.toFixed(3)}) / Leader elected`,
    );

    this._emit('zone.leader.elected', {
      zoneId,
      zoneName: zone.name,
      leaderId: winner.agentId,
      score: winner.score,
      candidateCount: candidates.length,
    });

    return {
      leaderId: winner.agentId,
      score: winner.score,
    };
  }

  /**
   * 降级 Zone Leader
   * Demote zone leader
   *
   * 移除当前 Leader 角色, 将其降为 member, 并发布降级事件。
   * Remove current leader role, demote to member, and publish demotion event.
   *
   * @param {string} zoneId - Zone ID
   * @param {Object} [options]
   * @param {string} [options.reason='manual'] - 降级原因 / Demotion reason
   * @returns {{ demotedAgentId: string, reason: string } | null} 降级结果, 无 Leader 返回 null / Demotion result, null if no leader
   */
  demoteLeader(zoneId, { reason = 'manual' } = {}) {
    const zone = this._zoneRepo.getZone(zoneId);
    if (!zone) {
      throw new Error(`[ZoneManager] Zone 不存在 / Zone not found: ${zoneId}`);
    }

    if (!zone.leaderId) {
      this._logger.warn?.(
        `[ZoneManager] Zone ${zoneId} 无 Leader, 无需降级 / No leader to demote`,
      );
      return null;
    }

    const demotedAgentId = zone.leaderId;

    // 移除 Leader: 角色降为 member, Zone leaderId 清空
    // Remove leader: role demoted to member, zone leaderId cleared
    this._zoneRepo.updateMemberRole(zoneId, demotedAgentId, ZoneRole.member);
    this._zoneRepo.updateZone(zoneId, { leaderId: null });

    this._logger.info?.(
      `[ZoneManager] Leader 已降级: Zone ${zone.name}, Agent ${demotedAgentId}, 原因=${reason} / Leader demoted`,
    );

    this._emit('zone.leader.demoted', {
      zoneId,
      zoneName: zone.name,
      demotedAgentId,
      reason,
    });

    return { demotedAgentId, reason };
  }

  // ━━━ 健康检查 / Health Check ━━━

  /**
   * Zone 健康检查
   * Zone health check
   *
   * 检测项 / Checks:
   * - 是否有成员 / Has members
   * - 是否有 Leader / Has leader
   * - Leader 是否仍在成员列表中 / Leader is still a member
   * - 成员数是否在合理范围 / Member count within limits
   *
   * @param {string} zoneId
   * @returns {HealthCheckResult}
   */
  healthCheck(zoneId) {
    const zone = this._zoneRepo.getZone(zoneId);
    if (!zone) {
      return { healthy: false, issues: ['zone_not_found'] };
    }

    const issues = [];
    const members = this._zoneRepo.getMembers(zoneId);
    const memberCount = members.length;

    // 成员检查 / Member check
    if (memberCount < HEALTH_MIN_MEMBERS) {
      issues.push(`insufficient_members (count=${memberCount}, min=${HEALTH_MIN_MEMBERS})`);
    }

    // Leader 检查 / Leader check
    if (!zone.leaderId) {
      issues.push('no_leader');
    } else {
      const leaderIsMember = members.some(m => m.agent_id === zone.leaderId);
      if (!leaderIsMember) {
        issues.push('leader_not_in_members');
      }
    }

    // 超员检查 / Over-capacity check
    if (memberCount > this._maxMembers) {
      issues.push(`over_capacity (count=${memberCount}, max=${this._maxMembers})`);
    }

    // 技术栈检查 / Tech stack check
    if (!zone.techStack || zone.techStack.length === 0) {
      issues.push('empty_tech_stack');
    }

    const healthy = issues.length === 0;

    if (!healthy) {
      this._logger.warn?.(
        `[ZoneManager] Zone ${zone.name} 健康检查异常: ${issues.join(', ')} / Health issues detected`,
      );
    }

    return { healthy, issues };
  }

  // ━━━ Jaccard 相似度 / Jaccard Similarity ━━━

  /**
   * 计算两个集合的 Jaccard 相似度
   * Compute Jaccard similarity between two sets
   *
   * Jaccard(A, B) = |A ∩ B| / |A ∪ B|
   *
   * 用于 Agent 技能与 Zone 技术栈的匹配。
   * Used for matching agent skills with zone tech stack.
   *
   * @param {Set<string>} setA - 集合 A / Set A
   * @param {Set<string>} setB - 集合 B / Set B
   * @returns {number} 相似度 [0, 1] / Similarity [0, 1]
   */
  computeJaccard(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 0;

    let intersectionSize = 0;
    for (const item of setA) {
      if (setB.has(item)) {
        intersectionSize++;
      }
    }

    const unionSize = setA.size + setB.size - intersectionSize;
    if (unionSize === 0) return 0;

    return intersectionSize / unionSize;
  }

  // ━━━ 统计 / Statistics ━━━

  /**
   * 获取全局 Zone 统计
   * Get global zone statistics
   *
   * @returns {Object} stats
   */
  getZoneStats() {
    const zones = this._zoneRepo.listZones();
    let totalMembers = 0;
    let zonesWithLeader = 0;

    for (const zone of zones) {
      const count = this._zoneRepo.getMemberCount(zone.id);
      totalMembers += count;
      if (zone.leaderId) zonesWithLeader++;
    }

    return {
      totalZones: zones.length,
      totalMembers,
      zonesWithLeader,
      zonesWithoutLeader: zones.length - zonesWithLeader,
      avgMembersPerZone: zones.length > 0 ? totalMembers / zones.length : 0,
    };
  }

  // ━━━ 信息素 Scope / Pheromone Scope ━━━

  /**
   * 获取 Zone 的信息素范围 (用于 Zone 级隔离)
   * Get pheromone scope for a zone (for zone-level isolation)
   *
   * 信息素范围格式: /zone/{zoneId}
   * Pheromone scope format: /zone/{zoneId}
   *
   * @param {string} zoneId
   * @returns {string} 信息素范围 / Pheromone scope
   */
  static getZoneScope(zoneId) {
    return `${ZONE_SCOPE_PREFIX}${zoneId}`;
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 获取 Agent 的技能集合 (用于 Jaccard 匹配)
   * Get agent skill set (for Jaccard matching)
   *
   * 从 AgentRepository 获取技能列表, 转为 Set。
   * Fetches skill list from AgentRepository and converts to Set.
   *
   * @param {string} agentId
   * @returns {Set<string>} 技能名称集合 / Skill name set
   * @private
   */
  _getAgentSkillSet(agentId) {
    const skills = this._agentRepo.getSkills(agentId);
    if (!skills || skills.length === 0) return new Set();

    return new Set(skills.map(s => s.skill_name).filter(Boolean));
  }

  /**
   * 发布消息总线事件
   * Publish to message bus
   *
   * @param {string} topic
   * @param {Object} data
   * @private
   */
  _emit(topic, data) {
    if (this._messageBus) {
      try {
        this._messageBus.publish(topic, data, { senderId: 'zone-manager' });
      } catch {
        // 忽略消息总线错误 / Ignore message bus errors
      }
    }
  }

  /**
   * 设置自动降级订阅
   * Setup auto-demotion subscription
   *
   * 监听 'agent.lifecycle.transition' 事件:
   * 若某 Zone Leader 转为 MAINTENANCE 或 RETIRED 状态, 自动降级并触发重新选举。
   *
   * Subscribe to 'agent.lifecycle.transition' events:
   * If a zone leader transitions to MAINTENANCE or RETIRED, auto-demote and trigger re-election.
   *
   * @private
   */
  _setupAutoDemotionSubscription() {
    if (!this._messageBus) return;

    /** @type {Set<string>} 需要自动降级的状态 / States that trigger auto-demotion */
    const DEMOTE_STATES = new Set(['MAINTENANCE', 'RETIRED']);

    try {
      this._messageBus.subscribe('agent.lifecycle.transition', (event) => {
        const payload = event?.payload || event;
        const agentId = payload?.agentId;
        const newState = payload?.newState || payload?.to;

        if (!agentId || !newState) return;
        if (!DEMOTE_STATES.has(newState)) return;

        // 查找该 Agent 是否是任何 Zone 的 Leader
        // Check if this agent is a leader of any zone
        try {
          const zones = this._zoneRepo.listZones();

          for (const zone of zones) {
            if (zone.leaderId !== agentId) continue;

            this._logger.info?.(
              `[ZoneManager] 自动降级: Agent ${agentId} 转为 ${newState}, Zone ${zone.name} / Auto-demotion triggered`,
            );

            // 降级 / Demote
            this.demoteLeader(zone.id, {
              reason: `auto:lifecycle_${newState.toLowerCase()}`,
            });

            // 触发重新选举 / Trigger re-election
            try {
              this.electLeader(zone.id);
            } catch (electionErr) {
              this._logger.warn?.(
                `[ZoneManager] 自动重选失败: Zone ${zone.name} — ${electionErr.message} / Auto re-election failed`,
              );
            }
          }
        } catch (err) {
          this._logger.warn?.(
            `[ZoneManager] 自动降级处理异常: ${err.message} / Auto-demotion error`,
          );
        }
      });

      this._logger.info?.(
        '[ZoneManager] 自动降级订阅已建立 / Auto-demotion subscription established',
      );
    } catch {
      // messageBus.subscribe 不可用时静默跳过
      // Silently skip if messageBus.subscribe is unavailable
    }
  }
}
