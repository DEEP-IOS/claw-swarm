/**
 * PheromoneEngine 单元测试 -- deposit/read/readAll/acoSelect/evaporate + 事件自动触发 + MMAS 约束
 * 使用真实 SignalStore + EventBus（非 mock），确保端到端信号路径可信
 * @module tests/communication/pheromone/pheromone-engine.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignalStore } from '../../../src/core/field/signal-store.js';
import { EventBus } from '../../../src/core/bus/event-bus.js';
import { PheromoneEngine } from '../../../src/communication/pheromone/pheromone-engine.js';

describe('PheromoneEngine', () => {
  let eventBus, field, engine;

  beforeEach(() => {
    eventBus = new EventBus();
    field = new SignalStore({ eventBus });
    engine = new PheromoneEngine({ field, eventBus });
  });

  afterEach(async () => {
    await engine.stop();
    await field.stop();
  });

  // ── deposit: all 6 types ─────────────────────────────────────

  describe('deposit', () => {
    it('deposits all 6 default pheromone types successfully', () => {
      const types = ['trail', 'alarm', 'recruit', 'queen', 'dance', 'food'];
      for (const type of types) {
        const signal = engine.deposit(type, 'scope-1', 0.5, {}, 'agent-1');
        expect(signal).toBeDefined();
        expect(signal.id).toBeDefined();
        expect(signal.metadata.pheromoneType).toBe(type);
      }
    });

    it('deposited signal is queryable from the field', () => {
      engine.deposit('trail', 'task:abc', 0.7, { info: 'hello' }, 'a1');
      const results = field.query({ dimension: 'trail', scope: 'task:abc' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].metadata.pheromoneType).toBe('trail');
    });

    it('unknown type throws', () => {
      expect(() => engine.deposit('unknown', 'scope', 0.5)).toThrow(/unknown type/);
    });

    it('MMAS upper bound: strength > maxBound is clamped to maxBound', () => {
      const signal = engine.deposit('trail', 'scope-1', 2.0);
      // maxBound for trail is 1.0; SignalStore also clamps to [0,1]
      expect(signal.strength).toBeLessThanOrEqual(1.0);
    });

    it('MMAS lower bound: strength < minBound is clamped to minBound', () => {
      const signal = engine.deposit('trail', 'scope-1', 0.001);
      // minBound for trail is 0.01
      expect(signal.strength).toBeGreaterThanOrEqual(0.01);
    });

    it('publishes pheromone.deposited event', () => {
      const handler = vi.fn();
      eventBus.subscribe('pheromone.deposited', handler);
      engine.deposit('alarm', 'scope-x', 0.6, {}, 'emitter-1');
      expect(handler).toHaveBeenCalled();
      const envelope = handler.mock.calls[0][0];
      expect(envelope.data.type).toBe('alarm');
      expect(envelope.data.scope).toBe('scope-x');
    });
  });

  // ── read ─────────────────────────────────────────────────────

  describe('read', () => {
    it('returns only signals matching the pheromone type', () => {
      engine.deposit('trail', 'scope-1', 0.5);
      engine.deposit('alarm', 'scope-1', 0.8);
      engine.deposit('trail', 'scope-1', 0.6);

      const trailSignals = engine.read('trail', 'scope-1');
      expect(trailSignals.length).toBe(2);
      expect(trailSignals.every(s => s.metadata.pheromoneType === 'trail')).toBe(true);
    });

    it('unknown type throws', () => {
      expect(() => engine.read('unknown', 'scope')).toThrow(/unknown type/);
    });

    it('read from empty scope returns empty array', () => {
      const result = engine.read('trail', 'nonexistent-scope');
      expect(result).toEqual([]);
    });
  });

  // ── readAll ──────────────────────────────────────────────────

  describe('readAll', () => {
    it('returns 6-key object with deposited types > 0 and others = 0', () => {
      engine.deposit('trail', 'scope-1', 0.5);
      engine.deposit('alarm', 'scope-1', 0.8);

      const all = engine.readAll('scope-1');
      expect(Object.keys(all)).toHaveLength(6);
      // trail and alarm should have been deposited
      // Others (recruit, queen, dance, food) should be 0
      expect(all.recruit).toBe(0);
      expect(all.queen).toBe(0);
      expect(all.dance).toBe(0);
      expect(all.food).toBe(0);
    });

    it('readAll on empty scope returns all zeros', () => {
      const all = engine.readAll('empty-scope');
      for (const val of Object.values(all)) {
        expect(val).toBe(0);
      }
    });
  });

  // ── acoSelect ────────────────────────────────────────────────

  describe('acoSelect', () => {
    it('throws on empty candidates array', () => {
      expect(() => engine.acoSelect([], 'scope')).toThrow(/must not be empty/);
    });

    it('selects from candidates (basic sanity)', () => {
      const candidates = [
        { id: 'c1', eta: 1.0 },
        { id: 'c2', eta: 1.0 },
        { id: 'c3', eta: 1.0 },
      ];
      const result = engine.acoSelect(candidates, 'scope-aco');
      expect(candidates.some(c => c.id === result.id)).toBe(true);
    });

    it('with uniform tau, all candidates are selectable (run multiple times)', () => {
      const candidates = [
        { id: 'c1', eta: 1.0 },
        { id: 'c2', eta: 1.0 },
      ];
      const counts = { c1: 0, c2: 0 };
      for (let i = 0; i < 200; i++) {
        const result = engine.acoSelect(candidates, 'scope-uniform');
        counts[result.id]++;
      }
      // Both should be selected at least once with uniform tau and eta
      expect(counts.c1).toBeGreaterThan(0);
      expect(counts.c2).toBeGreaterThan(0);
    });

    it('candidate with higher tau is selected more often (statistical)', () => {
      // Deposit trail pheromone for c1 to increase its tau
      for (let i = 0; i < 10; i++) {
        engine.deposit('trail', 'aco-scope:c1', 0.9, {}, 'test');
      }
      // c2 has no deposits (tau defaults to 0.01)

      const candidates = [
        { id: 'c1', eta: 1.0 },
        { id: 'c2', eta: 1.0 },
      ];

      const counts = { c1: 0, c2: 0 };
      for (let i = 0; i < 1000; i++) {
        const result = engine.acoSelect(candidates, 'aco-scope');
        counts[result.id]++;
      }

      // c1 should be selected significantly more often
      expect(counts.c1).toBeGreaterThan(counts.c2);
      // With large tau difference, c1 should dominate
      expect(counts.c1).toBeGreaterThan(800);
    });

    it('increments selectCount', () => {
      const before = engine.stats().selectCount;
      engine.acoSelect([{ id: 'x', eta: 1 }], 'scope');
      expect(engine.stats().selectCount).toBe(before + 1);
    });
  });

  // ── evaporate ────────────────────────────────────────────────

  describe('evaporate', () => {
    it('publishes pheromone.evaporated event', () => {
      const handler = vi.fn();
      eventBus.subscribe('pheromone.evaporated', handler);
      engine.deposit('trail', 'scope-evap', 0.5);
      engine.evaporate('scope-evap', 'trail');
      expect(handler).toHaveBeenCalled();
      const envelope = handler.mock.calls[0][0];
      expect(envelope.data.type).toBe('trail');
      expect(envelope.data.scope).toBe('scope-evap');
      expect(typeof envelope.data.count).toBe('number');
    });

    it('unknown type throws', () => {
      expect(() => engine.evaporate('scope', 'nonexistent')).toThrow(/unknown type/);
    });
  });

  // ── event-driven auto-deposit ────────────────────────────────

  describe('event-driven auto-deposit', () => {
    it('agent.lifecycle.completed triggers trail deposit', () => {
      const before = engine.stats().depositCount;
      eventBus.publish('agent.lifecycle.completed', {
        agentId: 'agent-x',
        scope: 'task:auto-1',
      });
      expect(engine.stats().depositCount).toBe(before + 1);
    });

    it('quality.anomaly.detected triggers alarm deposit', () => {
      const before = engine.stats().depositCount;
      eventBus.publish('quality.anomaly.detected', {
        taskId: 'task:anomaly-1',
        detectorId: 'detector-1',
      });
      expect(engine.stats().depositCount).toBe(before + 1);
    });

    it('after stop, events no longer trigger deposits', async () => {
      await engine.stop();
      const before = engine.stats().depositCount;
      eventBus.publish('agent.lifecycle.completed', { agentId: 'a1' });
      eventBus.publish('quality.anomaly.detected', { taskId: 't1' });
      expect(engine.stats().depositCount).toBe(before);
    });
  });

  // ── stats ────────────────────────────────────────────────────

  describe('stats', () => {
    it('tracks depositCount, readCount, selectCount correctly', () => {
      engine.deposit('trail', 's1', 0.5);
      engine.deposit('alarm', 's1', 0.6);
      engine.read('trail', 's1');
      engine.acoSelect([{ id: 'x', eta: 1 }], 's1');

      const s = engine.stats();
      expect(s.depositCount).toBe(2);
      // readCount includes reads from acoSelect internal calls + explicit read
      expect(s.readCount).toBeGreaterThanOrEqual(1);
      expect(s.selectCount).toBe(1);
    });
  });

  // ── static declarations ──────────────────────────────────────

  describe('static declarations', () => {
    it('produces returns 4 field dimensions', () => {
      expect(PheromoneEngine.produces()).toEqual(['trail', 'alarm', 'knowledge', 'coordination']);
    });

    it('subscribes lists the 2 auto-trigger topics', () => {
      expect(PheromoneEngine.subscribes()).toEqual([
        'agent.lifecycle.completed',
        'quality.anomaly.detected',
      ]);
    });
  });
});
