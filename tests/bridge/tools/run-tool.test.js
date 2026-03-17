import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRunTool } from '../../../src/bridge/tools/run-tool.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function parse(resp) {
  return JSON.parse(resp.content[0].text);
}

function makeDeps(overrides = {}) {
  return {
    core: {
      orchestration: {
        routeTask: vi.fn(() => null), // System 2 by default
        createPlan: vi.fn(() => ({
          dagId: 'dag-test',
          suggestedRole: 'implementer',
          summary: 'test plan',
          timeBudgetMs: 300000,
        })),
        adviseSpawn: vi.fn(() => ({
          role: 'implementer',
          reason: 'best fit',
          parallelism: 1,
        })),
        selectTools: vi.fn(() => ['bash', 'file_read']),
      },
      intelligence: {
        classifyIntent: vi.fn(() => ({ type: 'code', confidence: 0.85, keywords: ['build'] })),
        buildPrompt: vi.fn(() => 'full-prompt'),
      },
      field: { emit: vi.fn() },
    },
    quality: {
      checkImmunity: vi.fn(() => ({ immune: false, preventionPrompts: [], riskScore: 0 })),
      startPipelineTracking: vi.fn(),
    },
    sessionBridge: {
      getCurrentScope: vi.fn(() => 'project-scope'),
    },
    spawnClient: {
      spawn: vi.fn(async () => 'agent-abc'),
      cancel: vi.fn(async () => ({ detail: 'cancelled' })),
      resume: vi.fn(async () => ({ detail: 'resumed' })),
    },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('createRunTool (swarm_run)', () => {
  let deps;
  let tool;

  beforeEach(() => {
    deps = makeDeps();
    tool = createRunTool(deps);
  });

  // ── Structure ───────────────────────────────────────────────────────

  describe('tool structure', () => {
    it('returns object with name, parameters, execute', () => {
      expect(tool.name).toBe('swarm_run');
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    });

    it('parameters is valid JSON schema (type object with properties)', () => {
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties).toBeDefined();
      expect(tool.parameters.properties.task).toBeDefined();
    });

    it('task is required', () => {
      expect(tool.parameters.required).toContain('task');
    });
  });

  // ── Direct reply (System 1) ─────────────────────────────────────────

  describe('direct_reply (System 1 fast path)', () => {
    it('returns direct_reply when router picks system 1', async () => {
      deps.core.orchestration.routeTask = vi.fn(() => ({
        system: 1,
        answer: '42',
        confidence: 0.95,
      }));
      const resp = await tool.execute('tc-1', { task: 'what is 6*7' });
      const data = parse(resp);
      expect(data.status).toBe('direct_reply');
      expect(data.answer).toBe('42');
      expect(data.system).toBe(1);
    });

    it('skips direct_reply if role is explicitly set', async () => {
      deps.core.orchestration.routeTask = vi.fn(() => ({ system: 1, answer: 'x' }));
      const resp = await tool.execute('tc-2', { task: 'do something', role: 'researcher' });
      const data = parse(resp);
      expect(data.status).toBe('dispatched');
    });
  });

  // ── Full spawn flow (System 2) ──────────────────────────────────────

  describe('full spawn flow', () => {
    it('dispatches agent and returns dispatched status', async () => {
      const resp = await tool.execute('tc-3', { task: 'implement feature X' });
      const data = parse(resp);
      expect(data.status).toBe('dispatched');
      expect(data.agentId).toBe('agent-abc');
      expect(data.role).toBe('implementer');
      expect(data.dagId).toBe('dag-test');
    });

    it('calls spawnClient.spawn with correct options', async () => {
      await tool.execute('tc-4', { task: 'build module' });
      const opts = deps.spawnClient.spawn.mock.calls[0][0];
      expect(opts.role).toBe('implementer');
      expect(opts.prompt).toBe('full-prompt');
      expect(opts.scope).toBe('project-scope');
    });

    it('starts pipeline tracking', async () => {
      await tool.execute('tc-5', { task: 'build module' });
      expect(deps.quality.startPipelineTracking).toHaveBeenCalledWith('dag-test', 300000);
    });

    it('emits agent.spawned field signal', async () => {
      await tool.execute('tc-6', { task: 'build module' });
      expect(deps.core.field.emit).toHaveBeenCalledWith('agent.spawned', expect.objectContaining({ agentId: 'agent-abc' }));
    });
  });

  // ── Cancel branch ───────────────────────────────────────────────────

  describe('cancel', () => {
    it('calls spawnClient.cancel and returns cancelled status', async () => {
      const resp = await tool.execute('tc-7', { task: '', cancel: 'agent-xyz' });
      const data = parse(resp);
      expect(data.status).toBe('cancelled');
      expect(data.agentId).toBe('agent-xyz');
    });

    it('returns error when spawnClient has no cancel', async () => {
      deps.spawnClient = {};
      tool = createRunTool(deps);
      const resp = await tool.execute('tc-8', { task: '', cancel: 'agent-xyz' });
      const data = parse(resp);
      expect(data.status).toBe('error');
    });
  });

  // ── Resume branch ───────────────────────────────────────────────────

  describe('resume', () => {
    it('calls spawnClient.resume and returns resumed status', async () => {
      const resp = await tool.execute('tc-9', { task: '', resume: 'agent-xyz' });
      const data = parse(resp);
      expect(data.status).toBe('resumed');
      expect(data.agentId).toBe('agent-xyz');
    });
  });

  // ── Missing / invalid task ──────────────────────────────────────────

  describe('missing task', () => {
    it('returns error when task is empty string', async () => {
      const resp = await tool.execute('tc-10', { task: '' });
      const data = parse(resp);
      expect(data.status).toBe('error');
    });

    it('returns error when task is whitespace-only', async () => {
      const resp = await tool.execute('tc-11', { task: '   ' });
      const data = parse(resp);
      expect(data.status).toBe('error');
    });
  });

  // ── Response format ─────────────────────────────────────────────────

  describe('response format', () => {
    it('always returns { content: [{ type: "text", text: ... }] }', async () => {
      const resp = await tool.execute('tc-12', { task: 'hello' });
      expect(resp).toHaveProperty('content');
      expect(Array.isArray(resp.content)).toBe(true);
      expect(resp.content[0].type).toBe('text');
      expect(typeof resp.content[0].text).toBe('string');
    });

    it('returns error when spawnClient is unavailable', async () => {
      deps.spawnClient = {};
      tool = createRunTool(deps);
      const resp = await tool.execute('tc-13', { task: 'build it' });
      const data = parse(resp);
      expect(data.status).toBe('error');
      expect(data.error).toContain('SpawnClient');
    });
  });
});
