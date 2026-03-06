/**
 * subagent_ended Hook — 子代理结束后钩子 / Subagent Ended Hook
 *
 * 子代理结束后的评估处理：记录结果用于治理和人格进化。
 * Post-subagent evaluation: records outcome for governance and persona evolution.
 *
 * [WHY] 子代理完成后需要：
 * 1. 记录执行结果（治理系统的信誉评估输入）
 * 2. 发射 trail 信息素（让其他 Agent 感知任务完成/失败）
 *
 * After subagent completion:
 * 1. Record execution outcome (input for governance reputation evaluation)
 * 2. Emit trail pheromone (let other agents perceive task completion/failure)
 *
 * @module hooks/subagent-ended
 * @author DEEP-IOS
 */

/**
 * 处理 subagent_ended 事件 / Handle the subagent_ended event
 *
 * @param {Object} event   - 事件对象，包含 subagentId/agentId 和 outcome / Event object
 * @param {Object} ctx     - 上下文对象 / Context object
 * @param {Object} engines - 引擎实例集合 / Engine instances
 * @param {Object} config  - 插件配置 / Plugin configuration
 * @param {Object} logger  - 日志器 / Logger instance
 */
export function handleSubagentEnded(event, ctx, engines, config, logger) {
  const subagentId = event?.subagentId || event?.agentId;
  const outcome = event?.outcome || 'ok';

  // ── 1. 治理记录 / Governance recording ───────────────────────────
  // [WHY] 子代理的执行结果是评估其能力的重要数据点。
  //       同时更新能力引擎（四维评分）和声誉账本（贡献积分）。
  // Subagent outcomes are key data points for capability evaluation.
  // Updates both capability engine (4D scoring) and reputation ledger (contribution points).
  if (config.governance?.enabled && engines.capabilityEngine) {
    try {
      const quality = outcome === 'ok' ? 0.8 : 0.2;

      // 能力评估 / Capability evaluation
      engines.capabilityEngine.evaluateTaskCompletion(subagentId || 'subagent', {
        id: `subagent-${subagentId}-${Date.now()}`,
        type: event?.taskType || 'backend',
      }, {
        quality,
        helpedOthers: false,
        hasInnovation: false,
      });

      // 声誉贡献 / Reputation contribution
      if (engines.reputationLedger) {
        engines.reputationLedger.recordContribution(subagentId || 'subagent', {
          id: `subagent-${subagentId}-${Date.now()}`,
          complexity: 1,
          type: event?.taskType || 'backend',
        }, {
          quality,
          impact: quality,
          earlyCompletion: false,
          hasInnovation: false,
          helpedOthers: false,
        });
      }

      logger.debug(`Subagent ${subagentId} governance recorded: outcome=${outcome}, quality=${quality}`);
    } catch (err) {
      logger.warn('Subagent governance recording failed:', err.message);
    }
  }

  // ── 2. 发射 trail 信息素 / Emit trail pheromone ──────────────────
  if (config.pheromone?.enabled && engines.pheromone) {
    try {
      engines.pheromone.emitPheromone({
        type: 'trail',
        sourceId: subagentId || 'subagent',
        targetScope: '/global',
        intensity: outcome === 'ok' ? 1.0 : 0.3,
        payload: { event: 'subagent_ended', outcome },
      });
    } catch (err) {
      logger.warn('Subagent trail pheromone failed:', err.message);
    }
  }
}
