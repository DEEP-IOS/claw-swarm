/**
 * before_agent_start Hook — Agent 启动前钩子
 *
 * 统一的 Agent 启动前上下文注入：
 * 1. 记忆上下文（来自 OME buildPrependContext）
 * 2. 同伴目录（来自 api.config.agents）
 * 3. 信息素快照（当前活跃信号）
 *
 * Unified pre-start context injection:
 * 1. Memory context (from OME buildPrependContext)
 * 2. Peer directory (from api.config.agents)
 * 3. Pheromone snapshot (current active signals)
 *
 * [WHY] 三种上下文通过 prependContext 合并注入，
 * 不会因上下文压缩而丢失（每次启动都重新注入）。
 * All three contexts merged via prependContext,
 * never lost to context compaction (re-injected every start).
 *
 * @module hooks/before-agent-start
 * @author DEEP-IOS
 */
export function handleBeforeAgentStart(event, ctx, engines, config, logger, api) {
  const parts = [];
  const agentId = resolveAgentId(event, ctx, config);

  // 1. Memory context
  if (config.memory?.enabled && engines.buildPrependContext) {
    try {
      const memoryContext = engines.buildPrependContext(agentId, config);
      if (memoryContext) parts.push(memoryContext);
    } catch (err) {
      logger.warn('Memory context injection failed:', err.message);
    }
  }

  // 2. Peer directory (lazy-read from api.config)
  if (config.collaboration?.enabled && api?.config?.agents) {
    try {
      const peers = (api.config.agents || []).filter(a => a.id !== agentId);
      if (peers.length > 0) {
        const peerLines = peers.map(p =>
          `- ${p.id} (${p.label || p.name || 'agent'}): ${(p.skills || []).join(', ') || 'general'}`
        );
        parts.push(`[Peer Directory]\n${peerLines.join('\n')}`);
      }
    } catch (err) {
      logger.warn('Peer directory injection failed:', err.message);
    }
  }

  // 3. Pheromone snapshot
  if (config.pheromone?.enabled && engines.pheromone) {
    try {
      const scopes = ['/global', `/agent/${agentId}`];
      const snapshot = engines.pheromone.buildSnapshot(agentId, scopes);
      if (snapshot) parts.push(snapshot);
    } catch (err) {
      logger.warn('Pheromone snapshot injection failed:', err.message);
    }
  }

  if (parts.length > 0) {
    return { prependContext: parts.join('\n\n') };
  }
}

// Simple agent ID resolution (inline, doesn't need full OME resolver for now)
function resolveAgentId(event, ctx, config) {
  if (ctx?.agentId) return ctx.agentId;
  if (event?.agentId) return event.agentId;
  return config.memory?.agentResolution?.defaultAgentId || 'main';
}
