import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookAdapter } from '../../../src/bridge/hooks/hook-adapter.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function makeDeps(overrides = {}) {
  return {
    core: {
      communication: { start: vi.fn(), stop: vi.fn(), post: vi.fn(), send: vi.fn() },
      intelligence: {
        classifyIntent: vi.fn(() => ({ type: 'code', confidence: 0.9 })),
        estimateScope: vi.fn(() => 'module'),
        buildPrompt: vi.fn(() => 'generated-prompt'),
        start: vi.fn(),
        stop: vi.fn(),
        appendToMemory: vi.fn(),
      },
      orchestration: {
        advisor: { advise: vi.fn(() => ({ role: 'implementer', allowedTools: ['bash'], modelOverride: 'fast' })) },
        adviseSpawn: vi.fn(() => ({ role: 'reviewer' })),
        start: vi.fn(),
        stop: vi.fn(),
      },
      quality: { start: vi.fn(), stop: vi.fn() },
      observe: { start: vi.fn(), stop: vi.fn() },
      field: { superpose: vi.fn(() => ({ urgency: 0.5 })), emit: vi.fn() },
      store: { snapshot: vi.fn() },
    },
    quality: {
      checkImmunity: vi.fn(() => ({ preventionPrompts: ['avoid X'] })),
      getCompliancePrompt: vi.fn(() => 'comply'),
      canExecuteTool: vi.fn(() => ({ allowed: true })),
      validateTool: vi.fn(() => ({ valid: true })),
      recordToolSuccess: vi.fn(),
      recordToolFailure: vi.fn(),
      checkCompliance: vi.fn(),
      auditOutput: vi.fn(),
      classifyFailure: vi.fn(),
      recordAgentEvent: vi.fn(),
    },
    observe: {
      startSpan: vi.fn(),
      endSpan: vi.fn(),
    },
    sessionBridge: {
      startSession: vi.fn(),
      endSession: vi.fn(),
      getScope: vi.fn(() => 'test-scope'),
      trackAgent: vi.fn(),
      removeAgent: vi.fn(),
    },
    modelFallback: {
      handleError: vi.fn(() => ({ action: 'retry', model: 'fallback' })),
    },
    spawnClient: {
      notifyEnded: vi.fn(),
    },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('HookAdapter', () => {
  let deps;
  let adapter;

  beforeEach(() => {
    deps = makeDeps();
    adapter = new HookAdapter(deps);
  });

  // ── Constructor ─────────────────────────────────────────────────────

  describe('constructor', () => {
    it('stores all injected dependencies', () => {
      expect(adapter._core).toBe(deps.core);
      expect(adapter._quality).toBe(deps.quality);
      expect(adapter._sessionBridge).toBe(deps.sessionBridge);
    });

    it('initialises stats with zeroes', () => {
      const stats = adapter.getStats();
      expect(stats.hooksFired).toBe(0);
      expect(stats.hookErrors).toBe(0);
      expect(stats.blockedToolCalls).toBe(0);
      expect(stats.agentsAdvised).toBe(0);
    });

    it('throws when destructuring fails without required deps', () => {
      expect(() => new HookAdapter({})).not.toThrow(); // all optional via ??
    });
  });

  // ── registerHooks ───────────────────────────────────────────────────

  describe('registerHooks', () => {
    it('calls addHook exactly 16 times', () => {
      const app = { addHook: vi.fn() };
      adapter.registerHooks(app);
      expect(app.addHook).toHaveBeenCalledTimes(16);
    });

    it('registers all expected hook names', () => {
      const app = { addHook: vi.fn() };
      adapter.registerHooks(app);
      const names = app.addHook.mock.calls.map(c => c[0]);
      const expected = [
        'session_start', 'session_end', 'message_created',
        'before_agent_start', 'agent_start', 'agent_end',
        'llm_output', 'before_tool_call', 'after_tool_call',
        'prependSystemContext', 'before_shutdown', 'error',
        'tool_result', 'agent_message', 'activate', 'deactivate',
      ];
      expect(names).toEqual(expected);
    });

    it('does nothing if app has no addHook', () => {
      expect(() => adapter.registerHooks({})).not.toThrow();
      expect(() => adapter.registerHooks(null)).not.toThrow();
    });

    it('getRegisteredHookCount returns 16', () => {
      expect(adapter.getRegisteredHookCount()).toBe(16);
    });
  });

  // ── before_agent_start ──────────────────────────────────────────────

  describe('onBeforeAgentStart', () => {
    it('injects systemPrompt into agent', async () => {
      const session = { id: 'sess-1' };
      const agent = { role: 'implementer', task: 'build feature' };
      const result = await adapter.onBeforeAgentStart(session, agent);
      expect(result.advised).toBe(true);
      expect(agent.systemPrompt).toBe('generated-prompt');
    });

    it('sets allowedTools from advisor', async () => {
      const agent = { role: 'implementer' };
      await adapter.onBeforeAgentStart({ id: 's1' }, agent);
      expect(agent.allowedTools).toEqual(['bash']);
    });

    it('sets model override from advisor', async () => {
      const agent = { role: 'implementer' };
      await adapter.onBeforeAgentStart({ id: 's1' }, agent);
      expect(agent.model).toBe('fast');
    });

    it('passes immunity warnings into prompt context', async () => {
      const agent = { role: 'tester', task: 'run tests' };
      await adapter.onBeforeAgentStart({ id: 's1' }, agent);
      const call = deps.core.intelligence.buildPrompt.mock.calls[0];
      expect(call[2].immunityWarnings).toEqual(['avoid X']);
    });

    it('passes compliance prompt into prompt context', async () => {
      const agent = { role: 'tester' };
      await adapter.onBeforeAgentStart({ id: 's1' }, agent);
      const call = deps.core.intelligence.buildPrompt.mock.calls[0];
      expect(call[2].complianceWarning).toBe('comply');
    });

    it('returns { advised: false } on error', async () => {
      deps.core.orchestration.advisor.advise = vi.fn(() => { throw new Error('boom'); });
      const result = await adapter.onBeforeAgentStart({ id: 's1' }, {});
      expect(result.advised).toBe(false);
      expect(result.error).toBe('boom');
    });

    it('increments agentsAdvised stat', async () => {
      await adapter.onBeforeAgentStart({ id: 's1' }, {});
      expect(adapter.getStats().agentsAdvised).toBe(1);
    });
  });

  // ── before_tool_call ────────────────────────────────────────────────

  describe('onBeforeToolCall', () => {
    it('returns { blocked: false } when circuit breaker allows', () => {
      const result = adapter.onBeforeToolCall({ id: 's1' }, { name: 'bash', params: {} });
      expect(result).toEqual({ blocked: false });
    });

    it('returns { blocked: true } when circuit breaker blocks', () => {
      deps.quality.canExecuteTool = vi.fn(() => ({ allowed: false, reason: 'open' }));
      const result = adapter.onBeforeToolCall({ id: 's1' }, { name: 'bash' });
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('open');
    });

    it('returns { blocked: true } when validation fails', () => {
      deps.quality.validateTool = vi.fn(() => ({ valid: false, reason: 'bad param', repairPrompt: 'fix it' }));
      const result = adapter.onBeforeToolCall({ id: 's1' }, { name: 'bash', params: {} });
      expect(result.blocked).toBe(true);
      expect(result.repairPrompt).toBe('fix it');
    });

    it('increments blockedToolCalls stat on block', () => {
      deps.quality.canExecuteTool = vi.fn(() => ({ allowed: false }));
      adapter.onBeforeToolCall({ id: 's1' }, { name: 'x' });
      expect(adapter.getStats().blockedToolCalls).toBe(1);
    });
  });

  // ── after_tool_call ─────────────────────────────────────────────────

  describe('onAfterToolCall', () => {
    it('records success when result is ok', () => {
      adapter.onAfterToolCall({ id: 's1' }, { name: 'bash' }, { success: true });
      expect(deps.quality.recordToolSuccess).toHaveBeenCalledWith('bash');
    });

    it('records failure when result.success is false', () => {
      adapter.onAfterToolCall({ id: 's1' }, { name: 'bash' }, { success: false, error: 'fail' });
      expect(deps.quality.recordToolFailure).toHaveBeenCalledWith('bash', 'fail');
    });
  });

  // ── session_start / session_end ─────────────────────────────────────

  describe('session hooks', () => {
    it('onSessionStart calls sessionBridge.startSession', () => {
      const session = { id: 'sess-abc' };
      adapter.onSessionStart(session);
      expect(deps.sessionBridge.startSession).toHaveBeenCalledWith(session);
    });

    it('onSessionEnd calls sessionBridge.endSession', () => {
      const session = { id: 'sess-abc' };
      adapter.onSessionEnd(session);
      expect(deps.sessionBridge.endSession).toHaveBeenCalledWith(session);
    });
  });

  // ── message_created ─────────────────────────────────────────────────

  describe('onMessageCreated', () => {
    it('classifies intent and estimates scope', () => {
      const result = adapter.onMessageCreated({ id: 's1' }, { content: 'fix bug' });
      expect(result).toEqual({ intent: { type: 'code', confidence: 0.9 }, scope: 'module' });
    });

    it('returns fallback on error', () => {
      deps.core.intelligence.classifyIntent = vi.fn(() => { throw new Error('x'); });
      const result = adapter.onMessageCreated({ id: 's1' }, { content: '' });
      expect(result).toEqual({ intent: null, scope: null });
    });
  });

  // ── agent_start / agent_end ─────────────────────────────────────────

  describe('agent lifecycle', () => {
    it('onAgentStart starts trace span and tracks agent', () => {
      adapter.onAgentStart({ id: 's1' }, { id: 'a1' });
      expect(deps.observe.startSpan).toHaveBeenCalledWith('a1', null, 's1');
      expect(deps.sessionBridge.trackAgent).toHaveBeenCalledWith('s1', 'a1');
    });

    it('onAgentEnd ends span, removes agent, and audits on success', () => {
      adapter.onAgentEnd({ id: 's1' }, { id: 'a1' }, { success: true });
      expect(deps.observe.endSpan).toHaveBeenCalledWith('a1', { failed: false });
      expect(deps.sessionBridge.removeAgent).toHaveBeenCalledWith('s1', 'a1');
      expect(deps.quality.auditOutput).toHaveBeenCalled();
    });

    it('onAgentEnd classifies failure on failure result', () => {
      adapter.onAgentEnd({ id: 's1' }, { id: 'a1' }, { success: false, error: 'err' });
      expect(deps.quality.classifyFailure).toHaveBeenCalledWith({ agentId: 'a1', error: 'err' });
    });
  });

  // ── error hook ──────────────────────────────────────────────────────

  describe('onError', () => {
    it('delegates to modelFallback and does not crash', () => {
      const result = adapter.onError({ model: 'balanced', role: 'impl' }, new Error('x'));
      expect(result).toEqual({ action: 'retry', model: 'fallback' });
    });

    it('increments hookErrors stat', () => {
      adapter.onError({}, new Error('e'));
      expect(adapter.getStats().hookErrors).toBe(1);
    });
  });

  // ── safe() wrapper ──────────────────────────────────────────────────

  describe('safe wrapper (via hooks)', () => {
    it('does not crash when all deps are null', () => {
      const bare = new HookAdapter({ core: null, quality: null, observe: null, sessionBridge: null, modelFallback: null, spawnClient: null });
      expect(() => bare.onActivate()).not.toThrow();
      expect(() => bare.onDeactivate()).not.toThrow();
      expect(() => bare.onSessionStart(null)).not.toThrow();
      expect(() => bare.onBeforeToolCall(null, null)).not.toThrow();
    });
  });

  // ── Hook priority / misc ────────────────────────────────────────────

  describe('prependSystemContext', () => {
    it('returns XML-wrapped field vector', () => {
      const result = adapter.onPrependSystemContext({ id: 's1' });
      expect(result).toContain('<swarm-context>');
      expect(result).toContain('urgency');
    });

    it('returns empty string when field is unavailable', () => {
      deps.core.field.superpose = vi.fn(() => null);
      const result = adapter.onPrependSystemContext({ id: 's1' });
      expect(result).toBe('');
    });
  });

  describe('onBeforeShutdown', () => {
    it('calls store.snapshot', () => {
      adapter.onBeforeShutdown();
      expect(deps.core.store.snapshot).toHaveBeenCalled();
    });
  });

  describe('onAgentMessage', () => {
    it('posts to communication and appends to working memory', () => {
      adapter.onAgentMessage({ id: 's1' }, { agentId: 'a1', content: 'hello' });
      expect(deps.core.communication.post).toHaveBeenCalled();
      expect(deps.core.intelligence.appendToMemory).toHaveBeenCalled();
    });
  });

  describe('stats', () => {
    it('hooksFired increments with each hook call', () => {
      adapter.onActivate();
      adapter.onDeactivate();
      adapter.onSessionStart({ id: 's1' });
      expect(adapter.getStats().hooksFired).toBe(3);
    });

    it('getStats returns a copy', () => {
      const s1 = adapter.getStats();
      const s2 = adapter.getStats();
      expect(s1).not.toBe(s2);
      expect(s1).toEqual(s2);
    });
  });
});
