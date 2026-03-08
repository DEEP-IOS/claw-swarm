/**
 * SoulDesigner — SOUL 片段生成器 / SOUL Snippet Generator
 *
 * v4.x 直接迁移: 根据 agent 档案 (tier, capabilities, persona, behavior, zone)
 * 生成结构化 SOUL 片段, 注入 LLM 系统提示。
 *
 * Direct migration from v4.x: takes an agent profile and generates structured
 * SOUL snippets for LLM system prompt injection. Includes role-specific
 * instructions, constraints, communication protocols, and capability-aware
 * behavioral guidance.
 *
 * SOUL 片段结构 / SOUL Snippet Sections:
 *   1. Identity    — 身份与角色 / Identity and role
 *   2. Capability  — 能力自知 / Capability self-awareness
 *   3. Behavior    — 行为指南 / Behavioral guidelines
 *   4. Constraints — 约束与限制 / Constraints and limits
 *   5. Protocol    — 通信协议 / Communication protocol
 *   6. Zone        — Zone 归属 / Zone affiliation
 *
 * @module L3-agent/soul-designer
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

/**
 * SOUL 片段可用段落类型 / Available SOUL snippet section types
 * @type {string[]}
 */
const SNIPPET_SECTIONS = [
  'identity',
  'capability',
  'behavior',
  'constraints',
  'protocol',
  'zone',
];

/**
 * Tier 对应的行为描述 / Tier-specific behavioral descriptions
 * @type {Record<string, string>}
 */
const TIER_BEHAVIORS = {
  trainee: 'You are a trainee. Ask questions when uncertain. Follow established patterns. Seek review for all outputs.',
  junior: 'You are a junior agent. Handle straightforward tasks independently. Escalate complex decisions. Document your reasoning.',
  mid: 'You are a mid-level agent. Work independently on standard tasks. Make sound technical decisions. Mentor trainees when possible.',
  senior: 'You are a senior agent. Lead complex implementations. Make architectural decisions. Review junior work. Optimize for quality.',
  lead: 'You are a lead agent. Set technical direction. Coordinate cross-team efforts. Make strategic decisions. Ensure system-wide quality.',
};

/**
 * Persona 角色的通信风格 / Communication style by persona role
 * @type {Record<string, string>}
 */
const PERSONA_STYLES = {
  'scout-bee': 'Communicate discoveries concisely. Focus on reporting findings and recommending next steps. Be exploratory and curious.',
  'worker-bee': 'Communicate progress and blockers clearly. Focus on execution quality. Be systematic and thorough.',
  'guard-bee': 'Communicate risks and security concerns proactively. Focus on protection and validation. Be vigilant and precise.',
  'queen-messenger': 'Communicate coordination needs and status updates. Focus on orchestration. Be clear and authoritative.',
};

/**
 * 行为标签到指导说明的映射 / Behavior tag to guidance mapping
 * @type {Record<string, string>}
 */
const BEHAVIOR_GUIDANCE = {
  cooperative: 'Prioritize teamwork. Share information proactively. Seek consensus before major decisions.',
  independent: 'Work autonomously. Minimize unnecessary coordination. Deliver complete solutions.',
  aggressive: 'Move fast. Prioritize progress over perfection. Take initiative on ambiguous tasks.',
  cautious: 'Validate before acting. Double-check critical operations. Prefer safe approaches.',
  adaptive: 'Adjust approach based on context. Balance speed and quality based on task needs.',
};

// ============================================================================
// SoulDesigner
// ============================================================================

export class SoulDesigner {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {Object} deps.logger
   */
  constructor({ logger }) {
    /** @private */
    this._logger = logger;
  }

  /**
   * 根据 agent 档案生成完整 SOUL 片段 / Generate complete SOUL snippet from agent profile
   *
   * @param {Object} agentProfile
   * @param {string} agentProfile.id - Agent ID
   * @param {string} agentProfile.name - Agent 名称 / Agent name
   * @param {string} [agentProfile.tier='trainee'] - 经验等级 / Experience tier
   * @param {string} [agentProfile.persona='worker-bee'] - 人格角色 / Persona role
   * @param {string} [agentProfile.behavior='adaptive'] - 行为倾向 / Behavior tendency
   * @param {Record<string, number>} [agentProfile.capabilities] - 8D 能力分 / 8D capability scores
   * @param {string} [agentProfile.zoneId] - Zone ID
   * @param {string} [agentProfile.zoneName] - Zone 名称 / Zone name
   * @param {string} [agentProfile.taskDescription] - 当前任务描述 / Current task description
   * @param {string} [agentProfile.role] - 特定角色 / Specific role
   * @returns {string} 完整 SOUL 片段 / Complete SOUL snippet
   */
  design(agentProfile) {
    const sections = [];

    // 1. Identity 身份 / Identity section
    sections.push(this._buildIdentitySection(agentProfile));

    // 2. Capability 能力自知 / Capability awareness
    if (agentProfile.capabilities) {
      sections.push(this._buildCapabilitySection(agentProfile.capabilities));
    }

    // 3. Behavior 行为指南 / Behavioral guidelines
    sections.push(this._buildBehaviorSection(agentProfile));

    // 4. Constraints 约束 / Constraints
    sections.push(this._buildConstraintsSection(agentProfile));

    // 5. Protocol 通信协议 / Communication protocol
    sections.push(this._buildProtocolSection(agentProfile));

    // 6. Zone 归属 / Zone affiliation
    if (agentProfile.zoneId) {
      sections.push(this._buildZoneSection(agentProfile));
    }

    const soul = sections.filter(Boolean).join('\n\n');

    this._logger.debug(
      { agentId: agentProfile.id, sections: sections.length },
      'SOUL snippet generated / SOUL 片段已生成',
    );

    return soul;
  }

  /**
   * 为特定角色模板生成 SOUL / Generate role-specific SOUL snippet
   *
   * @param {Object} roleTemplate
   * @param {string} roleTemplate.name - 角色名 / Role name
   * @param {string} roleTemplate.description - 角色描述 / Role description
   * @param {string[]} [roleTemplate.responsibilities] - 职责清单 / Responsibility list
   * @param {string[]} [roleTemplate.constraints] - 角色约束 / Role constraints
   * @param {Object} agentProfile - Agent 档案 / Agent profile
   * @returns {string}
   */
  designForRole(roleTemplate, agentProfile) {
    const parts = [];

    // 基础 SOUL / Base SOUL
    parts.push(this.design(agentProfile));

    // 角色专属指导 / Role-specific guidance
    parts.push(`## Assigned Role: ${roleTemplate.name}`);
    if (roleTemplate.description) {
      parts.push(roleTemplate.description);
    }

    // 职责 / Responsibilities
    if (Array.isArray(roleTemplate.responsibilities) && roleTemplate.responsibilities.length > 0) {
      parts.push('### Responsibilities');
      for (const resp of roleTemplate.responsibilities) {
        parts.push(`- ${resp}`);
      }
    }

    // 角色约束 / Role constraints
    if (Array.isArray(roleTemplate.constraints) && roleTemplate.constraints.length > 0) {
      parts.push('### Role Constraints');
      for (const c of roleTemplate.constraints) {
        parts.push(`- ${c}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * 获取可用的 SOUL 段落类型 / Get available snippet section types
   *
   * @returns {string[]}
   */
  getSnippetSections() {
    return [...SNIPPET_SECTIONS];
  }

  // --------------------------------------------------------------------------
  // 段落构建器 / Section Builders
  // --------------------------------------------------------------------------

  /**
   * 构建身份段落 / Build identity section
   * @param {Object} profile
   * @returns {string}
   * @private
   */
  _buildIdentitySection(profile) {
    const tier = profile.tier || 'trainee';
    const name = profile.name || profile.id || 'Agent';
    const role = profile.role || 'general';

    const lines = [
      `## Identity`,
      `You are **${name}**, a ${tier}-tier agent in the Claw-Swarm system.`,
      `Role: ${role}`,
    ];

    if (profile.taskDescription) {
      lines.push(`Current Task: ${profile.taskDescription}`);
    }

    return lines.join('\n');
  }

  /**
   * 构建能力自知段落 / Build capability awareness section
   * @param {Record<string, number>} capabilities - 8D 分数 / 8D scores
   * @returns {string}
   * @private
   */
  _buildCapabilitySection(capabilities) {
    const lines = ['## Your Capabilities'];

    // 找出强项和弱项 / Identify strengths and weaknesses
    const entries = Object.entries(capabilities)
      .filter(([, score]) => typeof score === 'number')
      .sort(([, a], [, b]) => b - a);

    if (entries.length === 0) return '';

    const strengths = entries.filter(([, s]) => s >= 70);
    const weaknesses = entries.filter(([, s]) => s < 40);

    if (strengths.length > 0) {
      lines.push(`Strengths: ${strengths.map(([d, s]) => `${d}(${Math.round(s)})`).join(', ')}`);
    }
    if (weaknesses.length > 0) {
      lines.push(`Areas to improve: ${weaknesses.map(([d, s]) => `${d}(${Math.round(s)})`).join(', ')}`);
    }

    lines.push('Leverage your strengths. Be extra careful in weak areas or escalate to specialists.');

    return lines.join('\n');
  }

  /**
   * 构建行为指南段落 / Build behavior guidelines section
   * @param {Object} profile
   * @returns {string}
   * @private
   */
  _buildBehaviorSection(profile) {
    const tier = profile.tier || 'trainee';
    const persona = profile.persona || 'worker-bee';
    const behavior = profile.behavior || 'adaptive';

    const lines = ['## Behavioral Guidelines'];

    // Tier 行为 / Tier behavior
    lines.push(TIER_BEHAVIORS[tier] || TIER_BEHAVIORS.trainee);

    // Persona 风格 / Persona style
    const personaStyle = PERSONA_STYLES[persona];
    if (personaStyle) {
      lines.push(personaStyle);
    }

    // 行为标签指导 / Behavior tag guidance
    const guidance = BEHAVIOR_GUIDANCE[behavior];
    if (guidance) {
      lines.push(guidance);
    }

    return lines.join('\n');
  }

  /**
   * 构建约束段落 / Build constraints section
   * @param {Object} profile
   * @returns {string}
   * @private
   */
  _buildConstraintsSection(profile) {
    const tier = profile.tier || 'trainee';
    const lines = ['## Constraints'];

    // 通用约束 / Universal constraints
    lines.push('- Always follow the swarm communication protocol for inter-agent messaging.');
    lines.push('- Report task completion status via pheromone signals.');
    lines.push('- Do not modify files outside your assigned scope.');

    // Tier-specific 约束 / Tier-specific constraints
    if (tier === 'trainee' || tier === 'junior') {
      lines.push('- Seek approval before making architectural changes.');
      lines.push('- Do not merge or deploy without senior review.');
    }

    if (tier === 'trainee') {
      lines.push('- Limit scope to a single file or function per task.');
    }

    return lines.join('\n');
  }

  /**
   * 构建通信协议段落 / Build communication protocol section
   * @param {Object} profile
   * @returns {string}
   * @private
   */
  _buildProtocolSection(profile) {
    const lines = [
      '## Communication Protocol',
      'Use structured messaging when communicating with other agents:',
      '- **TRAIL** pheromone: Mark successful solution paths for others to follow.',
      '- **ALARM** pheromone: Signal errors, blockers, or critical issues.',
      '- **RECRUIT** pheromone: Request help from specialist agents.',
      '- **DANCE** pheromone: Share discovered resource locations or patterns.',
      'When in doubt, emit ALARM and wait for guidance from senior agents.',
    ];

    return lines.join('\n');
  }

  /**
   * 构建 Zone 归属段落 / Build zone affiliation section
   * @param {Object} profile
   * @returns {string}
   * @private
   */
  _buildZoneSection(profile) {
    const lines = [
      `## Zone Affiliation`,
      `You belong to zone **${profile.zoneName || profile.zoneId}**.`,
      'Coordinate with zone members. Follow zone-specific conventions.',
      'Pheromone signals are scoped to your zone unless explicitly broadcast.',
    ];

    return lines.join('\n');
  }
}
