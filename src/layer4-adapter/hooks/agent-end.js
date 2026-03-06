/**
 * agent_end Hook — Agent 结束钩子 / Agent End Hook
 *
 * Agent 会话结束时的收尾处理：保存检查点、发射信息素轨迹、
 * 执行治理评估和人格进化记录。
 *
 * End-of-session cleanup when an agent finishes: saves checkpoints,
 * emits trail pheromones, runs governance post-task evaluation,
 * and records persona evolution outcomes.
 *
 * [WHY] Agent 结束是持久化运行成果的关键时刻。
 * 在此统一完成检查点保存和信息素发射，确保后续会话或同伴
 * 能获取到完整的执行记录，而不会因遗漏而丢失上下文。
 * Agent termination is the critical moment for persisting run outcomes.
 * Centralizing checkpoint saves and pheromone emissions here ensures
 * that subsequent sessions or peers have access to complete execution
 * records, preventing context loss from missed persistence steps.
 *
 * @module hooks/agent-end
 * @author DEEP-IOS
 */

import { persistCheckpoint } from '../../layer2-engines/memory/checkpoint-service.js';

export function handleAgentEnd(event, ctx, engines, config, logger) {
  const agentId = ctx?.agentId || event?.agentId || 'main';
  const sessionId = ctx?.sessionId || event?.sessionId || null;

  // ── 1. 保存检查点 / Save checkpoint (from OME) ────────────────────
  // [WHY] agent_end 是持久化内存状态的最后机会。
  //       从内存 Map 构建 mechanical checkpoint 并写入 DB。
  // agent_end is the last chance to persist in-memory state.
  // Build mechanical checkpoint from in-memory Map and write to DB.
  if (config.memory?.enabled && engines.agentState) {
    try {
      const state = engines.agentState.getAgentState(agentId);
      if (state) {
        persistCheckpoint(
          agentId,
          sessionId,
          'agent_end',
          state,
          event?.messages || null,  // 如果 hook 提供了消息数组 / If hook provides message array
          null,                     // summary (Phase 2, LLM-generated)
          config.memory,
        );
        logger.debug(`Checkpoint saved for agent ${agentId}`);
      }
    } catch (err) {
      logger.warn('Checkpoint save failed:', err.message);
    }
  }

  // ── 2. 发射 trail 信息素 / Emit trail pheromone ────────────────────
  if (config.pheromone?.enabled && engines.pheromone) {
    try {
      engines.pheromone.emitPheromone({
        type: 'trail',
        sourceId: agentId,
        targetScope: `/agent/${agentId}`,
        intensity: 1.0,
        payload: { session: sessionId, event: 'agent_end' },
      });
    } catch (err) {
      logger.warn('Trail pheromone emission failed:', err.message);
    }
  }

  // ── 3. 治理事后评估 / Governance post-task evaluation ──────────────
  // [WHY] 每次会话结束是评估 Agent 整体表现的自然节点。
  //       同时记录贡献（声誉账本）和能力评分（四维引擎）。
  // Session end is a natural evaluation point for overall agent performance.
  // Records contribution (reputation ledger) and capability score (4D engine).
  if (config.governance?.enabled && engines.capabilityEngine) {
    try {
      const outcome = event?.outcome || 'ok';
      const quality = outcome === 'ok' ? 0.7 : 0.3;

      engines.capabilityEngine.evaluateTaskCompletion(agentId, {
        id: `session-${sessionId || Date.now()}`,
        type: event?.taskType || 'backend',
      }, {
        quality,
        helpedOthers: false,
        hasInnovation: false,
      });

      // 声誉贡献记录 / Reputation contribution recording
      if (engines.reputationLedger) {
        engines.reputationLedger.recordContribution(agentId, {
          id: `session-${sessionId || Date.now()}`,
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
    } catch (err) {
      logger.warn('Governance post-evaluation failed:', err.message);
    }
  }

  // ── 4. 人格进化记录 / Persona evolution recording ──────────────────
  // [WHY] 记录"人格 × 任务类型 → 结果"，为未来推荐积累数据。
  // Records "persona × taskType → outcome" to accumulate data for future recommendations.
  if (config.soul?.enabled && engines.personaEvolution) {
    try {
      const personaId = ctx?.personaId || event?.personaId || null;
      if (personaId) {
        const outcome = event?.outcome || 'ok';
        engines.personaEvolution.recordOutcome({
          personaId,
          taskType: event?.taskType || 'general',
          success: outcome === 'ok',
          qualityScore: outcome === 'ok' ? 0.7 : 0.3,
          durationMs: event?.durationMs || null,
          notes: { agentId, sessionId },
        });
        logger.debug(`Persona outcome recorded: ${personaId} on ${event?.taskType || 'general'}`);
      }
    } catch (err) {
      logger.warn('Persona evolution recording failed:', err.message);
    }
  }
}
