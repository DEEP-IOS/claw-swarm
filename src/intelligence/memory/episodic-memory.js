/**
 * EpisodicMemory — 情景记忆：记录、检索和整合代理任务经历
 * Episodic memory: records, retrieves, and consolidates agent task episodes
 *
 * 每个 episode 代表一次完整的任务执行经历，包含目标、动作、结果和教训。
 * 通过向量索引实现语义检索，通过整合 (consolidate) 提取最佳实践和反模式。
 *
 * Each episode represents a complete task execution experience including goal,
 * actions, outcome, and lessons learned. Semantic retrieval is enabled via
 * vector indexing; consolidation extracts best practices and anti-patterns.
 *
 * @module intelligence/memory/episodic-memory
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js';
import { DIM_KNOWLEDGE } from '../../core/field/types.js';

// --- Constants -----------------------------------------------------------
const COLLECTION_EPISODES     = 'episodes';
const COLLECTION_CONSOLIDATED = 'consolidated';
const MAX_ACTIONS = 8;

function clampQuality(value, fallback) {
  const numeric = typeof value === 'number' ? value : fallback;
  return Math.max(0, Math.min(1, numeric));
}

function truncateText(value, max = 120) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

function normalizeOutcome(result) {
  if (result?.outcome === 'failure' || result?.success === false) return 'failure';
  if (result?.outcome === 'partial' || result?.partial === true) return 'partial';
  return 'success';
}

function extractActions(sessionHistory = []) {
  const actions = [];

  for (const entry of sessionHistory) {
    if (!entry) continue;

    const label = entry.tool || entry.action || entry.type || entry.name || '';
    const detail = truncateText(
      entry.content
      || entry.summary
      || entry.message
      || entry.result
      || '',
      80,
    );

    const combined = [label, detail].filter(Boolean).join(': ');
    if (combined) {
      actions.push(combined);
    }

    if (actions.length >= MAX_ACTIONS) break;
  }

  return actions;
}

// --- EpisodicMemory ------------------------------------------------------
export class EpisodicMemory extends ModuleBase {
  static produces()   { return [DIM_KNOWLEDGE]; }
  static consumes()   { return []; }
  static publishes()  { return ['memory.episode.recorded', 'memory.consolidated']; }
  static subscribes() { return ['agent.lifecycle.completed']; }

  /**
   * @param {object} opts
   * @param {import('../../core/store/domain-store.js').DomainStore} opts.domainStore
   * @param {import('../../core/field/signal-store.js').SignalStore} opts.field
   * @param {import('../../core/bus/event-bus.js').EventBus} opts.eventBus
   * @param {import('./embedding-engine.js').EmbeddingEngine} opts.embeddingEngine
   * @param {import('./vector-index.js').VectorIndex} opts.vectorIndex
   */
  constructor({ domainStore, field, eventBus, embeddingEngine, vectorIndex }) {
    super();
    this._domainStore     = domainStore;
    this._field           = field;
    this._eventBus        = eventBus;
    this._embeddingEngine = embeddingEngine;
    this._vectorIndex     = vectorIndex;
    this._unsubscribers   = [];
  }

  async start() {
    if (this._unsubscribers.length > 0) return;
    const subscribe = this._eventBus?.subscribe?.bind(this._eventBus);
    if (!subscribe) return;

    const onCompleted = (envelope) => {
      void this._recordFromLifecycle(envelope?.data ?? envelope);
    };

    const unsubscribe = subscribe('agent.lifecycle.completed', onCompleted);
    this._unsubscribers.push(
      typeof unsubscribe === 'function'
        ? unsubscribe
        : () => this._eventBus?.unsubscribe?.('agent.lifecycle.completed', onCompleted),
    );
  }

  async stop() {
    for (const unsubscribe of this._unsubscribers.splice(0)) {
      unsubscribe?.();
    }
  }

  // --- Core Methods -------------------------------------------------------

  /**
   * 记录一条情景记忆 / Record an episode
   *
   * @param {object} episode
   * @param {string} episode.id
   * @param {string} episode.taskId
   * @param {string} episode.role
   * @param {string} episode.goal
   * @param {string[]} episode.actions
   * @param {'success'|'partial'|'failure'} episode.outcome
   * @param {number} episode.quality      - [0, 1]
   * @param {string} episode.sessionId
   * @param {string[]} [episode.tags]
   * @param {string[]} [episode.lessons]
   * @returns {Promise<void>}
   */
  async record(episode) {
    // 1. Generate embedding vector
    const textForEmbedding = episode.goal + ' ' + episode.actions.join(' ');
    const embedding = await this._embeddingEngine.embed(textForEmbedding);

    // 2. Persist to DomainStore
    const storedEpisode = {
      ...episode,
      embedding,
      tags:       episode.tags     || [],
      lessons:    episode.lessons  || [],
      recordedAt: episode.recordedAt || Date.now(),
    };
    this._domainStore.put(COLLECTION_EPISODES, episode.id, storedEpisode);

    // 3. Index embedding in VectorIndex
    this._vectorIndex.add(episode.id, embedding);

    // 4. Emit knowledge dimension signal
    this._field.emit({
      dimension: DIM_KNOWLEDGE,
      scope:     episode.sessionId,
      strength:  episode.quality * 0.5,
      emitterId: 'episodic-memory',
      metadata:  { episodeId: episode.id, outcome: episode.outcome },
    });

    // 5. Publish event
    this._eventBus.publish('memory.episode.recorded', {
      episodeId: episode.id,
      taskId:    episode.taskId,
      role:      episode.role,
    });
  }

  /**
   * 语义检索情景记忆 / Semantic search for episodes
   *
   * @param {string} text         - query text
   * @param {object} [options]
   * @param {number} [options.topK=5]
   * @param {number} [options.minQuality=0]
   * @param {string} [options.role]
   * @param {string} [options.outcome]
   * @param {number} [options.maxAge]       - max age in ms
   * @returns {Promise<Array>} Episode[]
   */
  async query(text, options = {}) {
    const { topK = 5, minQuality = 0, role, outcome, maxAge } = options;

    // 1. Vector search for candidates (over-fetch for filtering headroom)
    const queryEmbedding = await this._embeddingEngine.embed(text);
    const vectorResults  = this._vectorIndex.search(queryEmbedding, topK * 3);

    // 2. Fetch full episodes and apply filters
    const now = Date.now();
    const filtered = [];

    for (const { id } of vectorResults) {
      const ep = this._domainStore.get(COLLECTION_EPISODES, id);
      if (!ep) continue;
      if (ep.quality < minQuality) continue;
      if (role    && ep.role    !== role)    continue;
      if (outcome && ep.outcome !== outcome) continue;
      if (maxAge  && (now - ep.recordedAt) > maxAge) continue;
      filtered.push(ep);
    }

    // 3. Truncate to topK
    return filtered.slice(0, topK);
  }

  /**
   * 整合会话经验 / Consolidate session experiences
   * Extracts best practices from successes and anti-patterns from failures.
   *
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async consolidate(sessionId) {
    // 1. Retrieve all episodes for this session
    const allEpisodes = this._domainStore.query(
      COLLECTION_EPISODES,
      (ep) => ep.sessionId === sessionId
    ) || [];

    if (allEpisodes.length === 0) return;

    // 2. Success episodes -> best practices
    const successes     = allEpisodes.filter((ep) => ep.outcome === 'success');
    const bestPractices = this._extractCommonPatterns(successes);

    // 3. Failure episodes -> anti-patterns
    const failures     = allEpisodes.filter((ep) => ep.outcome === 'failure');
    const antiPatterns = this._extractCommonPatterns(failures);

    // 4. Persist consolidated results
    this._domainStore.put(COLLECTION_CONSOLIDATED, sessionId, {
      sessionId,
      bestPractices,
      antiPatterns,
      episodeCount:   allEpisodes.length,
      successCount:   successes.length,
      failureCount:   failures.length,
      consolidatedAt: Date.now(),
    });

    // 5. Publish consolidation event
    this._eventBus.publish('memory.consolidated', { sessionId });
  }

  /**
   * 获取整合结果 / Get consolidated results for a session
   * @param {string} sessionId
   * @returns {object|undefined}
   */
  getConsolidated(sessionId) {
    return this._domainStore.get(COLLECTION_CONSOLIDATED, sessionId);
  }

  /**
   * 统计信息 / Aggregate statistics
   * @returns {{ totalEpisodes: number, successRate: number, topTags: string[], averageQuality: number }}
   */
  stats() {
    const all   = this._domainStore.query(COLLECTION_EPISODES, () => true) || [];
    const total = all.length;

    if (total === 0) {
      return { totalEpisodes: 0, successRate: 0, topTags: [], averageQuality: 0 };
    }

    const successes      = all.filter((ep) => ep.outcome === 'success').length;
    const successRate    = successes / total;
    const averageQuality = all.reduce((sum, ep) => sum + ep.quality, 0) / total;

    // Count tag frequencies
    const tagCounts = new Map();
    for (const ep of all) {
      for (const tag of (ep.tags || [])) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);

    return { totalEpisodes: total, successRate, topTags, averageQuality };
  }

  // --- Internal Helpers ---------------------------------------------------

  /**
   * 从 episodes 中提取共同 tags 和 lessons
   * Extract common tags and lessons from a set of episodes
   * @param {Array} episodes
   * @returns {{ tags: string[], lessons: string[] }}
   * @private
   */
  _extractCommonPatterns(episodes) {
    const tagCounts    = new Map();
    const lessonCounts = new Map();

    for (const ep of episodes) {
      for (const tag of (ep.tags || [])) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
      for (const lesson of (ep.lessons || [])) {
        lessonCounts.set(lesson, (lessonCounts.get(lesson) || 0) + 1);
      }
    }

    // Keep items appearing >= 2 times, or all if total episodes <= 2
    const threshold = episodes.length <= 2 ? 1 : 2;

    const tags = [...tagCounts.entries()]
      .filter(([, c]) => c >= threshold)
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);

    const lessons = [...lessonCounts.entries()]
      .filter(([, c]) => c >= threshold)
      .sort((a, b) => b[1] - a[1])
      .map(([l]) => l);

    return { tags, lessons };
  }

  async _recordFromLifecycle(payload) {
    if (!payload?.agentId) return;

    const result = payload.result || {};
    const outcome = normalizeOutcome(result);
    const actions = extractActions(result.sessionHistory);
    const quality = clampQuality(
      result.quality
      ?? result.qualityScore
      ?? result.score
      ?? result.audit?.score,
      outcome === 'success' ? 0.8 : outcome === 'partial' ? 0.5 : 0.2,
    );

    const tags = [...new Set([
      ...(Array.isArray(result.tags) ? result.tags : []),
      payload.roleId || payload.role || null,
      payload.dagId ? 'dag' : null,
    ].filter(Boolean))];

    const lessons = Array.isArray(result.lessons)
      ? result.lessons.map((lesson) => truncateText(lesson, 140)).filter(Boolean)
      : (outcome === 'failure' && result.error
        ? [truncateText(`Failure: ${result.error}`, 140)]
        : []);

    const goal = truncateText(
      payload.task
      || result.goal
      || result.task
      || result.summary
      || result.content
      || result.output
      || payload.taskId
      || `Agent ${payload.agentId} completed work`,
      240,
    );

    const episode = {
      id: result.episodeId || `ep-${payload.agentId}-${Date.now()}`,
      taskId: payload.taskId || result.taskId || payload.agentId,
      role: payload.roleId || payload.role || 'generalist',
      goal,
      actions: actions.length > 0 ? actions : [truncateText(payload.taskId || payload.agentId, 80)],
      outcome,
      quality,
      sessionId: payload.sessionId || result.sessionId || payload.dagId || 'global',
      tags,
      lessons,
      recordedAt: result.completedAt || Date.now(),
    };

    await this.record(episode);
  }
}

export default EpisodicMemory;
