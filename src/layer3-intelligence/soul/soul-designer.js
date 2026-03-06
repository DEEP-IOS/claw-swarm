/**
 * SoulDesigner — 灵魂设计器 / Soul Designer
 *
 * 根据任务描述自动选择最合适的 Agent 人格模板，
 * 并生成完整的 SOUL 片段用于子代理创建。
 *
 * Automatically selects the best-matching agent persona template based on
 * task description, and generates complete SOUL snippets for subagent creation.
 *
 * [WHY] 手动为每个子代理设计人格提示词既重复又容易出错。
 * SoulDesigner 将"任务 -> 人格匹配 -> 提示词生成"自动化，
 * 确保每个子代理都有针对性的行为指导。
 * Manually designing persona prompts for each subagent is repetitive and error-prone.
 * SoulDesigner automates "task -> persona matching -> prompt generation",
 * ensuring every subagent receives targeted behavioral guidance.
 *
 * @module soul/soul-designer
 * @author DEEP-IOS
 */

import { PERSONA_TEMPLATES, mergePersonas, getPersonaTemplate } from './persona-templates.js';

export class SoulDesigner {
  /**
   * @param {Object} config - 插件配置 / Plugin configuration
   * @param {Object} [personaEvolution] - PersonaEvolution 实例（可选）/ PersonaEvolution instance (optional)
   */
  constructor(config, personaEvolution) {
    this._personas = mergePersonas(config.soul?.personas || {});
    // [WHY] PersonaEvolution 是可选依赖——即使治理未启用，
    //       SoulDesigner 仍可通过关键词匹配工作。
    //       当 PersonaEvolution 可用时，getRecommendation() 优先使用历史胜率数据。
    // PersonaEvolution is an optional dependency — SoulDesigner can still
    // function via keyword matching even if governance is not enabled.
    // When available, getRecommendation() prioritizes historical win-rate data.
    this._evolution = personaEvolution || null;
  }

  /**
   * 基于关键词匹配选择最佳人格 / Select best persona via keyword matching
   *
   * @param {string} taskDescription - 任务描述 / Task description
   * @param {string} [taskType]      - 任务类型 / Task type
   * @returns {{ personaId: string, confidence: number, soulSnippet: string }}
   */
  selectPersona(taskDescription, taskType) {
    const desc = (taskDescription + ' ' + (taskType || '')).toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    for (const [id, template] of Object.entries(this._personas)) {
      let score = 0;
      for (const keyword of (template.bestFor || [])) {
        if (desc.includes(keyword)) score += 1;
      }
      // Also check description
      if (template.description && desc.includes(template.description.toLowerCase().split(' ')[0])) {
        score += 0.5;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { personaId: id, confidence: Math.min(score / 3, 1.0), soulSnippet: template.soulSnippet };
      }
    }

    // Default to worker-bee if no match
    if (!bestMatch) {
      const worker = this._personas['worker-bee'] || Object.values(this._personas)[0];
      bestMatch = { personaId: worker?.id || 'worker-bee', confidence: 0.3, soulSnippet: worker?.soulSnippet || '' };
    }

    return bestMatch;
  }

  /**
   * 生成完整的 SOUL 片段 / Generate a complete SOUL snippet
   *
   * @param {Object} options
   * @param {string} options.personaId       - 人格模板 ID / Persona template ID
   * @param {string} [options.taskDescription] - 任务描述 / Task description
   * @param {string} [options.swarmRole]       - 蜂群角色 / Swarm role
   * @param {string} [options.peerDirectory]   - 同伴目录 / Peer directory
   * @returns {string}
   */
  generateSoul({ personaId, taskDescription, swarmRole, peerDirectory }) {
    const template = this._personas[personaId];
    if (!template) return `You are an agent working on: ${taskDescription}`;

    const parts = [template.soulSnippet];

    if (taskDescription) {
      parts.push(`\n## Current Task\n${taskDescription}`);
    }
    if (swarmRole) {
      parts.push(`\n## Your Role in the Swarm\n${swarmRole}`);
    }
    if (peerDirectory) {
      parts.push(`\n${peerDirectory}`);
    }

    return parts.join('\n');
  }

  /**
   * 列出所有可用人格 / List all available personas
   * @returns {Array<Object>}
   */
  listPersonas() {
    return Object.values(this._personas).map(t => ({
      id: t.id, name: t.name, description: t.description,
      bestFor: t.bestFor, collaborationStyle: t.collaborationStyle,
    }));
  }

  /**
   * 基于进化数据获取推荐 / Get recommendation based on persona evolution data
   *
   * [WHY] 优先使用历史胜率数据（PersonaEvolution），
   *       无数据时降级为关键词匹配。
   * Prioritizes historical win-rate data (PersonaEvolution),
   * falls back to keyword matching when no data is available.
   *
   * @param {string} taskType - 任务类型 / Task type
   * @returns {{ personaId: string, confidence: number, soulSnippet: string }}
   */
  getRecommendation(taskType) {
    // 尝试从进化数据获取最佳人格 / Try to get best persona from evolution data
    if (this._evolution) {
      try {
        const best = this._evolution.getBestPersona(taskType);
        if (best && best.persona_id) {
          const template = this._personas[best.persona_id];
          if (template) {
            return {
              personaId: best.persona_id,
              confidence: best.win_rate != null ? best.win_rate : 0.5,
              soulSnippet: template.soulSnippet,
            };
          }
        }
      } catch {
        // 进化数据查询失败，降级到关键词匹配
        // Evolution query failed, fall back to keyword matching
      }
    }

    // 降级：基于关键词匹配 / Fallback: keyword-based selection
    return this.selectPersona('', taskType);
  }
}
