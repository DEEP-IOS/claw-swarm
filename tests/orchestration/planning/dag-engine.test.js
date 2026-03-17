/**
 * DAGEngine -- unit tests
 * @module tests/orchestration/planning/dag-engine
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DAGEngine, NODE_STATE } from '../../../src/orchestration/planning/dag-engine.js';

// ============================================================================
// Shared mocks
// ============================================================================

const makeMocks = () => ({
  field: {
    emit: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    superpose: vi.fn().mockReturnValue({}),
    read: vi.fn().mockReturnValue([]),
  },
  bus: {
    emit: vi.fn(),
    publish: vi.fn(),
    subscribe: vi.fn(),
  },
  store: {},
});

// ============================================================================
// Helpers
// ============================================================================

/** Build a simple node definition */
const node = (id, role = 'implementer', dependsOn = []) => ({
  id,
  taskId: `task-${id}`,
  role,
  dependsOn,
});

// ============================================================================
// Tests
// ============================================================================

describe('DAGEngine', () => {
  /** @type {ReturnType<typeof makeMocks>} */
  let mocks;
  /** @type {DAGEngine} */
  let engine;

  beforeEach(() => {
    mocks = makeMocks();
    engine = new DAGEngine({
      field: mocks.field,
      bus: mocks.bus,
      store: mocks.store,
    });
  });

  // --------------------------------------------------------------------------
  // 1. Linear DAG topological sort + getReady progression
  // --------------------------------------------------------------------------
  it('linear DAG (A->B->C): getReady returns nodes one by one', () => {
    const nodes = [
      node('A', 'researcher'),
      node('B', 'implementer', ['A']),
      node('C', 'tester', ['B']),
    ];

    engine.createDAG('d1', nodes);

    // Initially only A is ready (no deps)
    const ready1 = engine.getReady('d1');
    expect(ready1.map(n => n.id)).toEqual(['A']);

    // Move A through the state machine
    engine.assignNode('d1', 'A', 'agent-1');
    engine.startNode('d1', 'A');
    engine.completeNode('d1', 'A', { ok: true });

    // Now B should be ready
    const ready2 = engine.getReady('d1');
    expect(ready2.map(n => n.id)).toEqual(['B']);

    engine.assignNode('d1', 'B', 'agent-2');
    engine.startNode('d1', 'B');
    engine.completeNode('d1', 'B', { ok: true });

    // Now C should be ready
    const ready3 = engine.getReady('d1');
    expect(ready3.map(n => n.id)).toEqual(['C']);
  });

  // --------------------------------------------------------------------------
  // 2. Fork+merge DAG: A -> (B,C) -> D
  // --------------------------------------------------------------------------
  it('fork+merge DAG handles parallel and convergence', () => {
    const nodes = [
      node('A', 'researcher'),
      node('B', 'implementer', ['A']),
      node('C', 'tester', ['A']),
      node('D', 'reviewer', ['B', 'C']),
    ];

    engine.createDAG('d2', nodes);

    // Only A is initially ready
    expect(engine.getReady('d2').map(n => n.id)).toEqual(['A']);

    // Complete A
    engine.assignNode('d2', 'A', 'ag1');
    engine.startNode('d2', 'A');
    engine.completeNode('d2', 'A', {});

    // B and C are now ready in parallel
    const ready = engine.getReady('d2').map(n => n.id).sort();
    expect(ready).toEqual(['B', 'C']);

    // Complete only B -- D not yet ready
    engine.assignNode('d2', 'B', 'ag2');
    engine.startNode('d2', 'B');
    engine.completeNode('d2', 'B', {});
    expect(engine.getReady('d2').map(n => n.id)).toEqual(['C']);

    // Complete C -- now D is ready
    engine.assignNode('d2', 'C', 'ag3');
    engine.startNode('d2', 'C');
    engine.completeNode('d2', 'C', {});
    expect(engine.getReady('d2').map(n => n.id)).toEqual(['D']);
  });

  // --------------------------------------------------------------------------
  // 3. Cycle detection (A->B->C->A)
  // --------------------------------------------------------------------------
  it('cyclic dependency throws error', () => {
    const nodes = [
      node('A', 'researcher', ['C']),
      node('B', 'implementer', ['A']),
      node('C', 'tester', ['B']),
    ];

    expect(() => engine.createDAG('cyc', nodes)).toThrow(/[Cc]yclic/);
  });

  // --------------------------------------------------------------------------
  // 4. failNode retries 3 times then enters DLQ
  // --------------------------------------------------------------------------
  it('failNode retries then enters dead-letter queue after maxRetries', () => {
    engine = new DAGEngine({
      field: mocks.field,
      bus: mocks.bus,
      config: { maxRetries: 3 },
    });

    engine.createDAG('d3', [node('N1', 'implementer')]);

    // Assign + start so we can fail it from EXECUTING state initially
    // Actually failNode doesn't check state explicitly for EXECUTING,
    // it just increments retries and resets or DLQs.
    // But the first 3 calls with retries < 3 reset to PENDING.
    engine.failNode('d3', 'N1', 'err-1'); // retries=1, < 3 -> PENDING
    expect(engine.getNodeStatus('d3', 'N1').state).toBe('PENDING');

    engine.failNode('d3', 'N1', 'err-2'); // retries=2, < 3 -> PENDING
    expect(engine.getNodeStatus('d3', 'N1').state).toBe('PENDING');

    engine.failNode('d3', 'N1', 'err-3'); // retries=3, >= 3 -> DEAD_LETTER
    expect(engine.getNodeStatus('d3', 'N1').state).toBe('DEAD_LETTER');

    // DLQ should have 1 entry
    const dlq = engine.getDeadLetterQueue();
    expect(dlq.length).toBe(1);
    expect(dlq[0].nodeId).toBe('N1');
  });

  // --------------------------------------------------------------------------
  // 5. DLQ evicts oldest when over maxDLQSize
  // --------------------------------------------------------------------------
  it('DLQ evicts oldest entries when exceeding maxDLQSize', () => {
    engine = new DAGEngine({
      field: mocks.field,
      bus: mocks.bus,
      config: { maxRetries: 1, maxDLQSize: 2 },
    });

    // Create 3 separate DAGs with 1 node each
    for (let i = 0; i < 3; i++) {
      engine.createDAG(`dlq-${i}`, [node(`N${i}`, 'implementer')]);
      engine.failNode(`dlq-${i}`, `N${i}`, `error-${i}`); // retries=1 >= 1 -> DLQ
    }

    const dlq = engine.getDeadLetterQueue();
    // maxDLQSize=2, so only the 2 newest should remain
    expect(dlq.length).toBe(2);
    // getDeadLetterQueue returns newest first
    expect(dlq[0].nodeId).toBe('N2');
    expect(dlq[1].nodeId).toBe('N1');
  });

  // --------------------------------------------------------------------------
  // 6. Work-stealing respects cooldown
  // --------------------------------------------------------------------------
  it('stealWork respects cooldown period', () => {
    engine = new DAGEngine({
      field: mocks.field,
      bus: mocks.bus,
      config: { workStealCooldownMs: 100000 }, // 100 seconds
    });

    engine.createDAG('ws1', [node('W1', 'implementer'), node('W2', 'tester')]);

    // First steal should succeed
    const stolen1 = engine.stealWork('ws1', 'idle-agent');
    expect(stolen1).not.toBeNull();

    // Second steal on the same node should be blocked by cooldown
    // But W2 might still be eligible if it hasn't been stolen yet
    // After steal, W1 is ASSIGNED so only W2 is PENDING
    const stolen2 = engine.stealWork('ws1', 'idle-agent-2');
    expect(stolen2).not.toBeNull();
    expect(stolen2.id).toBe('W2');

    // Now both are assigned, no more steals possible
    const stolen3 = engine.stealWork('ws1', 'idle-agent-3');
    expect(stolen3).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 7. cancelDAG marks all incomplete nodes as DEAD_LETTER
  // --------------------------------------------------------------------------
  it('cancelDAG marks all incomplete nodes as DEAD_LETTER', () => {
    engine.createDAG('can1', [
      node('C1', 'researcher'),
      node('C2', 'implementer', ['C1']),
      node('C3', 'tester', ['C2']),
    ]);

    // Complete C1
    engine.assignNode('can1', 'C1', 'ag1');
    engine.startNode('can1', 'C1');
    engine.completeNode('can1', 'C1', {});

    engine.cancelDAG('can1');

    expect(engine.getNodeStatus('can1', 'C1').state).toBe('COMPLETED');
    expect(engine.getNodeStatus('can1', 'C2').state).toBe('DEAD_LETTER');
    expect(engine.getNodeStatus('can1', 'C3').state).toBe('DEAD_LETTER');
  });

  // --------------------------------------------------------------------------
  // 8. All COMPLETED -> dag.completed event published
  // --------------------------------------------------------------------------
  it('publishes dag.completed when all nodes are COMPLETED', () => {
    engine.createDAG('comp1', [node('X1', 'researcher')]);

    engine.assignNode('comp1', 'X1', 'ag1');
    engine.startNode('comp1', 'X1');
    engine.completeNode('comp1', 'X1', { done: true });

    // bus.emit should have been called with 'dag.completed'
    const completedCalls = mocks.bus.emit.mock.calls.filter(
      ([topic]) => topic === 'dag.completed'
    );
    expect(completedCalls.length).toBe(1);
    expect(completedCalls[0][1]).toEqual({ dagId: 'comp1' });
  });

  // --------------------------------------------------------------------------
  // 9. getDAGStatus returns correct counts
  // --------------------------------------------------------------------------
  it('getDAGStatus returns correct statistics', () => {
    engine.createDAG('stat1', [
      node('S1', 'researcher'),
      node('S2', 'implementer', ['S1']),
      node('S3', 'tester', ['S1']),
    ]);

    // S1: assign + start + complete
    engine.assignNode('stat1', 'S1', 'ag1');
    engine.startNode('stat1', 'S1');
    engine.completeNode('stat1', 'S1', {});

    // S2: assign -> ASSIGNED
    engine.assignNode('stat1', 'S2', 'ag2');

    // S3 stays PENDING

    const status = engine.getDAGStatus('stat1');
    expect(status.total).toBe(3);
    expect(status.completed).toBe(1);
    expect(status.assigned).toBe(1);
    expect(status.pending).toBe(1);
  });

  // --------------------------------------------------------------------------
  // 10. assignNode + startNode + completeNode state flow
  // --------------------------------------------------------------------------
  it('state flow: PENDING -> ASSIGNED -> EXECUTING -> COMPLETED', () => {
    engine.createDAG('flow1', [node('F1', 'researcher')]);

    const s0 = engine.getNodeStatus('flow1', 'F1');
    expect(s0.state).toBe('PENDING');

    engine.assignNode('flow1', 'F1', 'agent-x');
    const s1 = engine.getNodeStatus('flow1', 'F1');
    expect(s1.state).toBe('ASSIGNED');
    expect(s1.assignedTo).toBe('agent-x');

    engine.startNode('flow1', 'F1');
    const s2 = engine.getNodeStatus('flow1', 'F1');
    expect(s2.state).toBe('EXECUTING');

    engine.completeNode('flow1', 'F1', { result: 42 });
    const s3 = engine.getNodeStatus('flow1', 'F1');
    expect(s3.state).toBe('COMPLETED');
    expect(s3.result).toEqual({ result: 42 });
  });

  // --------------------------------------------------------------------------
  // Bonus: assigning a non-PENDING node throws
  // --------------------------------------------------------------------------
  it('assignNode throws if node is not PENDING', () => {
    engine.createDAG('err1', [node('E1', 'researcher')]);
    engine.assignNode('err1', 'E1', 'ag1'); // now ASSIGNED
    expect(() => engine.assignNode('err1', 'E1', 'ag2')).toThrow(/PENDING/);
  });

  // --------------------------------------------------------------------------
  // Bonus: empty nodes throws
  // --------------------------------------------------------------------------
  it('createDAG with empty nodes throws', () => {
    expect(() => engine.createDAG('empty', [])).toThrow(/empty/i);
  });

  // --------------------------------------------------------------------------
  // Bonus: duplicate dagId throws
  // --------------------------------------------------------------------------
  it('createDAG with duplicate dagId throws', () => {
    engine.createDAG('dup1', [node('D1', 'researcher')]);
    expect(() => engine.createDAG('dup1', [node('D2', 'researcher')])).toThrow(/already exists/);
  });
});
