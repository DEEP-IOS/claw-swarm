/**
 * CriticalPath -- unit tests
 * @module tests/orchestration/planning/critical-path
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CriticalPath,
  BASE_DURATION,
  TREND_COEFFICIENTS,
  DEFAULT_DURATION,
} from '../../../src/orchestration/planning/critical-path.js';

// ============================================================================
// Shared mocks
// ============================================================================

const makeMocks = (fieldReadReturn = []) => ({
  field: {
    emit: vi.fn(),
    read: vi.fn().mockReturnValue(fieldReadReturn),
  },
  bus: {
    emit: vi.fn(),
    publish: vi.fn(),
  },
});

// ============================================================================
// Helpers
// ============================================================================

const mkNode = (id, role, dependsOn = []) => ({ id, role, dependsOn });

// ============================================================================
// Tests
// ============================================================================

describe('CriticalPath', () => {
  /** @type {ReturnType<typeof makeMocks>} */
  let mocks;
  /** @type {CriticalPath} */
  let cp;

  beforeEach(() => {
    mocks = makeMocks();
    cp = new CriticalPath({ field: mocks.field, bus: mocks.bus });
  });

  // --------------------------------------------------------------------------
  // 1. Linear DAG -> critical path = all nodes
  // --------------------------------------------------------------------------
  it('linear DAG: critical path contains all nodes', () => {
    const nodes = [
      mkNode('A', 'researcher'),
      mkNode('B', 'implementer', ['A']),
      mkNode('C', 'tester', ['B']),
    ];

    const durations = new Map([
      ['A', 10000],
      ['B', 20000],
      ['C', 15000],
    ]);

    const result = cp.analyze(nodes, durations);

    // In a linear chain, every node is on the critical path
    expect(result.criticalPath).toEqual(['A', 'B', 'C']);
    expect(result.totalDuration).toBe(45000); // 10k + 20k + 15k
  });

  // --------------------------------------------------------------------------
  // 2. Forked DAG -> critical path = longest branch
  // --------------------------------------------------------------------------
  it('forked DAG: critical path follows the longest branch', () => {
    //   A
    //  / \
    // B   C
    //  \ /
    //   D
    const nodes = [
      mkNode('A', 'researcher'),
      mkNode('B', 'implementer', ['A']),  // B=180000 (long)
      mkNode('C', 'tester', ['A']),        // C=10000 (short)
      mkNode('D', 'reviewer', ['B', 'C']),
    ];

    const durations = new Map([
      ['A', 10000],
      ['B', 180000],
      ['C', 10000],
      ['D', 5000],
    ]);

    const result = cp.analyze(nodes, durations);

    // Critical path should be A -> B -> D (longest)
    expect(result.criticalPath).toContain('A');
    expect(result.criticalPath).toContain('B');
    expect(result.criticalPath).toContain('D');
    expect(result.totalDuration).toBe(10000 + 180000 + 5000);
  });

  // --------------------------------------------------------------------------
  // 3. Nodes with slack > 0 are NOT on the critical path
  // --------------------------------------------------------------------------
  it('nodes with slack > 0 are not on the critical path', () => {
    const nodes = [
      mkNode('A', 'researcher'),
      mkNode('B', 'implementer', ['A']),  // long
      mkNode('C', 'tester', ['A']),        // short
      mkNode('D', 'reviewer', ['B', 'C']),
    ];

    const durations = new Map([
      ['A', 10000],
      ['B', 200000],
      ['C', 5000],   // C is much shorter than B
      ['D', 10000],
    ]);

    const result = cp.analyze(nodes, durations);

    // C should have positive slack because B is much longer
    expect(result.slackTimes.get('C')).toBeGreaterThan(0);
    expect(result.criticalPath).not.toContain('C');
  });

  // --------------------------------------------------------------------------
  // 4. Improving trend -> estimated duration shortened (x0.85)
  // --------------------------------------------------------------------------
  it('improving trend multiplies base duration by 0.85', () => {
    mocks.field.read.mockReturnValue([
      { strength: 0.7, metadata: { role: 'implementer', trend: 'improving' } },
    ]);

    cp = new CriticalPath({ field: mocks.field, bus: mocks.bus });

    const nodes = [mkNode('n1', 'implementer')];
    const durations = cp.estimateDurations(nodes);

    const expected = Math.round(BASE_DURATION.implementer * TREND_COEFFICIENTS.improving);
    expect(durations.get('n1')).toBe(expected);
  });

  it('declining trend multiplies base duration by 1.2', () => {
    mocks.field.read.mockReturnValue([
      { strength: 0.5, metadata: { role: 'tester', trend: 'declining' } },
    ]);

    cp = new CriticalPath({ field: mocks.field, bus: mocks.bus });

    const nodes = [mkNode('n2', 'tester')];
    const durations = cp.estimateDurations(nodes);

    const expected = Math.round(BASE_DURATION.tester * TREND_COEFFICIENTS.declining);
    expect(durations.get('n2')).toBe(expected);
  });

  // --------------------------------------------------------------------------
  // 5. estimateDurations uses correct base durations
  // --------------------------------------------------------------------------
  it('estimateDurations uses BASE_DURATION for each role', () => {
    // No learning signals -> stable trend (x1.0)
    const nodes = [
      mkNode('r1', 'researcher'),
      mkNode('i1', 'implementer'),
      mkNode('t1', 'tester'),
      mkNode('c1', 'coordinator'),
    ];

    const durations = cp.estimateDurations(nodes);

    expect(durations.get('r1')).toBe(BASE_DURATION.researcher);
    expect(durations.get('i1')).toBe(BASE_DURATION.implementer);
    expect(durations.get('t1')).toBe(BASE_DURATION.tester);
    expect(durations.get('c1')).toBe(BASE_DURATION.coordinator);
  });

  it('estimateDurations uses DEFAULT_DURATION for unknown roles', () => {
    const nodes = [mkNode('u1', 'unknown_role_xyz')];
    const durations = cp.estimateDurations(nodes);

    expect(durations.get('u1')).toBe(DEFAULT_DURATION);
  });

  // --------------------------------------------------------------------------
  // 6. analyze with empty nodes returns empty result
  // --------------------------------------------------------------------------
  it('analyze with empty nodes returns empty result', () => {
    const result = cp.analyze([], null);
    expect(result.criticalPath).toEqual([]);
    expect(result.totalDuration).toBe(0);
    expect(result.bottleneck).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 7. getBottleneck returns the longest-duration critical path node
  // --------------------------------------------------------------------------
  it('getBottleneck identifies the longest critical-path node', () => {
    const nodes = [
      mkNode('A', 'coordinator'),   // 30000
      mkNode('B', 'implementer', ['A']),  // 180000 (longest)
      mkNode('C', 'tester', ['B']),       // 120000
    ];

    const result = cp.getBottleneck(nodes);

    expect(result.nodeId).toBe('B');
    expect(result.duration).toBe(BASE_DURATION.implementer);
  });

  // --------------------------------------------------------------------------
  // 8. updateOnCompletion stores actual duration and publishes event
  // --------------------------------------------------------------------------
  it('updateOnCompletion stores duration and publishes event', () => {
    cp.updateOnCompletion('dag-1', 'n1', 50000);

    const calls = mocks.bus.emit.mock.calls.filter(
      ([topic]) => topic === 'critical-path.updated'
    );
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toEqual({
      dagId: 'dag-1',
      nodeId: 'n1',
      actualDuration: 50000,
    });
  });

  // --------------------------------------------------------------------------
  // 9. analyze auto-fills missing durations from BASE_DURATION
  // --------------------------------------------------------------------------
  it('analyze fills missing durations from BASE_DURATION', () => {
    const nodes = [mkNode('A', 'researcher')];
    // Pass no explicit durations
    const result = cp.analyze(nodes);

    expect(result.totalDuration).toBe(BASE_DURATION.researcher);
    expect(result.criticalPath).toEqual(['A']);
  });

  // --------------------------------------------------------------------------
  // 10. analyze accepts plain object for estimatedDurations
  // --------------------------------------------------------------------------
  it('analyze accepts plain object durations instead of Map', () => {
    const nodes = [
      mkNode('A', 'researcher'),
      mkNode('B', 'implementer', ['A']),
    ];

    const result = cp.analyze(nodes, { A: 5000, B: 10000 });

    expect(result.totalDuration).toBe(15000);
    expect(result.criticalPath).toEqual(['A', 'B']);
  });
});
