/**
 * QualityController - Multi-dimensional output quality auditor tests
 * @module tests/quality/gate/quality-controller.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QualityController } from '../../../src/quality/gate/quality-controller.js';

// ─── Mock Factories ──────────────────────────────────────────────────────────

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

function createMockStore() {
  const data = new Map();
  return {
    put: vi.fn((domain, key, value) => data.set(`${domain}/${key}`, value)),
    get: vi.fn((domain, key) => data.get(`${domain}/${key}`) || null),
    query: vi.fn((domain, filterFn) => {
      const results = [];
      for (const [k, v] of data) {
        if (k.startsWith(`${domain}/`)) {
          const bareKey = k.slice(domain.length + 1);
          if (!filterFn || filterFn(v, bareKey)) results.push(v);
        }
      }
      return results;
    }),
    delete: vi.fn((domain, key) => data.delete(`${domain}/${key}`)),
    _data: data,
  };
}

function createMockReputationCRDT() {
  return {
    increment: vi.fn(),
    decrement: vi.fn(),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a high-quality agent output object.
 * - result is long, contains documentation keywords, no error markers
 * - filesChanged has a reasonable count
 * - tokensUsed is set
 */
function makeHighQualityOutput(agentId = 'agent-1') {
  return {
    agentId,
    roleId: 'coder',
    taskDescription: 'Implement user login feature',
    result: 'Summary: I have updated the login module. Added input validation step. ' +
      'Changed the auth handler to support OAuth. Because the old approach was insecure, ' +
      'I created a new session manager. The procedure is documented below. ' +
      'This explanation covers all edge cases including timeout and token refresh. ' +
      'Additional notes: the approach handles CJK characters properly too. ' +
      'All steps verified and tested end-to-end with comprehensive coverage.',
    filesChanged: ['auth.js', 'session.js', 'login.vue'],
    tokensUsed: 1500,
    durationMs: 5000,
  };
}

/**
 * Build a low-quality agent output with no result and no files.
 */
function makeLowQualityOutput(agentId = 'agent-2') {
  return {
    agentId,
    roleId: 'coder',
    taskDescription: 'Implement payment processing',
    result: null,
    filesChanged: [],
    tokensUsed: 50,
    durationMs: 200,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('QualityController', () => {
  let field, bus, store, reputationCRDT, controller;

  beforeEach(() => {
    field = createMockField();
    bus = createMockBus();
    store = createMockStore();
    reputationCRDT = createMockReputationCRDT();
    controller = new QualityController({ field, bus, store, reputationCRDT });
  });

  // 1. Constructor
  it('creates instance with default stats', () => {
    expect(controller).toBeInstanceOf(QualityController);
    const stats = controller.getStats();
    expect(stats.totalAudits).toBe(0);
    expect(stats.gradeDistribution).toEqual({ A: 0, B: 0, C: 0, D: 0, F: 0 });
  });

  // 2. High quality output -> score >= 0.7, grade B or A
  it('evaluateOutput: high quality output yields score >= 0.7 and grade B or A', () => {
    const result = controller.evaluateOutput(makeHighQualityOutput());

    expect(result.qualityScore).toBeGreaterThanOrEqual(0.7);
    expect(['A', 'B']).toContain(result.grade);
  });

  // 3. Low quality output -> score < 0.4, grade D or F
  it('evaluateOutput: low quality output yields score < 0.4 and grade D or F', () => {
    const result = controller.evaluateOutput(makeLowQualityOutput());

    expect(result.qualityScore).toBeLessThan(0.4);
    expect(['D', 'F']).toContain(result.grade);
  });

  // 4. Breakdown has 4 items all in [0, 1]
  it('evaluateOutput: breakdown contains 4 dimensions all between 0 and 1', () => {
    const result = controller.evaluateOutput(makeHighQualityOutput());
    const { breakdown } = result;

    expect(Object.keys(breakdown)).toEqual(
      expect.arrayContaining(['correctness', 'completeness', 'style', 'documentation']),
    );
    for (const key of Object.keys(breakdown)) {
      expect(breakdown[key]).toBeGreaterThanOrEqual(0);
      expect(breakdown[key]).toBeLessThanOrEqual(1);
    }
  });

  // 5. Weighted sum = correctness*0.4 + completeness*0.3 + style*0.15 + doc*0.15
  it('evaluateOutput: qualityScore equals weighted sum of breakdown', () => {
    const result = controller.evaluateOutput(makeHighQualityOutput());
    const { breakdown, qualityScore } = result;

    const expected =
      breakdown.correctness   * 0.40 +
      breakdown.completeness  * 0.30 +
      breakdown.style         * 0.15 +
      breakdown.documentation * 0.15;

    expect(qualityScore).toBeCloseTo(expected, 10);
  });

  // 6. score >= 0.7 -> reputationCRDT.increment called
  it('evaluateOutput: score >= 0.7 triggers reputationCRDT.increment', () => {
    controller.evaluateOutput(makeHighQualityOutput('agent-inc'));

    expect(reputationCRDT.increment).toHaveBeenCalledWith('agent-inc');
    expect(reputationCRDT.decrement).not.toHaveBeenCalled();
  });

  // 7. score < 0.4 -> reputationCRDT.decrement called
  it('evaluateOutput: score < 0.4 triggers reputationCRDT.decrement', () => {
    controller.evaluateOutput(makeLowQualityOutput('agent-dec'));

    expect(reputationCRDT.decrement).toHaveBeenCalledWith('agent-dec');
    expect(reputationCRDT.increment).not.toHaveBeenCalled();
  });

  // 8. DIM_REPUTATION signal emitted with correct strength
  it('evaluateOutput: emits DIM_REPUTATION signal with clamped score', () => {
    const output = makeHighQualityOutput('agent-sig');
    const result = controller.evaluateOutput(output);

    expect(field.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'reputation',
        scope: 'agent-sig',
        strength: expect.any(Number),
        emitterId: 'QualityController',
      }),
    );

    const call = field.emit.mock.calls[0][0];
    expect(call.strength).toBeGreaterThanOrEqual(0);
    expect(call.strength).toBeLessThanOrEqual(1);
    expect(call.strength).toBeCloseTo(result.qualityScore, 10);
  });

  // 9. bus.publish 'quality.audit.completed'
  it('evaluateOutput: publishes quality.audit.completed on bus', () => {
    controller.evaluateOutput(makeHighQualityOutput());

    expect(bus.publish).toHaveBeenCalledWith(
      'quality.audit.completed',
      expect.objectContaining({
        agentId: 'agent-1',
        qualityScore: expect.any(Number),
        grade: expect.any(String),
        breakdown: expect.any(Object),
      }),
      'QualityController',
    );
  });

  // 10. store.put audit record
  it('evaluateOutput: stores audit record via store.put', () => {
    controller.evaluateOutput(makeHighQualityOutput('agent-store'));

    expect(store.put).toHaveBeenCalledWith(
      'quality',
      expect.stringMatching(/^audit-agent-store-/),
      expect.objectContaining({
        agentId: 'agent-store',
        qualityScore: expect.any(Number),
      }),
    );
  });

  // 11. _onAgentCompleted: event triggers evaluateOutput
  it('_onAgentCompleted: bus event triggers evaluateOutput', async () => {
    await controller.start();

    // Retrieve the registered handler
    const handler = bus._handlers['agent.completed'];
    expect(handler).toBeDefined();

    // Simulate an event envelope
    handler({ data: makeHighQualityOutput('agent-event') });

    // Should have published an audit
    expect(bus.publish).toHaveBeenCalledWith(
      'quality.audit.completed',
      expect.objectContaining({ agentId: 'agent-event' }),
      'QualityController',
    );
  });

  // 12. getStats: gradeDistribution updated correctly
  it('getStats: gradeDistribution reflects evaluations', () => {
    controller.evaluateOutput(makeHighQualityOutput());
    controller.evaluateOutput(makeLowQualityOutput());
    controller.evaluateOutput(makeHighQualityOutput());

    const stats = controller.getStats();
    expect(stats.totalAudits).toBe(3);
    expect(stats.avgScore).toBeGreaterThan(0);

    // Sum of all grades should equal totalAudits
    const gradeSum = Object.values(stats.gradeDistribution).reduce((a, b) => a + b, 0);
    expect(gradeSum).toBe(3);
  });
});
