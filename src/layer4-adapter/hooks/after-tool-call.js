/**
 * after_tool_call Hook — 工具调用后钩子 / After Tool Call Hook
 *
 * 统一的工具调用后处理：
 * 1. Agent 状态跟踪（来自 OME）
 * 2. 挣扎检测（新功能，Phase C 完整实现）
 * 3. 治理能力评估（来自 v3.0）
 *
 * Unified post-tool-call processing:
 * 1. Agent state tracking (from OME)
 * 2. Struggle detection (new feature, full implementation in Phase C)
 * 3. Governance capability evaluation (from v3.0)
 *
 * [WHY] 每次工具调用都是观察 Agent 行为的窗口。
 * 通过集中拦截 after_tool_call，我们可以同时完成状态记录、
 * 异常模式检测和能力评分，避免在多个地方重复埋点。
 * Every tool call is a window into agent behavior.
 * By centralizing interception at after_tool_call, we perform state recording,
 * anomaly-pattern detection, and capability scoring in one place,
 * avoiding scattered instrumentation across multiple modules.
 *
 * @module hooks/after-tool-call
 * @author DEEP-IOS
 */
export function handleAfterToolCall(event, ctx, engines, config, logger) {
  const agentId = ctx?.agentId || event?.agentId || 'main';

  // 1. Agent state tracking (from OME)
  // agent-state-service exports individual functions, accessed via engines.agentState
  if (config.memory?.enabled && engines.agentState) {
    try {
      engines.agentState.trackToolCall(
        agentId,
        event.toolName,
        event.params,
        event.result,
        event.error,
        config.memory,
      );

      // Check if tool modifies files -> trigger checkpoint
      // (Full implementation uses isFileModifyingTool from config)
    } catch (err) {
      logger.warn('Tool call tracking failed:', err.message);
    }
  }

  // ── 2. 挣扎检测（信息素感知）/ Struggle detection (pheromone-aware) ──
  // [WHY] 连续失败 >= 阈值时，先检查 ALARM 信息素密度：
  //       >=2 个 ALARM → 系统性问题（如 API 挂了），不发 RECRUIT
  //       <2 个 ALARM → 个体挣扎，发射 RECRUIT 信息素请求帮助
  // If consecutive failures >= threshold, check ALARM pheromone density:
  // >=2 ALARMs = systemic issue (e.g. API down), skip RECRUIT
  // <2 ALARMs = individual struggle, emit RECRUIT pheromone for help
  if (config.collaboration?.enabled && engines.struggleDetector) {
    try {
      const isSuccess = !event.error;
      const result = engines.struggleDetector.recordAndCheck(
        agentId, event.toolName, isSuccess, event.error
      );

      if (result.struggling) {
        // 信息素感知二次判断 / Pheromone-aware second-pass check
        const isRealStruggle = engines.struggleDetector.isStruggling(
          agentId, result.failureCount, engines.pheromone || null
        );
        if (isRealStruggle) {
          engines.struggleDetector.handleStruggle(
            agentId, engines.pheromone || null, event.toolName, logger
          );
        } else {
          logger.debug(`Agent ${agentId} failing but ALARM density suggests systemic issue — skipping RECRUIT`);
        }
      }
    } catch (err) {
      logger.warn('Struggle detection failed:', err.message);
    }
  }

  // ── 3. 治理能力评估 / Governance capability evaluation ─────────────
  // [WHY] 每次工具调用的成功/失败是能力评分的微观输入。
  //       通过 evaluationQueue 异步批量处理，避免阻塞 hook。
  // Each tool call success/failure is micro-input for capability scoring.
  // Processed asynchronously via evaluationQueue to avoid blocking.
  if (config.governance?.enabled && engines.capabilityEngine) {
    try {
      engines.capabilityEngine.evaluateTaskCompletion(agentId, {
        id: `tool-${event.toolName}-${Date.now()}`,
        type: 'backend',
      }, {
        quality: event.error ? 0.2 : 0.7,
        helpedOthers: false,
        hasInnovation: false,
      });
    } catch (err) {
      logger.warn('Governance tool evaluation failed:', err.message);
    }
  }
}
