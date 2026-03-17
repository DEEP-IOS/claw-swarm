/**
 * ReplanEngine -- unit tests
 * @module tests/orchestration/planning/replan-engine
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ReplanEngine,
  STRATEGIES,
  FAILURE_STRATEGY_MAP,
  ROLE_ALTERNATIVES,
} from '../../../src/orchestration/planning/replan-engine.js';

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
});

const makeDagEngine = (nodeOverrides = {}) => ({
  getNodeStatus: vi.fn().mockReturnValue({
    id: 'n1',
    taskId: 'task-n1',
    state: 'FAILED',
    retries: 0,
    role: 'implementer',
    dependsOn: [],
    ...nodeOverrides,
  }),
  failNode: vi.fn(),
  assignNode: vi.fn(),
  startNode: vi.fn(),
  completeNode: vi.fn(),
});

// ============================================================================
// Tests
// ============================================================================

describe('ReplanEngine', () => {
  /** @type {ReturnType<typeof makeMocks>} */
  let mocks;
  /** @type {ReturnType<typeof makeDagEngine>} */
  let dagEngine;
  /** @type {ReplanEngine} */
  let engine;

  beforeEach(() => {
    mocks = makeMocks();
    dagEngine = makeDagEngine();
    engine = new ReplanEngine({
      field: mocks.field,
      bus: mocks.bus,
      dagEngine,
    });
  });

  // --------------------------------------------------------------------------
  // 1. timeout failure -> RETRY_SAME_ROLE
  // --------------------------------------------------------------------------
  it('timeout failure selects RETRY_SAME_ROLE strategy', () => {
    const result = engine.selectStrategy(
      { type: 'timeout', message: 'request timed out' },
      'dag-1',
      'n1',
    );

    expect(result.strategyKey).toBe('RETRY_SAME_ROLE');
    expect(result.strategy).toBe(STRATEGIES.RETRY_SAME_ROLE);
    expect(result.reason).toContain('timeout');
  });

  // --------------------------------------------------------------------------
  // 2. quality_low + declining trend -> ESCALATE_MODEL
  // --------------------------------------------------------------------------
  it('capability_insufficient + declining learning -> ESCALATE_MODEL', () => {
    // Return learning signals with declining trend
    mocks.field.read.mockImplementation(({ dimension }) => {
      if (dimension === 'learning') {
        return [{ strength: 0.5, metadata: { trend: 'declining' } }];
      }
      return [];
    });

    engine = new ReplanEngine({
      field: mocks.field,
      bus: mocks.bus,
      dagEngine,
    });

    const result = engine.selectStrategy(
      { type: 'capability_insufficient' },
      'dag-1',
      'n1',
    );

    expect(result.strategyKey).toBe('ESCALATE_MODEL');
  });

  it('timeout + declining learning trend escalates to ESCALATE_MODEL', () => {
    // When timeout would normally be RETRY_SAME_ROLE, but learning signals
    // show declining trend, it should escalate to ESCALATE_MODEL
    mocks.field.read.mockImplementation(({ dimension }) => {
      if (dimension === 'learning') {
        return [{ strength: 0.5, metadata: { trend: 'declining' } }];
      }
      return [];
    });

    engine = new ReplanEngine({
      field: mocks.field,
      bus: mocks.bus,
      dagEngine,
    });

    const result = engine.selectStrategy(
      { type: 'timeout' },
      'dag-1',
      'n1',
    );

    // timeout -> RETRY_SAME_ROLE, but declining learning -> escalate to ESCALATE_MODEL
    expect(result.strategyKey).toBe('ESCALATE_MODEL');
  });

  // --------------------------------------------------------------------------
  // 3. wrong_approach -> CHANGE_ROLE
  // --------------------------------------------------------------------------
  it('wrong_approach failure selects CHANGE_ROLE strategy', () => {
    const result = engine.selectStrategy(
      { type: 'wrong_approach' },
      'dag-1',
      'n1',
    );

    expect(result.strategyKey).toBe('CHANGE_ROLE');
  });

  // --------------------------------------------------------------------------
  // 4. task_too_complex -> SPLIT_TASK
  // --------------------------------------------------------------------------
  it('task_too_complex failure selects SPLIT_TASK strategy', () => {
    const result = engine.selectStrategy(
      { type: 'task_too_complex' },
      'dag-1',
      'n1',
    );

    expect(result.strategyKey).toBe('SPLIT_TASK');
  });

  // --------------------------------------------------------------------------
  // 5. unrecoverable / high alarm -> ABORT_WITH_REPORT
  // --------------------------------------------------------------------------
  it('unrecoverable failure selects ABORT_WITH_REPORT', () => {
    const result = engine.selectStrategy(
      { type: 'unrecoverable' },
      'dag-1',
      'n1',
    );

    expect(result.strategyKey).toBe('ABORT_WITH_REPORT');
  });

  it('high system alarm level forces ABORT_WITH_REPORT', () => {
    // Return high alarm signals (average > 0.8)
    mocks.field.read.mockImplementation(({ dimension }) => {
      if (dimension === 'alarm') {
        return [
          { strength: 0.9 },
          { strength: 0.95 },
        ];
      }
      return [];
    });

    engine = new ReplanEngine({
      field: mocks.field,
      bus: mocks.bus,
      dagEngine,
    });

    // Even though timeout would normally be RETRY_SAME_ROLE
    const result = engine.selectStrategy(
      { type: 'timeout' },
      'dag-1',
      'n1',
    );

    expect(result.strategyKey).toBe('ABORT_WITH_REPORT');
  });

  // --------------------------------------------------------------------------
  // 6. execute: RETRY_SAME_ROLE calls dagEngine.failNode
  // --------------------------------------------------------------------------
  it('execute RETRY_SAME_ROLE calls dagEngine.failNode', () => {
    const result = engine.execute('RETRY_SAME_ROLE', 'dag-1', 'n1');

    expect(result.success).toBe(true);
    expect(result.action).toBe('reset_to_pending');
    expect(dagEngine.failNode).toHaveBeenCalledWith('dag-1', 'n1', 'replan: retry');
    expect(dagEngine.getNodeStatus).toHaveBeenCalledWith('dag-1', 'n1');
  });

  // --------------------------------------------------------------------------
  // 7. execute: ESCALATE_MODEL calls dagEngine.failNode with escalate message
  // --------------------------------------------------------------------------
  it('execute ESCALATE_MODEL returns modelOverride details', () => {
    const result = engine.execute('ESCALATE_MODEL', 'dag-1', 'n1');

    expect(result.success).toBe(true);
    expect(result.action).toBe('escalate_model');
    expect(result.details.modelOverride).toBe('strong');
    expect(dagEngine.failNode).toHaveBeenCalledWith('dag-1', 'n1', 'replan: escalate model');
  });

  // --------------------------------------------------------------------------
  // 8. execute: CHANGE_ROLE picks alternative role
  // --------------------------------------------------------------------------
  it('execute CHANGE_ROLE picks alternative role from mapping', () => {
    dagEngine.getNodeStatus.mockReturnValue({
      id: 'n1',
      taskId: 'task-n1',
      state: 'FAILED',
      retries: 1,
      role: 'implementer',
      dependsOn: [],
    });

    const result = engine.execute('CHANGE_ROLE', 'dag-1', 'n1');

    expect(result.success).toBe(true);
    expect(result.action).toBe('change_role');
    expect(result.details.previousRole).toBe('implementer');
    expect(result.details.newRole).toBe(ROLE_ALTERNATIVES['implementer']);
  });

  // --------------------------------------------------------------------------
  // 9. execute: SPLIT_TASK returns sub-nodes
  // --------------------------------------------------------------------------
  it('execute SPLIT_TASK produces 2 sub-nodes', () => {
    const result = engine.execute('SPLIT_TASK', 'dag-1', 'n1');

    expect(result.success).toBe(true);
    expect(result.action).toBe('split_task');
    expect(result.details.subNodes).toHaveLength(2);
    expect(result.details.subNodes[0].id).toBe('n1-sub-a');
    expect(result.details.subNodes[1].id).toBe('n1-sub-b');
    expect(result.details.subNodes[1].dependsOn).toContain('n1-sub-a');
  });

  // --------------------------------------------------------------------------
  // 10. execute: ABORT_WITH_REPORT returns abort details
  // --------------------------------------------------------------------------
  it('execute ABORT_WITH_REPORT returns abort action', () => {
    const result = engine.execute('ABORT_WITH_REPORT', 'dag-1', 'n1');

    expect(result.success).toBe(true);
    expect(result.action).toBe('abort');
    expect(result.details.reason).toContain('dead-letter');
  });

  // --------------------------------------------------------------------------
  // 11. execute: unknown strategy returns failure
  // --------------------------------------------------------------------------
  it('execute with unknown strategy returns failure', () => {
    const result = engine.execute('UNKNOWN_STRATEGY', 'dag-1', 'n1');

    expect(result.success).toBe(false);
    expect(result.action).toBe('unknown_strategy');
  });

  // --------------------------------------------------------------------------
  // 12. selectStrategy emits replan.strategy.selected event
  // --------------------------------------------------------------------------
  it('selectStrategy publishes strategy selection event', () => {
    engine.selectStrategy({ type: 'timeout' }, 'dag-1', 'n1');

    const calls = mocks.bus.emit.mock.calls.filter(
      ([topic]) => topic === 'replan.strategy.selected'
    );
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toHaveProperty('strategyKey');
    expect(calls[0][1]).toHaveProperty('dagId', 'dag-1');
    expect(calls[0][1]).toHaveProperty('nodeId', 'n1');
  });
});
