/**
 * ComplianceMonitor unit tests
 * Tests LLM output compliance checking with escalation model.
 *
 * @module tests/quality/analysis/compliance-monitor
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock ModuleBase ───────────────────────────────────────────────────────
vi.mock('../../../src/core/module-base.js', () => ({
  ModuleBase: class {
    constructor(deps = {}) {
      this.field = deps.field ?? null;
      this.bus = deps.bus ?? null;
      this.store = deps.store ?? null;
      this.config = deps.config ?? {};
    }
    static produces() { return []; }
    static consumes() { return []; }
    static publishes() { return []; }
    static subscribes() { return []; }
    async start() {}
    async stop() {}
  },
}));

vi.mock('../../../src/core/field/types.js', () => ({
  DIM_ALARM: 'alarm',
  DIM_TRAIL: 'trail',
}));

// ─── Import after mocks ────────────────────────────────────────────────────
const { ComplianceMonitor } = await import('../../../src/quality/analysis/compliance-monitor.js');

// ─── Mock Factories ────────────────────────────────────────────────────────

function createMockField() {
  return {
    emit: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    superpose: vi.fn().mockReturnValue({}),
  };
}

function createMockBus() {
  const handlers = {};
  return {
    publish: vi.fn(),
    subscribe: vi.fn((topic, handler) => { handlers[topic] = handler; }),
    unsubscribe: vi.fn(),
    _handlers: handlers,
  };
}

// ─── Test Suite ────────────────────────────────────────────────────────────

describe('ComplianceMonitor', () => {
  let monitor;
  let field;
  let bus;

  beforeEach(() => {
    field = createMockField();
    bus = createMockBus();
    monitor = new ComplianceMonitor({ field, bus, config: {} });
  });

  // ── 1. Constructor ──────────────────────────────────────────────────

  it('creates an instance with zero violation counters', () => {
    expect(monitor).toBeInstanceOf(ComplianceMonitor);
    const stats = monitor.getStats();
    expect(stats.totalViolations).toBe(0);
  });

  // ── 2. check: normal output is compliant ────────────────────────────

  it('returns { compliant: true } for safe output', () => {
    const result = monitor.check('session-1', 'This is a normal, safe output.');
    expect(result.compliant).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.escalationLevel).toBe(0);
  });

  // ── 3. check: "rm -rf /" triggers unsafe_operation ──────────────────

  it('detects unsafe_operation for "rm -rf /" command', () => {
    const result = monitor.check('session-2', 'Executing rm -rf / to clean up');
    expect(result.compliant).toBe(false);
    const ids = result.violations.map(v => v.id);
    expect(ids).toContain('unsafe_operation');
  });

  // ── 4. check: "/etc/passwd" triggers unauthorized_file_access ───────

  it('detects unauthorized_file_access for reading /etc/passwd', () => {
    const result = monitor.check('session-3', 'reading /etc/passwd for user info');
    expect(result.compliant).toBe(false);
    const ids = result.violations.map(v => v.id);
    expect(ids).toContain('unauthorized_file_access');
  });

  // ── 5. check: "api_key=abc123" triggers sensitive_data_exposure ─────

  it('detects sensitive_data_exposure for api_key patterns', () => {
    const result = monitor.check('session-4', 'Set api_key=abc123 in config');
    expect(result.compliant).toBe(false);
    const ids = result.violations.map(v => v.id);
    expect(ids).toContain('sensitive_data_exposure');
  });

  // ── 6. check: out-of-scope paths trigger scope_violation ────────────

  it('detects scope_violation for file paths outside allowed paths', () => {
    const result = monitor.check('session-5', 'Editing /root/secret/data.json', {
      allowedPaths: ['/home/user/project'],
    });
    expect(result.compliant).toBe(false);
    const ids = result.violations.map(v => v.id);
    expect(ids).toContain('scope_violation');
  });

  // ── 7. check: 1st violation sets escalationLevel 1 ──────────────────

  it('returns escalationLevel 1 on first violation', () => {
    const result = monitor.check('sess-esc', 'rm -rf / dangerous');
    expect(result.escalationLevel).toBe(1);
  });

  // ── 8. check: 2nd violation in same session escalates to level 2 ────

  it('escalates to level 2 on second violation in same session', () => {
    monitor.check('sess-esc2', 'rm -rf /tmp');
    const result2 = monitor.check('sess-esc2', 'reading /etc/passwd');
    expect(result2.escalationLevel).toBe(2);
  });

  // ── 9. check: 3rd violation caps at level 3 ────────────────────────

  it('caps escalation at level 3 on third and subsequent violations', () => {
    monitor.check('sess-esc3', 'rm -rf /tmp');
    monitor.check('sess-esc3', 'reading /etc/passwd');
    const result3 = monitor.check('sess-esc3', 'api_key=secret');
    expect(result3.escalationLevel).toBe(3);

    // 4th violation should still be capped at 3
    const result4 = monitor.check('sess-esc3', 'rm -rf /home');
    expect(result4.escalationLevel).toBe(3);
  });

  // ── 10. check: DIM_ALARM emitted with strength = 0.3 + level*0.2 ──

  it('emits DIM_ALARM with strength = 0.3 + escalationLevel * 0.2', () => {
    // Level 1: strength = 0.3 + 1*0.2 = 0.5
    monitor.check('sess-alarm', 'rm -rf /tmp');
    expect(field.emit).toHaveBeenCalledTimes(1);
    const call1 = field.emit.mock.calls[0][0];
    expect(call1.dimension).toBe('alarm');
    expect(call1.strength).toBeCloseTo(0.5, 5);

    field.emit.mockClear();

    // Level 2: strength = 0.3 + 2*0.2 = 0.7
    monitor.check('sess-alarm', 'reading /etc/passwd');
    const call2 = field.emit.mock.calls[0][0];
    expect(call2.strength).toBeCloseTo(0.7, 5);

    field.emit.mockClear();

    // Level 3: strength = 0.3 + 3*0.2 = 0.9
    monitor.check('sess-alarm', 'api_key=xyz');
    const call3 = field.emit.mock.calls[0][0];
    expect(call3.strength).toBeCloseTo(0.9, 5);
  });

  // ── 11. getEscalationPrompt: level-based warning messages ──────────

  it('returns correct escalation prompts for each level', () => {
    // Level 0: no violations yet
    expect(monitor.getEscalationPrompt('fresh-session')).toBeNull();

    // Level 1: after first violation
    monitor.check('prompt-sess', 'rm -rf /tmp');
    const prompt1 = monitor.getEscalationPrompt('prompt-sess');
    expect(prompt1).toBeTypeOf('string');
    expect(prompt1.toLowerCase()).toContain('warning');

    // Level 2: after second violation
    monitor.check('prompt-sess', 'reading /etc/passwd');
    const prompt2 = monitor.getEscalationPrompt('prompt-sess');
    expect(prompt2).toBeTypeOf('string');
    expect(prompt2.toLowerCase()).toContain('severe');

    // Level 3: after third violation
    monitor.check('prompt-sess', 'api_key=xyz');
    const prompt3 = monitor.getEscalationPrompt('prompt-sess');
    expect(prompt3).toBeTypeOf('string');
    expect(prompt3.toLowerCase()).toContain('final');
  });

  // ── 12. resetSession: clears counter, subsequent check at level 1 ──

  it('resets session counter; next violation starts at level 1 again', () => {
    monitor.check('reset-sess', 'rm -rf /tmp');
    monitor.check('reset-sess', 'reading /etc/passwd');
    expect(monitor.getViolationHistory('reset-sess')).toBe(2);

    monitor.resetSession('reset-sess');
    expect(monitor.getViolationHistory('reset-sess')).toBe(0);

    // Next violation should be level 1 again
    const result = monitor.check('reset-sess', 'rm -rf /var');
    expect(result.escalationLevel).toBe(1);
  });
});
