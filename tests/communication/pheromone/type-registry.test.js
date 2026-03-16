/**
 * TypeRegistry 单元测试 -- 6 种默认信息素类型注册、维度映射、非法输入拒绝
 * @module tests/communication/pheromone/type-registry.test
 */

import { describe, it, expect } from 'vitest';
import { TypeRegistry } from '../../../src/communication/pheromone/type-registry.js';
import {
  DIM_TRAIL,
  DIM_ALARM,
  DIM_COORDINATION,
  DIM_KNOWLEDGE,
} from '../../../src/core/field/types.js';

describe('TypeRegistry', () => {
  // ── default types ────────────────────────────────────────────

  it('registers 6 default pheromone types', () => {
    const reg = new TypeRegistry();
    const types = reg.list();
    expect(types).toHaveLength(6);
    expect(types).toEqual(expect.arrayContaining(['trail', 'alarm', 'recruit', 'queen', 'dance', 'food']));
  });

  // ── get ──────────────────────────────────────────────────────

  it('get returns correct config for each default type', () => {
    const reg = new TypeRegistry();
    const trail = reg.get('trail');
    expect(trail).toEqual({
      lambda: 0.008,
      fieldDim: DIM_TRAIL,
      minBound: 0.01,
      maxBound: 1.0,
      description: expect.any(String),
    });

    const alarm = reg.get('alarm');
    expect(alarm.lambda).toBe(0.15);
    expect(alarm.fieldDim).toBe(DIM_ALARM);
  });

  it('get returns undefined for non-existent type', () => {
    const reg = new TypeRegistry();
    expect(reg.get('nonexistent')).toBeUndefined();
  });

  // ── has ──────────────────────────────────────────────────────

  it('has returns true for existing type, false otherwise', () => {
    const reg = new TypeRegistry();
    expect(reg.has('trail')).toBe(true);
    expect(reg.has('food')).toBe(true);
    expect(reg.has('ghost')).toBe(false);
  });

  // ── getByFieldDim ────────────────────────────────────────────

  it('getByFieldDim(DIM_TRAIL) returns trail and food', () => {
    const reg = new TypeRegistry();
    const result = reg.getByFieldDim(DIM_TRAIL);
    expect(result).toEqual(expect.arrayContaining(['trail', 'food']));
    expect(result).toHaveLength(2);
  });

  it('getByFieldDim(DIM_COORDINATION) returns recruit and queen', () => {
    const reg = new TypeRegistry();
    const result = reg.getByFieldDim(DIM_COORDINATION);
    expect(result).toEqual(expect.arrayContaining(['recruit', 'queen']));
    expect(result).toHaveLength(2);
  });

  it('getByFieldDim(DIM_KNOWLEDGE) returns dance', () => {
    const reg = new TypeRegistry();
    expect(reg.getByFieldDim(DIM_KNOWLEDGE)).toEqual(['dance']);
  });

  it('getByFieldDim(DIM_ALARM) returns alarm', () => {
    const reg = new TypeRegistry();
    expect(reg.getByFieldDim(DIM_ALARM)).toEqual(['alarm']);
  });

  // ── register invalid ────────────────────────────────────────

  it('register with invalid fieldDim throws', () => {
    const reg = new TypeRegistry();
    expect(() => reg.register('custom', {
      lambda: 0.01,
      fieldDim: 'invalid_dimension',
      minBound: 0.01,
      maxBound: 1.0,
      description: 'test',
    })).toThrow(/invalid fieldDim/);
  });

  it('register with valid fieldDim succeeds', () => {
    const reg = new TypeRegistry();
    reg.register('custom', {
      lambda: 0.05,
      fieldDim: DIM_ALARM,
      minBound: 0.02,
      maxBound: 0.9,
      description: 'custom type',
    });
    expect(reg.has('custom')).toBe(true);
    expect(reg.list()).toHaveLength(7);
  });
});
