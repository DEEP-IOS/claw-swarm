/**
 * ExecutionPlanner -- unit tests
 * @module tests/orchestration/planning/execution-planner
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ExecutionPlanner,
  PHASE_TEMPLATES,
  ROLE_KEYWORDS,
} from '../../../src/orchestration/planning/execution-planner.js';

// ============================================================================
// Shared mocks
// ============================================================================

const makeMocks = (fieldReadReturn = []) => ({
  field: {
    emit: vi.fn(),
    read: vi.fn().mockReturnValue(fieldReadReturn),
    query: vi.fn().mockReturnValue([]),
    superpose: vi.fn().mockReturnValue({}),
  },
  bus: {
    emit: vi.fn(),
    publish: vi.fn(),
    subscribe: vi.fn(),
  },
  capabilityEngine: {
    scoreRole: vi.fn().mockReturnValue(0.5),
  },
  hybridRetrieval: {
    getRolePerformance: vi.fn().mockReturnValue(0.5),
  },
});

// ============================================================================
// Tests
// ============================================================================

describe('ExecutionPlanner', () => {
  /** @type {ReturnType<typeof makeMocks>} */
  let mocks;
  /** @type {ExecutionPlanner} */
  let planner;

  beforeEach(() => {
    mocks = makeMocks();
    planner = new ExecutionPlanner({
      field: mocks.field,
      bus: mocks.bus,
      capabilityEngine: mocks.capabilityEngine,
      hybridRetrieval: mocks.hybridRetrieval,
    });
  });

  // --------------------------------------------------------------------------
  // 1. bug_fix intent -> 3-phase DAG (diagnose -> fix -> test)
  // --------------------------------------------------------------------------
  it('bug_fix intent produces 3 phases: diagnose -> fix -> test', () => {
    const result = planner.decompose(
      { primary: 'bug_fix', description: 'fix null pointer bug' },
      { complexity: 'medium' },
    );

    expect(result.length).toBe(3);

    // Verify phase order via taskId prefixes
    expect(result[0].taskId).toContain('diagnose');
    expect(result[1].taskId).toContain('fix');
    expect(result[2].taskId).toContain('test');

    // Verify dependency chain
    expect(result[0].dependsOn).toEqual([]);
    expect(result[1].dependsOn).toEqual([result[0].id]);
    expect(result[2].dependsOn).toEqual([result[1].id]);
  });

  // --------------------------------------------------------------------------
  // 2. new_feature -> 4-phase DAG
  // --------------------------------------------------------------------------
  it('new_feature intent produces 4 phases', () => {
    const result = planner.decompose(
      { primary: 'new_feature', description: 'add search feature' },
      { complexity: 'high' },
    );

    expect(result.length).toBe(4);
    expect(result[0].taskId).toContain('research');
    expect(result[1].taskId).toContain('plan');
    expect(result[2].taskId).toContain('implement');
    expect(result[3].taskId).toContain('review');

    // Sequential dependency chain
    expect(result[1].dependsOn).toEqual([result[0].id]);
    expect(result[2].dependsOn).toEqual([result[1].id]);
    expect(result[3].dependsOn).toEqual([result[2].id]);
  });

  // --------------------------------------------------------------------------
  // 3. Knowledge sufficient (>0.7) skips research phase
  // --------------------------------------------------------------------------
  it('skips research phase when knowledge signals are sufficient', () => {
    // Mock field.read to return high-strength knowledge signals
    mocks.field.read.mockImplementation(({ dimension, minStrength }) => {
      if (dimension === 'knowledge' && minStrength >= 0.7) {
        return [{ strength: 0.9, metadata: {} }];
      }
      return [];
    });

    planner = new ExecutionPlanner({
      field: mocks.field,
      bus: mocks.bus,
      capabilityEngine: mocks.capabilityEngine,
      hybridRetrieval: mocks.hybridRetrieval,
    });

    const result = planner.decompose(
      { primary: 'new_feature', description: 'add caching layer' },
      { complexity: 'medium' },
    );

    // research phase should be skipped, leaving 3 phases
    expect(result.length).toBe(3);
    expect(result[0].taskId).toContain('plan');
    expect(result[1].taskId).toContain('implement');
    expect(result[2].taskId).toContain('review');
  });

  // --------------------------------------------------------------------------
  // 4. MoE scoring: capabilityEngine high-score role is selected
  // --------------------------------------------------------------------------
  it('MoE scoring uses capabilityEngine scores', () => {
    // Make capabilityEngine give high score to debugger
    mocks.capabilityEngine.scoreRole.mockImplementation((roleId) => {
      if (roleId === 'debugger') return 0.95;
      return 0.1;
    });

    planner = new ExecutionPlanner({
      field: mocks.field,
      bus: mocks.bus,
      capabilityEngine: mocks.capabilityEngine,
      hybridRetrieval: mocks.hybridRetrieval,
    });

    // bug_fix "fix" phase has default role "debugger" with candidate [debugger, implementer]
    const result = planner.decompose(
      { primary: 'bug_fix', description: 'repair broken function' },
      {},
    );

    // The "fix" phase should pick debugger (high capability score)
    const fixNode = result.find(n => n.taskId.includes('fix'));
    expect(fixNode).toBeDefined();
    // debugger has keyword matches for "repair" and "fix", plus high capability score
    expect(fixNode.role).toBe('debugger');
  });

  // --------------------------------------------------------------------------
  // 5. selectBestRole returns highest scoring role
  // --------------------------------------------------------------------------
  it('selectBestRole returns the role with the highest MoE score', () => {
    // Make capabilityEngine favor 'tester'
    mocks.capabilityEngine.scoreRole.mockImplementation((roleId) => {
      if (roleId === 'tester') return 0.9;
      return 0.1;
    });

    const result = planner.selectBestRole(
      { description: 'test the login flow' },
      ['researcher', 'tester', 'implementer'],
    );

    expect(result.roleId).toBe('tester');
    expect(result.score).toBeGreaterThan(0);
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 6. explore/question intent -> single phase
  // --------------------------------------------------------------------------
  it('explore intent produces single-phase DAG', () => {
    const result = planner.decompose(
      { primary: 'explore', description: 'explore codebase structure' },
      {},
    );

    expect(result.length).toBe(1);
    expect(result[0].taskId).toContain('explore');
    expect(result[0].dependsOn).toEqual([]);
  });

  it('question intent produces single-phase DAG', () => {
    const result = planner.decompose(
      { primary: 'question', description: 'explain the architecture' },
      {},
    );

    expect(result.length).toBe(1);
    expect(result[0].taskId).toContain('answer');
    expect(result[0].dependsOn).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // 7. selectBestRole with empty candidates returns fallback
  // --------------------------------------------------------------------------
  it('selectBestRole with no candidates returns fallback researcher', () => {
    const result = planner.selectBestRole({ description: 'something' }, []);
    expect(result.roleId).toBe('researcher');
    expect(result.score).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 8. Unknown intent falls back to explore template
  // --------------------------------------------------------------------------
  it('unknown intent type falls back to explore template', () => {
    const result = planner.decompose(
      { primary: 'unknown_intent_xyz', description: 'some task' },
      {},
    );

    expect(result.length).toBe(1);
    expect(result[0].taskId).toContain('explore');
  });

  // --------------------------------------------------------------------------
  // 9. adaptPlan inserts diagnostic node after failure
  // --------------------------------------------------------------------------
  it('adaptPlan inserts diagnostic step after failed node', () => {
    const existingNodes = [
      { id: 'n1', taskId: 'research', role: 'researcher', dependsOn: [] },
      { id: 'n2', taskId: 'implement', role: 'implementer', dependsOn: ['n1'] },
      { id: 'n3', taskId: 'review', role: 'reviewer', dependsOn: ['n2'] },
    ];

    const adapted = planner.adaptPlan(existingNodes, { failedNodeId: 'n2' });

    // Should have 4 nodes now (1 diagnostic inserted)
    expect(adapted.length).toBe(4);

    // The diagnostic node should be after n2
    const diagIdx = adapted.findIndex(n => n.taskId.includes('diagnose failure'));
    expect(diagIdx).toBe(2); // after n2 (index 1)
    expect(adapted[diagIdx].dependsOn).toContain('n2');
    expect(adapted[diagIdx].role).toBe('debugger');
  });

  // --------------------------------------------------------------------------
  // 10. decompose emits plan.created event
  // --------------------------------------------------------------------------
  it('decompose emits plan.created event on bus', () => {
    planner.decompose(
      { primary: 'explore', description: 'explore' },
      {},
    );

    const planCalls = mocks.bus.emit.mock.calls.filter(
      ([topic]) => topic === 'plan.created'
    );
    expect(planCalls.length).toBe(1);
    expect(planCalls[0][1]).toHaveProperty('intentType', 'explore');
    expect(planCalls[0][1]).toHaveProperty('nodeCount');
  });
});
