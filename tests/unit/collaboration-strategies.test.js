/**
 * @fileoverview Unit tests for Claw-Swarm v4.0 - Layer 3 Collaboration Strategies
 * @module tests/unit/collaboration-strategies.test
 *
 * 测试协作策略：冻结、字段验证、策略内容。
 * Tests collaboration strategies: freezing, field validation, strategy content.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  STRATEGIES,
  getStrategy,
  listStrategies,
} from '../../src/layer3-intelligence/collaboration/strategies.js';

// ===========================================================================
// STRATEGIES — 协作策略 / Collaboration Strategies
// ===========================================================================

describe('STRATEGIES', () => {
  it('should be frozen at top level (顶层应冻结)', () => {
    assert.ok(Object.isFrozen(STRATEGIES));
  });

  it('should contain exactly 4 strategies (恰好包含 4 种策略)', () => {
    const keys = Object.keys(STRATEGIES);
    assert.equal(keys.length, 4);
  });

  it('should contain parallel, pipeline, debate, stigmergy (包含 parallel, pipeline, debate, stigmergy)', () => {
    assert.ok(STRATEGIES.parallel);
    assert.ok(STRATEGIES.pipeline);
    assert.ok(STRATEGIES.debate);
    assert.ok(STRATEGIES.stigmergy);
  });

  it('each strategy should have required fields (每个策略应有必需字段)', () => {
    for (const [key, strategy] of Object.entries(STRATEGIES)) {
      assert.ok(strategy.id, `${key} missing id`);
      assert.ok(strategy.name, `${key} missing name`);
      assert.ok(strategy.description, `${key} missing description`);
      assert.ok(strategy.spawnMode, `${key} missing spawnMode`);
      assert.ok(strategy.communication, `${key} missing communication`);
      assert.ok(Array.isArray(strategy.requires), `${key} requires should be an array`);
      assert.ok(typeof strategy.maxAgents === 'number', `${key} maxAgents should be a number`);
    }
  });

  it('strategy values should be correct types (策略值类型正确)', () => {
    for (const strategy of Object.values(STRATEGIES)) {
      assert.equal(typeof strategy.id, 'string');
      assert.equal(typeof strategy.name, 'string');
      assert.equal(typeof strategy.description, 'string');
      assert.equal(typeof strategy.spawnMode, 'string');
      assert.equal(typeof strategy.communication, 'string');
      assert.equal(typeof strategy.maxAgents, 'number');
      assert.ok(strategy.maxAgents > 0);
    }
  });

  it('should have frozen individual strategy objects (每个策略对象应冻结)', () => {
    for (const strategy of Object.values(STRATEGIES)) {
      assert.ok(Object.isFrozen(strategy));
    }
  });

  it('cannot modify strategies (无法修改策略)', () => {
    assert.throws(() => {
      STRATEGIES.newStrategy = { id: 'new' };
    }, TypeError);
  });

  it('cannot modify individual strategy fields (无法修改单个策略字段)', () => {
    assert.throws(() => {
      STRATEGIES.parallel.maxAgents = 100;
    }, TypeError);
  });

  it('parallel strategy should use run spawnMode (parallel 策略使用 run 模式)', () => {
    assert.equal(STRATEGIES.parallel.spawnMode, 'run');
    assert.equal(STRATEGIES.parallel.communication, 'pheromone');
  });

  it('pipeline strategy should use session spawnMode (pipeline 策略使用 session 模式)', () => {
    assert.equal(STRATEGIES.pipeline.spawnMode, 'session');
    assert.equal(STRATEGIES.pipeline.communication, 'memory');
  });
});

// ===========================================================================
// getStrategy — 获取策略 / Get Strategy
// ===========================================================================

describe('getStrategy', () => {
  it('should return strategy by name (通过名称获取策略)', () => {
    const s = getStrategy('debate');
    assert.equal(s.id, 'debate');
  });

  it('should default to parallel for unknown name (未知名称默认返回 parallel)', () => {
    const s = getStrategy('nonexistent');
    assert.equal(s.id, 'parallel');
  });
});

// ===========================================================================
// listStrategies — 列出策略 / List Strategies
// ===========================================================================

describe('listStrategies', () => {
  it('should return all strategies as array (以数组形式返回所有策略)', () => {
    const list = listStrategies();
    assert.equal(list.length, 4);
    const ids = list.map(s => s.id);
    assert.ok(ids.includes('parallel'));
    assert.ok(ids.includes('pipeline'));
    assert.ok(ids.includes('debate'));
    assert.ok(ids.includes('stigmergy'));
  });
});
