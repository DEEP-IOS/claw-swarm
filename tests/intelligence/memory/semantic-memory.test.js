/**
 * SemanticMemory — 语义知识图谱 单元测试
 * @module tests/intelligence/memory/semantic-memory
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SemanticMemory } from '../../../src/intelligence/memory/semantic-memory.js';
import { DomainStore } from '../../../src/core/store/domain-store.js';
import { SignalStore } from '../../../src/core/field/signal-store.js';
import { EventBus } from '../../../src/core/bus/event-bus.js';

describe('SemanticMemory', () => {
  let domainStore;
  let field;
  let eventBus;
  let sem;

  beforeEach(() => {
    domainStore = new DomainStore({ domain: 'semantic-test', snapshotDir: '/tmp/semantic-test' });
    field = new SignalStore();
    eventBus = new EventBus();
    sem = new SemanticMemory({ domainStore, field, eventBus });
  });

  it('addFact + queryFacts full round-trip', () => {
    sem.addFact('React', 'uses', 'JSX', 0.9, 'docs');
    const facts = sem.queryFacts({ subject: 'React' });
    expect(facts).toHaveLength(1);
    expect(facts[0].subject).toBe('React');
    expect(facts[0].predicate).toBe('uses');
    expect(facts[0].object).toBe('JSX');
    expect(facts[0].confidence).toBe(0.9);
    expect(facts[0].source).toBe('docs');
  });

  it('duplicate triple updates confidence (takes higher)', () => {
    sem.addFact('A', 'depends-on', 'B', 0.5);
    sem.addFact('A', 'depends-on', 'B', 0.9);
    const facts = sem.queryFacts({ subject: 'A', predicate: 'depends-on' });
    expect(facts).toHaveLength(1);
    expect(facts[0].confidence).toBe(0.9);
  });

  it('duplicate triple does not downgrade confidence', () => {
    sem.addFact('A', 'depends-on', 'B', 0.9);
    sem.addFact('A', 'depends-on', 'B', 0.3);
    const facts = sem.queryFacts({ subject: 'A' });
    expect(facts[0].confidence).toBe(0.9);
  });

  it('queryFacts filter by subject', () => {
    sem.addFact('A', 'uses', 'B');
    sem.addFact('C', 'uses', 'D');
    const facts = sem.queryFacts({ subject: 'A' });
    expect(facts).toHaveLength(1);
    expect(facts[0].subject).toBe('A');
  });

  it('queryFacts filter by predicate', () => {
    sem.addFact('A', 'uses', 'B');
    sem.addFact('A', 'extends', 'C');
    const facts = sem.queryFacts({ predicate: 'extends' });
    expect(facts).toHaveLength(1);
    expect(facts[0].object).toBe('C');
  });

  it('queryFacts filter by object', () => {
    sem.addFact('A', 'uses', 'B');
    sem.addFact('C', 'uses', 'B');
    const facts = sem.queryFacts({ object: 'B' });
    expect(facts).toHaveLength(2);
  });

  it('queryFacts filter by minConfidence', () => {
    sem.addFact('A', 'uses', 'B', 0.3);
    sem.addFact('C', 'uses', 'D', 0.9);
    const facts = sem.queryFacts({ minConfidence: 0.5 });
    expect(facts).toHaveLength(1);
    expect(facts[0].subject).toBe('C');
  });

  it('inferRelated BFS: A->B->C at depth 2', () => {
    sem.addFact('A', 'uses', 'B');
    sem.addFact('B', 'depends-on', 'C');
    const related = sem.inferRelated('A', 2);
    expect(related.length).toBeGreaterThanOrEqual(2);
    const entities = related.map((r) => r.entity);
    expect(entities).toContain('B');
    expect(entities).toContain('C');
    // B should be depth 1, C should be depth 2
    const bEntry = related.find((r) => r.entity === 'B');
    const cEntry = related.find((r) => r.entity === 'C');
    expect(bEntry.depth).toBe(1);
    expect(cEntry.depth).toBe(2);
  });

  it('inferRelated cycle-safe: A->B->A does not loop', () => {
    sem.addFact('A', 'uses', 'B');
    sem.addFact('B', 'uses', 'A');
    const related = sem.inferRelated('A', 5);
    // Should only find B, not revisit A
    const entities = related.map((r) => r.entity);
    expect(entities).toContain('B');
    expect(entities).not.toContain('A');
    // Should terminate (not infinite loop)
    expect(related.length).toBe(1);
  });

  it('removeFact removes the fact', () => {
    const fact = sem.addFact('A', 'uses', 'B');
    expect(sem.queryFacts({ subject: 'A' })).toHaveLength(1);
    sem.removeFact(fact.id);
    expect(sem.queryFacts({ subject: 'A' })).toHaveLength(0);
  });

  it('stats() returns correct aggregate info', () => {
    sem.addFact('A', 'uses', 'B', 0.8);
    sem.addFact('A', 'extends', 'C', 0.6);
    sem.addFact('D', 'uses', 'E', 1.0);
    const s = sem.stats();
    expect(s.totalFacts).toBe(3);
    expect(s.uniqueSubjects).toBe(2); // A, D
    expect(s.uniquePredicates).toBe(2); // uses, extends
    expect(s.averageConfidence).toBeCloseTo(0.8, 2);
  });

  it('field.emit called on addFact (DIM_KNOWLEDGE)', () => {
    const emitSpy = vi.spyOn(field, 'emit');
    sem.addFact('A', 'uses', 'B', 0.9);
    expect(emitSpy).toHaveBeenCalledTimes(1);
    const call = emitSpy.mock.calls[0][0];
    expect(call.dimension).toBe('knowledge');
    expect(call.emitterId).toBe('semantic-memory');
    expect(call.strength).toBeCloseTo(0.9 * 0.3, 5);
  });

  it('getGraph returns nodes and edges', () => {
    sem.addFact('A', 'uses', 'B');
    sem.addFact('B', 'extends', 'C');
    const graph = sem.getGraph();
    expect(graph.nodes).toContain('A');
    expect(graph.nodes).toContain('B');
    expect(graph.nodes).toContain('C');
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toHaveProperty('from');
    expect(graph.edges[0]).toHaveProperty('to');
    expect(graph.edges[0]).toHaveProperty('label');
  });
});
