/**
 * EvidenceGate - Tiered evidence evaluation gate tests
 * @module tests/quality/gate/evidence-gate.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvidenceGate } from '../../../src/quality/gate/evidence-gate.js';

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeClaim(agentId = 'agent-1', type = 'task_result') {
  return { agentId, type, description: 'Test claim' };
}

function makeEvidence(tier, description = 'evidence item') {
  return { tier, description };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('EvidenceGate', () => {
  let field, bus, store, gate;

  beforeEach(() => {
    field = createMockField();
    bus = createMockBus();
    store = createMockStore();
    gate = new EvidenceGate({ field, bus, store });
  });

  // 1. Constructor
  it('creates instance with default thresholds', () => {
    expect(gate).toBeInstanceOf(EvidenceGate);
    expect(gate._hardThreshold).toBe(0.6);
    expect(gate._softThreshold).toBe(0.3);
  });

  // 2. 3 PRIMARY evidences -> score >= 0.8, passed = true
  it('evaluate: 3 PRIMARY evidences yields score >= 0.8 and passed=true', () => {
    const evidences = [
      makeEvidence('PRIMARY', 'direct test'),
      makeEvidence('PRIMARY', 'direct log'),
      makeEvidence('PRIMARY', 'direct observation'),
    ];
    const result = gate.evaluate(makeClaim(), evidences);

    // 3 PRIMARY: avg = 1.0, bonus = 1.0 * 1.2 = 1.2 clamped to 1.0
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.passed).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.flagged).toBe(false);
  });

  // 3. 1 INFERENCE evidence -> score ~0.4, passed = false, flagged = true
  it('evaluate: 1 INFERENCE evidence yields flagged=true (between soft and hard)', () => {
    const evidences = [makeEvidence('INFERENCE', 'indirect reasoning')];
    const result = gate.evaluate(makeClaim(), evidences);

    // INFERENCE weight = 0.4, no PRIMARY bonus => score = 0.4
    expect(result.score).toBeCloseTo(0.4, 5);
    expect(result.passed).toBe(false);
    expect(result.flagged).toBe(true);
    expect(result.blocked).toBe(false);
  });

  // 4. 0 evidences -> score = 0, blocked = true
  it('evaluate: 0 evidences yields score=0 and blocked=true', () => {
    const result = gate.evaluate(makeClaim(), []);

    expect(result.score).toBe(0);
    expect(result.blocked).toBe(true);
    expect(result.passed).toBe(false);
  });

  // 5. Mixed evidences -> correct weighted average
  it('evaluate: mixed evidences produce correct weighted average', () => {
    const evidences = [
      makeEvidence('PRIMARY', 'direct'),         // weight 1.0
      makeEvidence('CORROBORATION', 'support'),   // weight 0.75
      makeEvidence('INFERENCE', 'indirect'),      // weight 0.4
    ];
    const result = gate.evaluate(makeClaim(), evidences);

    // avg = (1.0 + 0.75 + 0.4) / 3 = 0.7166... then PRIMARY bonus * 1.2 = 0.86
    const rawAvg = (1.0 + 0.75 + 0.4) / 3;
    const expected = Math.min(rawAvg * 1.2, 1.0);
    expect(result.score).toBeCloseTo(expected, 5);
  });

  // 6. PRIMARY bonus applied (score * 1.2 clamped to 1.0)
  it('evaluate: PRIMARY bonus applied and clamped to 1.0', () => {
    // 1 PRIMARY: avg = 1.0, * 1.2 = 1.2 -> clamped to 1.0
    const evidences = [makeEvidence('PRIMARY', 'direct')];
    const result = gate.evaluate(makeClaim(), evidences);
    expect(result.score).toBe(1.0);

    // Mix: 1 PRIMARY + 1 INFERENCE: avg = (1.0+0.4)/2 = 0.7, * 1.2 = 0.84
    const evidences2 = [
      makeEvidence('PRIMARY', 'direct'),
      makeEvidence('INFERENCE', 'indirect'),
    ];
    const result2 = gate.evaluate(makeClaim(), evidences2);
    expect(result2.score).toBeCloseTo(0.84, 5);
  });

  // 7. passed=true -> DIM_REPUTATION signal emitted
  it('evaluate: passed=true emits DIM_REPUTATION signal', () => {
    const evidences = [makeEvidence('PRIMARY'), makeEvidence('PRIMARY')];
    gate.evaluate(makeClaim('agent-x'), evidences);

    const reputationCalls = field.emit.mock.calls.filter(
      c => c[0].dimension === 'reputation',
    );
    expect(reputationCalls.length).toBe(1);
    expect(reputationCalls[0][0].scope).toBe('agent-x');
  });

  // 8. passed=false -> DIM_ALARM signal emitted
  it('evaluate: passed=false emits DIM_ALARM signal', () => {
    const evidences = [makeEvidence('INFERENCE')];
    gate.evaluate(makeClaim('agent-y'), evidences);

    const alarmCalls = field.emit.mock.calls.filter(
      c => c[0].dimension === 'alarm',
    );
    expect(alarmCalls.length).toBe(1);
    expect(alarmCalls[0][0].scope).toBe('agent-y');
  });

  // 9. bus.publish called with 'quality.gate.evaluated'
  it('evaluate: publishes quality.gate.evaluated on bus', () => {
    gate.evaluate(makeClaim(), [makeEvidence('PRIMARY')]);

    expect(bus.publish).toHaveBeenCalledWith(
      'quality.gate.evaluated',
      expect.objectContaining({
        score: expect.any(Number),
        passed: expect.any(Boolean),
      }),
      'EvidenceGate',
    );
  });

  // 10. store.put called for audit record
  it('evaluate: stores audit record via store.put', () => {
    gate.evaluate(makeClaim('agent-z'), [makeEvidence('PRIMARY')]);

    expect(store.put).toHaveBeenCalledWith(
      'quality',
      expect.stringMatching(/^gate-agent-z-/),
      expect.objectContaining({
        claim: expect.any(Object),
        score: expect.any(Number),
        timestamp: expect.any(Number),
      }),
    );
  });

  // 11. appeal: retrieves original, merges evidences, re-evaluates with higher score
  it('appeal: merges additional evidences and re-evaluates', () => {
    // First evaluation with just INFERENCE -> low score
    const claim = makeClaim('agent-appeal');
    const initialEvs = [makeEvidence('INFERENCE', 'weak evidence')];
    gate.evaluate(claim, initialEvs);

    // Find the store key from the put call
    const putCall = store.put.mock.calls.find(
      c => c[0] === 'quality' && c[1].startsWith('gate-agent-appeal-'),
    );
    const evalKey = putCall[1];

    // Appeal with additional PRIMARY evidence
    const additionalEvs = [makeEvidence('PRIMARY', 'strong evidence')];
    const appealResult = gate.appeal(evalKey, additionalEvs);

    expect(appealResult).not.toBeNull();
    expect(appealResult.previousScore).toBeCloseTo(0.4, 5);
    expect(appealResult.score).toBeGreaterThan(0.4);
    expect(appealResult.tier).toBe('Direct evidence');
  });

  // 12. appeal: bus.publish 'quality.gate.appealed'
  it('appeal: publishes quality.gate.appealed on bus', () => {
    const claim = makeClaim('agent-a2');
    gate.evaluate(claim, [makeEvidence('INFERENCE')]);

    const putCall = store.put.mock.calls.find(
      c => c[0] === 'quality' && c[1].startsWith('gate-agent-a2-'),
    );
    const evalKey = putCall[1];

    gate.appeal(evalKey, [makeEvidence('PRIMARY')]);

    expect(bus.publish).toHaveBeenCalledWith(
      'quality.gate.appealed',
      expect.objectContaining({
        evaluationId: evalKey,
        previousScore: expect.any(Number),
        newScore: expect.any(Number),
      }),
      'EvidenceGate',
    );
  });

  // 13. getHistory: returns stored evaluations
  it('getHistory: returns evaluations from store', () => {
    // Use fake timers to guarantee distinct timestamps
    vi.useFakeTimers({ now: 1000 });
    gate.evaluate(makeClaim('agent-h'), [makeEvidence('PRIMARY')]);

    vi.setSystemTime(2000);
    gate.evaluate(makeClaim('agent-h'), [makeEvidence('INFERENCE')]);

    const history = gate.getHistory('agent-h');
    expect(history.length).toBe(2);

    vi.useRealTimers();
  });

  // 14. getStats: returns correct passRate, appealRate, avgScore
  it('getStats: returns correct aggregate statistics', () => {
    // Pass
    gate.evaluate(makeClaim(), [makeEvidence('PRIMARY'), makeEvidence('PRIMARY')]);
    // Fail
    gate.evaluate(makeClaim(), []);

    const stats = gate.getStats();
    expect(stats.totalEvaluations).toBe(2);
    expect(stats.passRate).toBe(0.5); // 1 out of 2 passed
    expect(stats.avgScore).toBeGreaterThan(0); // (1.0 + 0) / 2
  });

  // 15. Custom thresholds via config
  it('respects custom thresholds from config', () => {
    const customGate = new EvidenceGate({
      field,
      bus,
      store,
      config: { hardThreshold: 0.9, softThreshold: 0.5 },
    });

    // Score ~0.84 (1 PRIMARY + 1 INFERENCE) is below 0.9 but above 0.5 -> flagged
    const evidences = [makeEvidence('PRIMARY'), makeEvidence('INFERENCE')];
    const result = customGate.evaluate(makeClaim(), evidences);

    expect(result.passed).toBe(false);
    expect(result.flagged).toBe(true);
    expect(result.blocked).toBe(false);
  });
});
