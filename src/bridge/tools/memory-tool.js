// R8 Bridge - swarm_memory tool
// Semantic memory operations: search, record, forget, stats, export

function toolResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResponse(error) {
  return toolResponse({ status: 'error', error: String(error) });
}

/**
 * createMemoryTool - Factory for the swarm_memory tool
 *
 * Provides full CRUD operations on the intelligence domain's memory store.
 * Supports semantic search, recording new entries, selective forgetting,
 * statistics, and bulk export.
 *
 * Dependencies:
 *   core.intelligence - MemoryStore for persistence and search
 *   core.field        - Signal emission for memory events
 */
export function createMemoryTool({ core, quality, sessionBridge, spawnClient }) {
  return {
    name: 'swarm_memory',
    description: [
      'Swarm episodic memory — store and retrieve learned experiences.',
      '',
      'Actions:',
      '  search — Find relevant memories by query',
      '  record — Store a new experience/lesson',
      '  forget — Remove a memory by ID',
      '  stats — Memory usage statistics',
      '  export — Export all memories as JSON',
    ].join('\n'),

    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['search', 'record', 'forget', 'stats', 'export'],
          description: 'Memory action to perform',
        },
        query: {
          type: 'string',
          description: 'Search query (for search action)',
        },
        content: {
          type: 'string',
          description: 'Content to store (for record action)',
        },
        type: {
          type: 'string',
          description: 'Memory entry type (e.g., fact, decision, lesson, pattern)',
        },
        memoryId: {
          type: 'string',
          description: 'Memory entry ID (for forget action)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization (for record action)',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 20)',
        },
      },
      required: ['action'],
    },

    async execute(toolCallId, params) {
      try {
        const { action } = params;
        const scope = sessionBridge?.getCurrentScope?.() ?? 'default';
        const memory = core?.intelligence;

        switch (action) {
          case 'search': {
            const { query, type, limit } = params;
            if (!query) {
              return errorResponse('query is required for search action');
            }

            const maxResults = limit || 20;
            let results = [];

            results = await memory?.searchMemory?.(query, {
              type,
              scope,
              limit: maxResults,
            }) ?? [];

            return toolResponse({
              status: 'ok',
              action: 'search',
              query,
              count: results.length,
              entries: (Array.isArray(results) ? results : []).slice(0, maxResults).map(r => ({
                id: r.id,
                type: r.type,
                content: r.content,
                relevance: r.relevance || r.score,
                tags: r.tags || [],
                source: r.source,
                createdAt: r.createdAt,
              })),
            });
          }

          case 'record': {
            const { content, type, tags } = params;
            if (!content) {
              return errorResponse('content is required for record action');
            }

            const entryId = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const entry = {
              id: entryId,
              type: type || 'general',
              content,
              tags: tags || [],
              scope,
              source: 'bridge',
              createdAt: Date.now(),
            };

            await memory?.recordMemory?.(entry);

            core?.bus?.publish?.('memory.recorded', {
              memoryId: entryId,
              type: entry.type,
              scope,
              timestamp: entry.createdAt,
            }, 'swarm-memory');

            return toolResponse({
              status: 'recorded',
              memoryId: entryId,
              type: entry.type,
              tags: entry.tags,
              contentLength: content.length,
            });
          }

          case 'forget': {
            const { memoryId } = params;
            if (!memoryId) {
              return errorResponse('memoryId is required for forget action');
            }

            const deleted = await memory?.forgetMemory?.(memoryId);

            core?.bus?.publish?.('memory.forgotten', {
              memoryId,
              scope,
              timestamp: Date.now(),
            }, 'swarm-memory');

            return toolResponse({
              status: deleted ? 'forgotten' : 'not_found',
              memoryId,
            });
          }

          case 'stats': {
            let stats = {
              totalEntries: 0,
              byType: {},
              oldestEntry: null,
              newestEntry: null,
            };

            stats = await memory?.getMemoryStats?.({ scope }) ?? stats;

            return toolResponse({
              status: 'ok',
              action: 'stats',
              scope,
              totalEntries: stats.totalEntries || 0,
              byType: stats.byType || {},
              oldestEntry: stats.oldestEntry || null,
              newestEntry: stats.newestEntry || null,
              storageUsed: stats.storageUsed || 0,
            });
          }

          case 'export': {
            const { type, limit } = params;
            const maxExport = limit || 100;
            let entries = [];

            entries = await memory?.exportMemory?.({ type, scope, limit: maxExport }) ?? [];

            return toolResponse({
              status: 'ok',
              action: 'export',
              scope,
              count: Array.isArray(entries) ? entries.length : 0,
              entries: (Array.isArray(entries) ? entries : []).slice(0, maxExport).map(e => ({
                id: e.id,
                type: e.type,
                content: e.content,
                tags: e.tags || [],
                createdAt: e.createdAt,
              })),
            });
          }

          default:
            return errorResponse(`Unknown memory action: ${action}`);
        }
      } catch (err) {
        return errorResponse(`swarm_memory execution failed: ${err.message}`);
      }
    },
  };
}
