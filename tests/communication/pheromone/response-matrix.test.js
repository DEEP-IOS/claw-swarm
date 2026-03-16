/**
 * ResponseMatrix 单元测试 -- 响应梯度、紧急度计算、top-K、角色列表、深拷贝
 * 使用真实 SignalStore + EventBus + PheromoneEngine（非 mock）
 * @module tests/communication/pheromone/response-matrix.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SignalStore } from '../../../src/core/field/signal-store.js';
import { EventBus } from '../../../src/core/bus/event-bus.js';
import { PheromoneEngine } from '../../../src/communication/pheromone/pheromone-engine.js';
import { ResponseMatrix } from '../../../src/communication/pheromone/response-matrix.js';

describe('ResponseMatrix', () => {
  let eventBus, field, engine, matrix;

  beforeEach(() => {
    eventBus = new EventBus();
    field = new SignalStore({ eventBus });
    engine = new PheromoneEngine({ field, eventBus });
    matrix = new ResponseMatrix({ pheromoneEngine: engine });
  });

  afterEach(async () => {
    await engine.stop();
    await field.stop();
  });

  // ── getResponseGradient ──────────────────────────────────────

  describe('getResponseGradient', () => {
    it('debugger + alarm + concentration=1.0 returns 0.95', () => {
      // matrix._matrix.alarm.debugger = 0.95
      const gradient = matrix.getResponseGradient('alarm', 'debugger', 1.0);
      expect(gradient).toBeCloseTo(0.95, 5);
    });

    it('researcher + dance + concentration=0.5 returns 0.45', () => {
      // matrix._matrix.dance.researcher = 0.9; 0.9 * 0.5 = 0.45
      const gradient = matrix.getResponseGradient('dance', 'researcher', 0.5);
      expect(gradient).toBeCloseTo(0.45, 5);
    });

    it('unknown role uses default 0.5 * concentration', () => {
      const gradient = matrix.getResponseGradient('trail', 'unknown_role', 0.8);
      // baseResponse defaults to 0.5 for unknown role; 0.5 * 0.8 = 0.4
      expect(gradient).toBeCloseTo(0.4, 5);
    });

    it('zero concentration returns 0', () => {
      const gradient = matrix.getResponseGradient('alarm', 'debugger', 0);
      expect(gradient).toBe(0);
    });
  });

  // ── computeUrgency ───────────────────────────────────────────

  describe('computeUrgency', () => {
    it('returns 0 for scope with no pheromones', () => {
      const urgency = matrix.computeUrgency('empty-scope', 'debugger');
      expect(urgency).toBe(0);
    });

    it('returns > 0 after depositing pheromones', () => {
      engine.deposit('alarm', 'scope-u', 0.9);
      engine.deposit('trail', 'scope-u', 0.7);
      const urgency = matrix.computeUrgency('scope-u', 'debugger');
      expect(urgency).toBeGreaterThan(0);
      expect(urgency).toBeLessThanOrEqual(1);
    });

    it('urgency is bounded to [0, 1]', () => {
      // Deposit many strong pheromones
      const types = ['trail', 'alarm', 'recruit', 'queen', 'dance', 'food'];
      for (const type of types) {
        engine.deposit(type, 'scope-max', 1.0);
      }
      const urgency = matrix.computeUrgency('scope-max', 'coordinator');
      expect(urgency).toBeLessThanOrEqual(1);
      expect(urgency).toBeGreaterThanOrEqual(0);
    });
  });

  // ── getTopPheromones ─────────────────────────────────────────

  describe('getTopPheromones', () => {
    it('returns sorted entries with correct topK limit', () => {
      engine.deposit('alarm', 'scope-top', 0.9);
      engine.deposit('trail', 'scope-top', 0.5);
      engine.deposit('dance', 'scope-top', 0.7);

      const top2 = matrix.getTopPheromones('scope-top', 'debugger', 2);
      expect(top2).toHaveLength(2);
      // Each entry has { type, gradient }
      expect(top2[0]).toHaveProperty('type');
      expect(top2[0]).toHaveProperty('gradient');
      // Sorted descending by gradient
      expect(top2[0].gradient).toBeGreaterThanOrEqual(top2[1].gradient);
    });

    it('default topK=3 returns at most 3 entries', () => {
      engine.deposit('alarm', 'scope-top3', 0.8);
      engine.deposit('trail', 'scope-top3', 0.5);
      engine.deposit('recruit', 'scope-top3', 0.6);
      engine.deposit('dance', 'scope-top3', 0.7);

      const top = matrix.getTopPheromones('scope-top3', 'researcher');
      expect(top.length).toBeLessThanOrEqual(3);
    });
  });

  // ── getRoles ─────────────────────────────────────────────────

  describe('getRoles', () => {
    it('returns 10 roles', () => {
      const roles = matrix.getRoles();
      expect(roles).toHaveLength(10);
      expect(roles).toEqual(expect.arrayContaining([
        'researcher', 'implementer', 'reviewer', 'debugger', 'coordinator',
        'architect', 'tester', 'analyst', 'optimizer', 'mentor',
      ]));
    });
  });

  // ── getMatrix (deep copy) ────────────────────────────────────

  describe('getMatrix', () => {
    it('returns a deep copy that does not affect the original', () => {
      const copy = matrix.getMatrix();

      // Verify it has the right structure
      expect(copy).toHaveProperty('trail');
      expect(copy).toHaveProperty('alarm');
      expect(copy.trail).toHaveProperty('debugger');

      // Mutate the copy
      const originalValue = copy.trail.debugger;
      copy.trail.debugger = 999;

      // Original should be unchanged
      const fresh = matrix.getMatrix();
      expect(fresh.trail.debugger).toBe(originalValue);
    });

    it('copy has all 6 pheromone types as keys', () => {
      const copy = matrix.getMatrix();
      expect(Object.keys(copy).sort()).toEqual(['alarm', 'dance', 'food', 'queen', 'recruit', 'trail']);
    });
  });
});
